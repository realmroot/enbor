// Create-session orchestration — deps-first.
//
// This cluster owns building a new session: secret-material guards, envFrom /
// workspace reference validation, provider + policy + runtime-catalog
// checks, snapshot serialization, the 38-field session-row build, and the launch
// path (self-hosted work item, queued cloud turn, or inline cloud startup). It
// also owns the self-hosted work-item enqueue and resume-token lookup, which the
// prompt cluster reuses.
//
// Deps-first: the orchestration store, audit, policy, cloud-turn queue, and
// runtime input gateway all arrive as ports on `deps`; provider/runtime resolution
// and the inline cloud launch run through sibling usecases. The module is
// infra-free — it reaches for ports + domain + shared + runtime leaf shaping +
// sibling usecases only. Logic is verbatim from the former
// server/runtime/session-create module; only dependency acquisition changed.

import type { RuntimeName } from '@server/contracts/environment-contracts'
import {
  IdentityRuntimeMismatchError,
  IdentityRuntimeRequiredError,
  IdentityRuntimeUnsupportedError,
  resolveIdentityRuntime,
} from '@server/domain/identity'
import { enborMemoryRef, memoryStoreIdFromRef } from '@server/domain/memory-store'
import { runtimeDriverName, runtimeNameForIdentity } from '@server/domain/runtime/driver'
import type {
  EnvFromEntry,
  GitRepositoryVolume,
  MemoryVolume,
  SecretItem,
  Volume,
  VolumeMount,
} from '@server/domain/runtime/execution-inputs'
import {
  type AgentSnapshot,
  agentSnapshotWithWorkspaceContext,
  agentSubagentReferences,
  createAgentSnapshot,
  createEnvironmentSnapshot,
  createSessionSubagentSnapshot,
  type EnvironmentSnapshot,
  normalizeEnvironmentSnapshot,
  parseJson,
} from '@server/domain/runtime/session-snapshot'
import { now, requestIdFrom, stringify } from '@server/domain/runtime/util'
import { runtimeRequirement, selfHostedRuntimeModel } from '@server/domain/runtime-catalog'
import { environmentHostingMode } from '@server/domain/runtime-session'
import { hasSecretMaterial, sessionUserMetadata } from '@server/domain/session'
import { normalizeWorkspaceSpec, workspaceSpec } from '@server/domain/workspace'
import { newPrimaryKey } from '@server/id'
import { safeRuntimeError } from '@server/runtime-error'
import { SESSION_DO_EVENT_STORE } from '@shared/session-events'
import { creationDigest, creationFingerprint } from '../creation-idempotency'
import type {
  AgentRow,
  AgentVersionRow,
  AuthScope,
  CloudTurnQueueStartMessage,
  RunnerChannel,
  SessionCreateOptions,
  SessionOrchestrationStore,
  SessionRow,
  SessionUpdate,
  WorkItemInsert,
} from '../ports'
import { ResourceDeletedDuringMutationError } from '../ports'
import type { CloudTurnDeps } from './cloud-turn'
import { startSessionRuntimeForRow } from './cloud-turn'
import { validateRuntimeProviderModel } from './provisioning'

const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
const VOLUME_NAME_PATTERN = /^[A-Za-z0-9._-]+$/
const SECRET_ITEM_PATH_PATTERN = /^[A-Za-z0-9._/-]+$/
const REALMROOT_STATE_VOLUME = 'realmroot-agent-state'
const REALMROOT_STATE_DIR = '/workspace/.enbor/realmroot-state'
const REALMROOT_RESERVED_ENV = new Set(['AGENT', 'AGENT_SESSION_ID', 'REALMROOT_ORIGIN', 'REALMROOT_STATE_DIR'])

function pathsOverlap(left: string, right: string) {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`)
}

// The create flow delegates the inline cloud launch to the cloud-turn usecase,
// so it needs the full CloudTurnDeps. The self-hosted / queued paths use the
// store, audit, policy, queue, and runtime input ports directly.
//
// rereadStartedSession mirrors the legacy RUNTIME_MODE === 'test' branch: in
// test mode the inline cloud launch ran synchronously so the row is re-read to
// surface the started session; in production the launch is fire-and-forget and
// the pending row is returned as-is.
export type CreateSessionDeps = CloudTurnDeps & { runnerChannel: RunnerChannel; rereadStartedSession: boolean }

type SessionRuntimeError = {
  status: 400 | 403 | 404 | 409 | 500
  code: string
  message: string
  fields?: Record<string, string>
  detail?: Record<string, unknown>
}

export type CreateSessionOptions = SessionCreateOptions

export type CreateSessionResult = { ok: true; session: SessionRow } | { ok: false; error: SessionRuntimeError }

async function resolveMemoryVolumes(
  store: SessionOrchestrationStore,
  auth: AuthScope,
  volumes: Volume[],
): Promise<{ volumes: Volume[] } | { fields: Record<string, string> }> {
  const resolved: Volume[] = []
  for (const [index, volume] of volumes.entries()) {
    if (volume.type !== 'memory') {
      resolved.push(volume)
      continue
    }
    const storeId = typeof volume.memoryRef === 'string' ? memoryStoreIdFromRef(volume.memoryRef) : null
    if (!storeId) {
      return { fields: { [`volumes.${index}.memoryRef`]: 'Memory reference must use enbor://memories/{storeId}.' } }
    }
    if (!(await store.activeMemoryStoreExists(auth.project.id, storeId))) {
      return { fields: { [`volumes.${index}.memoryRef`]: 'Memory store must exist and be active.' } }
    }
    resolved.push({
      name: volume.name,
      type: 'memory',
      memoryRef: enborMemoryRef(storeId),
    } satisfies MemoryVolume)
  }
  return { volumes: resolved }
}

async function resolveEnvFromEntries(
  store: SessionOrchestrationStore,
  auth: AuthScope,
  envFrom: EnvFromEntry[],
): Promise<{ entries: EnvFromEntry[] } | { fields: Record<string, string> }> {
  const entries: EnvFromEntry[] = []
  const names = new Set<string>()
  for (const [index, entry] of envFrom.entries()) {
    const field = `envFrom.${index}`
    if (entry.type !== 'secret') {
      return { fields: { [`${field}.type`]: 'Use secret.' } }
    }
    if (entry.name !== undefined) {
      if (!ENV_NAME_PATTERN.test(entry.name)) {
        return { fields: { [`${field}.name`]: 'Use a valid environment variable name.' } }
      }
      if (names.has(entry.name)) {
        return { fields: { [`${field}.name`]: 'Secret environment variable names must be unique.' } }
      }
      names.add(entry.name)
    } else if (entry.key !== undefined) {
      return { fields: { [`${field}.key`]: 'Secret data key requires name.' } }
    }
    const secretRef = entry.secretRef
    const version = await store.secretVersionForResolution(auth.organization.id, auth.project.id, secretRef)
    if (version?.state !== 'active') {
      return {
        fields: {
          [`${field}.secretRef`]: 'Secret reference must exist, be active, and belong to this project or organization.',
        },
      }
    }
    entries.push({
      type: 'secret',
      secretRef,
      ...(entry.name !== undefined ? { name: entry.name } : {}),
      ...(entry.key ? { key: entry.key } : {}),
    })
  }
  return { entries }
}

function validateSecretItems(field: string, items: SecretItem[] | undefined): Record<string, string> | null {
  if (!items) {
    return null
  }
  if (!Array.isArray(items) || items.length > 50) {
    return { [`${field}.items`]: 'Use at most 50 secret items.' }
  }
  const paths = new Set<string>()
  for (const [index, item] of items.entries()) {
    const key = item.key
    const path = item.path
    if (typeof key !== 'string' || key.length === 0 || key.length > 253) {
      return { [`${field}.items.${index}.key`]: 'Use a valid secret data key.' }
    }
    const segments = typeof path === 'string' ? path.split('/') : []
    if (
      typeof path !== 'string' ||
      path.length === 0 ||
      path.length > 253 ||
      !SECRET_ITEM_PATH_PATTERN.test(path) ||
      path.startsWith('/') ||
      segments.some((segment) => !segment || segment === '.' || segment === '..')
    ) {
      return { [`${field}.items.${index}.path`]: 'Use a safe relative item path.' }
    }
    if (paths.has(path)) {
      return { [`${field}.items.${index}.path`]: 'Secret item paths must be unique.' }
    }
    paths.add(path)
  }
  return null
}

async function validateDeclaredVolumes(
  store: SessionOrchestrationStore,
  auth: AuthScope,
  volumes: Volume[],
  volumeMounts: VolumeMount[],
): Promise<{ volumes: Volume[]; volumeMounts: VolumeMount[] } | { fields: Record<string, string> }> {
  const volumeNames = new Set<string>()
  const normalizedVolumes: Volume[] = []
  for (const [index, volume] of volumes.entries()) {
    const field = `volumes.${index}`
    if (!VOLUME_NAME_PATTERN.test(volume.name) || volume.name === '.' || volume.name === '..') {
      return { fields: { [`${field}.name`]: 'Use a safe volume name.' } }
    }
    if (volumeNames.has(volume.name)) {
      return { fields: { [`${field}.name`]: 'Volume names must be unique.' } }
    }
    volumeNames.add(volume.name)
    if (volume.type === 'empty_dir') {
      const seedPaths = new Set<string>()
      for (const [projectionIndex, projection] of (volume.seedFrom ?? []).entries()) {
        const projectionField = `${field}.seedFrom.${projectionIndex}`
        const itemFields = validateSecretItems(projectionField, projection.items)
        if (itemFields) {
          return { fields: itemFields }
        }
        for (const [itemIndex, item] of (projection.items ?? []).entries()) {
          if (seedPaths.has(item.path)) {
            return {
              fields: {
                [`${projectionField}.items.${itemIndex}.path`]:
                  'Empty directory seed paths must be unique across projections.',
              },
            }
          }
          seedPaths.add(item.path)
        }
        const version = await store.secretVersionForResolution(
          auth.organization.id,
          auth.project.id,
          projection.secretRef,
        )
        if (version?.state !== 'active') {
          return { fields: { [`${projectionField}.secretRef`]: 'Seed secret reference must be active.' } }
        }
      }
      normalizedVolumes.push(volume)
      continue
    }
    if (volume.type !== 'secret') {
      if (volume.type === 'git_repository' && volume.secretRef) {
        const itemFields = validateSecretItems(field, volume.items)
        if (itemFields) {
          return { fields: itemFields }
        }
        const version = await store.secretVersionForResolution(auth.organization.id, auth.project.id, volume.secretRef)
        if (version?.state !== 'active') {
          return {
            fields: {
              [`${field}.secretRef`]: 'Git repository secret reference must point to an active credential version.',
            },
          }
        }
        normalizedVolumes.push({ ...volume, secretRef: volume.secretRef } satisfies GitRepositoryVolume)
        continue
      }
      if (volume.type === 'git_repository' && volume.items && volume.items.length > 0) {
        return { fields: { [`${field}.items`]: 'Secret items require a secretRef.' } }
      }
      normalizedVolumes.push(volume)
      continue
    }
    const itemFields = validateSecretItems(field, volume.items)
    if (itemFields) {
      return { fields: itemFields }
    }
    const version = await store.secretVersionForResolution(auth.organization.id, auth.project.id, volume.secretRef)
    if (version) {
      if (version.state !== 'active') {
        return { fields: { [`${field}.secretRef`]: 'Secret reference must be active.' } }
      }
      normalizedVolumes.push({ ...volume, secretRef: volume.secretRef })
      continue
    }
    const vaultVersions = await store.vaultVersionsForResolution(
      auth.organization.id,
      auth.project.id,
      volume.secretRef,
    )
    if (!vaultVersions) {
      return {
        fields: { [`${field}.secretRef`]: 'Secret reference must point to an active credential version or vault.' },
      }
    }
    if (volume.items && volume.items.length > 0) {
      return { fields: { [`${field}.items`]: 'Secret items require a credential reference.' } }
    }
    normalizedVolumes.push(volume)
  }

  const mountedNames = new Set<string>()
  const normalizedMounts: VolumeMount[] = []
  for (const [index, mount] of volumeMounts.entries()) {
    const field = `volumeMounts.${index}`
    if (!volumeNames.has(mount.name)) {
      return { fields: { [`${field}.name`]: 'Volume mount must reference a declared volume.' } }
    }
    if (mountedNames.has(mount.name)) {
      return { fields: { [`${field}.name`]: 'Volume can only be mounted once.' } }
    }
    mountedNames.add(mount.name)
    if (!mount.mountPath.startsWith('/workspace/') || mount.mountPath.includes('..')) {
      return { fields: { [`${field}.mountPath`]: 'Volume mount path must stay under /workspace.' } }
    }
    normalizedMounts.push({ name: mount.name, mountPath: mount.mountPath, readOnly: mount.readOnly ?? true })
  }

  for (const volumeName of volumeNames) {
    if (!mountedNames.has(volumeName)) {
      return { fields: { volumes: `Volume ${volumeName} must have a matching volume mount.` } }
    }
  }

  return { volumes: normalizedVolumes, volumeMounts: normalizedMounts }
}

// ── Session reads ───────────────────────────────────────────────────────────

async function currentAgentVersion(store: SessionOrchestrationStore, agent: AgentRow) {
  if (!agent.currentVersionId) {
    return null
  }
  return store.findAgentVersion(agent.id, agent.currentVersionId)
}

async function sessionSubagentSnapshots(
  store: SessionOrchestrationStore,
  projectId: string,
  parentAgentId: string,
  version: AgentVersionRow,
) {
  const snapshots = []
  for (const reference of agentSubagentReferences(version)) {
    if (typeof reference?.agentId !== 'string' || !reference.agentId.trim()) {
      return {
        error: 'Stored sub-agent configuration must reference an Agent resource; apply pending database migrations',
      } as const
    }
    if (reference.agentId === parentAgentId) {
      return { error: 'An Agent cannot reference itself as a sub-agent' } as const
    }
    const agent = await store.findAgent(projectId, reference.agentId)
    if (!agent || agent.deletedAt || !agent.currentVersionId) {
      return { error: `Referenced sub-agent is deleted or unavailable: ${reference.agentId}` } as const
    }
    const agentVersion = await store.findAgentVersion(agent.id, agent.currentVersionId)
    if (!agentVersion) {
      return { error: `Referenced sub-agent has no current version: ${reference.agentId}` } as const
    }
    snapshots.push(createSessionSubagentSnapshot(agent, agentVersion, reference.name))
  }
  return { snapshots } as const
}

function sessionPrompt(prompt: string) {
  return prompt
}

function sessionTitleFromPrompt(prompt: string) {
  const title = prompt.split(/\r?\n/, 1)[0]?.replace(/\s+/g, ' ').trim()
  if (!title) {
    return 'New session'
  }
  return title.length > 80 ? `${title.slice(0, 77).trimEnd()}...` : title
}

function identityRuntimeInputs(
  binding: AgentSnapshot['identity'],
  sessionId: string,
  env: Record<string, string>,
  envFrom: EnvFromEntry[],
  volumes: Volume[],
  volumeMounts: VolumeMount[],
):
  | { env: Record<string, string>; volumes: Volume[]; volumeMounts: VolumeMount[] }
  | { fields: Record<string, string> } {
  if (!binding) return { env, volumes, volumeMounts }
  const reserved = Object.keys(env).find((name) => REALMROOT_RESERVED_ENV.has(name))
  if (reserved) {
    return { fields: { [`env.${reserved}`]: `${reserved} is managed by the Realmroot Agent binding.` } }
  }
  const reservedEnvFromIndex = envFrom.findIndex((entry) => entry.name && REALMROOT_RESERVED_ENV.has(entry.name))
  if (reservedEnvFromIndex >= 0) {
    return {
      fields: {
        [`envFrom.${reservedEnvFromIndex}.name`]: 'Realmroot Agent environment variables are managed by the binding.',
      },
    }
  }
  const bulkEnvFromIndex = envFrom.findIndex((entry) => entry.name === undefined)
  if (bulkEnvFromIndex >= 0) {
    return {
      fields: {
        [`envFrom.${bulkEnvFromIndex}.name`]:
          'Realmroot-bound Sessions require explicit envFrom names to protect managed variables.',
      },
    }
  }
  if (volumes.some((volume) => volume.name === REALMROOT_STATE_VOLUME)) {
    return { fields: { volumes: `Volume name ${REALMROOT_STATE_VOLUME} is reserved for Realmroot Agent state.` } }
  }
  if (volumeMounts.some((mount) => pathsOverlap(mount.mountPath, REALMROOT_STATE_DIR))) {
    return { fields: { volumeMounts: 'Realmroot Agent state mount paths are reserved.' } }
  }
  const issuerPath = base64Url(binding.issuer)
  const runtimePath = `${base64Url(binding.runtime)}.json`
  return {
    env: {
      ...env,
      AGENT: binding.runtime,
      AGENT_SESSION_ID: sessionId,
      REALMROOT_ORIGIN: new URL(binding.issuer).origin,
      REALMROOT_STATE_DIR,
    },
    volumes: [
      ...volumes,
      {
        name: REALMROOT_STATE_VOLUME,
        type: 'empty_dir',
        seedFrom: [
          {
            type: 'secret',
            secretRef: binding.credentialRef,
            items: [{ key: 'state.json', path: `identities/${issuerPath}/${runtimePath}` }],
          },
        ],
      },
    ],
    volumeMounts: [...volumeMounts, { name: REALMROOT_STATE_VOLUME, mountPath: REALMROOT_STATE_DIR, readOnly: false }],
  }
}

function base64Url(value: string) {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

// ── Work item enqueue ───────────────────────────────────────────────────────

export async function enqueueSelfHostedSessionWork(
  deps: Pick<CreateSessionDeps, 'sessionOrchestration' | 'runnerChannel'>,
  auth: AuthScope,
  values: {
    session: SessionRow
    agentSnapshot: AgentSnapshot
    environmentSnapshot: EnvironmentSnapshot | null
    runtime: RuntimeName
    runtimeConfig: Record<string, unknown>
    env?: Record<string, string>
    envFrom?: EnvFromEntry[]
    volumes?: Volume[]
    volumeMounts?: VolumeMount[]
    prompt?: string
    resume?: boolean
    resumeToken?: string | null
    requestId?: string | null
  },
) {
  const timestamp = now()
  const workItem = selfHostedSessionWorkItem(auth, values, timestamp)
  await deps.sessionOrchestration.insertWorkItem(workItem)
  if (workItem.environmentId) {
    await deps.runnerChannel.assignWork({
      organizationId: auth.organization.id,
      projectId: auth.project.id,
      environmentId: workItem.environmentId,
      workItemId: workItem.id,
    })
  }
}

export async function queueSelfHostedSessionWorkWhenState(
  deps: Pick<CreateSessionDeps, 'sessionOrchestration' | 'runnerChannel'>,
  auth: AuthScope,
  values: Parameters<typeof enqueueSelfHostedSessionWork>[2],
  expected: string | string[],
  sessionUpdate: SessionUpdate,
  timestamp = now(),
) {
  const workItem = selfHostedSessionWorkItem(auth, values, timestamp)
  const queued = await deps.sessionOrchestration.queueSessionWorkWhenState(
    auth.project.id,
    values.session.id,
    expected,
    sessionUpdate,
    workItem,
  )
  if (queued && workItem.environmentId) {
    await deps.runnerChannel.assignWork({
      organizationId: auth.organization.id,
      projectId: auth.project.id,
      environmentId: workItem.environmentId,
      workItemId: workItem.id,
    })
  }
  return queued
}

function selfHostedSessionWorkItem(
  auth: AuthScope,
  values: Parameters<typeof enqueueSelfHostedSessionWork>[2],
  timestamp: string,
): WorkItemInsert {
  const runnerModel = selfHostedRuntimeModel(values.agentSnapshot.provider, values.agentSnapshot.model)
  const payload = {
    protocol: 'enbor-runner-work',
    type: 'session.start',
    sessionId: values.session.id,
    hostingMode: values.environmentSnapshot?.type ?? 'self_hosted',
    runtime: values.runtime,
    runtimeConfig: values.runtimeConfig,
    ...(values.agentSnapshot.provider ? { provider: values.agentSnapshot.provider } : {}),
    ...(runnerModel ? { model: runnerModel } : {}),
    runtimeDriver: runtimeDriverName(values.runtime, 'self_hosted'),
    agentSnapshot: values.agentSnapshot,
    environmentSnapshot: values.environmentSnapshot,
    env: values.env ?? {},
    envFrom: values.envFrom ?? [],
    volumes: values.volumes ?? [],
    volumeMounts: values.volumeMounts ?? [],
    requestId: requestIdFrom(values.requestId),
    prompt: values.prompt ?? null,
    resume: values.resume ?? false,
    resumeToken: values.resumeToken ?? null,
    runtimeRequirement:
      values.environmentSnapshot?.type === 'self_hosted' ? runtimeRequirement(values.runtime, runnerModel) : null,
  }
  return {
    id: newPrimaryKey(),
    organizationId: auth.organization.id,
    projectId: auth.project.id,
    sessionId: values.session.id,
    environmentId: values.session.environmentId,
    runnerId: null,
    leaseId: null,
    type: 'session.start',
    state: 'available',
    priority: 0,
    attempts: 0,
    maxAttempts: 3,
    payload: stringify(payload),
    result: null,
    error: null,
    availableAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

export async function latestRunnerResumeToken(
  deps: Pick<CreateSessionDeps, 'sessionOrchestration'>,
  auth: AuthScope,
  sessionId: string,
) {
  const rows = await deps.sessionOrchestration.recentSessionWorkItems(auth.project.id, sessionId, 5)
  for (const row of rows) {
    if (row.state === 'succeeded') {
      const result = parseJson<Record<string, unknown>>(row.result)
      if (typeof result?.resumeToken === 'string' && result.resumeToken) {
        return result.resumeToken
      }
    }
    const payload = parseJson<Record<string, unknown>>(row.payload)
    if (typeof payload?.resumeToken === 'string' && payload.resumeToken) {
      return payload.resumeToken
    }
  }
  return null
}

// ── Create session ──────────────────────────────────────────────────────────

export async function createSessionForAgent(
  deps: CreateSessionDeps,
  auth: AuthScope,
  agentId: string,
  requestedEnvironmentId: string | null,
  options: CreateSessionOptions,
  requestId: string | null,
): Promise<CreateSessionResult> {
  const store = deps.sessionOrchestration
  const audit = deps.audit
  const policy = deps.policy
  const { idempotencyKey, ...creationOptions } = options
  const keyHash = idempotencyKey ? await creationDigest(idempotencyKey) : undefined
  const fingerprint = keyHash
    ? await creationFingerprint({ agentId, requestedEnvironmentId, options: creationOptions })
    : undefined
  const replay = async (): Promise<CreateSessionResult | null> => {
    if (!keyHash) return null
    const existing = await store.findSessionCreation(auth.project.id, keyHash)
    if (!existing) return null
    if (existing.fingerprint !== fingerprint) {
      return {
        ok: false,
        error: {
          status: 409,
          code: 'idempotency_conflict',
          message: 'Idempotency-Key was already used for a different Session creation request.',
        },
      }
    }
    const session = await store.findSession(auth.project.id, existing.sessionId)
    if (!session) {
      return {
        ok: false,
        error: { status: 409, code: 'idempotency_conflict', message: 'Idempotency-Key belongs to a deleted Session.' },
      }
    }
    return { ok: true, session }
  }
  const existing = await replay()
  if (existing) return existing
  const userPrompt = options.prompt.trim()
  if (!userPrompt) {
    return {
      ok: false,
      error: {
        status: 400,
        code: 'validation_error',
        message: 'Prompt is required',
        fields: { prompt: 'Prompt is required.' },
      },
    }
  }
  if (
    hasSecretMaterial(options.metadata) ||
    hasSecretMaterial(options.volumes) ||
    hasSecretMaterial(options.runtimeConfig) ||
    hasSecretMaterial(options.env)
  ) {
    return {
      ok: false,
      error: {
        status: 400,
        code: 'validation_error',
        message: 'Invalid session configuration',
        fields: {
          metadata: 'Secret material must be stored in secret references.',
          volumes: 'Volumes must not contain secret material.',
          runtimeConfig: 'Secret material must be stored in secret references.',
          env: 'Session environment variables must not contain raw secret material.',
        },
      },
    }
  }
  const normalizedWorkspaceVolumes = normalizeWorkspaceSpec(
    workspaceSpec(options.volumes ?? [], options.volumeMounts ?? []),
  )
  if ('fields' in normalizedWorkspaceVolumes) {
    return {
      ok: false,
      error: {
        status: 400,
        code: 'validation_error',
        message: 'Invalid session volumes',
        fields: normalizedWorkspaceVolumes.fields,
      },
    }
  }

  const agent = await store.findAgent(auth.project.id, agentId)
  if (!agent) {
    return { ok: false, error: { status: 404, code: 'not_found', message: 'Agent not found' } }
  }
  if (agent.deletedAt) {
    return { ok: false, error: { status: 409, code: 'conflict', message: 'Deleted agents cannot create sessions' } }
  }

  const agentVersion = await currentAgentVersion(store, agent)
  if (!agentVersion) {
    throw new Error('Agent current version is required')
  }
  const providerId = agentVersion.providerId
  const resolvedSubagents = await sessionSubagentSnapshots(store, auth.project.id, agent.id, agentVersion)
  if ('error' in resolvedSubagents) {
    return { ok: false, error: { status: 409, code: 'conflict', message: resolvedSubagents.error } }
  }
  const agentSnapshot = createAgentSnapshot(agentVersion, resolvedSubagents.snapshots)
  let runtime: RuntimeName
  try {
    runtime = runtimeNameForIdentity(resolveIdentityRuntime(options.runtime, agentSnapshot.identity))
  } catch (error) {
    if (
      error instanceof IdentityRuntimeMismatchError ||
      error instanceof IdentityRuntimeRequiredError ||
      error instanceof IdentityRuntimeUnsupportedError
    ) {
      return { ok: false, error: { status: 409, code: error.code, message: error.message } }
    }
    throw error
  }
  const id = options.id ?? newPrimaryKey()
  const realmrootInputs = identityRuntimeInputs(
    agentSnapshot.identity,
    id,
    options.env ?? {},
    options.envFrom ?? [],
    normalizedWorkspaceVolumes.volumes,
    normalizedWorkspaceVolumes.volumeMounts,
  )
  if ('fields' in realmrootInputs) {
    return {
      ok: false,
      error: {
        status: 400,
        code: 'validation_error',
        message: 'Invalid Realmroot runtime configuration',
        fields: realmrootInputs.fields,
      },
    }
  }
  const prompt = sessionPrompt(userPrompt)
  if (providerId) {
    const { decision: policyDecision, override: policyOverride } = await policy.evaluateProviderForSession(auth, {
      providerId,
      modelId: agentVersion.model,
      adminOverride: false,
    })
    if (!policyDecision.allowed) {
      await audit.record(auth, {
        action: 'session.create',
        resourceType: 'session',
        outcome: 'denied',
        requestId: requestIdFrom(requestId),
        policyCategory: policyDecision.category,
        metadata: { agentId, providerId, modelId: agentVersion.model, decision: policyDecision },
      })
      return {
        ok: false,
        error: {
          status: 403,
          code: 'policy_denied',
          message: policyDecision.message,
          detail: {
            category: policyDecision.category,
            resourceType:
              policyDecision.category === 'budget'
                ? 'budget'
                : policyDecision.category === 'model'
                  ? 'model'
                  : 'provider',
            resourceId:
              policyDecision.category === 'budget'
                ? policyDecision.rule
                : policyDecision.category === 'model'
                  ? agentVersion.model
                  : providerId,
            ruleId: policyDecision.rule,
          },
        },
      }
    }
    if (policyOverride) {
      await audit.record(auth, {
        action: 'session.create',
        resourceType: 'session',
        outcome: 'success',
        requestId: requestIdFrom(requestId),
        policyCategory: 'override',
        metadata: {
          agentId,
          providerId,
          modelId: agentVersion.model,
          overriddenDecision: policyOverride,
        },
      })
    }
  }

  // Resolve an environment when the caller didn't pin one: pick one whose
  // active runner can serve this runtime/model. Cloud runtimes have no runner,
  // so they resolve to nothing and must pin an environment explicitly.
  const environmentId =
    requestedEnvironmentId ??
    (await store.resolveEnvironmentForRuntime(
      auth.project.id,
      runtime,
      selfHostedRuntimeModel(providerId, agentVersion.model),
    ))
  if (!environmentId) {
    return {
      ok: false,
      error: {
        status: 409,
        code: 'conflict',
        message: `No environment has an active runner for runtime "${runtime}"; specify environmentId`,
      },
    }
  }

  const environment = await store.findEnvironment(auth.project.id, environmentId)
  if (!environment?.currentVersionId) {
    return {
      ok: false,
      error: { status: 409, code: 'conflict', message: 'Selected environment is deleted or unavailable' },
    }
  }
  const environmentVersion = await store.findEnvironmentVersion(auth.project.id, environment.currentVersionId)
  if (!environmentVersion) {
    return {
      ok: false,
      error: { status: 409, code: 'conflict', message: 'Selected environment is deleted or unavailable' },
    }
  }
  const resolvedWorkspaceVolumes = await resolveMemoryVolumes(store, auth, realmrootInputs.volumes)
  if ('fields' in resolvedWorkspaceVolumes) {
    return {
      ok: false,
      error: {
        status: 400,
        code: 'validation_error',
        message: 'Invalid session memory store volume',
        fields: resolvedWorkspaceVolumes.fields,
      },
    }
  }
  const validatedEnvFrom = await resolveEnvFromEntries(store, auth, options.envFrom ?? [])
  if ('fields' in validatedEnvFrom) {
    return {
      ok: false,
      error: {
        status: 400,
        code: 'validation_error',
        message: 'Invalid session envFrom references',
        fields: validatedEnvFrom.fields,
      },
    }
  }

  const mergedEnv = realmrootInputs.env
  const mergedEnvFrom = validatedEnvFrom.entries
  const validatedVolumes = await validateDeclaredVolumes(
    store,
    auth,
    resolvedWorkspaceVolumes.volumes,
    realmrootInputs.volumeMounts,
  )
  if ('fields' in validatedVolumes) {
    return {
      ok: false,
      error: {
        status: 400,
        code: 'validation_error',
        message: 'Invalid session volumes',
        fields: validatedVolumes.fields,
      },
    }
  }

  const timestamp = now()
  const runtimeAgentSnapshot = agentSnapshotWithWorkspaceContext(
    agentSnapshot,
    validatedVolumes.volumes,
    validatedVolumes.volumeMounts,
  )
  const baseEnvironmentSnapshot = normalizeEnvironmentSnapshot(createEnvironmentSnapshot(environmentVersion))
  const runtimeConfig = options.runtimeConfig ?? {}
  const environmentSnapshot = baseEnvironmentSnapshot
  const hostingMode = environmentHostingMode(environmentSnapshot)
  const usesCloudLoop = runtime === 'enbor'
  if (hostingMode === 'cloud' && deps.cloudSandboxEnabled === false) {
    return {
      ok: false,
      error: {
        status: 403,
        code: 'forbidden',
        message: 'Cloud sandbox sessions are not available; use a self-hosted environment',
        detail: {
          reason: 'cloud_sandbox_disabled',
          resourceType: 'environment',
          resourceId: environmentId,
          hostingMode,
        },
      },
    }
  }
  const budgetDenial = hostingMode === 'cloud' ? await deps.platformBudget?.check(auth.organization.id) : null
  if (budgetDenial) {
    return {
      ok: false,
      error: {
        status: 403,
        code: 'policy_denied',
        message: budgetDenial.message,
        detail: { category: budgetDenial.category, ruleId: budgetDenial.rule, resourceType: 'budget' },
      },
    }
  }
  if (
    !(await validateRuntimeProviderModel(
      deps,
      auth,
      environmentId,
      hostingMode,
      runtime,
      providerId,
      agentSnapshot.model,
    ))
  ) {
    return {
      ok: false,
      error: {
        status: 409,
        code: 'conflict',
        message: 'Unsupported runtime provider/model combination',
        detail: {
          resourceType: 'runtime_catalog',
          runtime,
          hostingMode,
          provider: providerId,
          model: agentSnapshot.model,
        },
      },
    }
  }
  const sandboxId = usesCloudLoop ? id.toLowerCase() : null
  if (hostingMode === 'cloud') {
    const sandboxDecision = await policy.evaluateSandboxRuntime(auth, {
      session: {
        id,
        agentSnapshot: stringify(agentSnapshot),
        environmentSnapshot: environmentSnapshot ? stringify(environmentSnapshot) : null,
      },
      operation: 'startup',
      command: null,
      host: null,
    })
    if (!sandboxDecision.allowed) {
      await audit.record(auth, {
        action: 'session.create',
        resourceType: 'session',
        outcome: 'denied',
        requestId: requestIdFrom(requestId),
        policyCategory: sandboxDecision.category,
        metadata: { agentId, environmentId, decision: sandboxDecision },
      })
      return {
        ok: false,
        error: {
          status: 403,
          code: 'policy_denied',
          message: sandboxDecision.message,
          detail: {
            category: sandboxDecision.category,
            resourceType: 'sandbox',
            resourceId: sandboxId ?? id,
            ruleId: sandboxDecision.rule,
          },
        },
      }
    }
  }
  const userMetadata = sessionUserMetadata(options.metadata)
  const pending = {
    id,
    agentId,
    organizationId: auth.organization.id,
    createdByUserId: auth.user.id,
    agentVersionId: agentVersion.id,
    agentSnapshot: stringify(agentSnapshot),
    environmentId,
    environmentVersionId: environmentVersion.id,
    environmentSnapshot: environmentSnapshot ? stringify(environmentSnapshot) : null,
    title: options.name ?? sessionTitleFromPrompt(userPrompt),
    env: stringify(mergedEnv),
    envFrom: stringify(mergedEnvFrom),
    volumes: stringify(validatedVolumes.volumes),
    volumeMounts: stringify(validatedVolumes.volumeMounts),
    projectId: auth.project.id,
    durableObjectName: `org_${auth.organization.id}:project_${auth.project.id}:session_${id}`,
    sandboxId,
    resumeToken: null,
    runtimeEndpointPath: null,
    modelProvider: providerId,
    modelConfig: stringify({
      ...(providerId ? { provider: providerId } : {}),
      ...(agentSnapshot.model ? { model: agentSnapshot.model } : {}),
    }),
    state: 'pending',
    stateReason: hostingMode === 'self_hosted' ? 'waiting-for-runner' : null,
    activeTurnId: null,
    turnLeaseExpiresAt: null,
    continuationDepth: 0,
    metadata: stringify({
      labels: userMetadata.labels,
      annotations: userMetadata.annotations,
      hostingMode,
      runtime,
      runtimeConfig,
      runtimeDriver: runtimeDriverName(runtime, hostingMode),
      ...(usesCloudLoop
        ? {
            runtimeBackend: 'enbor-cloud',
            runtimeProtocol: 'enbor-runtime-rpc',
            eventStore: SESSION_DO_EVENT_STORE,
            loop: 'cloud-session-runtime',
            sandboxBackend: hostingMode === 'self_hosted' ? 'runner-sandbox' : 'cloudflare-sandbox',
          }
        : {}),
      ...(hostingMode === 'self_hosted'
        ? {
            runnerState: 'queued',
            runnerProtocol: 'enbor-runner-work',
            runnerWorkKind: runtime === 'enbor' ? 'sandbox-tool-executor' : 'runtime-bridge',
          }
        : {}),
    }),
    startedAt: null,
    closedAt: null,
    deletedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  } satisfies SessionRow
  const workValues = {
    session: pending,
    agentSnapshot: runtimeAgentSnapshot,
    environmentSnapshot,
    runtime,
    runtimeConfig,
    env: mergedEnv,
    envFrom: mergedEnvFrom,
    volumes: validatedVolumes.volumes,
    volumeMounts: validatedVolumes.volumeMounts,
    prompt,
    requestId: requestIdFrom(requestId),
  }
  const durableWork =
    keyHash && hostingMode === 'self_hosted' ? selfHostedSessionWorkItem(auth, workValues, timestamp) : undefined
  const cloudStart: CloudTurnQueueStartMessage = {
    type: 'session.start',
    sessionId: id,
    organizationId: auth.organization.id,
    projectId: auth.project.id,
    requestId: requestIdFrom(requestId),
    runtime,
    runtimeConfig,
    env: mergedEnv,
    envFrom: mergedEnvFrom,
    volumes: validatedVolumes.volumes,
    volumeMounts: validatedVolumes.volumeMounts,
    prompt,
  }
  try {
    if (keyHash && fingerprint) {
      await store.insertSessionCreation(pending, {
        keyHash,
        fingerprint,
        ...(durableWork ? { workItem: durableWork } : { cloudStart }),
      })
    } else {
      await store.insertSession(pending)
    }
  } catch (error) {
    const winner = await replay()
    if (winner) return winner
    if (error instanceof ResourceDeletedDuringMutationError) {
      return {
        ok: false,
        error: { status: 409, code: 'conflict', message: 'Project was deleted while Session creation was in progress' },
      }
    }
    throw error
  }
  await audit.record(auth, {
    action: 'session.create',
    resourceType: 'session',
    resourceId: id,
    outcome: 'success',
    requestId: requestIdFrom(requestId),
    sessionId: id,
    metadata: { state: pending.state, hostingMode, runtime },
  })

  try {
    if (durableWork) {
      await deps.runnerChannel.assignWork({
        organizationId: auth.organization.id,
        projectId: auth.project.id,
        environmentId,
        workItemId: durableWork.id,
      })
      return { ok: true, session: pending }
    }
    if (hostingMode === 'self_hosted') {
      await enqueueSelfHostedSessionWork(deps, auth, {
        session: pending,
        agentSnapshot: runtimeAgentSnapshot,
        environmentSnapshot,
        runtime,
        runtimeConfig,
        env: mergedEnv,
        envFrom: mergedEnvFrom,
        volumes: validatedVolumes.volumes,
        volumeMounts: validatedVolumes.volumeMounts,
        prompt,
        requestId: requestIdFrom(requestId),
      })
      return { ok: true, session: pending }
    }

    if (!deps.cloudTurnQueue.runsInline()) {
      await deps.cloudTurnQueue.enqueue({
        type: 'session.start',
        sessionId: pending.id,
        organizationId: auth.organization.id,
        projectId: auth.project.id,
        requestId: requestIdFrom(requestId),
        runtime,
        runtimeConfig,
        env: mergedEnv,
        envFrom: mergedEnvFrom,
        volumes: validatedVolumes.volumes,
        volumeMounts: validatedVolumes.volumeMounts,
        prompt,
      })
      if (keyHash) await store.acknowledgeCloudSessionCreation(auth.project.id, id)
      return { ok: true, session: pending }
    }

    await startSessionRuntimeForRow(deps, auth, {
      pending,
      agentSnapshot,
      environmentSnapshot,
      runtime,
      runtimeConfig,
      requestId: requestIdFrom(requestId),
      env: mergedEnv,
      envFrom: mergedEnvFrom,
      volumes: validatedVolumes.volumes,
      volumeMounts: validatedVolumes.volumeMounts,
      prompt,
    })
    if (keyHash) await store.acknowledgeCloudSessionCreation(auth.project.id, id)
    if (!deps.rereadStartedSession) {
      return { ok: true, session: pending }
    }
    const started = await store.findSession(auth.project.id, id)
    if (!started) {
      throw new Error('Created session was not persisted')
    }
    return { ok: true, session: started }
  } catch (error) {
    // Durable work remains available to recovery even when the notification or queue send fails.
    if (keyHash) throw error
    // The row is persisted as 'pending' but the launch step failed (e.g. the
    // queue send threw). Reconcile the orphaned row to 'error' so it is not
    // stranded until the expiry sweep, then report the failure.
    const safeError = safeRuntimeError(error)
    await store.updateSessionWhenState(auth.project.id, id, 'pending', {
      state: 'error',
      stateReason: safeError.message,
      updatedAt: now(),
    })
    await audit.record(auth, {
      action: 'session.create',
      resourceType: 'session',
      resourceId: id,
      outcome: 'failure',
      requestId: requestIdFrom(requestId),
      sessionId: id,
      metadata: { ...safeError },
    })
    return { ok: false, error: { status: 500, code: 'session_launch_failed', message: safeError.message } }
  }
}
