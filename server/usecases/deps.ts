import type { EnborEvent } from '@shared/session-events'
import type {
  AgentRepo,
  AuditPort,
  AuditReadRepo,
  AuthScope,
  BudgetRepo,
  CloudRuntimeLifecycle,
  CloudTurnQueue,
  ConnectorRepo,
  EnborTurnExecutor,
  EnvironmentRepo,
  EventStore,
  IdentityRepo,
  InboxActivationRepo,
  InboxCallbackTokenCodec,
  InboxSubscriptionGateway,
  LeaseRepo,
  MemoryStoreRepo,
  PolicyPort,
  PolicyRepo,
  ProjectRepo,
  ProviderCatalogGateway,
  ProviderRepo,
  RealmrootEnrollmentGateway,
  RealmrootManagementAuthority,
  RunnerChannel,
  RunnerRepo,
  RuntimeSecretGateway,
  RuntimeWorkspaceReader,
  SecretStoreGateway,
  SessionOrchestrationStore,
  SessionRepo,
  SessionSandboxExecutor,
  TriggerDispatchQueue,
  TriggerDispatchRepo,
  TriggerRepo,
  UsageRepo,
  VaultRepo,
  WorkItemRepo,
} from './ports'
import type { ToolApprovalGate } from './runtime/approval-gate'

// The approval-gate factory the cloud turn loop threads into its turn callbacks.
// Built once per Deps so the runtime usecases reach it without re-acquiring the
// store/audit/policy ports it closes over.
type CreateApprovalGate = (values: {
  auth: AuthScope
  sessionId: string
  sessionMetadata: Record<string, unknown>
  appendEvent: (event: EnborEvent) => Promise<string>
}) => ToolApprovalGate

// Aggregates every port a usecase may reach for. Constructed once per request
// by composition.createDeps and handed to routes via Hono context.
export interface Deps {
  agents: AgentRepo
  identities?: IdentityRepo
  environments: EnvironmentRepo
  providers: ProviderRepo
  realmrootEnrollment?: RealmrootEnrollmentGateway
  realmrootManagement?: RealmrootManagementAuthority
  providerCatalog: ProviderCatalogGateway
  vaults: VaultRepo
  secretStore: SecretStoreGateway
  connectors: ConnectorRepo
  policies: PolicyRepo
  budgets: BudgetRepo
  memoryStores?: MemoryStoreRepo
  audit: AuditPort
  policy: PolicyPort
  usageRecords: UsageRepo
  auditRecords: AuditReadRepo
  triggers: TriggerRepo
  inboxActivations?: InboxActivationRepo
  inboxCallbackTokens?: InboxCallbackTokenCodec
  inboxSubscriptions?: InboxSubscriptionGateway
  triggerDispatch: TriggerDispatchRepo
  triggerDispatchQueue?: TriggerDispatchQueue
  projects: ProjectRepo
  runners: RunnerRepo
  workItems: WorkItemRepo
  leases: LeaseRepo
  runtimeSecrets: RuntimeSecretGateway
  cloudTurnQueue: CloudTurnQueue
  runnerChannel: RunnerChannel
  cloudRuntime: CloudRuntimeLifecycle
  runtimeWorkspace: RuntimeWorkspaceReader
  sandboxExecutor: SessionSandboxExecutor
  enborTurnExecutor: EnborTurnExecutor
  sessionOrchestration: SessionOrchestrationStore
  sessions: SessionRepo
  // "Storage follows the loop": cloud-loop (enbor) events live in the Session DO,
  // everything else on D1. Routes append/read/stream and cold-store events per session.
  sessionEventStore: EventStore
  createApprovalGate: CreateApprovalGate
  // Mirrors the legacy RUNTIME_MODE === 'test' branch: in test mode the
  // inline cloud launch runs synchronously so the create flow re-reads the
  // started row; in production the launch is fire-and-forget.
  rereadStartedSession: boolean
  // False when the operator has switched the hosted cloud sandbox off; cloud
  // sessions are then refused at creation and their queued turns are not run.
  cloudSandboxEnabled?: boolean
}
