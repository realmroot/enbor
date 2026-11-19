// Cloud turn execution, runtime startup, and the queue consumer — deps-first.
//
// This cluster owns the cloud-side model turn loop: launching the cloud runtime
// for a pending session row (startSessionRuntimeForRow), running a single model
// turn with the approval/policy gate (executeCloudSessionTurn), the queue
// consumer that dispatches start/step/turn messages (consumeCloudTurnQueueMessage),
// and the initial-prompt dispatch that seeds the first turn after startup
// (dispatchPrompt).
//
// VERBATIM logic: the lease CAS, the continuation-depth cap, the soft-budget
// pause, and the message-dispatch control flow are byte-for-byte the same as the
// former server/runtime/cloud-turn module. Only dependency ACQUISITION changed —
// the orchestration store, runtime lifecycle/turn executor, queue, audit,
// runtime input, and the event/turn-callbacks/provisioning helpers arrive as ports/usecases on
// `deps` instead of being built from env/db. The module is infra-free: it
// reaches for ports + domain + shared contracts + the Enbor turn engine + sibling
// usecases only.

import type { RuntimeName } from '@server/contracts/environment-contracts'
import { isRuntimeName, runtimeDriver, runtimeDriverName } from '@server/domain/runtime/driver'
import type { EnvFromEntry, Volume, VolumeMount } from '@server/domain/runtime/execution-inputs'
import { resolveSessionProviderModel } from '@server/domain/runtime/provider'
import {
  type AgentSnapshot,
  agentSnapshotWithWorkspaceContext,
  type EnvironmentSnapshot,
  parseAgentSnapshot,
  parseJson,
} from '@server/domain/runtime/session-snapshot'
import { cloudTurnSystemAuth } from '@server/domain/runtime/system-auth'
import {
  CONTINUATION_LIMIT_REASON,
  lifecycleLeaseExpiry,
  MAX_CONTINUATION_DEPTH,
  newTurnId,
  TURN_LEASE_RETRY_DELAY_SECONDS,
  turnLeaseExpiry,
} from '@server/domain/runtime/turn'
import { now, requestIdFrom } from '@server/domain/runtime/util'
import {
  DEFAULT_SESSION_IDLE_TIMEOUT_SECONDS,
  ENBOR_ANNOTATION_KEY_SESSION_IDLE_TIMEOUT_SECONDS,
} from '@server/metadata-keys'
import { safeRuntimeError } from '@server/runtime-error'
import { type EnborEvent, SESSION_DO_EVENT_STORE } from '@shared/session-events'
import type {
  AuditPort,
  AuthScope,
  CloudRuntimeLifecycle,
  CloudTurnQueue,
  CloudTurnQueueMessage,
  EnborTurnExecutor,
  EventStore,
  PlatformBudgetGate,
  PolicyPort,
  ProviderRepo,
  RuntimeSecretGateway,
  SandboxRuntimeStartInput,
  SessionOrchestrationStore,
  SessionRow,
} from '../ports'
import type { ToolApprovalGate } from './approval-gate'
import { isRuntimePolicyDenied, isRuntimeTurnCancelled } from './engine/errors'
import { appendRuntimeEvent, appendUserPromptEvent, loadRuntimeConversation, markPromptFailed } from './events'
import { mcpConnectorIds, resolveMcpServers } from './provisioning'
import { buildSessionTurnCallbacks, type SessionTurnCallbacks } from './turn-callbacks'

// Per-invocation soft budget for new model turns (see executeCloudSessionTurn).
const CLOUD_TURN_SOFT_BUDGET_MS = 4 * 60_000

// The approval gate factory threaded into buildSessionTurnCallbacks.
type CreateApprovalGate = (values: {
  auth: AuthScope
  sessionId: string
  sessionMetadata: Record<string, unknown>
  appendEvent: (event: EnborEvent) => Promise<string>
}) => ToolApprovalGate

function idleTimeoutSeconds(metadata: Record<string, unknown>): number {
  const annotations = metadata.annotations
  if (!annotations || typeof annotations !== 'object' || Array.isArray(annotations)) {
    return DEFAULT_SESSION_IDLE_TIMEOUT_SECONDS
  }
  const value = Number((annotations as Record<string, unknown>)[ENBOR_ANNOTATION_KEY_SESSION_IDLE_TIMEOUT_SECONDS])
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_SESSION_IDLE_TIMEOUT_SECONDS
}

async function sleepIdleCloudSession(deps: CloudTurnDeps, auth: AuthScope, session: SessionRow) {
  if (!session.sandboxId) return
  const metadata = parseJson<Record<string, unknown>>(session.metadata) ?? {}
  if (metadata.sandboxBackend === 'runner-sandbox') return
  const timeoutSeconds = idleTimeoutSeconds(metadata)
  try {
    await deps.cloudRuntime.idleCloudSession(session.sandboxId, timeoutSeconds)
  } catch (error) {
    const runtime = safeRuntimeError(error)
    await deps.audit.record(auth, {
      action: 'session.runtime.idle',
      resourceType: 'session',
      resourceId: session.id,
      outcome: 'failure',
      sessionId: session.id,
      metadata: { sandboxId: session.sandboxId, timeoutSeconds, runtime },
    })
  }
}

export async function activateCloudSessionForTurn(
  deps: CloudTurnDeps,
  auth: AuthScope,
  session: SessionRow,
  agentSnapshot: AgentSnapshot,
) {
  if (!session.sandboxId) return
  if (!agentSnapshot.provider) throw new Error('Cloud session provider is required')
  const metadata = parseJson<Record<string, unknown>>(session.metadata) ?? {}
  if (metadata.sandboxBackend === 'runner-sandbox') return
  const environmentSnapshot = parseJson<EnvironmentSnapshot>(session.environmentSnapshot)
  const runtimeConfig =
    metadata.runtimeConfig && typeof metadata.runtimeConfig === 'object' && !Array.isArray(metadata.runtimeConfig)
      ? (metadata.runtimeConfig as Record<string, unknown>)
      : {}
  const volumes = parseJson<Volume[]>(session.volumes) ?? []
  const volumeMounts = parseJson<VolumeMount[]>(session.volumeMounts) ?? []
  const envFrom = parseJson<EnvFromEntry[]>(session.envFrom) ?? []
  const directEnv = parseJson<Record<string, string>>(session.env) ?? {}
  const resolvedEnv = await deps.runtimeSecrets.resolveEnv(
    { organizationId: auth.organization.id, projectId: auth.project.id },
    envFrom,
  )
  const workspaceManifest = await deps.runtimeSecrets.resolveWorkspaceManifest(
    { organizationId: auth.organization.id, projectId: auth.project.id },
    volumes,
    volumeMounts,
  )
  const input: SandboxRuntimeStartInput = {
    sessionId: session.id,
    sandboxId: session.sandboxId,
    provider: agentSnapshot.provider,
    model: agentSnapshot.model,
    agentSnapshot: agentSnapshotWithWorkspaceContext(agentSnapshot, volumes, volumeMounts),
    environmentSnapshot: environmentSnapshot ? { ...environmentSnapshot, runtimeConfig } : null,
    mcpServers: await resolveMcpServers(deps, auth, session.id, agentSnapshot, environmentSnapshot),
    volumes,
    volumeMounts,
    workspaceManifest,
    env: { ...directEnv, ...resolvedEnv },
    ...(typeof metadata.runtime === 'string' ? { runtime: metadata.runtime } : {}),
  }
  await deps.cloudRuntime.activateCloudSession(input)
}

export type CloudTurnDeps = {
  sessionOrchestration: SessionOrchestrationStore
  sessionEventStore: EventStore
  policy: PolicyPort
  providers: ProviderRepo
  audit: AuditPort
  cloudRuntime: CloudRuntimeLifecycle
  enborTurnExecutor: EnborTurnExecutor
  cloudTurnQueue: CloudTurnQueue
  runtimeSecrets: RuntimeSecretGateway
  createApprovalGate: CreateApprovalGate
  // False when the operator has switched the hosted cloud sandbox off.
  cloudSandboxEnabled?: boolean
  // Operator daily ceiling on hosted model spend; absent means unlimited.
  platformBudget?: PlatformBudgetGate
}

export async function startSessionRuntimeForRow(
  deps: CloudTurnDeps,
  auth: AuthScope,
  input: {
    pending: SessionRow
    agentSnapshot: AgentSnapshot
    environmentSnapshot: EnvironmentSnapshot | null
    runtime: RuntimeName
    runtimeConfig: Record<string, unknown>
    requestId?: string | null
    env?: Record<string, string>
    envFrom?: EnvFromEntry[]
    volumes?: Volume[]
    volumeMounts?: VolumeMount[]
    prompt?: string
  },
) {
  const store = deps.sessionOrchestration
  const { pending, agentSnapshot, environmentSnapshot, runtime, runtimeConfig, prompt } = input
  const sessionEnv = input.env
  const sessionEnvFrom = input.envFrom ?? []
  const sessionVolumes = input.volumes ?? []
  const sessionVolumeMounts = input.volumeMounts ?? []
  const runtimeAgentSnapshot = agentSnapshotWithWorkspaceContext(agentSnapshot, sessionVolumes, sessionVolumeMounts)
  const sessionId = pending.id
  const sandboxId = pending.sandboxId ?? sessionId.toLowerCase()
  const runtimeName = runtime
  const driver = runtimeDriver(runtimeName)
  if (!driver.supportsCloudStartup) {
    throw new Error(`Runtime ${runtimeName} does not support cloud session startup`)
  }
  const startupLeaseId = newTurnId()
  const startupClaimedAt = now()
  const startupClaimed = await store.acquirePendingStartupLease(
    auth.project.id,
    sessionId,
    pending.startedAt,
    startupLeaseId,
    lifecycleLeaseExpiry(startupClaimedAt),
    startupClaimedAt,
  )
  if (!startupClaimed) return
  try {
    const mcpServers = await resolveMcpServers(deps, auth, sessionId, agentSnapshot, environmentSnapshot)
    const environmentSnapshotWithRuntimeConfig = environmentSnapshot ? { ...environmentSnapshot, runtimeConfig } : null
    const resolvedEnv = await deps.runtimeSecrets.resolveEnv(
      { organizationId: auth.organization.id, projectId: auth.project.id },
      sessionEnvFrom,
    )
    const workspaceManifest = await deps.runtimeSecrets.resolveWorkspaceManifest(
      { organizationId: auth.organization.id, projectId: auth.project.id },
      sessionVolumes,
      sessionVolumeMounts,
    )
    const env = { ...(sessionEnv ?? {}), ...resolvedEnv }
    if (!agentSnapshot.provider) {
      throw new Error('Cloud session provider is required')
    }
    const launchAt = now()
    const launchOwned = await store.renewTurnLease(
      auth.project.id,
      sessionId,
      startupLeaseId,
      lifecycleLeaseExpiry(launchAt),
    )
    if (!launchOwned) return
    const startedRuntime = await deps.cloudRuntime.startCloudSession({
      sessionId,
      sandboxId,
      runtime: runtimeName,
      provider: agentSnapshot.provider,
      model: agentSnapshot.model,
      agentSnapshot: runtimeAgentSnapshot,
      environmentSnapshot: environmentSnapshotWithRuntimeConfig,
      mcpServers,
      volumes: sessionVolumes,
      volumeMounts: sessionVolumeMounts,
      workspaceManifest,
      env,
    })
    const current = await store.findSession(auth.project.id, sessionId)
    if (current?.state !== 'pending') {
      if (!current) {
        await deps.cloudRuntime.stopCloudSession(sandboxId).catch(() => undefined)
      }
      return
    }
    const startedAt = now()
    const runtimeMetadata = {
      ...startedRuntime.metadata,
      runtimeDriver: runtimeDriverName(runtimeName, 'cloud'),
      runtimeBackend: driver.cloudBackend,
      runtimeProtocol: driver.cloudProtocol,
      mcpConnectors: mcpConnectorIds(mcpServers),
      // "Storage follows the loop": the cloud enbor loop owns this session's events,
      // so route its firehose to the Session DO (the event-store router reads
      // this stamp). Self-hosted CLI sessions never reach this path.
      eventStore: SESSION_DO_EVENT_STORE,
    }
    const started = {
      sandboxId,
      resumeToken: null,
      runtimeEndpointPath: null,
      state: 'idle',
      activeTurnId: startupLeaseId,
      turnLeaseExpiresAt: turnLeaseExpiry(startedAt),
      startedAt,
      closedAt: null,
      updatedAt: startedAt,
    }
    const recorded = await store.completeCloudSessionStart(
      auth.project.id,
      sessionId,
      pending.startedAt,
      startupLeaseId,
      started,
      runtimeMetadata,
    )
    if (!recorded) {
      const latest = await store.findSession(auth.project.id, sessionId)
      if (latest && latest.state !== 'idle' && latest.state !== 'running' && latest.state !== 'pending') {
        await deps.cloudRuntime.stopCloudSession(sandboxId)
      }
      return
    }
    const startedSession = await store.findSession(auth.project.id, sessionId)
    if (!startedSession) throw new Error('Started Session row is required')
    if (!prompt) await sleepIdleCloudSession(deps, auth, startedSession)
    await store.releaseTurnLease(auth.project.id, sessionId, startupLeaseId, {})
    await deps.audit.record(auth, {
      action: 'session.runtime.start',
      resourceType: 'session',
      resourceId: sessionId,
      outcome: 'success',
      requestId: requestIdFrom(input.requestId),
      sessionId,
      metadata: { sandboxId: startedRuntime.sandboxId },
    })
    if (prompt) {
      await dispatchPrompt(deps, auth, startedSession, prompt, input.requestId)
    }
  } catch (error) {
    const safeError = safeRuntimeError(error)
    const failedAt = now()
    const failed = await store.failCloudSessionStart(
      auth.project.id,
      sessionId,
      pending.startedAt,
      startupLeaseId,
      {
        state: 'error',
        stateReason: safeError.message,
        activeTurnId: null,
        turnLeaseExpiresAt: null,
        updatedAt: failedAt,
      },
      {
        runtimeDriver: runtimeDriverName(runtimeName, 'cloud'),
        runtimeBackend: driver.cloudBackend,
        error: safeError,
      },
    )
    if (!failed) {
      if (!(await store.findSession(auth.project.id, sessionId))) {
        await deps.cloudRuntime.stopCloudSession(sandboxId).catch(() => undefined)
      }
      return
    }
    await deps.cloudRuntime.stopCloudSession(sandboxId).catch(() => undefined)
    await appendRuntimeEvent(deps, {
      auth,
      sessionId,
      event: {
        type: 'runtime.error',
        payload: {
          message: safeError.message,
          ...(safeError.code ? { code: safeError.code } : {}),
          ...(safeError.detail ? { details: safeError.detail } : {}),
        },
      },
    })
    await deps.audit.record(auth, {
      action: 'session.runtime.start',
      resourceType: 'session',
      resourceId: sessionId,
      outcome: 'failure',
      requestId: requestIdFrom(input.requestId),
      sessionId,
      metadata: { ...safeError },
    })
  }
}

// ── Cloud turn execution + queue consumer ───────────────────────────────────

export type CloudTurnOutcome =
  | { ok: true; requiresAction?: boolean; paused?: boolean }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled: false; error: ReturnType<typeof safeRuntimeError> }

function isRuntimeUserMessageEvent(event: EnborEvent) {
  if (event.type !== 'message.started' && event.type !== 'message.updated' && event.type !== 'message.completed') {
    return false
  }
  const payload = event.payload as { message?: { role?: unknown; parentToolCallId?: string } }
  return payload.message?.role === 'user' && !payload.message.parentToolCallId
}

export async function executeCloudSessionTurn(
  deps: CloudTurnDeps,
  auth: AuthScope,
  session: SessionRow,
  work: { prompt?: string; continuation?: boolean },
  auditAction: 'session.prompt' | 'session.command',
): Promise<CloudTurnOutcome> {
  const store = deps.sessionOrchestration
  let callbacks: SessionTurnCallbacks | null = null
  try {
    const agentSnapshot = parseAgentSnapshot(session.agentSnapshot)
    if (!agentSnapshot) {
      throw new Error('Session agent snapshot is required')
    }
    const volumes = parseJson<Volume[]>(session.volumes) ?? []
    const volumeMounts = parseJson<VolumeMount[]>(session.volumeMounts) ?? []
    const runtimeAgentSnapshot = agentSnapshotWithWorkspaceContext(agentSnapshot, volumes, volumeMounts)
    await activateCloudSessionForTurn(deps, auth, session, agentSnapshot)
    const modelConfig = parseJson<Record<string, unknown>>(session.modelConfig) ?? {}
    const { messages, subagentMessages } = await loadRuntimeConversation(deps, session.id)
    const { provider: turnProvider, model: turnModel } = resolveSessionProviderModel(
      session,
      agentSnapshot,
      modelConfig,
    )
    if (work.prompt !== undefined) {
      await appendUserPromptEvent(deps, {
        auth,
        sessionId: session.id,
        prompt: work.prompt,
      })
    }
    callbacks = buildSessionTurnCallbacks(deps, {
      auth,
      session,
      recordPolicyDenial: async (blocked) => {
        const operationFields =
          blocked.operation.operation === 'command'
            ? { command: blocked.operation.command }
            : { host: blocked.operation.host }
        await appendRuntimeEvent(deps, {
          auth,
          sessionId: session.id,
          event: {
            type: 'permission.denied',
            payload: {
              reason: blocked.decision.category,
              resourceType: blocked.operation.resourceType,
              resourceId: blocked.operation.resourceId,
              operation: blocked.operation.operation,
              details: {
                ruleId: blocked.decision.rule,
                decision: blocked.decision,
                ...operationFields,
              },
            },
          },
        })
        await deps.audit.record(auth, {
          action: 'runtime_sandbox.operation',
          resourceType: blocked.operation.resourceType,
          resourceId: blocked.operation.resourceId,
          outcome: 'denied',
          sessionId: session.id,
          policyCategory: blocked.decision.category,
          metadata: { operation: blocked.operation.operation, ...operationFields, decision: blocked.decision },
        })
      },
    })
    const startedAt = Date.now()
    const turnCallbacks = callbacks
    const result = await deps.enborTurnExecutor.runTurn({
      sessionId: session.id,
      sandboxId: session.sandboxId ?? '',
      provider: turnProvider,
      model: turnModel,
      agentSnapshot: runtimeAgentSnapshot,
      ...(work.prompt !== undefined ? { prompt: work.prompt } : {}),
      ...(work.continuation ? { continuation: true } : {}),
      messages,
      subagentMessages,
      ...(deps.cloudTurnQueue.runsInline()
        ? {}
        : { shouldPause: () => Date.now() - startedAt > CLOUD_TURN_SOFT_BUDGET_MS }),
      ensureActive: turnCallbacks.ensureActive,
      onEvent:
        work.prompt === undefined
          ? turnCallbacks.onEvent
          : async (event) => {
              // Enbor persisted the submitted prompt before starting the model
              // turn. The Pi runtime emits the same user-message lifecycle;
              // keep that transport echo out of the canonical transcript.
              if (!isRuntimeUserMessageEvent(event)) await turnCallbacks.onEvent(event)
            },
      resolveToolResult: turnCallbacks.resolveToolResult,
      approveToolCall: turnCallbacks.approveToolCall,
    })
    if (result.status === 'idle') {
      await store.updateSessionWhenState(auth.project.id, session.id, 'running', {
        state: 'idle',
        updatedAt: now(),
      })
      await sleepIdleCloudSession(deps, auth, session)
    }

    if (result.status === 'paused') {
      await store.updateSessionWhenState(auth.project.id, session.id, 'running', {
        updatedAt: now(),
      })
      // The queue consumer owns the continuation (lease renewal + step cap), so a
      // paused turn just reports it instead of enqueuing the next step itself.
      return { ok: true, paused: true }
    }

    await deps.audit.record(auth, {
      action: auditAction,
      resourceType: 'session',
      resourceId: session.id,
      outcome: 'success',
      sessionId: session.id,
      metadata: auditAction === 'session.prompt' ? { source: 'api', promptDispatched: true } : { type: 'prompt' },
    })
    return { ok: true }
  } catch (error) {
    if (isRuntimeTurnCancelled(error)) {
      if (callbacks?.approvalGate.requiresAction()) {
        await store.updateSessionWhenState(auth.project.id, session.id, 'running', {
          state: 'idle',
          stateReason: 'requires-action',
          updatedAt: now(),
        })
        await sleepIdleCloudSession(deps, auth, session)
        return { ok: true, requiresAction: true }
      }
      return { ok: false, cancelled: true }
    }
    const safeError = safeRuntimeError(error)
    if (callbacks?.wasPolicyDenied() || isRuntimePolicyDenied(error)) {
      await store.updateSessionWhenState(auth.project.id, session.id, 'running', {
        state: 'idle',
        stateReason: 'policy-denied',
        updatedAt: now(),
      })
      await sleepIdleCloudSession(deps, auth, session)
      return { ok: false, cancelled: false, error: safeError }
    }
    await markPromptFailed(deps, auth, session, safeError.message)
    return { ok: false, cancelled: false, error: safeError }
  }
}

// Maps a completed turn's outcome to the continuation decision under the lease we
// hold (turnId). A paused turn extends the chain — bumping the depth, enforcing
// the cap, renewing the lease, and enqueuing the next step. Any terminal outcome
// releases the lease so the next queued turn can claim it.
export async function handleTurnOutcome(
  deps: CloudTurnDeps,
  auth: AuthScope,
  session: SessionRow,
  turnId: string,
  auditAction: 'session.prompt' | 'session.command',
  outcome: CloudTurnOutcome,
  requestId?: string | null,
): Promise<void> {
  const store = deps.sessionOrchestration
  if (outcome.ok && outcome.paused) {
    const depth = await store.incrementContinuationDepth(auth.project.id, session.id, turnId)
    if (depth >= MAX_CONTINUATION_DEPTH) {
      await sleepIdleCloudSession(deps, auth, session)
      await store.releaseTurnLease(auth.project.id, session.id, turnId, {
        state: 'idle',
        stateReason: CONTINUATION_LIMIT_REASON,
        updatedAt: now(),
      })
      return
    }
    await store.renewTurnLease(auth.project.id, session.id, turnId, turnLeaseExpiry())
    await deps.cloudTurnQueue.enqueue({
      type: 'session.step',
      sessionId: session.id,
      organizationId: auth.organization.id,
      projectId: auth.project.id,
      requestId: requestIdFrom(requestId),
      turnId,
      auditAction,
    })
    return
  }
  // Terminal (idle / error / cancelled / requires-action): executeCloudSessionTurn
  // already set the session state; just clear the lease for the next turn.
  await store.releaseTurnLease(auth.project.id, session.id, turnId, {})
}

// Runs a fresh turn under a newly-acquired lease. If the lease is held by another
// in-flight turn the message is deferred (re-enqueued after a short delay) instead
// of racing it — this is the per-session serialization (H1).
async function runLeasedTurn(
  deps: CloudTurnDeps,
  auth: AuthScope,
  session: SessionRow,
  work: { prompt?: string; continuation?: boolean },
  auditAction: 'session.prompt' | 'session.command',
  deferMessage: CloudTurnQueueMessage,
): Promise<void> {
  const store = deps.sessionOrchestration
  const turnId = newTurnId()
  const acquiredAt = now()
  const acquired = await store.acquireTurnLease(
    auth.project.id,
    session.id,
    turnId,
    turnLeaseExpiry(acquiredAt),
    acquiredAt,
  )
  if (!acquired) {
    await deps.cloudTurnQueue.enqueue(deferMessage, { delaySeconds: TURN_LEASE_RETRY_DELAY_SECONDS })
    return
  }
  const outcome = await executeCloudSessionTurn(deps, auth, session, work, auditAction)
  await handleTurnOutcome(deps, auth, session, turnId, auditAction, outcome, deferMessage.requestId)
}

export async function consumeCloudTurnQueueMessage(deps: CloudTurnDeps, message: CloudTurnQueueMessage): Promise<void> {
  const store = deps.sessionOrchestration
  const auth = cloudTurnSystemAuth(message)
  const session = await store.findSession(auth.project.id, message.sessionId)
  if (!session) {
    return
  }
  if (deps.cloudSandboxEnabled === false) {
    await markCloudTurnRefused(deps, message, 'cloud_sandbox_disabled')
    return
  }
  const budgetDenial = await deps.platformBudget?.check(message.organizationId)
  if (budgetDenial) {
    await markCloudTurnRefused(deps, message, 'platform_budget_exhausted', budgetDenial.rule)
    return
  }
  if (message.type === 'session.start') {
    if (session.state !== 'pending') {
      return
    }
    const agentSnapshot = parseAgentSnapshot(session.agentSnapshot)
    if (!agentSnapshot) {
      throw new Error('Session agent snapshot is required for cloud startup')
    }
    // message.runtime is an untrusted queue string; an unknown runtime would
    // otherwise reach runtimeDriver() and fail late, after side effects. Mark
    // the session errored up front instead of casting blindly.
    if (!isRuntimeName(message.runtime)) {
      await markCloudTurnDeadLettered(deps, message)
      return
    }
    await startSessionRuntimeForRow(deps, auth, {
      pending: session,
      agentSnapshot,
      environmentSnapshot: parseJson<EnvironmentSnapshot>(session.environmentSnapshot),
      runtime: message.runtime,
      runtimeConfig: message.runtimeConfig,
      env: message.env,
      envFrom: message.envFrom,
      volumes: message.volumes,
      volumeMounts: message.volumeMounts,
      requestId: requestIdFrom(message.requestId),
      ...(message.prompt !== undefined ? { prompt: message.prompt } : {}),
    })
    return
  }
  if (message.type === 'session.step') {
    if (session.state !== 'running') {
      return
    }
    if (message.turnId) {
      // Budget continuation of an in-flight chain: renew the SAME lease so a
      // concurrent prompt that arrived mid-chain stays deferred. If the lease was
      // lost (cleared, or reclaimed after expiry by another worker) — stop.
      const renewed = await store.renewTurnLease(auth.project.id, session.id, message.turnId, turnLeaseExpiry())
      if (!renewed) {
        return
      }
      const outcome = await executeCloudSessionTurn(deps, auth, session, { continuation: true }, message.auditAction)
      await handleTurnOutcome(deps, auth, session, message.turnId, message.auditAction, outcome, message.requestId)
      return
    }
    // Approval-resume (continuation with no held lease): acquire a fresh lease.
    await runLeasedTurn(deps, auth, session, { continuation: true }, message.auditAction, message)
    return
  }
  if (session.state === 'idle') {
    const reclaimed = await store.updateSessionWhenState(auth.project.id, session.id, 'idle', {
      state: 'running',
      stateReason: null,
      updatedAt: now(),
    })
    if (!reclaimed) {
      return
    }
  } else if (session.state !== 'running') {
    return
  }
  await runLeasedTurn(deps, auth, session, { prompt: message.prompt }, message.auditAction, message)
}

export async function dispatchPrompt(
  deps: CloudTurnDeps,
  auth: AuthScope,
  session: SessionRow,
  prompt: string,
  requestId?: string | null,
) {
  const store = deps.sessionOrchestration
  const submittedAt = now()
  const started = await store.updateSessionWhenState(auth.project.id, session.id, ['idle', 'running'], {
    state: 'running',
    stateReason: null,
    updatedAt: submittedAt,
  })
  if (!started) {
    throw new Error('Session runtime is no longer active')
  }

  if (deps.cloudTurnQueue.runsInline()) {
    await executeCloudSessionTurn(deps, auth, session, { prompt: prompt }, 'session.prompt')
    return
  }
  await deps.cloudTurnQueue.enqueue({
    type: 'session.turn',
    sessionId: session.id,
    organizationId: auth.organization.id,
    projectId: auth.project.id,
    requestId: requestIdFrom(requestId),
    prompt: prompt,
    auditAction: 'session.prompt',
  })
}

// A cloud turn message that exhausted its retries lands in the dead-letter queue.
// Mark the stranded session errored (clearing any lease it held) so clients
// recover it immediately instead of waiting for the 20-minute stall sweep.
// The operator refuses hosted work (cloud switched off, or the daily model
// budget spent): settle the session as errored without starting a sandbox or
// calling a model.
async function markCloudTurnRefused(
  deps: CloudTurnDeps,
  message: CloudTurnQueueMessage,
  reason: 'cloud_sandbox_disabled' | 'platform_budget_exhausted',
  rule: string | null = null,
): Promise<void> {
  const auth = cloudTurnSystemAuth(message)
  await deps.sessionOrchestration.updateSessionWhenState(auth.project.id, message.sessionId, ['pending', 'running'], {
    state: 'error',
    stateReason: reason.replaceAll('_', '-'),
    activeTurnId: null,
    turnLeaseExpiresAt: null,
    updatedAt: now(),
  })
  await deps.audit.record(auth, {
    action: message.type === 'session.start' ? 'session.runtime.start' : 'session.command',
    resourceType: 'session',
    resourceId: message.sessionId,
    outcome: 'denied',
    requestId: requestIdFrom(message.requestId),
    sessionId: message.sessionId,
    metadata: { reason, messageType: message.type, ...(rule ? { rule } : {}) },
  })
}

export async function markCloudTurnDeadLettered(deps: CloudTurnDeps, message: CloudTurnQueueMessage): Promise<void> {
  const store = deps.sessionOrchestration
  const auth = cloudTurnSystemAuth(message)
  await store.updateSessionWhenState(auth.project.id, message.sessionId, ['pending', 'running'], {
    state: 'error',
    stateReason: 'cloud-turn-failed',
    activeTurnId: null,
    turnLeaseExpiresAt: null,
    updatedAt: now(),
  })
  await deps.audit.record(auth, {
    action: message.type === 'session.start' ? 'session.runtime.start' : 'session.command',
    resourceType: 'session',
    resourceId: message.sessionId,
    outcome: 'failure',
    requestId: requestIdFrom(message.requestId),
    sessionId: message.sessionId,
    metadata: { reason: 'cloud_turn_dead_lettered', messageType: message.type },
  })
}
