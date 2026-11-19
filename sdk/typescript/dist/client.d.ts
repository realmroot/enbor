import type * as types from './generated/types.gen.js';
export interface EnborClientConfig {
    baseUrl: string;
    projectId?: string;
    headers?: Record<string, string>;
    authorize?: (url: string, method: string) => Promise<{
        accessToken: string;
        dpopProof: string;
    }>;
}
export interface EnborRunnerClientConfig {
    baseUrl: string;
    projectId?: string;
    headers?: Record<string, string>;
    webSocketFactory?: (url: string, headers: Record<string, string>) => WebSocket | Promise<WebSocket>;
}
export declare class EnborApiError extends Error {
    readonly status: number | undefined;
    readonly responseText: string;
    readonly body: unknown;
    constructor(status: number | undefined, responseText: string, body: unknown);
}
export interface SessionStream {
    events: AsyncIterable<types.SessionEvent>;
    send(message: types.SessionSocketClientMessage): Promise<void>;
    backfill(options?: {
        cursor?: number;
        limit?: number;
        eventType?: string;
    }): Promise<types.SessionSocketBackfillMessage>;
    close(): void;
}
export interface RunnerChannel {
    messages: AsyncIterable<types.RunnerChannelMessage>;
    send(message: types.RunnerChannelMessage): Promise<void>;
    close(): void;
}
export type EnborClient = ReturnType<typeof createEnborClient>;
export declare function createEnborClient(config: EnborClientConfig): {
    raw: import("./generated/client/types.gen.js").Client;
    configz: {
        get: () => Promise<types.PublicConfig>;
    };
    auth: {
        config: (query?: types.ReadAuthConfigData["query"]) => Promise<types.AuthConfig>;
        currentSession: () => Promise<types.AuthSession>;
    };
    projects: {
        list: (query?: types.ListProjectsData["query"]) => Promise<types.ProjectListResponse>;
        create: (body: types.CreateProjectRequest) => Promise<types.Project>;
        get: (projectId: string) => Promise<types.Project>;
        update: (projectId: string, body: types.UpdateProjectRequest) => Promise<types.Project>;
        delete: (projectId: string) => Promise<void>;
    };
    agents: {
        list: (query?: types.ListAgentsData["query"]) => Promise<types.AgentListResponse>;
        create: (body: types.CreateAgentRequest, idempotencyKey?: string) => Promise<types.Agent>;
        get: (agentId: string) => Promise<types.Agent>;
        update: (agentId: string, body: types.UpdateAgentRequest) => Promise<types.Agent>;
        delete: (agentId: string) => Promise<void>;
        listVersions: (agentId: string) => Promise<types.AgentVersionListResponse>;
        getVersion: (agentId: string, version: number) => Promise<types.AgentVersion>;
    };
    identities: {
        list: (query?: types.ListIdentitiesData["query"]) => Promise<types.IdentityListResponse>;
        create: (body: types.CreateIdentityRequest, idempotencyKey: string) => Promise<types.Identity>;
        get: (identityId: string) => Promise<types.Identity>;
        delete: (identityId: string) => Promise<void>;
    };
    environments: {
        list: (query?: types.ListEnvironmentsData["query"]) => Promise<types.EnvironmentListResponse>;
        create: (body: types.CreateEnvironmentRequest, idempotencyKey?: string) => Promise<types.Environment>;
        get: (environmentId: string) => Promise<types.Environment>;
        update: (environmentId: string, body: types.UpdateEnvironmentRequest) => Promise<types.Environment>;
        delete: (environmentId: string) => Promise<void>;
        listVersions: (environmentId: string) => Promise<types.EnvironmentVersionListResponse>;
        getVersion: (environmentId: string, version: number) => Promise<types.EnvironmentVersion>;
    };
    providers: {
        list: () => Promise<types.ProviderListResponse>;
        listModels: () => Promise<types.ProviderModelListResponse>;
        refreshCatalog: () => Promise<types.CatalogRefreshResult>;
        get: (providerId: string) => Promise<types.Provider>;
        listProviderModels: (providerId: string) => Promise<types.ProviderModelListResponse>;
    };
    runners: {
        list: (query?: types.ListRunnersData["query"]) => Promise<types.RunnerListResponse>;
        create: (body: types.CreateRunnerRequest) => Promise<types.Runner>;
        get: (runnerId: string) => Promise<types.Runner>;
        update: (runnerId: string, body: types.UpdateRunnerRequest) => Promise<types.Runner>;
        delete: (runnerId: string) => Promise<void>;
    };
    budgets: {
        list: () => Promise<types.BudgetListResponse>;
        create: (body: types.CreateBudgetRequest) => Promise<types.Budget>;
        get: (budgetId: string) => Promise<types.Budget>;
        update: (budgetId: string, body: types.UpdateBudgetRequest) => Promise<types.Budget>;
        delete: (budgetId: string) => Promise<void>;
    };
    connectors: {
        list: (query?: types.ListConnectorsData["query"]) => Promise<types.ConnectorListResponse>;
        get: (connectorId: string) => Promise<types.Connector>;
    };
    audit: {
        listRecords: (query?: types.ListAuditRecordsData["query"]) => Promise<types.AuditRecordListResponse>;
        getRecord: (recordId: string) => Promise<types.AuditRecord>;
    };
    triggers: {
        list: (query?: types.ListTriggersData["query"]) => Promise<types.TriggerListResponse>;
        create: (body: types.CreateTriggerRequest, idempotencyKey?: string) => Promise<types.Trigger>;
        get: (triggerId: string) => Promise<types.Trigger>;
        update: (triggerId: string, body: types.UpdateTriggerRequest) => Promise<types.Trigger>;
        delete: (triggerId: string) => Promise<void>;
        listRuns: (triggerId: string, query?: types.ListTriggerRunsData["query"]) => Promise<types.TriggerRunListResponse>;
        createRun: (triggerId: string, body: types.CreateHttpTriggerRunRequest, options?: {
            headers?: Record<string, string>;
        }) => Promise<types.TriggerRun>;
        getRun: (triggerId: string, runId: string) => Promise<types.TriggerRun>;
    };
    sessions: {
        list: (query?: types.ListSessionsData["query"]) => Promise<types.SessionListResponse>;
        create: (body: types.CreateSessionRequest, idempotencyKey?: string) => Promise<types.Session>;
        get: (sessionId: string) => Promise<types.Session>;
        update: (sessionId: string, body: types.UpdateSessionRequest) => Promise<types.Session>;
        delete: (sessionId: string) => Promise<void>;
        stream: (sessionId: string) => Promise<SessionStream>;
        listMessages: (sessionId: string, query?: types.ListSessionMessagesData["query"]) => Promise<types.SessionMessageListResponse>;
        createMessage: (sessionId: string, body: types.CreateSessionMessageRequest) => Promise<types.SessionMessage>;
        getMessage: (sessionId: string, messageId: string) => Promise<types.SessionMessage>;
        listEvents: (sessionId: string, query?: types.ListSessionEventsData["query"]) => Promise<types.SessionEventListResponse>;
        listApprovals: (sessionId: string) => Promise<types.SessionApprovalListResponse>;
        getApproval: (sessionId: string, approvalId: string) => Promise<types.SessionApproval>;
        decideApproval: (sessionId: string, approvalId: string, body: types.SessionApprovalDecisionRequest) => Promise<types.SessionApproval>;
    };
    memoryStores: {
        list: (query?: types.ListMemoryStoresData["query"]) => Promise<types.MemoryStoreListResponse>;
        create: (body: types.CreateMemoryStoreRequest) => Promise<types.MemoryStore>;
        get: (storeId: string) => Promise<types.MemoryStore>;
        update: (storeId: string, body: types.UpdateMemoryStoreRequest) => Promise<types.MemoryStore>;
        delete: (storeId: string) => Promise<void>;
        listMemories: (storeId: string, query?: types.ListMemoryStoreMemoriesData["query"]) => Promise<types.MemoryStoreMemoryListResponse>;
        createMemory: (storeId: string, body: types.CreateMemoryStoreMemoryRequest) => Promise<types.MemoryStoreMemory>;
        updateMemory: (storeId: string, memoryId: string, body: types.UpdateMemoryStoreMemoryRequest) => Promise<types.MemoryStoreMemory>;
        deleteMemory: (storeId: string, memoryId: string) => Promise<void>;
    };
    vaults: {
        list: (query?: types.ListVaultsData["query"]) => Promise<types.VaultListResponse>;
        create: (body: types.CreateVaultRequest) => Promise<types.Vault>;
        get: (vaultId: string) => Promise<types.Vault>;
        update: (vaultId: string, body: types.UpdateVaultRequest) => Promise<types.Vault>;
        delete: (vaultId: string) => Promise<void>;
        listCredentials: (vaultId: string, query?: types.ListVaultCredentialsData["query"]) => Promise<types.VaultCredentialListResponse>;
        createCredential: (vaultId: string, body: types.CreateVaultCredentialRequest) => Promise<types.VaultCredential>;
        getCredential: (vaultId: string, credentialId: string) => Promise<types.VaultCredential>;
        updateCredential: (vaultId: string, credentialId: string, body: types.UpdateVaultCredentialRequest) => Promise<types.VaultCredential>;
        updateCredentialSecret: (vaultId: string, credentialId: string, body: types.UpdateVaultCredentialSecretRequest) => Promise<types.VaultCredential>;
        listCredentialVersions: (vaultId: string, credentialId: string, query?: types.ListVaultCredentialVersionsData["query"]) => Promise<types.VaultCredentialVersionListResponse>;
        getCredentialVersion: (vaultId: string, credentialId: string, versionId: string) => Promise<{
            metadata: types.ResourceMetadata;
            spec: types.VaultCredentialVersionSpec;
            status: types.VaultCredentialVersionStatus;
        } | null>;
    };
    usage: {
        listRecords: (query?: types.ListUsageRecordsData["query"]) => Promise<types.UsageRecordListResponse>;
        getRecord: (recordId: string) => Promise<types.UsageRecord>;
        getSummary: (query?: types.ReadUsageSummaryData["query"]) => Promise<types.UsageSummary>;
    };
};
export type EnborRunnerClient = ReturnType<typeof createEnborRunnerClient>;
export declare function createEnborRunnerClient(config: EnborRunnerClientConfig): {
    raw: import("./generated/client/types.gen.js").Client;
    configz: {
        get: () => Promise<types.PublicConfig>;
    };
    runners: {
        list: (query?: types.ListRunnersData["query"]) => Promise<types.RunnerListResponse>;
        create: (body: types.CreateRunnerRequest) => Promise<types.Runner>;
        get: (runnerId: string) => Promise<types.Runner>;
        update: (runnerId: string, body: types.UpdateRunnerRequest) => Promise<types.Runner>;
        delete: (runnerId: string) => Promise<void>;
        channel: (runnerId: string) => Promise<RunnerChannel>;
        getHeartbeat: (runnerId: string) => Promise<types.RunnerHeartbeat>;
        putHeartbeat: (runnerId: string, body: types.PutRunnerHeartbeatRequest) => Promise<types.RunnerHeartbeat>;
    };
    workItems: {
        list: (query?: types.ListWorkItemsData["query"]) => Promise<types.WorkItemListResponse>;
        get: (workItemId: string) => Promise<types.WorkItem>;
    };
    leases: {
        list: (query?: types.ListLeasesData["query"]) => Promise<types.LeaseListResponse>;
        create: (body: types.CreateLeaseRequest) => Promise<types.Lease>;
        get: (leaseId: string) => Promise<types.Lease>;
        update: (leaseId: string, body: types.UpdateLeaseRequest) => Promise<types.Lease>;
    };
    sessions: {
        createEvents: (sessionId: string, body: types.CreateSessionEventsRequest) => Promise<types.SessionEventsAccepted>;
    };
};
