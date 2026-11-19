import type { EnborEvent } from '@shared/session-events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LIFECYCLE_LEASE_TTL_MS } from '../../domain/runtime/turn'
import { RUNTIME_START_TIMEOUT_MS } from '../../domain/runtime/util'
import { EnvironmentPackageInstallationError } from '../../runtime-error'
import type { SessionOrchestrationStore } from '../ports'
import {
  type CloudTurnDeps,
  consumeCloudTurnQueueMessage,
  markCloudTurnDeadLettered,
  startSessionRuntimeForRow,
} from './cloud-turn'
import { RuntimePolicyDeniedError, RuntimeTurnCancelledError } from './engine/errors'

// Characterization (golden-master) tests for the cloud-command / queue turn
// path: consumeCloudTurnQueueMessage → executeCloudSessionTurn. The integration
// suite runs turns INLINE (RUNTIME_MODE=test ⇒ cloudTurnsRunInline), so the
// paused→enqueue continuation branch is unreachable there. These pin it (and
// the provider/model selection the Phase 1 TurnEngine unification must
// preserve) before that refactor moves the code.
//
// The usecase is deps-first: the orchestration store, sandbox runtime host,
// queue, and audit all arrive on `deps`, so the test wires fakes at those seams
// instead of mocking the env-bound shim modules. enqueue is bridged so the
// assertions still see the (env, message, opts) call shape the queue gateway
// preserves.
const {
  runSessionTurnMock,
  enqueueCloudTurnMock,
  cloudTurnsRunInlineMock,
  recordAuditMock,
  appendEventMock,
  findSessionMock,
  sessionEventStreamMock,
  updateSessionWhenStateMock,
  completeCloudSessionStartMock,
  failCloudSessionStartMock,
  acquirePendingStartupLeaseMock,
  activateCloudSessionMock,
  idleCloudSessionMock,
  resolveEnvMock,
  resolveWorkspaceManifestMock,
  acquireTurnLeaseMock,
  renewTurnLeaseMock,
  releaseTurnLeaseMock,
  incrementContinuationDepthMock,
} = vi.hoisted(() => ({
  runSessionTurnMock:
    vi.fn<
      (input: {
        provider: string
        model: string | null
        onEvent: (event: EnborEvent) => Promise<void>
      }) => Promise<{ status: string }>
    >(),
  enqueueCloudTurnMock: vi.fn(),
  cloudTurnsRunInlineMock: vi.fn(() => false),
  recordAuditMock: vi.fn(),
  appendEventMock: vi.fn<(scope: unknown, event: EnborEvent) => Promise<string>>(async () => 'event_test'),
  findSessionMock: vi.fn(),
  sessionEventStreamMock: vi.fn(() => [] as unknown[]),
  updateSessionWhenStateMock: vi.fn<
    (projectId: string, sessionId: string, expected: string | string[], fields: Record<string, unknown>) => boolean
  >(() => true),
  completeCloudSessionStartMock: vi.fn(async () => true),
  failCloudSessionStartMock: vi.fn(async () => true),
  acquirePendingStartupLeaseMock: vi.fn<SessionOrchestrationStore['acquirePendingStartupLease']>(async () => true),
  activateCloudSessionMock: vi.fn(async () => undefined),
  idleCloudSessionMock: vi.fn(async () => undefined),
  resolveEnvMock: vi.fn(async () => ({})),
  resolveWorkspaceManifestMock: vi.fn(async () => ({ root: '/workspace', mounts: [] })),
  acquireTurnLeaseMock: vi.fn(async () => true),
  renewTurnLeaseMock: vi.fn<SessionOrchestrationStore['renewTurnLease']>(async () => true),
  releaseTurnLeaseMock: vi.fn(async () => true),
  incrementContinuationDepthMock: vi.fn(async () => 1),
}))

const env = { DB: {}, RUNTIME_MODE: 'production' } as never

// The queue gateway is env-bound (enqueue(env, message, opts)); the usecase
// drives it through deps.cloudTurnQueue.enqueue(message, opts). Bridge the two so
// the spy still records the env-first call shape the assertions filter on.
const cloudTurnQueue = {
  enqueue: (message: unknown, opts?: { delaySeconds?: number }) =>
    opts ? enqueueCloudTurnMock(env, message, opts) : enqueueCloudTurnMock(env, message),
  runsInline: () => cloudTurnsRunInlineMock(),
}

const store = {
  db: {},
  findSession: findSessionMock,
  sessionEventStream: sessionEventStreamMock,
  updateSessionWhenState: updateSessionWhenStateMock,
  completeCloudSessionStart: completeCloudSessionStartMock,
  failCloudSessionStart: failCloudSessionStartMock,
  acquirePendingStartupLease: acquirePendingStartupLeaseMock,
  acquireTurnLease: acquireTurnLeaseMock,
  renewTurnLease: renewTurnLeaseMock,
  releaseTurnLease: releaseTurnLeaseMock,
  incrementContinuationDepth: incrementContinuationDepthMock,
}

const deps: CloudTurnDeps = {
  sessionOrchestration: store as never,
  sessionEventStore: {
    eventStream: sessionEventStreamMock,
    appendEvent: appendEventMock,
    queryEvents: vi.fn(),
    archive: vi.fn(),
  } as never,
  providers: {
    findModel: async () => ({ id: 'm', providerId: 'workers-ai', modelId: '@cf/x' }),
    findBySlug: async () => ({ id: 'workers-ai', slug: 'workers-ai' }),
  } as never,
  // The cloud-turn usecase records audit through the AuditPort (deps.audit);
  // record(auth, entry) routes to the same spy the legacy recordAudit path used
  // (the entry lands in call[1], matching the recordAudit(db, { auth, ...entry })
  // shape the assertions filter on).
  audit: { record: (auth: unknown, entry: unknown) => recordAuditMock(auth, entry) } as never,
  policy: {} as never,
  cloudRuntime: {
    activateCloudSession: activateCloudSessionMock,
    idleCloudSession: idleCloudSessionMock,
  } as never,
  enborTurnExecutor: { runTurn: (input: unknown) => runSessionTurnMock(input as never) } as never,
  cloudTurnQueue: cloudTurnQueue as never,
  runtimeSecrets: {
    resolveEnv: resolveEnvMock,
    resolveWorkspaceManifest: resolveWorkspaceManifestMock,
  } as never,
  // runTurn is mocked, so the built callbacks are never exercised; a minimal gate
  // factory keeps buildSessionTurnCallbacks happy.
  createApprovalGate: () =>
    ({
      shouldSuppressEvent: () => false,
      resolveToolResult: async () => null,
      gate: async () => null,
      requiresAction: () => false,
    }) as never,
}

function fakeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'session_1',
    state: 'running',
    sandboxId: 'sandbox_1',
    modelProvider: 'workers-ai',
    modelConfig: JSON.stringify({}),
    agentSnapshot: JSON.stringify({ provider: 'anthropic', model: '@cf/x', mcpConnectors: [] }),
    environmentSnapshot: null,
    env: '{}',
    envFrom: '[]',
    volumes: '[]',
    volumeMounts: '[]',
    metadata: null,
    ...overrides,
  }
}

const stepMessage = {
  type: 'session.step',
  sessionId: 'session_1',
  organizationId: 'org_1',
  projectId: 'proj_1',
  auditAction: 'session.command',
} as const

describe('consumeCloudTurnQueueMessage — cloud-command turn path [spec: runtime/cloud-turn]', () => {
  beforeEach(() => {
    runSessionTurnMock.mockReset()
    enqueueCloudTurnMock.mockReset()
    recordAuditMock.mockReset()
    appendEventMock.mockClear()
    updateSessionWhenStateMock.mockClear()
    updateSessionWhenStateMock.mockReturnValue(true)
    completeCloudSessionStartMock.mockReset()
    completeCloudSessionStartMock.mockResolvedValue(true)
    failCloudSessionStartMock.mockReset()
    failCloudSessionStartMock.mockResolvedValue(true)
    acquirePendingStartupLeaseMock.mockReset()
    acquirePendingStartupLeaseMock.mockResolvedValue(true)
    renewTurnLeaseMock.mockReset()
    renewTurnLeaseMock.mockResolvedValue(true)
    idleCloudSessionMock.mockReset()
    activateCloudSessionMock.mockReset()
    resolveEnvMock.mockReset()
    resolveEnvMock.mockResolvedValue({})
    resolveWorkspaceManifestMock.mockReset()
    resolveWorkspaceManifestMock.mockResolvedValue({ root: '/workspace', mounts: [] })
    sessionEventStreamMock.mockReturnValue([])
    findSessionMock.mockReset()
    findSessionMock.mockResolvedValue(fakeSession())
    cloudTurnsRunInlineMock.mockReturnValue(false)
    acquireTurnLeaseMock.mockReset()
    acquireTurnLeaseMock.mockResolvedValue(true)
    renewTurnLeaseMock.mockReset()
    renewTurnLeaseMock.mockResolvedValue(true)
    releaseTurnLeaseMock.mockReset()
    releaseTurnLeaseMock.mockResolvedValue(true)
    incrementContinuationDepthMock.mockReset()
    incrementContinuationDepthMock.mockResolvedValue(1)
  })

  it('re-enqueues a session.step continuation when the turn pauses, without parking idle', async () => {
    runSessionTurnMock.mockResolvedValue({ status: 'paused' })

    await consumeCloudTurnQueueMessage(deps, { ...stepMessage, requestId: 'req_turn_1' })

    expect(enqueueCloudTurnMock).toHaveBeenCalledTimes(1)
    expect(enqueueCloudTurnMock).toHaveBeenCalledWith(
      env,
      expect.objectContaining({
        type: 'session.step',
        sessionId: 'session_1',
        organizationId: 'org_1',
        projectId: 'proj_1',
        requestId: 'req_turn_1',
        auditAction: 'session.command',
      }),
    )
    // A paused turn never transitions the session to idle.
    for (const call of updateSessionWhenStateMock.mock.calls) {
      expect(call[3].state).not.toBe('idle')
    }
  })

  it('[spec: runtime/idle-retention] parks a completed turn idle and sleeps its existing sandbox', async () => {
    findSessionMock.mockResolvedValue(
      fakeSession({ metadata: JSON.stringify({ annotations: { 'enbor.dev/idle-timeout-seconds': '300' } }) }),
    )
    runSessionTurnMock.mockResolvedValue({ status: 'idle' })

    await consumeCloudTurnQueueMessage(deps, stepMessage)

    expect(enqueueCloudTurnMock).not.toHaveBeenCalled()
    expect(updateSessionWhenStateMock).toHaveBeenCalledWith(
      'proj_1',
      'session_1',
      'running',
      expect.objectContaining({ state: 'idle' }),
    )
    expect(updateSessionWhenStateMock.mock.calls.at(-1)?.[3]).not.toHaveProperty('sandboxId')
    expect(idleCloudSessionMock).toHaveBeenCalledWith('sandbox_1', 300)
  })

  it.each([
    { metadata: null, label: 'missing metadata' },
    { metadata: JSON.stringify({}), label: 'missing annotations' },
    { metadata: JSON.stringify({ annotations: {} }), label: 'missing annotation key' },
    {
      metadata: JSON.stringify({ annotations: { 'enbor.dev/idle-timeout-seconds': '0' } }),
      label: 'zero annotation',
    },
    {
      metadata: JSON.stringify({ annotations: { 'enbor.dev/idle-timeout-seconds': '-1' } }),
      label: 'negative annotation',
    },
    {
      metadata: JSON.stringify({ annotations: { 'enbor.dev/idle-timeout-seconds': '1.5' } }),
      label: 'non-integer annotation',
    },
    {
      metadata: JSON.stringify({ annotations: { 'enbor.dev/idle-timeout-seconds': 'later' } }),
      label: 'non-numeric annotation',
    },
  ])('[spec: runtime/idle-retention] sleeps the sandbox for 60 seconds for $label', async ({ metadata }) => {
    findSessionMock.mockResolvedValue(fakeSession({ metadata }))
    runSessionTurnMock.mockResolvedValue({ status: 'idle' })

    await consumeCloudTurnQueueMessage(deps, stepMessage)

    expect(idleCloudSessionMock).toHaveBeenCalledWith('sandbox_1', 60)
    expect(updateSessionWhenStateMock).toHaveBeenCalledWith(
      'proj_1',
      'session_1',
      'running',
      expect.objectContaining({ state: 'idle' }),
    )
  })

  it('[spec: runtime/idle-retention] audits sandbox idle failure without blocking completed-turn settlement', async () => {
    findSessionMock.mockResolvedValue(
      fakeSession({ metadata: JSON.stringify({ annotations: { 'enbor.dev/idle-timeout-seconds': '60' } }) }),
    )
    runSessionTurnMock.mockResolvedValue({ status: 'idle' })
    idleCloudSessionMock.mockRejectedValue(new Error('sandbox idle unavailable'))

    await consumeCloudTurnQueueMessage(deps, stepMessage)

    expect(updateSessionWhenStateMock).toHaveBeenCalledWith(
      'proj_1',
      'session_1',
      'running',
      expect.objectContaining({ state: 'idle' }),
    )
    expect(releaseTurnLeaseMock).toHaveBeenCalledWith('proj_1', 'session_1', expect.any(String), {})
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'session.runtime.idle', outcome: 'failure', sessionId: 'session_1' }),
    )
    for (const call of updateSessionWhenStateMock.mock.calls) {
      expect(call[3].state).not.toBe('error')
    }
  })

  it('passes session.modelProvider (over the agent snapshot provider) and the resolved model into the turn', async () => {
    runSessionTurnMock.mockResolvedValue({ status: 'idle' })

    await consumeCloudTurnQueueMessage(deps, stepMessage)

    expect(runSessionTurnMock).toHaveBeenCalledTimes(1)
    const input = runSessionTurnMock.mock.calls[0]?.[0]
    expect(input?.provider).toBe('workers-ai')
    expect(input?.model).toBe('@cf/x')
  })

  it('[spec: runtime/idle-retention] activates the same cloud sandbox from persisted runtime inputs before a turn', async () => {
    const envFrom = [{ credentialId: 'credential_1', keys: ['TOKEN'] }]
    const volumes = [{ name: 'scratch', type: 'empty_dir', mountPath: '/workspace/scratch' }]
    const volumeMounts = [{ name: 'scratch', mountPath: '/workspace/scratch', readOnly: false }]
    const workspaceManifest = { root: '/workspace', mounts: [{ name: 'scratch', type: 'empty_dir' }] }
    resolveEnvMock.mockResolvedValue({ TOKEN: 'resolved', SHARED: 'resolved' })
    resolveWorkspaceManifestMock.mockResolvedValue(workspaceManifest as never)
    findSessionMock.mockResolvedValue(
      fakeSession({
        env: JSON.stringify({ DIRECT: 'persisted', SHARED: 'direct' }),
        envFrom: JSON.stringify(envFrom),
        volumes: JSON.stringify(volumes),
        volumeMounts: JSON.stringify(volumeMounts),
        environmentSnapshot: JSON.stringify({ runtimeConfig: { old: true } }),
        metadata: JSON.stringify({ runtime: 'enbor', runtimeConfig: { image: 'enbor-tool-executor' } }),
      }),
    )
    runSessionTurnMock.mockResolvedValue({ status: 'idle' })

    await consumeCloudTurnQueueMessage(deps, stepMessage)

    expect(resolveEnvMock).toHaveBeenCalledWith({ organizationId: 'org_1', projectId: 'proj_1' }, envFrom)
    expect(resolveWorkspaceManifestMock).toHaveBeenCalledWith(
      { organizationId: 'org_1', projectId: 'proj_1' },
      volumes,
      volumeMounts,
    )
    expect(activateCloudSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session_1',
        sandboxId: 'sandbox_1',
        provider: 'anthropic',
        model: '@cf/x',
        runtime: 'enbor',
        environmentSnapshot: expect.objectContaining({ runtimeConfig: { image: 'enbor-tool-executor' } }),
        volumes,
        volumeMounts,
        workspaceManifest,
        env: { DIRECT: 'persisted', SHARED: 'resolved', TOKEN: 'resolved' },
      }),
    )
    expect(runSessionTurnMock).toHaveBeenCalledOnce()
  })

  it.each([
    { annotations: undefined, label: 'the default timeout' },
    { annotations: { 'enbor.dev/idle-timeout-seconds': '300' }, label: 'an explicit timeout' },
  ])('[spec: runtime/idle-retention] skips cloud lifecycle for a runner-backed sandbox turn with $label', async ({
    annotations,
  }) => {
    findSessionMock.mockResolvedValue(
      fakeSession({ metadata: JSON.stringify({ sandboxBackend: 'runner-sandbox', annotations }) }),
    )
    runSessionTurnMock.mockResolvedValue({ status: 'idle' })

    await consumeCloudTurnQueueMessage(deps, stepMessage)

    expect(activateCloudSessionMock).not.toHaveBeenCalled()
    expect(idleCloudSessionMock).not.toHaveBeenCalled()
    expect(resolveEnvMock).not.toHaveBeenCalled()
    expect(resolveWorkspaceManifestMock).not.toHaveBeenCalled()
    expect(runSessionTurnMock).toHaveBeenCalledOnce()
  })

  it('prefers modelConfig.model over the agent snapshot model', async () => {
    findSessionMock.mockResolvedValue(fakeSession({ modelConfig: JSON.stringify({ model: '@cf/override' }) }))
    runSessionTurnMock.mockResolvedValue({ status: 'idle' })

    await consumeCloudTurnQueueMessage(deps, stepMessage)

    const input = runSessionTurnMock.mock.calls[0]?.[0]
    expect(input?.model).toBe('@cf/override')
  })

  it('records the user prompt as a canonical transcript event before running a prompt turn', async () => {
    runSessionTurnMock.mockImplementation(async (input) => {
      await input.onEvent({
        type: 'message.completed',
        payload: {
          message: { id: 'runtime-user-message', role: 'user', content: [{ type: 'text', text: 'continue the task' }] },
        },
      })
      return { status: 'idle' }
    })
    findSessionMock.mockResolvedValue(fakeSession({ state: 'idle' }))

    await consumeCloudTurnQueueMessage(deps, {
      type: 'session.turn',
      sessionId: 'session_1',
      organizationId: 'org_1',
      projectId: 'proj_1',
      prompt: 'continue the task',
      auditAction: 'session.command',
    })

    expect(appendEventMock).toHaveBeenCalledWith(
      { organizationId: 'org_1', projectId: 'proj_1', sessionId: 'session_1' },
      expect.objectContaining({
        type: 'message.completed',
        payload: expect.objectContaining({
          message: expect.objectContaining({
            role: 'user',
            content: [expect.objectContaining({ type: 'text', text: 'continue the task' })],
          }),
        }),
      }),
    )
    expect(runSessionTurnMock).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'continue the task' }))
    const userMessages = appendEventMock.mock.calls.filter(
      ([, event]) =>
        event.type === 'message.completed' &&
        (event.payload as { message?: { role?: string } }).message?.role === 'user',
    )
    expect(userMessages).toHaveLength(1)
  })

  it('[spec: runtime/idle-retention] sleeps the existing sandbox when policy denial parks the session idle', async () => {
    findSessionMock.mockResolvedValue(
      fakeSession({ metadata: JSON.stringify({ annotations: { 'enbor.dev/idle-timeout-seconds': '60' } }) }),
    )
    runSessionTurnMock.mockRejectedValue(new RuntimePolicyDeniedError('blocked by sandbox policy'))

    await consumeCloudTurnQueueMessage(deps, stepMessage)

    expect(updateSessionWhenStateMock).toHaveBeenCalledWith(
      'proj_1',
      'session_1',
      'running',
      expect.objectContaining({ state: 'idle', stateReason: 'policy-denied' }),
    )
    expect(idleCloudSessionMock).toHaveBeenCalledWith('sandbox_1', 60)
  })

  it('[spec: runtime/idle-retention] sleeps the existing sandbox when a turn pauses for required action', async () => {
    findSessionMock.mockResolvedValue(
      fakeSession({ metadata: JSON.stringify({ annotations: { 'enbor.dev/idle-timeout-seconds': '60' } }) }),
    )
    runSessionTurnMock.mockRejectedValue(new RuntimeTurnCancelledError())
    const requiresActionDeps: CloudTurnDeps = {
      ...deps,
      createApprovalGate: () =>
        ({
          shouldSuppressEvent: () => false,
          resolveToolResult: async () => null,
          gate: async () => null,
          requiresAction: () => true,
        }) as never,
    }

    await consumeCloudTurnQueueMessage(requiresActionDeps, stepMessage)

    expect(updateSessionWhenStateMock).toHaveBeenCalledWith(
      'proj_1',
      'session_1',
      'running',
      expect.objectContaining({ state: 'idle', stateReason: 'requires-action' }),
    )
    expect(idleCloudSessionMock).toHaveBeenCalledWith('sandbox_1', 60)
    expect(releaseTurnLeaseMock).toHaveBeenCalledWith('proj_1', 'session_1', expect.any(String), {})
  })

  it('defers the turn (without running it) when another turn holds the session lease [spec: runtime/cloud-turn]', async () => {
    acquireTurnLeaseMock.mockResolvedValue(false)

    await consumeCloudTurnQueueMessage(deps, stepMessage)

    // The lease CAS failed → the message is re-enqueued with a delay and the turn
    // never runs against the session another turn is already driving.
    expect(runSessionTurnMock).not.toHaveBeenCalled()
    expect(enqueueCloudTurnMock).toHaveBeenCalledWith(
      env,
      expect.objectContaining({ type: 'session.step' }),
      expect.objectContaining({ delaySeconds: expect.any(Number) }),
    )
  })

  it('[spec: runtime/idle-retention] sleeps the existing sandbox when the continuation cap parks idle', async () => {
    findSessionMock.mockResolvedValue(
      fakeSession({ metadata: JSON.stringify({ annotations: { 'enbor.dev/idle-timeout-seconds': '60' } }) }),
    )
    runSessionTurnMock.mockResolvedValue({ status: 'paused' })
    incrementContinuationDepthMock.mockResolvedValue(25)

    await consumeCloudTurnQueueMessage(deps, stepMessage)

    // At the cap the lease is released with a recoverable reason and no further
    // step is enqueued.
    expect(releaseTurnLeaseMock).toHaveBeenCalledWith(
      'proj_1',
      'session_1',
      expect.any(String),
      expect.objectContaining({ state: 'idle', stateReason: 'continuation-limit' }),
    )
    expect(enqueueCloudTurnMock).not.toHaveBeenCalled()
    expect(idleCloudSessionMock).toHaveBeenCalledWith('sandbox_1', 60)
  })

  it('[spec: runtime/idle-retention] audits sandbox idle failure without blocking continuation-cap settlement', async () => {
    findSessionMock.mockResolvedValue(
      fakeSession({ metadata: JSON.stringify({ annotations: { 'enbor.dev/idle-timeout-seconds': '60' } }) }),
    )
    runSessionTurnMock.mockResolvedValue({ status: 'paused' })
    incrementContinuationDepthMock.mockResolvedValue(25)
    idleCloudSessionMock.mockRejectedValue(new Error('sandbox idle unavailable'))

    await consumeCloudTurnQueueMessage(deps, stepMessage)

    expect(releaseTurnLeaseMock).toHaveBeenCalledWith(
      'proj_1',
      'session_1',
      expect.any(String),
      expect.objectContaining({ state: 'idle', stateReason: 'continuation-limit' }),
    )
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'session.runtime.idle', outcome: 'failure', sessionId: 'session_1' }),
    )
    for (const call of updateSessionWhenStateMock.mock.calls) {
      expect(call[3].state).not.toBe('error')
    }
  })

  it('stops a budget-continuation step whose held lease was lost (renew fails)', async () => {
    renewTurnLeaseMock.mockResolvedValue(false)

    await consumeCloudTurnQueueMessage(deps, { ...stepMessage, turnId: 'turn_held' })

    // renew failed → another worker owns the chain; this step must not run.
    expect(renewTurnLeaseMock).toHaveBeenCalledWith('proj_1', 'session_1', 'turn_held', expect.any(String))
    expect(runSessionTurnMock).not.toHaveBeenCalled()
  })

  it('marks the session errored without reaching the runtime driver on an unknown runtime name [spec: runtime/cloud-turn]', async () => {
    findSessionMock.mockResolvedValue(fakeSession({ state: 'pending' }))

    await consumeCloudTurnQueueMessage(deps, {
      type: 'session.start',
      sessionId: 'session_1',
      organizationId: 'org_1',
      projectId: 'proj_1',
      runtime: 'totally-not-a-runtime',
      runtimeConfig: {},
      auditAction: 'session.prompt',
    } as unknown as Parameters<typeof consumeCloudTurnQueueMessage>[1])

    // An unknown runtime is dead-lettered up front: the turn engine never runs.
    expect(runSessionTurnMock).not.toHaveBeenCalled()
    expect(updateSessionWhenStateMock).toHaveBeenCalledWith(
      'proj_1',
      'session_1',
      ['pending', 'running'],
      expect.objectContaining({ state: 'error', stateReason: 'cloud-turn-failed' }),
    )
  })

  it('[spec: sessions/cloud-sandbox-switch] settles a queued turn errored without running it while cloud is off', async () => {
    await consumeCloudTurnQueueMessage(
      { ...deps, cloudSandboxEnabled: false },
      { ...stepMessage, requestId: 'req_off' },
    )

    expect(runSessionTurnMock).not.toHaveBeenCalled()
    expect(activateCloudSessionMock).not.toHaveBeenCalled()
    expect(enqueueCloudTurnMock).not.toHaveBeenCalled()
    expect(updateSessionWhenStateMock).toHaveBeenCalledWith(
      'proj_1',
      'session_1',
      ['pending', 'running'],
      expect.objectContaining({ state: 'error', stateReason: 'cloud-sandbox-disabled', activeTurnId: null }),
    )
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'session.command',
        outcome: 'denied',
        metadata: { reason: 'cloud_sandbox_disabled', messageType: 'session.step' },
      }),
    )
  })

  it('[spec: sessions/cloud-sandbox-switch] refuses a queued cloud startup while cloud is off', async () => {
    findSessionMock.mockResolvedValue(fakeSession({ state: 'pending' }))

    await consumeCloudTurnQueueMessage({ ...deps, cloudSandboxEnabled: false }, {
      type: 'session.start',
      sessionId: 'session_1',
      organizationId: 'org_1',
      projectId: 'proj_1',
      runtime: 'enbor',
      runtimeConfig: {},
      auditAction: 'session.prompt',
    } as unknown as Parameters<typeof consumeCloudTurnQueueMessage>[1])

    expect(runSessionTurnMock).not.toHaveBeenCalled()
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'session.runtime.start', outcome: 'denied' }),
    )
  })

  it('marks a dead-lettered cloud turn errored and clears its lease [spec: runtime/cloud-turn]', async () => {
    await markCloudTurnDeadLettered(deps, stepMessage)

    expect(updateSessionWhenStateMock).toHaveBeenCalledWith(
      'proj_1',
      'session_1',
      ['pending', 'running'],
      expect.objectContaining({ state: 'error', stateReason: 'cloud-turn-failed', activeTurnId: null }),
    )
    expect(recordAuditMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ outcome: 'failure' }))
  })
})

// Robustness tests for startup partial-failure (H5 FIX 1): startSessionRuntimeForRow
// must not leak a provisioned sandbox when the pending→idle CAS no-ops (lost-row
// race). Deps-first: the sandbox runtime host (start/stop), the MCP snapshot, and
// the runtime env resolve all arrive on `deps`, so the test wires fakes at those
// seams.
describe('startSessionRuntimeForRow — startup partial-failure (H5 FIX 1)', () => {
  const startSessionRuntimeMock = vi.fn<(env: unknown, input: unknown) => Promise<unknown>>()
  const stopSessionRuntimeMock = vi.fn<(env: unknown, sandboxId: unknown) => Promise<undefined>>(async () => undefined)
  const resolveEnvFromMock = vi.fn(async () => ({}))

  const startupDeps: CloudTurnDeps = {
    sessionOrchestration: store as never,
    sessionEventStore: {
      eventStream: sessionEventStreamMock,
      appendEvent: appendEventMock,
      queryEvents: vi.fn(),
      archive: vi.fn(),
    } as never,
    providers: {
      findModel: async () => ({ id: 'm', providerId: 'workers-ai', modelId: '@cf/x' }),
      findBySlug: async () => ({ id: 'workers-ai', slug: 'workers-ai' }),
    } as never,
    audit: { record: (auth: unknown, entry: unknown) => recordAuditMock(auth, entry) } as never,
    policy: { evaluateMcpTool: async () => ({ allowed: true }) } as never,
    cloudRuntime: {
      startCloudSession: (input: unknown) => startSessionRuntimeMock(env, input),
      idleCloudSession: idleCloudSessionMock,
      stopCloudSession: (sandboxId: unknown) => stopSessionRuntimeMock(env, sandboxId),
    } as never,
    enborTurnExecutor: { runTurn: (input: unknown) => runSessionTurnMock(input as never) } as never,
    cloudTurnQueue: cloudTurnQueue as never,
    runtimeSecrets: {
      resolveEnv: () => resolveEnvFromMock(),
      resolveWorkspaceManifest: async () => ({ root: '/workspace', mounts: [] }),
    } as never,
    createApprovalGate: () =>
      ({
        shouldSuppressEvent: () => false,
        resolveToolResult: async () => null,
        gate: async () => null,
        requiresAction: () => false,
      }) as never,
  }

  const auth = {
    user: { id: 'user_1' },
    organization: { id: 'org_1', name: 'org_1' },
    project: { id: 'proj_1', name: 'proj_1' },
    roles: ['system'],
    permissions: ['*'],
  } as never

  function pendingRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'session_1',
      state: 'pending',
      sandboxId: 'sandbox_1',
      startedAt: null,
      metadata: null,
      ...overrides,
    }
  }

  const agentSnapshot = { provider: 'anthropic', model: '@cf/x', mcpConnectors: [] } as never

  beforeEach(() => {
    startSessionRuntimeMock.mockReset()
    startSessionRuntimeMock.mockResolvedValue({
      sandboxId: 'sandbox_1',
      metadata: { runtimeMode: 'test' },
    })
    stopSessionRuntimeMock.mockReset()
    stopSessionRuntimeMock.mockResolvedValue(undefined)
    resolveEnvFromMock.mockReset()
    resolveEnvFromMock.mockResolvedValue({})
    recordAuditMock.mockReset()
    appendEventMock.mockClear()
    findSessionMock.mockReset()
    findSessionMock.mockResolvedValue(pendingRow())
    updateSessionWhenStateMock.mockReset()
    updateSessionWhenStateMock.mockReturnValue(true)
    completeCloudSessionStartMock.mockReset()
    completeCloudSessionStartMock.mockResolvedValue(true)
    failCloudSessionStartMock.mockReset()
    failCloudSessionStartMock.mockResolvedValue(true)
    acquirePendingStartupLeaseMock.mockReset()
    acquirePendingStartupLeaseMock.mockResolvedValue(true)
    renewTurnLeaseMock.mockReset()
    renewTurnLeaseMock.mockResolvedValue(true)
    releaseTurnLeaseMock.mockReset()
    releaseTurnLeaseMock.mockResolvedValue(true)
    idleCloudSessionMock.mockReset()
    ;(store as { mcpCatalogEntries?: unknown }).mcpCatalogEntries = vi.fn(async () => [])
  })

  it('does not destroy the shared sandbox when a duplicate startup CAS loses to an idle winner', async () => {
    findSessionMock.mockResolvedValueOnce(pendingRow()).mockResolvedValueOnce(pendingRow({ state: 'idle' }))
    completeCloudSessionStartMock.mockResolvedValueOnce(false)

    await startSessionRuntimeForRow(startupDeps, auth, {
      pending: pendingRow() as never,
      agentSnapshot,
      environmentSnapshot: null,
      runtime: 'enbor',
      runtimeConfig: {},
      env: {},
      envFrom: [],
      prompt: 'hello',
    })

    expect(startSessionRuntimeMock).toHaveBeenCalledTimes(1)
    expect(stopSessionRuntimeMock).not.toHaveBeenCalled()
    const successAudits = recordAuditMock.mock.calls.filter(
      (call) => (call[1] as { outcome?: string }).outcome === 'success',
    )
    expect(successAudits).toHaveLength(0)
    expect(completeCloudSessionStartMock).toHaveBeenCalledTimes(1)
  })

  it('[spec: runtime/idle-retention] exits before startup side effects when another owner holds the startup lease', async () => {
    acquirePendingStartupLeaseMock.mockResolvedValue(false)

    await startSessionRuntimeForRow(startupDeps, auth, {
      pending: pendingRow() as never,
      agentSnapshot,
      environmentSnapshot: null,
      runtime: 'enbor',
      runtimeConfig: {},
      env: {},
      envFrom: [],
    })

    expect(acquirePendingStartupLeaseMock).toHaveBeenCalledWith(
      'proj_1',
      'session_1',
      null,
      expect.any(String),
      expect.any(String),
      expect.any(String),
    )
    const [, , , , leaseExpiresAt, claimedAt] = acquirePendingStartupLeaseMock.mock.calls[0]!
    expect(Date.parse(leaseExpiresAt) - Date.parse(claimedAt)).toBe(LIFECYCLE_LEASE_TTL_MS)
    expect(resolveEnvFromMock).not.toHaveBeenCalled()
    expect(startSessionRuntimeMock).not.toHaveBeenCalled()
    expect(completeCloudSessionStartMock).not.toHaveBeenCalled()
    expect(failCloudSessionStartMock).not.toHaveBeenCalled()
    expect(stopSessionRuntimeMock).not.toHaveBeenCalled()
  })

  it('[spec: runtime/idle-retention] does not touch the sandbox when startup ownership is lost after preflight', async () => {
    renewTurnLeaseMock.mockResolvedValue(false)
    const beforePreflight = Date.now()

    await startSessionRuntimeForRow(startupDeps, auth, {
      pending: pendingRow() as never,
      agentSnapshot,
      environmentSnapshot: null,
      runtime: 'enbor',
      runtimeConfig: {},
      env: {},
      envFrom: [],
    })

    expect(resolveEnvFromMock).toHaveBeenCalledOnce()
    expect(renewTurnLeaseMock).toHaveBeenCalledWith('proj_1', 'session_1', expect.any(String), expect.any(String))
    const [, , , leaseExpiresAt] = renewTurnLeaseMock.mock.calls[0]!
    expect(Date.parse(leaseExpiresAt)).toBeGreaterThanOrEqual(beforePreflight + LIFECYCLE_LEASE_TTL_MS)
    expect(Date.parse(leaseExpiresAt)).toBeLessThanOrEqual(Date.now() + LIFECYCLE_LEASE_TTL_MS)
    expect(startSessionRuntimeMock).not.toHaveBeenCalled()
    expect(completeCloudSessionStartMock).not.toHaveBeenCalled()
    expect(failCloudSessionStartMock).not.toHaveBeenCalled()
    expect(stopSessionRuntimeMock).not.toHaveBeenCalled()
  })

  it('[spec: runtime/idle-retention] keeps startup ownership until the sandbox launch actually settles', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-03T00:00:00.000Z'))
    let resolveLaunch!: (value: { sandboxId: string; metadata: Record<string, unknown> }) => void
    startSessionRuntimeMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveLaunch = resolve
        }),
    )
    let settled = false

    try {
      const startup = startSessionRuntimeForRow(startupDeps, auth, {
        pending: pendingRow() as never,
        agentSnapshot,
        environmentSnapshot: null,
        runtime: 'enbor',
        runtimeConfig: {},
        env: {},
        envFrom: [],
        prompt: 'hello',
      }).then(() => {
        settled = true
      })
      await vi.advanceTimersByTimeAsync(RUNTIME_START_TIMEOUT_MS + 1)

      expect(settled).toBe(false)
      expect(failCloudSessionStartMock).not.toHaveBeenCalled()
      expect(stopSessionRuntimeMock).not.toHaveBeenCalled()

      resolveLaunch({ sandboxId: 'sandbox_1', metadata: { runtimeMode: 'test' } })
      await startup
      expect(completeCloudSessionStartMock).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([
    'idle',
    'running',
  ])('does not destroy the shared sandbox when startup re-read sees a %s winner', async (state) => {
    findSessionMock.mockResolvedValue(pendingRow({ state }))

    await startSessionRuntimeForRow(startupDeps, auth, {
      pending: pendingRow() as never,
      agentSnapshot,
      environmentSnapshot: null,
      runtime: 'enbor',
      runtimeConfig: {},
      prompt: 'hello',
    })

    expect(stopSessionRuntimeMock).not.toHaveBeenCalled()
    expect(completeCloudSessionStartMock).not.toHaveBeenCalled()
    expect(recordAuditMock).not.toHaveBeenCalled()
  })

  it('records the success audit and dispatches the initial prompt when the CAS succeeds', async () => {
    updateSessionWhenStateMock.mockReturnValue(true)

    await startSessionRuntimeForRow(startupDeps, auth, {
      pending: pendingRow() as never,
      agentSnapshot,
      environmentSnapshot: null,
      runtime: 'enbor',
      runtimeConfig: {},
      env: {},
      envFrom: [],
      prompt: 'hello',
    })

    // No teardown on the happy path.
    expect(stopSessionRuntimeMock).not.toHaveBeenCalled()
    const successAudits = recordAuditMock.mock.calls.filter(
      (call) => (call[1] as { outcome?: string }).outcome === 'success',
    )
    expect(successAudits.length).toBeGreaterThanOrEqual(1)
    expect(completeCloudSessionStartMock).toHaveBeenCalledOnce()
    // The initial-prompt dispatch performs its turn-state CAS after startup completion.
    expect(updateSessionWhenStateMock).toHaveBeenCalled()
    expect(idleCloudSessionMock).not.toHaveBeenCalled()
  })

  it('[spec: runtime/idle-retention] starts without a prompt, sleeps the same sandbox, and retains its id', async () => {
    const metadata = JSON.stringify({ annotations: { 'enbor.dev/idle-timeout-seconds': '300' } })
    findSessionMock.mockResolvedValue(pendingRow({ metadata }))

    await startSessionRuntimeForRow(startupDeps, auth, {
      pending: pendingRow({ metadata }) as never,
      agentSnapshot,
      environmentSnapshot: null,
      runtime: 'enbor',
      runtimeConfig: {},
      env: {},
      envFrom: [],
    })

    expect(idleCloudSessionMock).toHaveBeenCalledWith('sandbox_1', 300)
    expect(completeCloudSessionStartMock).toHaveBeenCalledWith(
      'proj_1',
      'session_1',
      null,
      expect.any(String),
      expect.objectContaining({
        state: 'idle',
        sandboxId: 'sandbox_1',
        activeTurnId: expect.any(String),
        turnLeaseExpiresAt: expect.any(String),
      }),
      expect.objectContaining({ runtimeMode: 'test' }),
    )
    expect(releaseTurnLeaseMock).toHaveBeenCalledWith('proj_1', 'session_1', expect.any(String), {})
    expect(completeCloudSessionStartMock.mock.invocationCallOrder[0]).toBeLessThan(
      idleCloudSessionMock.mock.invocationCallOrder[0]!,
    )
    expect(idleCloudSessionMock.mock.invocationCallOrder[0]).toBeLessThan(
      releaseTurnLeaseMock.mock.invocationCallOrder[0]!,
    )
  })

  it('[spec: runtime/idle-retention] preserves an Inbox timeout backfilled while startup is in flight', async () => {
    findSessionMock.mockResolvedValue(
      pendingRow({
        metadata: JSON.stringify({
          annotations: { 'enbor.dev/idle-timeout-seconds': '60' },
          inboxBackfill: 'preserved',
        }),
      }),
    )

    await startSessionRuntimeForRow(startupDeps, auth, {
      pending: pendingRow({ metadata: JSON.stringify({ beforeStartup: true }) }) as never,
      agentSnapshot,
      environmentSnapshot: null,
      runtime: 'enbor',
      runtimeConfig: {},
      env: {},
      envFrom: [],
    })

    expect(idleCloudSessionMock).toHaveBeenCalledWith('sandbox_1', 60)
    expect(completeCloudSessionStartMock).toHaveBeenCalledWith(
      'proj_1',
      'session_1',
      null,
      expect.any(String),
      expect.objectContaining({ state: 'idle', sandboxId: 'sandbox_1' }),
      expect.objectContaining({ runtimeMode: 'test' }),
    )
  })

  it.each([
    { metadata: null, label: 'missing annotation' },
    {
      metadata: JSON.stringify({ annotations: { 'enbor.dev/idle-timeout-seconds': '0' } }),
      label: 'explicit zero',
    },
  ])('[spec: runtime/idle-retention] starts idle with the 60-second default for $label', async ({ metadata }) => {
    await startSessionRuntimeForRow(startupDeps, auth, {
      pending: pendingRow({ metadata }) as never,
      agentSnapshot,
      environmentSnapshot: null,
      runtime: 'enbor',
      runtimeConfig: {},
      env: {},
      envFrom: [],
    })

    expect(idleCloudSessionMock).toHaveBeenCalledWith('sandbox_1', 60)
    expect(completeCloudSessionStartMock).toHaveBeenCalledWith(
      'proj_1',
      'session_1',
      null,
      expect.any(String),
      expect.objectContaining({ state: 'idle', sandboxId: 'sandbox_1' }),
      expect.objectContaining({ runtimeMode: 'test' }),
    )
  })

  it('[spec: environments/cloud-packages] persists a safe runtime error event when package setup fails', async () => {
    startSessionRuntimeMock.mockRejectedValue(
      new EnvironmentPackageInstallationError(
        'webi-install:realmroot@0.4.2',
        'Webi did not return an installer for the requested package',
      ),
    )

    await startSessionRuntimeForRow(startupDeps, auth, {
      pending: pendingRow() as never,
      agentSnapshot,
      environmentSnapshot: null,
      runtime: 'enbor',
      runtimeConfig: {},
    })

    expect(appendEventMock).toHaveBeenCalledWith(
      { organizationId: 'org_1', projectId: 'proj_1', sessionId: 'session_1' },
      {
        type: 'runtime.error',
        payload: {
          message: 'Environment package installation failed at webi-install:realmroot@0.4.2',
          code: 'environment_package_installation_failed',
          details: {
            step: 'webi-install:realmroot@0.4.2',
            stderr: 'Webi did not return an installer for the requested package',
          },
        },
      },
    )
    expect(failCloudSessionStartMock).toHaveBeenCalledWith(
      'proj_1',
      'session_1',
      null,
      expect.any(String),
      expect.objectContaining({
        state: 'error',
        stateReason: 'Environment package installation failed at webi-install:realmroot@0.4.2',
      }),
      expect.objectContaining({
        runtimeBackend: 'enbor-cloud',
        error: expect.objectContaining({ code: 'environment_package_installation_failed' }),
      }),
    )
    expect(stopSessionRuntimeMock).toHaveBeenCalledWith(env, 'sandbox_1')
  })

  it('[spec: runtime/idle-retention] does not destroy or report against a running winner after startup failure loses its CAS', async () => {
    startSessionRuntimeMock.mockRejectedValue(new Error('stale startup failed'))
    failCloudSessionStartMock.mockResolvedValue(false)
    findSessionMock.mockResolvedValue(pendingRow({ state: 'running', metadata: JSON.stringify({ winner: true }) }))

    await startSessionRuntimeForRow(startupDeps, auth, {
      pending: pendingRow({ metadata: JSON.stringify({ annotations: { source: 'inbox' } }) }) as never,
      agentSnapshot,
      environmentSnapshot: null,
      runtime: 'enbor',
      runtimeConfig: {},
    })

    expect(failCloudSessionStartMock).toHaveBeenCalledOnce()
    expect(stopSessionRuntimeMock).not.toHaveBeenCalled()
    expect(appendEventMock).not.toHaveBeenCalled()
    expect(recordAuditMock).not.toHaveBeenCalled()
  })
})
