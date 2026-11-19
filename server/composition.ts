import { createAuditPort } from './adapters/gateways/audit'
import { createCloudTurnQueue } from './adapters/gateways/cloud-turn-queue'
import { createInboxCallbackTokenCodec } from './adapters/gateways/inbox-callback-tokens'
import { createInboxSubscriptionGateway } from './adapters/gateways/inbox-subscriptions'
import { createPlatformBudgetGate } from './adapters/gateways/platform-budget'
import { createPolicyPort } from './adapters/gateways/policy'
import { createProviderCatalogGateway } from './adapters/gateways/provider-catalog'
import { createRealmrootEnrollmentGateway } from './adapters/gateways/realmroot-enrollment'
import { createRealmrootManagementAuthority } from './adapters/gateways/realmroot-management'
import { createRunnerChannel } from './adapters/gateways/runner-channel'
import { createRuntimeSecretGateway } from './adapters/gateways/runtime-secrets'
import { createSecretStoreGateway } from './adapters/gateways/secret-store'
import { createSessionDoEventStore } from './adapters/gateways/session-do-events'
import { createCloudLoopChecker, createEventStore } from './adapters/gateways/session-event-store'
import { createTriggerDispatchQueue } from './adapters/gateways/trigger-dispatch-queue'
import { createAgentRepo } from './adapters/repos/agents'
import { createAuditReadRepo } from './adapters/repos/audit-records'
import { createBudgetRepo } from './adapters/repos/budgets'
import { createConnectorRepo } from './adapters/repos/connectors'
import { createEnvironmentRepo } from './adapters/repos/environments'
import { createIdentityRepo } from './adapters/repos/identities'
import { createInboxActivationRepo } from './adapters/repos/inbox-activations'
import { createLeaseRepo } from './adapters/repos/leases'
import { createMemoryStoreRepo } from './adapters/repos/memory-stores'
import { createPolicyRepo } from './adapters/repos/policies'
import { createProjectRepo } from './adapters/repos/projects'
import { createProviderRepo } from './adapters/repos/providers'
import { createRunnerRepo } from './adapters/repos/runners'
import { createRuntimeOrchestrationRepo } from './adapters/repos/runtime-orchestration'
import { createSessionRepo } from './adapters/repos/sessions'
import { createTriggerDispatchRepo } from './adapters/repos/trigger-dispatch'
import { createTriggerRepo } from './adapters/repos/triggers'
import { createUsageRepo } from './adapters/repos/usage-records'
import { createVaultRepo } from './adapters/repos/vaults'
import { createWorkItemRepo } from './adapters/repos/work-items'
import { createRuntimeExecutionAdapters } from './adapters/runtime/sandbox-runtime-host'
import { createDb } from './db/client'
import type { Env } from './env'
import type { Deps } from './usecases/deps'
import { createToolApprovalGate } from './usecases/runtime/approval-gate'

// The single composition root. Wires adapters into the Deps object. Cheap,
// plain-object, and request-free so scheduled/queue entrypoints can reuse it.
export function createDeps(env: Env): Deps {
  const db = createDb(env)
  const sessions = createSessionRepo(db)
  const audit = createAuditPort(db)
  const policy = createPolicyPort(db)
  const sessionOrchestration = createRuntimeOrchestrationRepo(db)
  // Routes event storage per session: cloud-loop (enbor) -> Session DO; relay
  // sessions read live/backfill events through the runner channel only.
  const sessionDoEvents = createSessionDoEventStore(env)
  const isCloudLoop = createCloudLoopChecker(db)
  const sessionEventStore = createEventStore(db, isCloudLoop, sessionDoEvents)
  const runnerChannel = createRunnerChannel(env, (sessionId) => sessions.resolveRunnerEnvironmentId(sessionId))
  const usageRecords = createUsageRepo(db)
  const runtimeExecution = createRuntimeExecutionAdapters(env, {
    runnerChannel,
    resolveSandboxBackend: (sessionId) => sessions.resolveSandboxBackend(sessionId),
  })
  return {
    agents: createAgentRepo(db),
    identities: createIdentityRepo(db),
    environments: createEnvironmentRepo(db),
    providers: createProviderRepo(db),
    realmrootEnrollment: createRealmrootEnrollmentGateway(env),
    realmrootManagement: createRealmrootManagementAuthority(env),
    providerCatalog: createProviderCatalogGateway(),
    vaults: createVaultRepo(db),
    secretStore: createSecretStoreGateway(env),
    connectors: createConnectorRepo(db),
    policies: createPolicyRepo(db),
    budgets: createBudgetRepo(db),
    memoryStores: createMemoryStoreRepo(db),
    audit,
    policy,
    usageRecords,
    auditRecords: createAuditReadRepo(db),
    triggers: createTriggerRepo(db),
    inboxActivations: createInboxActivationRepo(db),
    inboxCallbackTokens: createInboxCallbackTokenCodec(env),
    inboxSubscriptions: createInboxSubscriptionGateway(env),
    triggerDispatch: createTriggerDispatchRepo(db),
    triggerDispatchQueue: createTriggerDispatchQueue(env),
    projects: createProjectRepo(db),
    runners: createRunnerRepo(db),
    workItems: createWorkItemRepo(db),
    leases: createLeaseRepo(db),
    runtimeSecrets: createRuntimeSecretGateway(env, db),
    cloudTurnQueue: createCloudTurnQueue(env),
    runnerChannel,
    ...runtimeExecution,
    sessionOrchestration,
    sessions,
    sessionEventStore,
    createApprovalGate: (values) => createToolApprovalGate({ sessionOrchestration, audit, policy }, values),
    rereadStartedSession: env.RUNTIME_MODE === 'test',
    cloudSandboxEnabled: env.RUNTIME_MODE === 'test' || env.CLOUD_SANDBOX_ENABLED === 'true',
    platformBudget: createPlatformBudgetGate(env, usageRecords),
  }
}
