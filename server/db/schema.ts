import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

// API v1 schema. Observable conventions live in spec/api-contracts.feature:
// - `state` = operational state machine; `deletedAt` = deletion tombstone (null = live).
// - `enabled` boolean = operational toggle. Enum values never contain
//   deleted/paused.
// - Credentials are always secret references (credential_id + optional
//   credential_version_id); no raw secret ref strings.
// - organization_id stays in the DB for tenancy but is never exposed in API
//   payloads.

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    name: text('name').notNull(),
    deletedAt: text('deleted_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_projects_unique_live_name_per_organization')
      .on(table.organizationId, table.name)
      .where(sql`${table.deletedAt} is null`),
  ],
)

// Browser login state and sessions are server-owned. Cookies contain only
// opaque random values; Realmroot tokens are encrypted before entering D1.
export const webAuthorizationAttempts = sqliteTable(
  'web_authorization_attempts',
  {
    stateHash: text('state_hash').primaryKey(),
    encryptedPayload: text('encrypted_payload').notNull(),
    returnTo: text('return_to').notNull(),
    expiresAt: text('expires_at').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('idx_web_authorization_attempts_expires_at').on(table.expiresAt)],
)

export const webAuthSessions = sqliteTable(
  'web_auth_sessions',
  {
    idHash: text('id_hash').primaryKey(),
    subject: text('subject').notNull(),
    encryptedAccessToken: text('encrypted_access_token').notNull(),
    encryptedProfileClaims: text('encrypted_profile_claims'),
    expiresAt: text('expires_at').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_web_auth_sessions_subject').on(table.subject),
    index('idx_web_auth_sessions_expires_at').on(table.expiresAt),
  ],
)

// Global vendor catalog. NOT per-tenant: the platform serves one shared model
// universe (cloud runs everything through the Workers AI binding + AI Gateway),
// so a provider is just the model VENDOR (anthropic, openai, moonshotai, …).
// BYOK connection columns (base_url, credential refs, rate limits, budgets) were
// removed — they only ever mattered for the dropped per-tenant BYOK path.
export const providers = sqliteTable(
  'providers',
  {
    id: text('id').primaryKey(),
    // Vendor identity, derivable from a model id's vendor segment so discovery
    // resolves rows by slug.
    slug: text('slug').notNull(),
    displayName: text('display_name').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    metadata: text('metadata').notNull().default('{}'),
    // Last discovery refresh health for this vendor. Mirrors MODEL_CATALOG_STATES.
    modelCatalogState: text('model_catalog_state', { enum: ['ready', 'error'] })
      .notNull()
      .default('ready'),
    // JSON-encoded error object (nullable).
    lastError: text('last_error'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [uniqueIndex('idx_providers_slug').on(table.slug)],
)

// Global model catalog. One row per (vendor provider, model); populated by the
// scheduled discovery refresh (CF Workers AI search API + models.dev), not by
// per-tenant discovery.
export const providerModels = sqliteTable(
  'provider_models',
  {
    id: text('id').primaryKey(),
    providerId: text('provider_id')
      .notNull()
      .references(() => providers.id),
    modelId: text('model_id').notNull(),
    displayName: text('display_name').notNull(),
    capabilities: text('capabilities').notNull().default('[]'),
    contextWindow: integer('context_window'),
    pricing: text('pricing').notNull().default('{}'),
    // Mirrors MODEL_AVAILABILITY (server/domain/provider.ts).
    availability: text('availability', { enum: ['available', 'unavailable', 'disabled'] })
      .notNull()
      .default('available'),
    metadata: text('metadata').notNull().default('{}'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [uniqueIndex('idx_provider_models_unique_model').on(table.providerId, table.modelId)],
)

// Identity owns its independent provisioning lifecycle. vault_id,
// credential_id, and bound_agent_id are deliberately soft pointers: identities
// are declared before agents/vaults and all three write paths are transactional.
export const identities = sqliteTable(
  'identities',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    organizationId: text('organization_id').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    username: text('username').notNull(),
    runtime: text('runtime').notNull(),
    state: text('state', { enum: ['provisioning', 'active', 'error'] })
      .notNull()
      .default('provisioning'),
    failureCode: text('failure_code'),
    vaultId: text('vault_id').notNull(),
    credentialId: text('credential_id'),
    remoteAgentId: text('remote_agent_id'),
    issuer: text('issuer'),
    subject: text('subject'),
    boundAgentId: text('bound_agent_id'),
    idempotencyKeyHash: text('idempotency_key_hash').notNull(),
    requestFingerprint: text('request_fingerprint').notNull(),
    provisioningOwner: text('provisioning_owner'),
    provisioningLeaseExpiresAt: text('provisioning_lease_expires_at'),
    deletedAt: text('deleted_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_identities_project_created').on(table.projectId, table.createdAt, table.id),
    uniqueIndex('idx_identities_project_idempotency').on(table.projectId, table.idempotencyKeyHash),
    uniqueIndex('idx_identities_remote_agent').on(table.remoteAgentId),
    index('idx_identities_bound_agent').on(table.boundAgentId),
    check(
      'ck_identities_runtime',
      sql`length(${table.runtime}) between 1 and 64 and substr(${table.runtime}, 1, 1) glob '[a-z0-9]' and ${table.runtime} not glob '*[^a-z0-9._-]*'`,
    ),
    check('ck_identities_state', sql`${table.state} in ('provisioning','active','error')`),
  ],
)

export const agents = sqliteTable(
  'agents',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    name: text('name').notNull(),
    description: text('description'),
    systemPrompt: text('system_prompt').notNull(),
    // null = leave provider resolution to a runtime that owns defaults.
    providerId: text('provider_id').references(() => providers.id),
    model: text('model'),
    skills: text('skills').notNull().default('[]'),
    // JSON array of named references to existing Agent resources.
    subagents: text('subagents').notNull().default('[]'),
    allowedTools: text('allowed_tools').notNull().default('[]'),
    // JSON array of connector slugs. Resolved against the platform MCP catalog
    // at session start, not FK'd (slugs are stable connector ids).
    mcpConnectors: text('mcp_connectors').notNull().default('[]'),
    identityId: text('identity_id').references(() => identities.id),
    identitySnapshot: text('identity_snapshot'),
    creationKeyHash: text('creation_key_hash'),
    creationFingerprint: text('creation_fingerprint'),
    creationName: text('creation_name'),
    creationDescription: text('creation_description'),
    deletedAt: text('deleted_at'),
    // Intentionally NOT a FK to agent_versions: agents<->agent_versions is a
    // circular reference (agent_versions.agentId FKs agents.id). The pointer is
    // maintained by the repo in the same atomic batch as each version write; a
    // FK here would create an insert-order deadlock on first version creation.
    currentVersionId: text('current_version_id'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_agents_project_created').on(table.projectId, table.createdAt, table.id),
    uniqueIndex('idx_agents_project_creation_idempotency').on(table.projectId, table.creationKeyHash),
  ],
)

// Immutable per-version snapshot of agent config. JSON columns are intentional
// self-contained value objects — never normalized into join tables (atomic
// snapshot integrity).
export const agentVersions = sqliteTable(
  'agent_versions',
  {
    id: text('id').primaryKey(),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    version: integer('version').notNull(),
    systemPrompt: text('system_prompt').notNull(),
    // Snapshot value, intentionally NOT FK'd to providers: a version must survive
    // a hard provider delete (providers support DELETE). Resolved live only when
    // a session is created from this version. Contrast agents.providerId, which IS
    // a FK because it is live mutable config, not a snapshot.
    providerId: text('provider_id'),
    model: text('model'),
    skills: text('skills').notNull().default('[]'),
    subagents: text('subagents').notNull().default('[]'),
    allowedTools: text('allowed_tools').notNull().default('[]'),
    mcpConnectors: text('mcp_connectors').notNull().default('[]'),
    identityId: text('identity_id').references(() => identities.id),
    identitySnapshot: text('identity_snapshot'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_agent_versions_agent_id').on(table.agentId),
    uniqueIndex('idx_agent_versions_agent_version').on(table.agentId, table.version),
  ],
)

export const memoryStores = sqliteTable(
  'memory_stores',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    name: text('name').notNull(),
    description: text('description'),
    deletedAt: text('deleted_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [index('idx_memory_stores_project_created').on(table.projectId, table.createdAt, table.id)],
)

export const memoryStoreMemories = sqliteTable(
  'memory_store_memories',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => memoryStores.id),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    path: text('path').notNull(),
    content: text('content').notNull(),
    metadata: text('metadata').notNull().default('{}'),
    deletedAt: text('deleted_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_memory_store_memories_unique_live_store_path')
      .on(table.storeId, table.path)
      .where(sql`${table.deletedAt} is null`),
    index('idx_memory_store_memories_store_created').on(table.storeId, table.createdAt, table.id),
  ],
)

export const environments = sqliteTable(
  'environments',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    name: text('name').notNull(),
    description: text('description'),
    packages: text('packages').notNull().default('[]'),
    variables: text('variables').notNull().default('{}'),
    // Mirrors EnvironmentHostingMode (server/domain/environment.ts).
    hostingMode: text('hosting_mode', { enum: ['cloud', 'self_hosted'] })
      .notNull()
      .default('cloud'),
    networkPolicy: text('network_policy').notNull().default('{"mode":"unrestricted"}'),
    mcpPolicy: text('mcp_policy').notNull().default('{}'),
    packageManagerPolicy: text('package_manager_policy').notNull().default('{}'),
    resourceLimits: text('resource_limits').notNull().default('{}'),
    runtimeConfig: text('runtime_config').notNull().default('{}'),
    metadata: text('metadata').notNull().default('{}'),
    creationKeyHash: text('creation_key_hash'),
    creationFingerprint: text('creation_fingerprint'),
    creationName: text('creation_name'),
    creationDescription: text('creation_description'),
    deletedAt: text('deleted_at'),
    // Intentionally NOT a FK to environment_versions: the circular reference
    // (environment_versions.environment_id -> environments.id) would make inserts
    // un-orderable. The repo writes the initial pointer and version atomically;
    // integrity is enforced in the usecase, not the DB.
    currentVersionId: text('current_version_id'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_environments_project_created').on(table.projectId, table.createdAt, table.id),
    uniqueIndex('idx_environments_project_creation_idempotency').on(table.projectId, table.creationKeyHash),
    check('ck_environments_hosting_mode', sql`${table.hostingMode} in ('cloud','self_hosted')`),
  ],
)

export const environmentVersions = sqliteTable(
  'environment_versions',
  {
    id: text('id').primaryKey(),
    environmentId: text('environment_id')
      .notNull()
      .references(() => environments.id),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    version: integer('version').notNull(),
    packages: text('packages').notNull(),
    variables: text('variables').notNull(),
    hostingMode: text('hosting_mode', { enum: ['cloud', 'self_hosted'] })
      .notNull()
      .default('cloud'),
    networkPolicy: text('network_policy').notNull().default('{"mode":"unrestricted"}'),
    mcpPolicy: text('mcp_policy').notNull().default('{}'),
    packageManagerPolicy: text('package_manager_policy').notNull().default('{}'),
    resourceLimits: text('resource_limits').notNull(),
    runtimeConfig: text('runtime_config').notNull(),
    metadata: text('metadata').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_environment_versions_environment_id').on(table.environmentId),
    uniqueIndex('idx_environment_versions_environment_version').on(table.environmentId, table.version),
    check('ck_environment_versions_hosting_mode', sql`${table.hostingMode} in ('cloud','self_hosted')`),
  ],
)

export const vaults = sqliteTable(
  'vaults',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    // NULL = organization-scoped (shared across every project in the org).
    // Project-scoped rows pin a projectId; org-scoped rows are NULL by design
    // (see scope column). organization_id is always present. Visibility queries
    // use OR(projectId=?, projectId IS NULL).
    projectId: text('project_id').references(() => projects.id),
    name: text('name').notNull(),
    description: text('description'),
    // Mirrors VAULT_SCOPES (server/domain/vault.ts).
    scope: text('scope', { enum: ['project', 'organization'] })
      .notNull()
      .default('project'),
    managedBy: text('managed_by', { enum: ['identity'] }),
    deletedAt: text('deleted_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_vaults_project_created').on(table.projectId, table.createdAt, table.id),
    index('idx_vaults_organization_created').on(table.organizationId, table.createdAt, table.id),
    check('ck_vaults_scope', sql`${table.scope} in ('project','organization')`),
  ],
)

export const vaultCredentials = sqliteTable(
  'vault_credentials',
  {
    id: text('id').primaryKey(),
    vaultId: text('vault_id')
      .notNull()
      .references(() => vaults.id),
    organizationId: text('organization_id').notNull(),
    // NULL = organization-scoped (shared across the org); project-scoped rows pin
    // a projectId. organization_id is always present. By design — do not force
    // NOT NULL (scope queries use OR(projectId=?, projectId IS NULL)).
    projectId: text('project_id').references(() => projects.id),
    name: text('name').notNull(),
    type: text('type', {
      enum: [
        'opaque',
        'enbor.dev/basic-auth',
        'enbor.dev/ssh-auth',
        'enbor.dev/tls',
        'enbor.dev/private-key-jwk',
        'enbor.dev/oauth-token',
        'enbor.dev/realmroot-agent-state',
      ],
    }).notNull(),
    metadata: text('metadata').notNull().default('{}'),
    // Mirrors CREDENTIAL_STATES (server/domain/vault.ts).
    state: text('state', { enum: ['active', 'revoked'] })
      .notNull()
      .default('active'),
    // Intentional non-FK soft pointer. A real FK here + the version's credential_id
    // FK would form a circular dependency blocking the two-step insert (insert
    // credential, insert version, then set active_version_id). Integrity is kept by
    // the insertCredentialWithVersion/insertVersionRotation batches.
    activeVersionId: text('active_version_id'),
    revokedAt: text('revoked_at'),
    revokedByUserId: text('revoked_by_user_id'),
    revokeReason: text('revoke_reason'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_vault_credentials_vault_created').on(table.vaultId, table.createdAt, table.id),
    index('idx_vault_credentials_project_created').on(table.projectId, table.createdAt, table.id),
    uniqueIndex('idx_vault_credentials_identity_purpose')
      .on(
        table.vaultId,
        sql`json_extract(${table.metadata}, '$.managedBy')`,
        sql`json_extract(${table.metadata}, '$.identityId')`,
        sql`coalesce(json_extract(${table.metadata}, '$.purpose'), case when ${table.type} = 'enbor.dev/realmroot-agent-state' then 'agent-state' end)`,
      )
      .where(sql`json_extract(${table.metadata}, '$.managedBy') = 'identity'`),
    check('ck_vault_credentials_state', sql`${table.state} in ('active','revoked')`),
    check(
      'ck_vault_credentials_type',
      sql`${table.type} in ('opaque','enbor.dev/basic-auth','enbor.dev/ssh-auth','enbor.dev/tls','enbor.dev/private-key-jwk','enbor.dev/oauth-token','enbor.dev/realmroot-agent-state')`,
    ),
  ],
)

export const vaultCredentialVersions = sqliteTable(
  'vault_credential_versions',
  {
    id: text('id').primaryKey(),
    credentialId: text('credential_id')
      .notNull()
      .references(() => vaultCredentials.id),
    vaultId: text('vault_id')
      .notNull()
      .references(() => vaults.id),
    organizationId: text('organization_id').notNull(),
    // NULL = organization-scoped; project-scoped rows pin a projectId. By design.
    projectId: text('project_id').references(() => projects.id),
    version: integer('version').notNull(),
    // Mirrors SECRET_PROVIDERS (server/domain/vault.ts).
    provider: text('provider', { enum: ['enbor'] }).notNull(),
    secretRef: text('secret_ref').notNull(),
    referenceName: text('reference_name').notNull(),
    // Mirrors VERSION_STATES (server/domain/vault.ts).
    state: text('state', { enum: ['active', 'superseded', 'revoked'] })
      .notNull()
      .default('active'),
    hasSecret: integer('has_secret', { mode: 'boolean' }).notNull().default(true),
    metadata: text('metadata').notNull().default('{}'),
    createdAt: text('created_at').notNull(),
    supersededAt: text('superseded_at'),
    revokedAt: text('revoked_at'),
  },
  // idx_vault_credential_versions_credential_version dropped: the uniqueIndex on
  // the same (credentialId, version) tuple covers it.
  (table) => [
    uniqueIndex('idx_vault_credential_versions_unique_credential_version').on(table.credentialId, table.version),
    index('idx_vault_credential_versions_vault_created').on(table.vaultId, table.createdAt, table.id),
    check('ck_vault_credential_versions_state', sql`${table.state} in ('active','superseded','revoked')`),
    check('ck_vault_credential_versions_provider', sql`${table.provider} in ('enbor')`),
  ],
)

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id),
    organizationId: text('organization_id'),
    createdByUserId: text('created_by_user_id'),
    agentVersionId: text('agent_version_id').references(() => agentVersions.id),
    agentSnapshot: text('agent_snapshot'),
    environmentId: text('environment_id').references(() => environments.id),
    environmentVersionId: text('environment_version_id').references(() => environmentVersions.id),
    environmentSnapshot: text('environment_snapshot'),
    title: text('title'),
    env: text('env').notNull().default('{}'),
    envFrom: text('env_from').notNull().default('[]'),
    volumes: text('volumes').notNull().default('[]'),
    volumeMounts: text('volume_mounts').notNull().default('[]'),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    // Internal runtime placement columns. Never exposed via the API.
    durableObjectName: text('durable_object_name').notNull(),
    sandboxId: text('sandbox_id'),
    resumeToken: text('resume_token'),
    runtimeEndpointPath: text('runtime_endpoint_path'),
    modelProvider: text('model_provider'),
    modelConfig: text('model_config'),
    // Mirrors SESSION_STATES (server/domain/session.ts).
    state: text('state', { enum: ['pending', 'running', 'idle', 'stopped', 'error'] }).notNull(),
    stateReason: text('state_reason'),
    // Per-session turn lease. The multi-state CAS in updateSessionWhenState is not
    // a mutex (it succeeds on running→running), so a concurrent prompt could race
    // a turn already in flight. A turn claims the lease (active_turn_id) for the
    // whole continuation chain; a second turn loses the CAS and is deferred. NULL
    // means no turn is in flight; an elapsed turn_lease_expires_at lets the next
    // turn reclaim a lease whose holder crashed.
    activeTurnId: text('active_turn_id'),
    turnLeaseExpiresAt: text('turn_lease_expires_at'),
    // Continuation-step depth for the current turn chain; reset to 0 when a fresh
    // turn acquires the lease, incremented per pause, capped to bound runaway loops.
    continuationDepth: integer('continuation_depth').notNull().default(0),
    metadata: text('metadata').notNull().default('{}'),
    startedAt: text('started_at'),
    closedAt: text('closed_at'),
    deletedAt: text('deleted_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_sessions_project_state_created').on(table.projectId, table.state, table.createdAt, table.id),
    // Supports the watchdog isNotNull(sandboxId) sweeps (leakedSandboxSessions /
    // markStalledCloudSessions) without splitting the runtime columns into a side table.
    index('idx_sessions_sandbox').on(table.sandboxId),
    check('ck_sessions_state', sql`${table.state} in ('pending','running','idle','stopped','error')`),
  ],
)

// Creation identity survives Session deletion; pending cloud delivery is an outbox.
export const sessionCreations = sqliteTable(
  'session_creations',
  {
    sessionId: text('session_id')
      .primaryKey()
      .references(() => sessions.id),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    keyHash: text('key_hash').notNull(),
    fingerprint: text('fingerprint').notNull(),
    cloudStart: text('cloud_start'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [uniqueIndex('idx_session_creations_project_key').on(table.projectId, table.keyHash)],
)

export const sessionEvents = sqliteTable(
  'session_events',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id),
    sequence: integer('sequence').notNull(),
    type: text('type').notNull(),
    payload: text('payload').notNull(),
    metadata: text('metadata').notNull().default('{}'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_session_events_session_type_created').on(table.sessionId, table.type, table.createdAt),
    index('idx_session_events_session_sequence').on(table.sessionId, table.sequence),
    uniqueIndex('idx_session_events_unique_sequence').on(table.sessionId, table.sequence),
  ],
)

export const sessionMessages = sqliteTable(
  'session_messages',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id),
    type: text('type').notNull().default('prompt'),
    content: text('content').notNull(),
    // Mirrors MESSAGE_DELIVERIES (server/domain/session.ts).
    delivery: text('delivery', { enum: ['live', 'queued'] }).notNull(),
    // Mirrors MESSAGE_STATES (server/domain/session.ts).
    state: text('state', { enum: ['accepted', 'delivered', 'failed'] })
      .notNull()
      .default('accepted'),
    error: text('error'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_session_messages_session_created').on(table.sessionId, table.createdAt, table.id),
    check('ck_session_messages_delivery', sql`${table.delivery} in ('live','queued')`),
    check('ck_session_messages_state', sql`${table.state} in ('accepted','delivered','failed')`),
  ],
)

export const sessionApprovals = sqliteTable(
  'session_approvals',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id),
    // Runtime/ACP tool-call correlation id minted by the agent loop.
    // Intentionally non-FK: sandbox/builtin tool approvals are correlated by
    // (sessionId, toolCallId), not by a separate tool-call resource table.
    toolCallId: text('tool_call_id').notNull(),
    toolName: text('tool_name').notNull(),
    input: text('input').notNull().default('{}'),
    relatedEventIds: text('related_event_ids').notNull().default('[]'),
    // Mirrors APPROVAL_STATES (server/domain/session.ts).
    state: text('state', { enum: ['pending', 'approved', 'denied'] })
      .notNull()
      .default('pending'),
    reason: text('reason'),
    result: text('result'),
    decidedByUserId: text('decided_by_user_id'),
    decidedAt: text('decided_at'),
    requestedAt: text('requested_at').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_session_approvals_session_tool_call').on(table.sessionId, table.toolCallId),
    index('idx_session_approvals_session_state').on(table.sessionId, table.state, table.createdAt),
    check('ck_session_approvals_state', sql`${table.state} in ('pending','approved','denied')`),
  ],
)

export const triggers = sqliteTable(
  'triggers',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id),
    // Nullable: an unpinned trigger resolves a runner-capable environment per
    // dispatch (dispatch-triggers.resolveEnvironmentForRuntime) instead of
    // baking one in at creation time.
    environmentId: text('environment_id').references(() => environments.id),
    // Mirrors TriggerType (server/usecases/ports.ts).
    triggerType: text('trigger_type', { enum: ['scheduled', 'http', 'inbox'] })
      .notNull()
      .default('scheduled'),
    httpConcurrencyMode: text('http_concurrency_mode', { enum: ['parallel', 'serial'] })
      .notNull()
      .default('parallel'),
    // Mirrors RuntimeSchema (server/contracts/environment-contracts.ts) — keep in lockstep.
    runtime: text('runtime', { enum: ['enbor', 'claude-code', 'codex', 'copilot'] }).notNull(),
    name: text('name').notNull(),
    promptTemplate: text('prompt_template').notNull(),
    env: text('env').notNull().default('{}'),
    envFrom: text('env_from').notNull().default('[]'),
    volumes: text('volumes').notNull().default('[]'),
    volumeMounts: text('volume_mounts').notNull().default('[]'),
    intervalSeconds: integer('interval_seconds'),
    windowSeconds: integer('window_seconds').default(0),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    nextDueAt: text('next_due_at'),
    lastDispatchedAt: text('last_dispatched_at'),
    // Intentional non-FK pointer to trigger_runs.id. Avoids a triggers<->trigger_runs
    // circular FK (trigger_runs.trigger_id already FKs triggers); a convenience
    // denormalization set by the dispatcher (advanceTrigger) that may briefly lag.
    lastRunId: text('last_run_id'),
    inboxSubscriptionId: text('inbox_subscription_id'),
    inboxCallbackTokenHash: text('inbox_callback_token_hash'),
    inboxCallbackTokenCiphertext: text('inbox_callback_token_ciphertext'),
    inboxSubscriptionEtag: text('inbox_subscription_etag'),
    inboxRegisteredAgentSubject: text('inbox_registered_agent_subject'),
    inboxTransitionTargetSubject: text('inbox_transition_target_subject'),
    inboxProvisioningState: text('inbox_provisioning_state', {
      enum: ['pending', 'active', 'inactive', 'error'],
    }),
    inboxProvisioningError: text('inbox_provisioning_error'),
    creationKeyHash: text('creation_key_hash'),
    creationFingerprint: text('creation_fingerprint'),
    metadata: text('metadata').notNull().default('{}'),
    // Nullable audit pointer with no FK — there is no users table in this D1 schema.
    // Realmroot identity references survive user-record deletion.
    createdByUserId: text('created_by_user_id'),
    deletedAt: text('deleted_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_triggers_project_next').on(table.projectId, table.enabled, table.nextDueAt, table.id),
    index('idx_triggers_due').on(table.enabled, table.nextDueAt, table.id),
    // enum types the column; check enforces it in D1/SQLite, in parity with every
    // other hardened enum column. Mirrors RuntimeSchema (contracts/environment-contracts).
    check('ck_triggers_runtime', sql`${table.runtime} in ('enbor','claude-code','codex','copilot')`),
    check('ck_triggers_type', sql`${table.triggerType} in ('scheduled','http','inbox')`),
    check('ck_triggers_http_concurrency', sql`${table.httpConcurrencyMode} in ('parallel','serial')`),
    check(
      'ck_triggers_schedule_shape',
      sql`(${table.triggerType} = 'scheduled' and ${table.intervalSeconds} is not null and ${table.nextDueAt} is not null) or (${table.triggerType} in ('http','inbox') and ${table.intervalSeconds} is null and ${table.nextDueAt} is null)`,
    ),
    check(
      'ck_triggers_inbox_shape',
      sql`(${table.triggerType} = 'inbox' and ${table.inboxSubscriptionId} is not null and ${table.inboxCallbackTokenHash} is not null and ${table.inboxCallbackTokenCiphertext} is not null and ${table.inboxProvisioningState} is not null) or (${table.triggerType} != 'inbox' and ${table.inboxSubscriptionId} is null and ${table.inboxCallbackTokenHash} is null and ${table.inboxCallbackTokenCiphertext} is null and ${table.inboxSubscriptionEtag} is null and ${table.inboxRegisteredAgentSubject} is null and ${table.inboxTransitionTargetSubject} is null and ${table.inboxProvisioningState} is null and ${table.inboxProvisioningError} is null)`,
    ),
    uniqueIndex('idx_triggers_inbox_subscription').on(table.inboxSubscriptionId),
    uniqueIndex('idx_triggers_project_creation_idempotency').on(table.projectId, table.creationKeyHash),
  ],
)

export const triggerRuns = sqliteTable(
  'trigger_runs',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    triggerId: text('trigger_id')
      .notNull()
      .references(() => triggers.id),
    scheduledFor: text('scheduled_for'),
    heartbeatAt: text('heartbeat_at'),
    triggeredAt: text('triggered_at').notNull(),
    // Mirrors RUN_STATES (server/http/triggers.ts).
    state: text('state', { enum: ['claimed', 'queued', 'dispatching', 'dispatched', 'failed'] }).notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    sessionId: text('session_id').references(() => sessions.id),
    correlationId: text('correlation_id').notNull(),
    errorMessage: text('error_message'),
    sourceSubscriptionId: text('source_subscription_id'),
    sourceEventId: text('source_event_id'),
    metadata: text('metadata').notNull().default('{}'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_trigger_runs_unique_occurrence').on(table.triggerId, table.scheduledFor),
    uniqueIndex('idx_trigger_runs_idempotency_key').on(table.idempotencyKey),
    uniqueIndex('idx_trigger_runs_source_event').on(table.sourceSubscriptionId, table.sourceEventId),
    index('idx_trigger_runs_trigger_created').on(table.triggerId, table.createdAt, table.id),
    index('idx_trigger_runs_project_created').on(table.projectId, table.createdAt, table.id),
    check('ck_trigger_runs_state', sql`${table.state} in ('claimed','queued','dispatching','dispatched','failed')`),
  ],
)

export const sessionRoutes = sqliteTable(
  'session_routes',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id),
    triggerId: text('trigger_id')
      .notNull()
      .references(() => triggers.id, { onDelete: 'cascade' }),
    routingKeyHash: text('routing_key_hash').notNull(),
    // Soft reservation: the route is claimed before Session creation so
    // concurrent first deliveries cannot create two Sessions for one key.
    sessionId: text('session_id').notNull(),
    activationRunId: text('activation_run_id')
      .notNull()
      .references(() => triggerRuns.id, { onDelete: 'cascade' }),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_session_routes_trigger_key').on(table.agentId, table.triggerId, table.routingKeyHash),
    uniqueIndex('idx_session_routes_session').on(table.sessionId),
    index('idx_session_routes_project').on(table.projectId, table.triggerId),
  ],
)

export const httpTriggerPendingRuns = sqliteTable(
  'http_trigger_pending_runs',
  {
    sequence: integer('sequence').primaryKey({ autoIncrement: true }),
    runId: text('run_id')
      .notNull()
      .unique()
      .references(() => triggerRuns.id, { onDelete: 'cascade' }),
    triggerId: text('trigger_id')
      .notNull()
      .references(() => triggers.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id').notNull(),
    organizationName: text('organization_name').notNull(),
    projectId: text('project_id').notNull(),
    projectName: text('project_name').notNull(),
    requestedByUserId: text('requested_by_user_id').notNull(),
    routingKeyHash: text('routing_key_hash'),
    renderedPrompt: text('rendered_prompt').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_http_trigger_pending_fifo').on(table.triggerId, table.sequence),
    index('idx_http_trigger_pending_project').on(table.projectId, table.sequence),
  ],
)

export const runners = sqliteTable(
  'runners',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    name: text('name').notNull(),
    environmentId: text('environment_id').references(() => environments.id),
    // Vault credential ref (nullable). Existence validated in the usecase
    // (secretRefUsable). Intentionally NOT a FK: a hard FK would reject
    // legitimate pre-validation writes / stale refs as raw D1 500s (D1 enforces
    // FKs). Documented soft pointer.
    credentialId: text('credential_id'),
    credentialVersionId: text('credential_version_id'),
    // Mirrors RUNNER_AUTH_MODES (server/domain/runner-queue.ts).
    authMode: text('auth_mode', { enum: ['realmroot'] })
      .notNull()
      .default('realmroot'),
    oidcSubject: text('oidc_subject'),
    oidcClientId: text('oidc_client_id'),
    // Mirrors RUNNER_STATES (server/http/runners.ts).
    state: text('state', { enum: ['active', 'draining', 'disabled', 'offline'] })
      .notNull()
      .default('offline'),
    currentLoad: integer('current_load').notNull().default(0),
    maxConcurrent: integer('max_concurrent').notNull().default(1),
    // Heartbeat-reported diagnostic snapshots (value objects, never reverse-queried)
    // — KEEP as JSON per the canonical resource representation contract.
    runtimeUsage: text('runtime_usage').notNull().default('[]'),
    runtimes: text('runtimes').notNull().default('[]'),
    metadata: text('metadata').notNull().default('{}'),
    lastHeartbeatAt: text('last_heartbeat_at'),
    deletedAt: text('deleted_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_runners_project_state_updated').on(table.projectId, table.state, table.updatedAt, table.id),
    index('idx_runners_project_environment').on(table.projectId, table.environmentId, table.state),
    check('ck_runners_state', sql`${table.state} in ('active','draining','disabled','offline')`),
    check('ck_runners_auth_mode', sql`${table.authMode} = 'realmroot'`),
  ],
)

export const workItems = sqliteTable(
  'work_items',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    sessionId: text('session_id').references(() => sessions.id),
    environmentId: text('environment_id').references(() => environments.id),
    runnerId: text('runner_id').references(() => runners.id),
    // Denormalized non-FK back-pointer to the current live lease (circular-FK
    // avoidance). leases.workItemId is the authoritative owning FK; this is the
    // reverse convenience pointer (mirror of sessions.activeTurnId).
    leaseId: text('lease_id'),
    type: text('type').notNull(),
    // Mirrors WORK_ITEM_STATES (server/http/work-items.ts).
    state: text('state', { enum: ['available', 'leased', 'succeeded', 'failed', 'cancelled'] })
      .notNull()
      .default('available'),
    priority: integer('priority').notNull().default(0),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    payload: text('payload').notNull(),
    result: text('result'),
    error: text('error'),
    availableAt: text('available_at').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_work_items_project_state_available').on(
      table.projectId,
      table.state,
      table.availableAt,
      table.priority,
      table.createdAt,
    ),
    index('idx_work_items_session').on(table.sessionId),
    index('idx_work_items_runner_state').on(table.runnerId, table.state),
    check('ck_work_items_state', sql`${table.state} in ('available','leased','succeeded','failed','cancelled')`),
  ],
)

export const leases = sqliteTable(
  'leases',
  {
    id: text('id').primaryKey(),
    workItemId: text('work_item_id')
      .notNull()
      .references(() => workItems.id),
    runnerId: text('runner_id')
      .notNull()
      .references(() => runners.id),
    organizationId: text('organization_id').notNull(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    // Mirrors LEASE_STATES (server/http/leases.ts) + 'interrupted' (finish input).
    // Persisted set is {active,completed,failed,cancelled,expired}; 'interrupted'
    // is an input value mapped to 'expired' — included as a harmless permitted superset.
    state: text('state', { enum: ['active', 'completed', 'failed', 'cancelled', 'expired', 'interrupted'] })
      .notNull()
      .default('active'),
    expiresAt: text('expires_at').notNull(),
    renewedAt: text('renewed_at'),
    resumeToken: text('resume_token'),
    settlementId: text('settlement_id'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_leases_project_state_expires').on(table.projectId, table.state, table.expiresAt),
    index('idx_leases_runner_state').on(table.runnerId, table.state),
    index('idx_leases_work_item').on(table.workItemId),
    check(
      'ck_leases_state',
      sql`${table.state} in ('active','completed','failed','cancelled','expired','interrupted')`,
    ),
  ],
)

export const sessionChannels = sqliteTable(
  'session_channels',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id),
    workItemId: text('work_item_id')
      .notNull()
      .references(() => workItems.id),
    leaseId: text('lease_id')
      .notNull()
      .references(() => leases.id),
    runnerId: text('runner_id')
      .notNull()
      .references(() => runners.id),
    organizationId: text('organization_id').notNull(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    state: text('state').notNull().default('active'),
    acceptedAt: text('accepted_at').notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
    closedAt: text('closed_at'),
    closeReason: text('close_reason'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_session_channels_session_state').on(table.sessionId, table.state),
    index('idx_session_channels_lease_state').on(table.leaseId, table.state),
    index('idx_session_channels_runner_state').on(table.runnerId, table.state),
  ],
)

export const policies = sqliteTable(
  'policies',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    // organization | team | project. Team-scope rows bind to an
    // OIDC-asserted team id; null otherwise. Mirrors PolicyScopeLevel (server/domain/policy.ts).
    scope: text('scope', { enum: ['organization', 'team', 'project'] })
      .notNull()
      .default('project'),
    teamId: text('team_id'),
    toolPolicy: text('tool_policy').notNull().default('{}'),
    mcpPolicy: text('mcp_policy').notNull().default('{}'),
    sandboxPolicy: text('sandbox_policy').notNull().default('{}'),
    metadata: text('metadata').notNull().default('{}'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_policies_project_scope').on(table.projectId, table.scope, table.updatedAt),
    index('idx_policies_org_scope').on(table.organizationId, table.scope, table.teamId, table.updatedAt),
    uniqueIndex('idx_policies_unique_scope').on(table.projectId, table.scope, table.teamId),
    check('ck_policies_scope', sql`${table.scope} in ('organization','team','project')`),
  ],
)

export const budgets = sqliteTable(
  'budgets',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    // Mirrors BudgetScope (server/domain/policy.ts) + http z.enum.
    scope: text('scope', { enum: ['project', 'provider', 'model'] }).notNull(),
    providerId: text('provider_id'),
    modelId: text('model_id'),
    // Mirrors http/budgets.ts z.enum.
    limitType: text('limit_type', { enum: ['tokens', 'cost_micros', 'sessions'] }).notNull(),
    limitValue: integer('limit_value').notNull(),
    window: text('window', { enum: ['day', 'month'] }).notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    metadata: text('metadata').notNull().default('{}'),
    deletedAt: text('deleted_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_budgets_project_enabled').on(table.projectId, table.enabled, table.scope),
    check('ck_budgets_scope', sql`${table.scope} in ('project','provider','model')`),
    check('ck_budgets_limit_type', sql`${table.limitType} in ('tokens','cost_micros','sessions')`),
    check('ck_budgets_window', sql`${table.window} in ('day','month')`),
  ],
)

// Append-only usage ledger. agentId/agentVersionId/sessionId/sessionEventId/
// providerId are intentional soft pointers (no FK) so usage history survives
// agent/session/provider deletion. projectId keeps its FK (usage is always
// project-scoped).
export const usageRecords = sqliteTable(
  'usage_records',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    agentId: text('agent_id'),
    agentVersionId: text('agent_version_id'),
    sessionId: text('session_id'),
    sessionEventId: text('session_event_id'),
    correlationId: text('correlation_id'),
    providerId: text('provider_id'),
    providerType: text('provider_type').notNull(),
    modelId: text('model_id').notNull(),
    // Terminal per-row outcome (never mutated). Mirrors USAGE_STATUSES (server/domain/usage.ts).
    state: text('state', { enum: ['success', 'error'] }).notNull(),
    promptTokens: integer('prompt_tokens').notNull().default(0),
    completionTokens: integer('completion_tokens').notNull().default(0),
    totalTokens: integer('total_tokens').notNull().default(0),
    durationMs: integer('duration_ms').notNull().default(0),
    costMicros: integer('cost_micros').notNull().default(0),
    currency: text('currency').notNull().default('USD'),
    usageType: text('usage_type').notNull().default('model'),
    metadata: text('metadata').notNull().default('{}'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_usage_records_project_created').on(table.projectId, table.createdAt, table.id),
    index('idx_usage_records_project_provider_model').on(table.projectId, table.providerType, table.modelId),
    check('ck_usage_records_state', sql`${table.state} in ('success','error')`),
  ],
)

// Append-only audit ledger. projectId is nullable + non-FK and
// sessionId/resourceId/actorUserId/controllerUserId are soft pointers so audit entries survive
// deletion of the subject and can record org-level (project-less) actions.
export const auditRecords = sqliteTable(
  'audit_records',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    projectId: text('project_id'),
    actorUserId: text('actor_user_id'),
    controllerUserId: text('controller_user_id'),
    actorType: text('actor_type').notNull().default('user'),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id'),
    outcome: text('outcome').notNull(),
    requestId: text('request_id'),
    correlationId: text('correlation_id'),
    sessionId: text('session_id'),
    policyCategory: text('policy_category'),
    metadata: text('metadata').notNull().default('{}'),
    before: text('before').notNull().default('{}'),
    after: text('after').notNull().default('{}'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_audit_records_org_created').on(table.organizationId, table.createdAt, table.id),
    index('idx_audit_records_project_created').on(table.projectId, table.createdAt, table.id),
    index('idx_audit_records_action_resource').on(table.action, table.resourceType, table.resourceId),
  ],
)

// Short-lived RFC 9449 replay ledger. It stores only public proof identifiers
// and thumbprints; access tokens and DPoP private keys never enter D1.
export const dpopProofs = sqliteTable(
  'dpop_proofs',
  {
    issuer: text('issuer').notNull(),
    keyThumbprint: text('key_thumbprint').notNull(),
    jti: text('jti').notNull(),
    expiresAt: text('expires_at').notNull(),
    consumedAt: text('consumed_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_dpop_proofs_identity').on(table.issuer, table.keyThumbprint, table.jti),
    index('idx_dpop_proofs_expires_at').on(table.expiresAt),
  ],
)

export const connectors = sqliteTable(
  'connectors',
  {
    // The connector slug (e.g. "github") is the id. connectors is the platform
    // MCP server catalog and is not project-scoped.
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    category: text('category').notNull(),
    trustLevel: text('trust_level').notNull(),
    capabilities: text('capabilities').notNull().default('[]'),
    supportedAuthModes: text('supported_auth_modes').notNull().default('[]'),
    setupRequirements: text('setup_requirements').notNull().default('[]'),
    // Immutable platform-catalog snapshot of the connector's advertised tool
    // definitions (value object, read whole).
    tools: text('tools').notNull().default('[]'),
    metadata: text('metadata').notNull().default('{}'),
    availability: text('availability').notNull().default('available'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [index('idx_connectors_category_trust').on(table.category, table.trustLevel)],
)
