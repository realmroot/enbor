import type { SessionInsert, WorkItemInsert } from '@shared/runtime-rows'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthScope } from '../ports'

// Robustness test for startup partial-failure (H5 FIX 2): when the launch
// dispatch throws after the pending row is persisted (e.g. the cloud-turn queue
// send fails), createSessionForAgent must reconcile the orphaned row to 'error'
// and report a session_launch_failed failure instead of stranding it 'pending'.
//
// The usecase is deps-first: the orchestration store, audit, policy, and queue
// all arrive on `deps`. Provider/runtime resolution + provider-config read live
// in the sibling provisioning usecase and the snapshot serializers in
// domain/runtime/session-snapshot; those module seams are stubbed so the test
// pins the reconcile flow directly.
const {
  enqueueCloudTurnMock,
  cloudTurnsRunInlineMock,
  startSessionRuntimeForRowMock,
  recordAuditMock,
  evaluateProviderPolicyForSessionMock,
  evaluateSandboxRuntimePolicyMock,
  resolveSessionProviderIdMock,
  validateRuntimeProviderModelMock,
  resolveSessionProviderConfigMock,
  agentSubagentReferencesMock,
  createAgentSnapshotMock,
  createSessionSubagentSnapshotMock,
  createEnvironmentSnapshotMock,
  insertSessionMock,
  insertWorkItemMock,
  updateSessionWhenStateMock,
  findAgentMock,
  findAgentVersionMock,
  findEnvironmentMock,
  findEnvironmentVersionMock,
  resolveEnvironmentForRuntimeMock,
  assignWorkMock,
  secretVersionForResolutionMock,
} = vi.hoisted(() => ({
  enqueueCloudTurnMock: vi.fn(),
  cloudTurnsRunInlineMock: vi.fn(() => false),
  startSessionRuntimeForRowMock: vi.fn(),
  recordAuditMock: vi.fn(),
  evaluateProviderPolicyForSessionMock: vi.fn<(auth: unknown, values: unknown) => Promise<unknown>>(async () => ({
    decision: { allowed: true },
    override: null,
  })),
  evaluateSandboxRuntimePolicyMock: vi.fn<(auth: unknown, values: unknown) => Promise<unknown>>(async () => ({
    allowed: true,
  })),
  resolveSessionProviderIdMock: vi.fn(async () => 'anthropic'),
  validateRuntimeProviderModelMock: vi.fn(async () => true),
  resolveSessionProviderConfigMock: vi.fn(async () => ({ ok: true, config: null })),
  agentSubagentReferencesMock: vi.fn((..._args: unknown[]): Array<{ agentId: string; name: string }> => []),
  createAgentSnapshotMock: vi.fn(
    (..._args: unknown[]): Record<string, unknown> => ({
      id: 'agentver_1',
      providerId: 'anthropic',
      model: '@cf/x',
    }),
  ),
  createSessionSubagentSnapshotMock: vi.fn(
    (agent: { id: string }, version: { id: string; version: number }, name: string) => ({
      agentId: agent.id,
      agentVersionId: version.id,
      version: version.version,
      name,
      description: 'Reviews work.',
      systemPrompt: 'Review carefully.',
      provider: null,
      model: null,
      allowedTools: ['read'],
      skills: ['enbor@review'],
      mcpConnectors: ['github'],
    }),
  ),
  createEnvironmentSnapshotMock: vi.fn(() => ({ id: 'envver_1', hostingMode: 'cloud', runtimeConfig: {} })),
  insertSessionMock: vi.fn<(row: SessionInsert) => Promise<void>>(async () => undefined),
  insertWorkItemMock: vi.fn<(row: WorkItemInsert) => Promise<void>>(async () => undefined),
  updateSessionWhenStateMock: vi.fn<
    (projectId: string, sessionId: string, expected: string | string[], fields: Record<string, unknown>) => boolean
  >(() => true),
  findAgentMock: vi.fn(),
  findAgentVersionMock: vi.fn(),
  findEnvironmentMock: vi.fn(),
  findEnvironmentVersionMock: vi.fn(),
  resolveEnvironmentForRuntimeMock: vi.fn(),
  assignWorkMock: vi.fn(async () => true),
  secretVersionForResolutionMock: vi.fn(),
}))

// Provider/runtime resolution + provider-config read live in the deps-first
// provisioning usecase. Stub those seams.
vi.mock('./provisioning', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./provisioning')>()),
  resolveSessionProviderId: resolveSessionProviderIdMock,
  validateRuntimeProviderModel: validateRuntimeProviderModelMock,
  resolveSessionProviderConfig: resolveSessionProviderConfigMock,
}))

vi.mock('@server/domain/runtime/session-snapshot', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@server/domain/runtime/session-snapshot')>()),
  agentSubagentReferences: agentSubagentReferencesMock,
  createAgentSnapshot: createAgentSnapshotMock,
  createSessionSubagentSnapshot: createSessionSubagentSnapshotMock,
  createEnvironmentSnapshot: createEnvironmentSnapshotMock,
}))

// The inline cloud launch delegates to the cloud-turn usecase; the queued path
// (runsInline=false) never reaches it, but stub it so no real startup runs.
vi.mock('./cloud-turn', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./cloud-turn')>()),
  startSessionRuntimeForRow: startSessionRuntimeForRowMock,
}))

import { type CreateSessionDeps, createSessionForAgent } from './session-create'

const store = {
  db: {},
  findAgent: findAgentMock,
  findAgentVersion: findAgentVersionMock,
  findEnvironment: findEnvironmentMock,
  findEnvironmentVersion: findEnvironmentVersionMock,
  resolveEnvironmentForRuntime: resolveEnvironmentForRuntimeMock,
  insertSession: insertSessionMock,
  insertWorkItem: insertWorkItemMock,
  updateSessionWhenState: updateSessionWhenStateMock,
  secretVersionForResolution: secretVersionForResolutionMock,
}

// enqueue is env-bound at the gateway; the usecase drives it through
// deps.cloudTurnQueue.enqueue(message). Route it to the spy so the throw lands on
// the launch dispatch the reconcile flow catches.
const deps: CreateSessionDeps = {
  sessionOrchestration: store as never,
  sessionEventStore: {
    eventStream: async () => [],
    appendCanonicalEvent: async () => 'event_test',
    queryEvents: async () => ({ rows: [], hasMore: false }),
    archive: async () => {},
  } as never,
  providers: {
    findModel: async () => ({ id: 'm', providerId: 'workers-ai', modelId: '@cf/x' }),
    findBySlug: async () => ({ id: 'workers-ai', slug: 'workers-ai' }),
  } as never,
  audit: { record: (auth: unknown, entry: unknown) => recordAuditMock(auth, entry) } as never,
  policy: {
    evaluateProviderForSession: (auth: unknown, values: unknown) =>
      evaluateProviderPolicyForSessionMock(auth as never, values as never),
    evaluateSandboxRuntime: (auth: unknown, values: unknown) =>
      evaluateSandboxRuntimePolicyMock(auth as never, values as never),
  } as never,
  cloudRuntime: {} as never,
  enborTurnExecutor: {} as never,
  cloudTurnQueue: {
    enqueue: (message: unknown) => enqueueCloudTurnMock(message),
    runsInline: () => cloudTurnsRunInlineMock(),
  } as never,
  runtimeSecrets: {
    resolveEnv: async () => ({}),
    resolveWorkspaceManifest: async () => ({ root: '/workspace', mounts: [] }),
  } as never,
  runnerChannel: {
    assignWork: assignWorkMock,
  } as never,
  createApprovalGate: () => ({}) as never,
  rereadStartedSession: false,
}

const auth: AuthScope = {
  user: { id: 'user_1' },
  organization: { id: 'org_1', name: 'org_1' },
  project: { id: 'proj_1', name: 'proj_1' },
  roles: ['system'],
  permissions: ['*'],
}

describe('createSessionForAgent — launch dispatch failure (H5 FIX 2)', () => {
  beforeEach(() => {
    agentSubagentReferencesMock.mockReset()
    agentSubagentReferencesMock.mockReturnValue([])
    createSessionSubagentSnapshotMock.mockClear()
    enqueueCloudTurnMock.mockReset()
    cloudTurnsRunInlineMock.mockReturnValue(false)
    recordAuditMock.mockReset()
    insertSessionMock.mockReset()
    insertSessionMock.mockResolvedValue(undefined)
    insertWorkItemMock.mockReset()
    insertWorkItemMock.mockResolvedValue(undefined)
    updateSessionWhenStateMock.mockReset()
    updateSessionWhenStateMock.mockReturnValue(true)
    findAgentMock.mockResolvedValue({
      id: 'agent_1',
      currentVersionId: 'agentver_1',
      archivedAt: null,
    })
    findAgentVersionMock.mockResolvedValue({ id: 'agentver_1', model: '@cf/x', providerId: 'anthropic' })
    findEnvironmentMock.mockResolvedValue({ id: 'env_1', currentVersionId: 'envver_1' })
    findEnvironmentVersionMock.mockResolvedValue({ id: 'envver_1', hostingMode: 'cloud' })
    resolveEnvironmentForRuntimeMock.mockReset()
    assignWorkMock.mockClear()
  })

  it('reconciles the orphaned pending row to error and returns session_launch_failed when the cloud-turn enqueue throws', async () => {
    enqueueCloudTurnMock.mockRejectedValue(new Error('queue send failed'))

    const result = await createSessionForAgent(
      deps,
      auth,
      'agent_1',
      'env_1',
      { runtime: 'enbor', prompt: 'Start cloud session' },
      null,
    )

    expect(result).toEqual({
      ok: false,
      error: { status: 500, code: 'session_launch_failed', message: 'queue send failed' },
    })
    // The pending row was inserted, then reconciled to 'error' under the
    // pending CAS.
    expect(insertSessionMock).toHaveBeenCalledTimes(1)
    const reconcile = updateSessionWhenStateMock.mock.calls.find(
      (call) => call[2] === 'pending' && (call[3] as { state?: string }).state === 'error',
    )
    expect(reconcile).toBeTruthy()
    expect((reconcile?.[3] as { stateReason?: string }).stateReason).toBe('queue send failed')
    // A create-failure audit was recorded.
    const failureAudit = recordAuditMock.mock.calls.find(
      (call) =>
        (call[1] as { action?: string; outcome?: string }).action === 'session.create' &&
        (call[1] as { outcome?: string }).outcome === 'failure',
    )
    expect(failureAudit).toBeTruthy()
  })

  it('[spec: sessions/cloud-sandbox-switch] rejects a cloud session without persisting it while cloud is off', async () => {
    const result = await createSessionForAgent(
      { ...deps, cloudSandboxEnabled: false },
      auth,
      'agent_1',
      'env_1',
      { runtime: 'enbor', prompt: 'Start cloud session' },
      null,
    )

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({
        status: 403,
        code: 'forbidden',
        detail: expect.objectContaining({ reason: 'cloud_sandbox_disabled' }),
      }),
    })
    expect(insertSessionMock).not.toHaveBeenCalled()
    expect(enqueueCloudTurnMock).not.toHaveBeenCalled()
  })

  it('keeps the happy path: returns ok and does not reconcile when the enqueue succeeds', async () => {
    enqueueCloudTurnMock.mockResolvedValue(undefined)

    const result = await createSessionForAgent(
      deps,
      auth,
      'agent_1',
      'env_1',
      { runtime: 'enbor', prompt: 'Start cloud session' },
      'req_create_1',
    )

    expect(result.ok).toBe(true)
    expect(insertSessionMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'Start cloud session' }))
    expect(enqueueCloudTurnMock).toHaveBeenCalledTimes(1)
    expect(enqueueCloudTurnMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'session.start', requestId: 'req_create_1' }),
    )
    const reconcile = updateSessionWhenStateMock.mock.calls.find(
      (call) => (call[3] as { state?: string }).state === 'error',
    )
    expect(reconcile).toBeUndefined()
  })

  it('[spec: agents/subagent-references] resolves each reference to its current version before snapshotting the session', async () => {
    const parentVersion = { id: 'agentver_parent', providerId: 'anthropic', model: '@cf/x' }
    const reviewerVersion = { id: 'agentver_reviewer_2', version: 2 }
    findAgentMock.mockImplementation(async (_projectId, agentId) =>
      agentId === 'agent_parent'
        ? { id: 'agent_parent', currentVersionId: parentVersion.id, archivedAt: null }
        : {
            id: 'agent_reviewer',
            name: 'Reviewer',
            description: 'Reviews work.',
            currentVersionId: reviewerVersion.id,
            deletedAt: null,
          },
    )
    findAgentVersionMock.mockImplementation(async (agentId, versionId) =>
      agentId === 'agent_parent' && versionId === parentVersion.id ? parentVersion : reviewerVersion,
    )
    agentSubagentReferencesMock.mockReturnValueOnce([{ agentId: 'agent_reviewer', name: 'reviewer' }])
    createAgentSnapshotMock.mockImplementationOnce((_version, subagents) => ({
      id: parentVersion.id,
      provider: 'anthropic',
      model: '@cf/x',
      identity: null,
      subagents,
    }))
    enqueueCloudTurnMock.mockResolvedValue(undefined)

    const result = await createSessionForAgent(
      deps,
      auth,
      'agent_parent',
      'env_1',
      { runtime: 'enbor', prompt: 'Coordinate review' },
      null,
    )

    expect(result.ok).toBe(true)
    expect(findAgentVersionMock).toHaveBeenCalledWith('agent_reviewer', 'agentver_reviewer_2')
    expect(createSessionSubagentSnapshotMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'agent_reviewer' }),
      reviewerVersion,
      'reviewer',
    )
    expect(createAgentSnapshotMock).toHaveBeenCalledWith(parentVersion, [
      expect.objectContaining({
        agentId: 'agent_reviewer',
        agentVersionId: 'agentver_reviewer_2',
        name: 'reviewer',
      }),
    ])
  })

  it('[spec: agents/subagent-references] rejects a malformed persisted sub-agent reference before looking up its Agent', async () => {
    const actual = await vi.importActual<typeof import('@server/domain/runtime/session-snapshot')>(
      '@server/domain/runtime/session-snapshot',
    )
    agentSubagentReferencesMock.mockImplementationOnce((row) =>
      actual.agentSubagentReferences(row as Parameters<typeof actual.agentSubagentReferences>[0]),
    )
    findAgentVersionMock.mockResolvedValueOnce({
      id: 'agentver_1',
      model: '@cf/x',
      providerId: 'anthropic',
      subagents: JSON.stringify([{ name: 'reviewer', systemPrompt: 'Unmigrated definition' }]),
    })
    findAgentMock.mockClear()
    findAgentMock.mockImplementation(async (_projectId, agentId) => {
      if (agentId !== 'agent_1') throw new TypeError('Invalid identifier reached the persistence port')
      return { id: 'agent_1', currentVersionId: 'agentver_1', deletedAt: null }
    })

    const result = await createSessionForAgent(
      deps,
      auth,
      'agent_1',
      'env_1',
      { runtime: 'enbor', prompt: 'Coordinate review' },
      null,
    )

    expect(result).toMatchObject({ ok: false, error: { status: 409, code: 'conflict' } })
    expect(findAgentMock.mock.calls.map(([, agentId]) => agentId)).toEqual(['agent_1'])
    expect(insertSessionMock).not.toHaveBeenCalled()
    expect(insertWorkItemMock).not.toHaveBeenCalled()
    expect(enqueueCloudTurnMock).not.toHaveBeenCalled()
  })

  it('rejects sessions without a prompt before creating any rows', async () => {
    const result = await createSessionForAgent(
      deps,
      auth,
      'agent_1',
      'env_1',
      {
        runtime: 'codex',
        prompt: '',
      },
      null,
    )

    expect(result).toEqual({
      ok: false,
      error: {
        status: 400,
        code: 'validation_error',
        message: 'Prompt is required',
        fields: { prompt: 'Prompt is required.' },
      },
    })
    expect(insertSessionMock).not.toHaveBeenCalled()
    expect(assignWorkMock).not.toHaveBeenCalled()
  })
})

describe('createSessionForAgent — environment resolution', () => {
  beforeEach(() => {
    enqueueCloudTurnMock.mockReset()
    enqueueCloudTurnMock.mockResolvedValue(undefined)
    cloudTurnsRunInlineMock.mockReturnValue(false)
    recordAuditMock.mockReset()
    insertSessionMock.mockReset()
    insertSessionMock.mockResolvedValue(undefined)
    insertWorkItemMock.mockReset()
    insertWorkItemMock.mockResolvedValue(undefined)
    updateSessionWhenStateMock.mockReset()
    updateSessionWhenStateMock.mockReturnValue(true)
    findAgentMock.mockResolvedValue({
      id: 'agent_1',
      currentVersionId: 'agentver_1',
      archivedAt: null,
    })
    findAgentVersionMock.mockResolvedValue({ id: 'agentver_1', model: '@cf/x', providerId: 'anthropic' })
    findEnvironmentMock.mockReset()
    findEnvironmentMock.mockResolvedValue({ id: 'env_resolved', currentVersionId: 'envver_1' })
    findEnvironmentVersionMock.mockResolvedValue({ id: 'envver_1', hostingMode: 'cloud' })
    resolveEnvironmentForRuntimeMock.mockReset()
    createAgentSnapshotMock.mockReturnValue({
      id: 'agentver_1',
      provider: 'anthropic',
      providerId: 'anthropic',
      model: '@cf/x',
      identity: null,
    } as never)
    createEnvironmentSnapshotMock.mockReturnValue({ id: 'envver_1', type: 'cloud' } as never)
  })

  it('resolves an environment for the runtime/model when none is pinned', async () => {
    resolveEnvironmentForRuntimeMock.mockResolvedValue('env_resolved')

    const result = await createSessionForAgent(
      deps,
      auth,
      'agent_1',
      null,
      { runtime: 'codex', prompt: 'Run Codex' },
      null,
    )

    expect(result.ok).toBe(true)
    expect(resolveEnvironmentForRuntimeMock).toHaveBeenCalledWith('proj_1', 'codex', '@cf/x')
    // The resolved id is what gets looked up and used.
    expect(findEnvironmentMock).toHaveBeenCalledWith('proj_1', 'env_resolved')
  })

  it('does not resolve when an environment is pinned', async () => {
    const result = await createSessionForAgent(
      deps,
      auth,
      'agent_1',
      'env_pinned',
      { runtime: 'codex', prompt: 'Run Codex' },
      null,
    )

    expect(result.ok).toBe(true)
    expect(resolveEnvironmentForRuntimeMock).not.toHaveBeenCalled()
    expect(findEnvironmentMock).toHaveBeenCalledWith('proj_1', 'env_pinned')
  })

  it('leaves provider and model selection to the self-hosted runtime when the agent pins neither', async () => {
    evaluateProviderPolicyForSessionMock.mockClear()
    findAgentVersionMock.mockResolvedValue({ id: 'agentver_1', model: null, providerId: null })
    createAgentSnapshotMock.mockReturnValue({
      id: 'agentver_1',
      provider: null,
      model: null,
      identity: null,
    } as never)
    findEnvironmentVersionMock.mockResolvedValue({ id: 'envver_1', hostingMode: 'self_hosted' })
    createEnvironmentSnapshotMock.mockReturnValue({ id: 'envver_1', type: 'self_hosted' } as never)

    const result = await createSessionForAgent(
      deps,
      auth,
      'agent_1',
      'env_pinned',
      { runtime: 'codex', prompt: 'Use the Codex runtime default' },
      null,
    )

    expect(result.ok).toBe(true)
    expect(createAgentSnapshotMock).toHaveBeenCalledWith(expect.objectContaining({ providerId: null }), [])
    expect(evaluateProviderPolicyForSessionMock).not.toHaveBeenCalled()
    expect(JSON.parse(insertSessionMock.mock.calls[0]?.[0].modelConfig ?? 'null')).toEqual({})
    expect(insertSessionMock.mock.calls[0]?.[0].modelProvider).toBeNull()
  })

  it('uses the runner-local model at self-hosted boundaries while preserving canonical snapshots', async () => {
    const canonicalModel = 'openai/gpt-5.6-sol'
    const localModel = 'gpt-5.6-sol'
    findAgentVersionMock.mockResolvedValue({ id: 'agentver_1', model: canonicalModel, providerId: 'openai' })
    createAgentSnapshotMock.mockReturnValue({
      id: 'agentver_1',
      provider: 'openai',
      providerId: 'openai',
      model: canonicalModel,
      identity: null,
    } as never)
    findEnvironmentVersionMock.mockResolvedValue({ id: 'envver_1', hostingMode: 'self_hosted' })
    createEnvironmentSnapshotMock.mockReturnValue({ id: 'envver_1', type: 'self_hosted' } as never)
    resolveEnvironmentForRuntimeMock.mockResolvedValue('env_resolved')

    const result = await createSessionForAgent(
      deps,
      auth,
      'agent_1',
      null,
      { runtime: 'codex', prompt: 'Run canonical Codex model' },
      null,
    )

    expect(result.ok).toBe(true)
    expect(resolveEnvironmentForRuntimeMock).toHaveBeenCalledWith('proj_1', 'codex', localModel)
    const insertedSession = insertSessionMock.mock.calls[0]?.[0]
    expect(insertedSession).toBeDefined()
    expect(JSON.parse(insertedSession?.agentSnapshot ?? 'null')).toMatchObject({ model: canonicalModel })
    expect(JSON.parse(insertedSession?.modelConfig ?? 'null')).toEqual({ provider: 'openai', model: canonicalModel })

    const workItem = insertWorkItemMock.mock.calls[0]?.[0]
    expect(workItem).toBeDefined()
    expect(JSON.parse(workItem?.payload ?? 'null')).toMatchObject({
      model: localModel,
      runtimeRequirement: { runtime: 'codex', model: localModel },
      agentSnapshot: { model: canonicalModel },
    })
  })

  it('returns a 409 and creates no session when no environment can be resolved', async () => {
    resolveEnvironmentForRuntimeMock.mockResolvedValue(null)

    const result = await createSessionForAgent(
      deps,
      auth,
      'agent_1',
      null,
      { runtime: 'codex', prompt: 'Run Codex' },
      null,
    )

    expect(result).toEqual({
      ok: false,
      error: {
        status: 409,
        code: 'conflict',
        message: 'No environment has an active runner for runtime "codex"; specify environmentId',
      },
    })
    expect(findEnvironmentMock).not.toHaveBeenCalled()
    expect(insertSessionMock).not.toHaveBeenCalled()
  })
})

describe('[spec: sessions/identity-materialization] Identity runtime inputs', () => {
  const binding = {
    identityId: 'identity_1',
    agentId: 'rr_agent_1',
    issuer: 'https://realmroot.example.com/api/auth',
    subject: 'rr_agent_1',
    username: 'runner',
    runtime: 'enbor' as const,
    credentialRef: 'enbor://vaults/vault_1/credentials/cred_1',
  }

  beforeEach(() => {
    enqueueCloudTurnMock.mockReset()
    enqueueCloudTurnMock.mockResolvedValue(undefined)
    cloudTurnsRunInlineMock.mockReturnValue(false)
    insertSessionMock.mockReset()
    insertSessionMock.mockResolvedValue(undefined)
    updateSessionWhenStateMock.mockReset()
    updateSessionWhenStateMock.mockReturnValue(true)
    findAgentMock.mockResolvedValue({ id: 'agent_1', currentVersionId: 'agentver_1', archivedAt: null })
    findAgentVersionMock.mockResolvedValue({ id: 'agentver_1', model: '@cf/x', providerId: 'anthropic' })
    findEnvironmentMock.mockResolvedValue({ id: 'env_1', currentVersionId: 'envver_1' })
    findEnvironmentVersionMock.mockResolvedValue({ id: 'envver_1', hostingMode: 'cloud' })
    createAgentSnapshotMock.mockReturnValue({
      id: 'agentver_1',
      providerId: 'anthropic',
      model: '@cf/x',
      identity: binding,
    } as never)
    secretVersionForResolutionMock.mockReset()
    secretVersionForResolutionMock.mockResolvedValue({
      id: 'vaultver_rotated',
      state: 'active',
      metadata: '{}',
      secretRef: 'enbor://vaults/vault_1/credentials/cred_1/versions/vaultver_rotated',
    })
  })

  it.each([
    'enbor',
    'codex',
    'claude-code',
    'copilot',
  ] as const)('[spec: identities/runtime-constraint] inherits %s and declaratively seeds the bound credential into a writable emptyDir', async (runtime) => {
    createAgentSnapshotMock.mockReturnValue({
      id: 'agentver_1',
      providerId: 'anthropic',
      model: '@cf/x',
      identity: { ...binding, runtime },
    } as never)
    const result = await createSessionForAgent(
      deps,
      auth,
      'agent_1',
      'env_1',
      { id: 'session_bound', prompt: 'Use private resources' },
      null,
    )

    expect(result.ok).toBe(true)
    const inserted = (
      insertSessionMock.mock.calls as unknown as Array<[{ env: string; volumes: string; volumeMounts: string }]>
    )[0]![0]
    expect(JSON.parse(inserted.env)).toEqual({
      AGENT: runtime,
      AGENT_SESSION_ID: 'session_bound',
      REALMROOT_ORIGIN: new URL(binding.issuer).origin,
      REALMROOT_STATE_DIR: '/workspace/.enbor/realmroot-state',
    })
    expect(JSON.parse(inserted.volumes)).toEqual([
      {
        name: 'realmroot-agent-state',
        type: 'empty_dir',
        seedFrom: [
          {
            type: 'secret',
            secretRef: binding.credentialRef,
            items: [
              {
                key: 'state.json',
                path: `identities/${Buffer.from(binding.issuer).toString('base64url')}/${Buffer.from(runtime).toString('base64url')}.json`,
              },
            ],
          },
        ],
      },
    ])
    expect(JSON.parse(inserted.volumeMounts)).toEqual([
      {
        name: 'realmroot-agent-state',
        mountPath: '/workspace/.enbor/realmroot-state',
        readOnly: false,
      },
    ])
    expect(secretVersionForResolutionMock).toHaveBeenCalledWith('org_1', 'proj_1', binding.credentialRef)
  })

  it('[spec: identities/runtime-constraint] rejects an explicit runtime conflicting with the Identity', async () => {
    createAgentSnapshotMock.mockReturnValue({
      id: 'agentver_1',
      providerId: 'anthropic',
      model: '@cf/x',
      identity: { ...binding, runtime: 'codex' },
    } as never)
    const result = await createSessionForAgent(
      deps,
      auth,
      'agent_1',
      'env_1',
      { runtime: 'enbor', prompt: 'Start' },
      null,
    )
    expect(result).toMatchObject({
      ok: false,
      error: { status: 409, code: 'identity_runtime_mismatch' },
    })
    expect(insertSessionMock).not.toHaveBeenCalled()
  })

  it.each([
    'AGENT',
    'AGENT_SESSION_ID',
    'REALMROOT_ORIGIN',
    'REALMROOT_STATE_DIR',
  ])('rejects caller control of reserved env %s', async (name) => {
    const result = await createSessionForAgent(
      deps,
      auth,
      'agent_1',
      'env_1',
      { runtime: 'enbor', prompt: 'Start', env: { [name]: 'override' } },
      null,
    )

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'validation_error', fields: { [`env.${name}`]: expect.stringContaining('managed') } },
    })
    expect(insertSessionMock).not.toHaveBeenCalled()
  })

  it('rejects a reserved Realmroot source volume name', async () => {
    const result = await createSessionForAgent(
      deps,
      auth,
      'agent_1',
      'env_1',
      {
        runtime: 'enbor',
        prompt: 'Start',
        volumes: [
          {
            name: 'realmroot-agent-state',
            type: 'git_repository',
            url: 'https://github.com/saltbo/enbor.git',
            ref: 'main',
          },
        ],
        volumeMounts: [{ name: 'realmroot-agent-state', mountPath: '/workspace/custom' }],
      },
      null,
    )

    expect(result).toMatchObject({ ok: false, error: { fields: { volumes: expect.stringContaining('reserved') } } })
  })

  it('rejects caller mounts that overlap a reserved Realmroot state directory', async () => {
    const result = await createSessionForAgent(
      deps,
      auth,
      'agent_1',
      'env_1',
      {
        runtime: 'enbor',
        prompt: 'Start',
        volumes: [
          {
            name: 'source',
            type: 'git_repository',
            url: 'https://github.com/saltbo/enbor.git',
            ref: 'main',
          },
        ],
        volumeMounts: [{ name: 'source', mountPath: '/workspace/.enbor' }],
      },
      null,
    )

    expect(result).toMatchObject({
      ok: false,
      error: { fields: { volumeMounts: expect.stringContaining('reserved') } },
    })
  })

  it.each([
    { envFrom: [{ type: 'secret', secretRef: 'enbor://vaults/vault_2/credentials/cred_2' }] },
    {
      envFrom: [
        {
          type: 'secret',
          name: 'AGENT_SESSION_ID',
          key: 'origin',
          secretRef: 'enbor://vaults/vault_2/credentials/cred_2',
        },
      ],
    },
  ])('rejects bulk or reserved-name envFrom entries', async ({ envFrom }) => {
    const result = await createSessionForAgent(
      deps,
      auth,
      'agent_1',
      'env_1',
      { runtime: 'enbor', prompt: 'Start', envFrom: envFrom as never },
      null,
    )

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'validation_error', fields: { 'envFrom.0.name': expect.any(String) } },
    })
    expect(insertSessionMock).not.toHaveBeenCalled()
  })

  it('rejects duplicate emptyDir paths across seed projections', async () => {
    const result = await createSessionForAgent(
      deps,
      auth,
      'agent_1',
      'env_1',
      {
        runtime: 'enbor',
        prompt: 'Start',
        volumes: [
          {
            name: 'state',
            type: 'empty_dir',
            seedFrom: [
              {
                type: 'secret',
                secretRef: 'enbor://vaults/v/credentials/a',
                items: [{ key: 'a', path: 'shared.json' }],
              },
              {
                type: 'secret',
                secretRef: 'enbor://vaults/v/credentials/b',
                items: [{ key: 'b', path: 'shared.json' }],
              },
            ],
          },
        ],
        volumeMounts: [{ name: 'state', mountPath: '/workspace/.enbor/state', readOnly: false }],
      },
      null,
    )

    expect(result).toMatchObject({
      ok: false,
      error: {
        fields: {
          'volumes.0.seedFrom.1.items.0.path': expect.stringContaining('unique across projections'),
        },
      },
    })
    expect(insertSessionMock).not.toHaveBeenCalled()
  })

  it('fails a new Session after the bound credential is revoked', async () => {
    secretVersionForResolutionMock.mockResolvedValue({ state: 'revoked', metadata: '{}', secretRef: 'ref' })
    const result = await createSessionForAgent(
      deps,
      auth,
      'agent_1',
      'env_1',
      { runtime: 'enbor', prompt: 'Start after revocation' },
      null,
    )

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'validation_error',
        fields: { 'volumes.0.seedFrom.0.secretRef': expect.stringContaining('active') },
      },
    })
    expect(insertSessionMock).not.toHaveBeenCalled()
  })
})
