export type ClientOptions = {
    baseUrl: 'https://enbor.realmroot.dev' | (string & {});
};
export type SessionSocketEventMessage = {
    type: 'event';
    record: SessionEvent;
};
export type SessionEvent = {
    id: string;
    sessionId: string;
    sequence: number;
    createdAt: string;
    type: 'runtime.started';
    payload: RuntimeLifecyclePayload;
} | {
    id: string;
    sessionId: string;
    sequence: number;
    createdAt: string;
    type: 'runtime.completed';
    payload: RuntimeLifecyclePayload;
} | {
    id: string;
    sessionId: string;
    sequence: number;
    createdAt: string;
    type: 'turn.started';
    payload: TurnPayload;
} | {
    id: string;
    sessionId: string;
    sequence: number;
    createdAt: string;
    type: 'turn.completed';
    payload: TurnPayload;
} | {
    id: string;
    sessionId: string;
    sequence: number;
    createdAt: string;
    type: 'message.started';
    payload: MessageEventPayload;
} | {
    id: string;
    sessionId: string;
    sequence: number;
    createdAt: string;
    type: 'message.updated';
    payload: MessageEventPayload;
} | {
    id: string;
    sessionId: string;
    sequence: number;
    createdAt: string;
    type: 'message.completed';
    payload: MessageEventPayload;
} | {
    id: string;
    sessionId: string;
    sequence: number;
    createdAt: string;
    type: 'usage.recorded';
    payload: UsageRecordedPayload;
} | {
    id: string;
    sessionId: string;
    sequence: number;
    createdAt: string;
    type: 'permission.requested';
    payload: PermissionRequestPayload;
} | {
    id: string;
    sessionId: string;
    sequence: number;
    createdAt: string;
    type: 'permission.resolved';
    payload: PermissionResolvedPayload;
} | {
    id: string;
    sessionId: string;
    sequence: number;
    createdAt: string;
    type: 'permission.denied';
    payload: PermissionDeniedPayload;
} | {
    id: string;
    sessionId: string;
    sequence: number;
    createdAt: string;
    type: 'runtime.error';
    payload: EventError;
};
export type RuntimeLifecyclePayload = {
    reason?: string;
};
export type TurnPayload = {
    status?: string;
    reason?: string;
    message?: EventMessage;
};
export type EventMessage = {
    id: string;
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: Array<MessageContentBlock>;
    providerMessageId?: string;
    parentMessageId?: string;
    parentToolCallId?: string;
    stopReason?: string;
};
export type MessageContentBlock = ({
    type: 'text';
} & TextContentBlock) | ({
    type: 'reasoning';
} & ReasoningContentBlock) | ({
    type: 'tool_call';
} & ToolCallContentBlock) | ({
    type: 'tool_result';
} & ToolResultContentBlock) | ({
    type: 'image';
} & ImageContentBlock) | ({
    type: 'file';
} & FileContentBlock);
export type TextContentBlock = {
    type: 'text';
    text: string;
};
export type ReasoningContentBlock = {
    type: 'reasoning';
    text: string;
};
export type ToolCallContentBlock = {
    type: 'tool_call';
    toolCall: EventToolCall;
};
export type EventToolCall = {
    id: string;
    name: 'bash';
    input: BashToolInput;
} | {
    id: string;
    name: 'read';
    input: ReadToolInput;
} | {
    id: string;
    name: 'write';
    input: WriteToolInput;
} | {
    id: string;
    name: 'edit';
    input: EditToolInput;
} | {
    id: string;
    name: 'grep';
    input: GrepToolInput;
} | {
    id: string;
    name: 'find';
    input: FindToolInput;
} | {
    id: string;
    name: 'ls';
    input: LsToolInput;
} | {
    id: string;
    name: 'fetch';
    input: FetchToolInput;
} | {
    id: string;
    name: 'web_search';
    input: WebSearchToolInput;
} | ExternalToolCall;
export type BashToolInput = {
    command: string;
    timeout?: number;
};
export type ReadToolInput = {
    path: string;
    offset?: number;
    limit?: number;
};
export type WriteToolInput = {
    path: string;
    content: string;
};
export type EditToolInput = {
    path: string;
    edits: Array<{
        oldText: string;
        newText: string;
    }>;
};
export type GrepToolInput = {
    pattern: string;
    path?: string;
    glob?: string;
    ignoreCase?: boolean;
    literal?: boolean;
    context?: number;
    limit?: number;
};
export type FindToolInput = {
    pattern?: string;
    glob?: string;
    path?: string;
    limit?: number;
};
export type LsToolInput = {
    path?: string;
    limit?: number;
};
export type FetchToolInput = {
    url: string;
};
export type WebSearchToolInput = {
    query: string;
    limit?: number;
};
export type ExternalToolCall = {
    id: string;
    name: string;
    input: {
        [key: string]: unknown;
    };
};
export type ToolResultContentBlock = {
    type: 'tool_result';
    toolCallId: string;
    result: ToolResult;
    error?: EventError;
};
export type ToolResult = {
    content: Array<ToolResultValueContentBlock>;
    structuredContent?: {
        [key: string]: unknown;
    };
    exitCode?: number;
};
export type ToolResultValueContentBlock = ({
    type: 'text';
} & TextContentBlock) | ({
    type: 'image';
} & ImageContentBlock) | ({
    type: 'file';
} & FileContentBlock) | ({
    type: 'json';
} & JsonContentBlock);
export type ImageContentBlock = {
    type: 'image';
    url?: string;
    mediaType?: string;
    data?: string;
};
export type FileContentBlock = {
    type: 'file';
    path?: string;
    name?: string;
    mediaType?: string;
    data?: string;
};
export type JsonContentBlock = {
    type: 'json';
    value?: unknown;
};
export type EventError = {
    message: string;
    code?: string;
    category?: string;
    retryable?: boolean;
    retryAfterSeconds?: number;
    details?: unknown;
};
export type MessageEventPayload = {
    message: EventMessage;
};
export type UsageRecordedPayload = {
    model: string;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    inputTokens?: number;
    outputTokens?: number;
    cachedInputTokens?: number;
    cacheCreationInputTokens?: number;
    reasoningTokens?: number;
    toolTokens?: number;
    costMicros?: number;
    details?: {
        [key: string]: unknown;
    };
};
export type PermissionRequestPayload = {
    permissionId?: string;
    command?: string;
    toolCall?: EventToolCall;
    details?: {
        [key: string]: unknown;
    };
};
export type PermissionResolvedPayload = {
    permissionId?: string;
    allowed: boolean;
    reason?: string;
    toolCall?: EventToolCall;
    details?: {
        [key: string]: unknown;
    };
};
export type PermissionDeniedPayload = {
    reason?: string;
    resourceType?: string;
    resourceId?: string;
    operation?: string;
    command?: string | null;
    host?: string | null;
    connectorId?: string;
    toolName?: string;
    details?: {
        [key: string]: unknown;
    };
};
export type SessionSocketBackfillMessage = {
    type: 'backfill';
    requestId: string;
    events: Array<SessionEvent>;
    nextCursor: number | null;
    hasMore: boolean;
};
export type SessionSocketRunnerUnavailableMessage = {
    type: 'runner_unavailable';
    message: string;
};
export type SessionSocketAckMessage = {
    type: 'ack';
    requestId: string;
};
export type SessionSocketErrorMessage = {
    type: 'error';
    requestId?: string;
    message: string;
};
export type SessionSocketServerMessage = ({
    type: 'event';
} & SessionSocketEventMessage) | ({
    type: 'backfill';
} & SessionSocketBackfillMessage) | ({
    type: 'runner_unavailable';
} & SessionSocketRunnerUnavailableMessage) | ({
    type: 'ack';
} & SessionSocketAckMessage) | ({
    type: 'error';
} & SessionSocketErrorMessage);
export type SessionSocketPromptMessage = {
    type: 'prompt';
    requestId?: string;
    content: string;
};
export type SessionSocketAbortMessage = {
    type: 'abort';
    requestId?: string;
};
export type SessionSocketSteerMessage = {
    type: 'steer';
    requestId?: string;
    content: string;
};
export type SessionSocketBackfillRequestMessage = {
    type: 'backfill';
    requestId?: string;
    cursor?: number;
    limit?: number;
    eventType?: string;
};
export type SessionSocketClientMessage = ({
    type: 'prompt';
} & SessionSocketPromptMessage) | ({
    type: 'abort';
} & SessionSocketAbortMessage) | ({
    type: 'steer';
} & SessionSocketSteerMessage) | ({
    type: 'backfill';
} & SessionSocketBackfillRequestMessage);
export type RunnerWorkspaceFile = {
    path: string;
    content: string;
};
export type RunnerGitCredential = {
    username: string;
    password: string;
};
export type RunnerWorkspaceMount = {
    name: string;
    type: 'git_repository' | 'memory' | 'secret' | 'empty_dir';
    mountPath: string;
    url?: string;
    ref?: string;
    credential?: RunnerGitCredential;
    memoryRef?: string;
    description?: string | null;
    readOnly?: boolean;
    files?: Array<RunnerWorkspaceFile>;
};
export type RunnerWorkspaceManifest = {
    root: '/workspace';
    mounts: Array<RunnerWorkspaceMount>;
};
export type RunnerVolume = {
    name: string;
    type: 'secret' | 'git_repository' | 'memory' | 'empty_dir';
    secretRef?: string;
    url?: string;
    ref?: string;
    memoryRef?: string;
};
export type RunnerVolumeMount = {
    name: string;
    mountPath: string;
    readOnly?: boolean;
};
export type RunnerToolCall = {
    id: string;
    name: string;
    arguments?: {
        [key: string]: unknown;
    };
    input?: {
        [key: string]: unknown;
    };
    approved?: boolean;
};
export type RunnerWorkPayload = {
    protocol?: 'enbor-runner-work';
    type?: string;
    sessionId?: string;
    hostingMode?: string;
    runtime?: string;
    runtimeConfig?: {
        [key: string]: unknown;
    };
    provider?: string;
    model?: string;
    agentSnapshot?: {
        [key: string]: unknown;
    };
    environmentSnapshot?: {
        [key: string]: unknown;
    } | null;
    runtimeDriver?: string;
    runtimeRequirement?: RunnerRuntimeRequirement;
    env?: {
        [key: string]: string;
    };
    workspaceManifest?: RunnerWorkspaceManifest;
    prompt?: string | null;
    resume?: boolean;
    resumeToken?: string | null;
    approved?: boolean;
    toolCallId?: string;
    toolName?: string;
    input?: {
        [key: string]: unknown;
    };
    toolCall?: RunnerToolCall;
};
export type RunnerRuntimeRequirement = {
    runtime: 'enbor' | 'claude-code' | 'codex' | 'copilot';
    model?: string;
};
export type RunnerRuntimeToolCall = {
    id: string;
    name: string;
    input?: {
        [key: string]: unknown;
    };
    arguments?: {
        [key: string]: unknown;
    };
};
export type RunnerRuntimeRequest = {
    toolCalls?: Array<RunnerRuntimeToolCall>;
};
export type RunnerOpaqueJsonObject = {
    [key: string]: unknown;
};
export type RunnerSessionCommand = {
    [key: string]: unknown;
};
export type RunnerSandboxRequest = {
    type: 'sandbox.execute' | 'sandbox.stop' | 'sandbox.readMemoryStores';
    toolCallId?: string;
    toolName?: string;
    input?: {
        [key: string]: unknown;
    };
    volumes?: Array<RunnerVolume>;
    volumeMounts?: Array<RunnerVolumeMount>;
};
export type RunnerChannelMessage = {
    type: 'runner.channel.accepted';
    runnerId?: string;
    environmentId?: string;
} | {
    type: 'work.assigned';
    runnerId?: string;
    lease: RunnerOpaqueJsonObject;
    workItem: RunnerOpaqueJsonObject;
} | {
    type: 'session.command';
    requestId?: string;
    sessionId: string;
    runnerId?: string;
    command: RunnerSessionCommand;
} | {
    type: 'session.command.result';
    requestId: string;
    sessionId: string;
    runnerId?: string;
    accepted: boolean;
    error?: string;
} | {
    type: 'sandbox.request';
    requestId: string;
    sessionId: string;
    runnerId?: string;
    request: RunnerSandboxRequest;
} | {
    type: 'sandbox.response';
    requestId: string;
    sessionId: string;
    runnerId?: string;
    ok: boolean;
    result?: RunnerOpaqueJsonObject;
    error?: string;
} | {
    type: 'session.backfill_request';
    eventId: string;
    sessionId: string;
} | {
    type: 'session.backfill_response';
    eventId: string;
    sessionId: string;
    events: Array<RunnerOpaqueJsonObject>;
    error?: string;
} | {
    type: 'runner.event';
    sessionId: string;
    record: RunnerOpaqueJsonObject;
} | {
    type: 'runner.event.accepted';
    eventId: string;
} | {
    type: 'session.channel.error';
    eventId?: string;
    message: string;
};
export type PublicConfig = {
    version: 1;
    service: PublicServiceConfig;
    auth: PublicAuthConfig;
};
export type PublicServiceConfig = {
    name: 'Enbor';
    origin: string;
};
export type PublicAuthConfig = {
    oidc: PublicOidcConfig;
};
export type PublicOidcConfig = {
    issuer: string;
    resource: string;
    runner?: PublicOidcClientConfig;
} | null;
export type PublicOidcClientConfig = {
    clientId: string;
    scopes: Array<string>;
};
export type AuthConfig = {
    methods: Array<AuthMethod>;
};
export type AuthMethod = {
    type: 'oidc';
    issuer: string;
    clientId: string;
};
export type AuthSession = {
    user: AuthUser;
    organization: AuthOrganization;
    project: AuthProject;
};
export type AuthUser = {
    id: string;
    email: string;
    name: string | null;
};
export type AuthOrganization = {
    id: string;
    name: string;
};
export type AuthProject = {
    id: string;
    name: string;
};
export type ErrorResponse = {
    error: {
        type: string;
        message: string;
        issues?: Array<unknown>;
        details?: {
            [key: string]: unknown;
        };
    };
};
export type ProjectListResponse = {
    data: Array<Project>;
    pagination: ListPagination;
};
export type Project = {
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
};
export type ListPagination = {
    limit: number;
    nextCursor: string | null;
    hasMore: boolean;
};
export type CreateProjectRequest = {
    name: string;
};
export type UpdateProjectRequest = {
    name: string;
};
export type AgentListResponse = {
    data: Array<Agent>;
    pagination: ListPagination;
};
export type Agent = {
    metadata: ResourceMetadata;
    spec: AgentSpec;
    status: AgentStatus;
};
export type ResourceMetadata = {
    uid: string;
    projectId: string | null;
    name: string;
    description: string | null;
    labels: {
        [key: string]: string;
    };
    annotations: {
        [key: string]: string;
    };
    createdBy: string | null;
    createdAt: string;
    updatedAt: string;
};
export type AgentSpec = {
    systemPrompt: string;
    provider: string | null;
    model: string | null;
    skills: Array<string>;
    subagents: Array<AgentSubagentReference>;
    allowedTools: Array<string>;
    mcpConnectors: Array<string>;
    identity: IdentityDescriptor;
};
export type AgentSubagentReference = {
    /**
     * Existing Agent resource in the same project.
     */
    agentId: string;
    /**
     * Stable runtime alias used to address the referenced Agent as a sub-agent.
     */
    name: string;
};
export type IdentityDescriptor = {
    identityId: string;
    /**
     * Realmroot internal Identity resource id. It is not the stable OIDC subject and must not be used for Inbox addressing.
     */
    agentId: string;
    issuer: string;
    /**
     * Stable OIDC subject used for Inbox addressing. New Realmroot subjects are bare UUIDv7 values; legacy opaque snapshot values remain readable.
     */
    subject: string;
    username: string;
    runtime: IdentityRuntime;
} | null;
/**
 * Canonical runtime identifier asserted by Realmroot. Binding to an Agent additionally requires a registered Enbor runtime driver.
 */
export type IdentityRuntime = string;
export type AgentStatus = {
    phase: ResourcePhase;
    currentVersionId: string | null;
    version: number;
    /**
     * Whether the active bound Identity can currently resolve a compatible execution environment for a Session, without requiring a Trigger.
     */
    schedulable: boolean;
};
export type ResourcePhase = 'active';
export type CreateAgentRequest = {
    metadata: ResourceCreateMetadata;
    spec: {
        systemPrompt: string;
        provider?: string | null;
        model?: string | null;
        skills?: Array<string>;
        subagents?: Array<AgentSubagentReference>;
        allowedTools?: Array<string>;
        mcpConnectors?: Array<string>;
        identityRef?: string | null;
    };
};
export type ResourceCreateMetadata = {
    name: string;
    description?: string | null;
};
export type UpdateAgentRequest = {
    metadata?: ResourceUpdateMetadata;
    spec?: {
        systemPrompt?: string;
        provider?: string | null;
        model?: string | null;
        skills?: Array<string>;
        subagents?: Array<AgentSubagentReference>;
        allowedTools?: Array<string>;
        mcpConnectors?: Array<string>;
        identityRef?: string | null;
    };
};
export type ResourceUpdateMetadata = {
    name?: string;
    description?: string | null;
};
export type AgentVersionListResponse = {
    data: Array<AgentVersion>;
    pagination: ListPagination;
};
export type AgentVersion = {
    metadata: ResourceMetadata;
    spec: AgentSpec;
    status: AgentVersionStatus;
};
export type AgentVersionStatus = {
    agentId: string;
    version: number;
};
export type EnvironmentListResponse = {
    data: Array<Environment>;
    pagination: ListPagination;
};
export type Environment = {
    metadata: ResourceMetadata;
    spec: EnvironmentSpec;
    status: EnvironmentStatus;
};
export type EnvironmentSpec = {
    scope: EnvironmentScope;
    type: EnvironmentType;
    networking: EnvironmentNetworking;
    packages: EnvironmentPackages;
    variables: {
        [key: string]: {
            description?: string;
            required?: boolean;
        };
    };
};
export type EnvironmentScope = 'project' | 'organization';
export type EnvironmentType = 'cloud' | 'self_hosted';
export type EnvironmentNetworking = {
    type: 'closed' | 'limited' | 'open';
    allowMcpServers: boolean;
    allowPackageManagers: boolean;
    allowedHosts?: Array<string>;
};
export type EnvironmentPackages = {
    type: 'packages';
    apt: Array<string>;
    cargo: Array<string>;
    gem: Array<string>;
    go: Array<string>;
    npm: Array<string>;
    pip: Array<string>;
    webi: Array<string>;
};
export type EnvironmentStatus = {
    phase: ResourcePhase;
    currentVersionId: string | null;
    version: number;
};
export type CreateEnvironmentRequest = {
    metadata: ResourceCreateMetadata & unknown;
    spec: {
        scope?: EnvironmentScope;
        type?: EnvironmentType;
        networking?: EnvironmentNetworking;
        packages?: EnvironmentPackages;
        variables?: {
            [key: string]: {
                description?: string;
                required?: boolean;
            };
        };
    };
};
export type UpdateEnvironmentRequest = {
    metadata?: ResourceUpdateMetadata;
    spec?: {
        scope?: EnvironmentScope;
        type?: EnvironmentType;
        networking?: EnvironmentNetworking;
        packages?: EnvironmentPackages;
        variables?: {
            [key: string]: {
                description?: string;
                required?: boolean;
            };
        };
    };
};
export type EnvironmentVersionListResponse = {
    data: Array<EnvironmentVersion>;
    pagination: ListPagination;
};
export type EnvironmentVersion = {
    metadata: ResourceMetadata;
    spec: EnvironmentSpec;
    status: EnvironmentVersionStatus;
};
export type EnvironmentVersionStatus = {
    environmentId: string;
    version: number;
};
export type IdentityListResponse = {
    data: Array<Identity>;
    pagination: ListPagination;
};
export type Identity = {
    metadata: ResourceMetadata;
    spec: {
        username: string;
        runtime: IdentityRuntime;
    };
    status: {
        phase: ResourcePhase;
        state: 'provisioning' | 'active' | 'error';
        failureCode: string | null;
        boundAgentId: string | null;
        descriptor: IdentityDescriptor;
    };
};
export type CreateIdentityRequest = {
    metadata: ResourceCreateMetadata;
    spec: {
        username: string;
        runtime: IdentityRuntime;
    };
};
export type InboxNotificationReceipt = {
    eventId: string;
    subscriptionId: string;
    triggerRunId: string;
    state: 'accepted';
};
export type InboxNotification = {
    eventId: string;
    type: 'message.created';
    subscriptionId: string;
    agentId: string;
    messageId: string;
    routingKey?: string;
    occurredAt: string;
};
export type ProviderListResponse = {
    data: Array<Provider>;
    pagination: {
        limit: number;
        nextCursor: string | null;
        hasMore: boolean;
    };
};
export type Provider = {
    id: string;
    slug: string;
    displayName: string;
    enabled: boolean;
    metadata: {
        [key: string]: unknown;
    };
    modelCatalogState: 'ready' | 'error';
    lastError: ProviderError;
    createdAt: string;
    updatedAt: string;
};
export type ProviderError = {
    type: string;
    category?: 'auth' | 'quota' | 'rate_limit' | 'model_unavailable' | 'invalid_request' | 'network' | 'unknown';
    message: string;
    retryable?: boolean;
    retryAfterSeconds?: number;
    occurredAt?: string;
} | null;
export type ProviderModelListResponse = {
    data: Array<ProviderModel>;
    pagination: {
        limit: number;
        nextCursor: string | null;
        hasMore: boolean;
    };
};
export type ProviderModel = {
    id: string;
    providerId: string;
    modelId: string;
    displayName: string;
    capabilities: Array<string>;
    contextWindow: number | null;
    pricing: ProviderModelPricing;
    availability: 'available' | 'unavailable' | 'disabled';
    metadata: {
        [key: string]: unknown;
    };
    createdAt: string;
    updatedAt: string;
};
export type ProviderModelPricing = {
    inputMicrosPerToken?: number;
    outputMicrosPerToken?: number;
    [key: string]: unknown;
};
export type CatalogRefreshResult = {
    outcome: 'succeeded' | 'failed';
    discoveredCount: number;
    vendors: number;
    category?: 'auth' | 'quota' | 'rate_limit' | 'model_unavailable' | 'invalid_request' | 'network' | 'unknown';
};
export type Runner = {
    id: string;
    projectId: string;
    name: string;
    environmentId: string | null;
    secretRef: NullableSecretRef;
    authMode: 'realmroot';
    state: 'active' | 'draining' | 'disabled' | 'offline';
    currentLoad: number;
    maxConcurrent: number;
    runtimeUsage: Array<RuntimeUsage>;
    runtimes: Array<RunnerRuntime>;
    metadata: {
        [key: string]: unknown;
    };
    lastHeartbeatAt: string | null;
    createdAt: string;
    updatedAt: string;
};
export type NullableSecretRef = string | null;
export type RuntimeUsage = {
    runtime: string;
    windows: Array<RuntimeUsageWindow>;
};
export type RuntimeUsageWindow = {
    label: string;
    utilization: number;
    resetsAt: string;
};
export type RunnerRuntime = {
    runtime: string;
    models: Array<string>;
    version?: string;
    state: 'ready' | 'missing' | 'unauthenticated' | 'unauthorized' | 'limited' | 'unhealthy';
    detail?: string;
};
export type CreateRunnerRequest = {
    name: string;
    environmentId?: string;
    secretRef?: string;
    authMode?: 'realmroot';
    maxConcurrent?: number;
    metadata?: {
        [key: string]: unknown;
    };
};
export type RunnerListResponse = {
    data: Array<Runner>;
    pagination: ListPagination;
};
export type UpdateRunnerRequest = {
    name?: string;
    state?: 'active' | 'draining' | 'disabled';
    maxConcurrent?: number;
    metadata?: {
        [key: string]: unknown;
    };
};
export type RunnerHeartbeat = {
    runnerId: string;
    state: 'active' | 'draining' | 'disabled' | 'offline';
    currentLoad: number;
    runtimeUsage: Array<RuntimeUsage>;
    runtimes: Array<RunnerRuntime>;
    lastHeartbeatAt: string | null;
};
export type PutRunnerHeartbeatRequest = {
    state?: 'active' | 'draining' | 'offline';
    runtimeUsage?: Array<RuntimeUsage>;
    runtimes?: Array<RunnerRuntime>;
    metadata?: {
        [key: string]: unknown;
    };
};
export type RunnerChannelMetadata = {
    upgrade: 'websocket';
};
export type WorkItemListResponse = {
    data: Array<WorkItem>;
    pagination: ListPagination;
};
export type WorkItem = {
    id: string;
    projectId: string;
    sessionId: string | null;
    environmentId: string | null;
    runnerId: string | null;
    leaseId: string | null;
    type: string;
    state: 'available' | 'leased' | 'succeeded' | 'failed' | 'cancelled';
    priority: number;
    attempts: number;
    maxAttempts: number;
    payload: {
        [key: string]: unknown;
    };
    result: {
        [key: string]: unknown;
    } | null;
    error: {
        [key: string]: unknown;
    } | null;
    availableAt: string;
    createdAt: string;
    updatedAt: string;
};
export type Lease = {
    id: string;
    workItemId: string;
    runnerId: string;
    state: 'active' | 'completed' | 'failed' | 'cancelled' | 'expired';
    expiresAt: string;
    renewedAt: string | null;
    resumeToken: string | null;
    createdAt: string;
    updatedAt: string;
};
export type CreateLeaseRequest = {
    workItemId: string;
    runnerId: string;
    leaseDurationSeconds?: number;
};
export type LeaseListResponse = {
    data: Array<Lease>;
    pagination: ListPagination;
};
export type UpdateLeaseRequest = {
    /**
     * Lease transition. `interrupted` is an action, not a resting state: it requeues the work item for recovery and the lease settles as `expired` in the resource.
     */
    state?: 'active' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
    leaseDurationSeconds?: number;
    expiresAt?: string;
    resumeToken?: string;
    result?: {
        [key: string]: unknown;
    };
    error?: {
        [key: string]: unknown;
    };
};
export type BudgetListResponse = {
    data: Array<Budget>;
    pagination: ListPagination;
};
export type Budget = {
    id: string;
    scope: 'project' | 'provider' | 'model';
    providerId: string | null;
    modelId: string | null;
    limitType: 'tokens' | 'cost_micros' | 'sessions';
    limitValue: number;
    window: 'day' | 'month';
    enabled: boolean;
    metadata: {
        [key: string]: unknown;
    };
    createdAt: string;
    updatedAt: string;
};
export type CreateBudgetRequest = {
    scope: 'project' | 'provider' | 'model';
    providerId?: string;
    modelId?: string;
    limitType: 'tokens' | 'cost_micros' | 'sessions';
    limitValue: number;
    window: 'day' | 'month';
    enabled?: boolean;
    metadata?: {
        [key: string]: unknown;
    };
};
export type UpdateBudgetRequest = {
    limitValue?: number;
    window?: 'day' | 'month';
    enabled?: boolean;
    metadata?: {
        [key: string]: unknown;
    };
};
export type ConnectorListResponse = {
    data: Array<Connector>;
    pagination: ListPagination;
};
export type Connector = {
    id: string;
    name: string;
    description: string;
    category: 'development' | 'planning';
    trustLevel: 'verified';
    capabilities: Array<string>;
    supportedAuthModes: Array<'vault_credential'>;
    setupRequirements: Array<string>;
    tools: Array<ConnectorTool>;
    metadata: {
        [key: string]: unknown;
    };
    availability: 'available' | 'unavailable';
    createdAt: string;
    updatedAt: string;
};
export type ConnectorTool = {
    name: string;
    description: string | null;
    inputSchema: {
        [key: string]: unknown;
    };
    approvalMode: 'none' | 'per_call' | 'always_required' | 'project_policy';
    policyMetadata: {
        [key: string]: unknown;
    };
};
export type UsageRecordListResponse = {
    data: Array<UsageRecord>;
    pagination: ListPagination;
};
export type UsageRecord = {
    id: string;
    projectId: string;
    agentId: string | null;
    agentVersionId: string | null;
    sessionId: string | null;
    sessionEventId: string | null;
    correlationId: string | null;
    providerId: string | null;
    providerType: 'workers-ai' | 'anthropic' | 'openai' | 'openai-compatible' | 'ollama' | 'sandbox';
    modelId: string;
    state: 'success' | 'error';
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    durationMs: number;
    costMicros: number;
    currency: string;
    usageType: 'model' | 'tool';
    metadata: {
        [key: string]: unknown;
    };
    createdAt: string;
};
export type UsageSummary = {
    groupBy: 'provider' | 'model' | 'agent';
    totals: UsageSummaryTotals;
    groups: Array<UsageSummaryGroup>;
};
export type UsageSummaryTotals = {
    records: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    durationMs: number;
    costMicros: number;
    currency: string;
};
export type UsageSummaryGroup = UsageSummaryTotals & {
    key: {
        [key: string]: string | null;
    };
};
export type AuditRecordListResponse = {
    data: Array<AuditRecord>;
    pagination: ListPagination;
};
export type AuditRecord = {
    id: string;
    projectId: string | null;
    actorUserId: string | null;
    controllerUserId: string | null;
    actorType: 'user' | 'agent' | 'system';
    action: string;
    resourceType: string;
    resourceId: string | null;
    outcome: 'success' | 'failure' | 'denied';
    requestId: string | null;
    correlationId: string | null;
    sessionId: string | null;
    policyCategory: string | null;
    metadata: {
        [key: string]: unknown;
    };
    before: {
        [key: string]: unknown;
    };
    after: {
        [key: string]: unknown;
    };
    createdAt: string;
};
export type Trigger = {
    metadata: ResourceMetadata;
    spec: TriggerSpec;
    status: TriggerStatus;
};
export type TriggerSpec = {
    source: TriggerSource;
    suspend: boolean;
    template: TriggerTemplate;
};
export type TriggerSource = {
    type: 'schedule';
    schedule: TriggerSchedule;
} | {
    type: 'http';
    concurrency?: HttpTriggerConcurrency;
} | {
    type: 'inbox';
};
export type TriggerSchedule = {
    type: 'interval';
    intervalSeconds: number;
    windowSeconds: number;
};
export type HttpTriggerConcurrency = {
    mode: 'parallel' | 'serial';
};
export type TriggerTemplate = {
    metadata: TriggerTemplateMetadata;
    spec: TriggerTemplateSpec;
};
export type TriggerTemplateMetadata = {
    labels: {
        [key: string]: string;
    };
    annotations: {
        [key: string]: string;
    };
};
export type TriggerTemplateSpec = {
    agentId: string;
    environmentId: string | null;
    runtime: RuntimeName;
    env: ExecutionEnv;
    envFrom: Array<EnvFromEntry>;
    volumes: Array<Volume>;
    volumeMounts: Array<VolumeMount>;
    promptTemplate: string;
};
export type RuntimeName = 'enbor' | 'claude-code' | 'codex' | 'copilot';
export type ExecutionEnv = {
    [key: string]: string;
};
export type EnvFromEntry = {
    type: 'secret';
    name?: string;
    secretRef: string;
    key?: string;
};
export type Volume = ({
    type: 'secret';
} & SecretVolume) | ({
    type: 'git_repository';
} & GitRepositoryVolume) | ({
    type: 'memory';
} & MemoryVolume) | ({
    type: 'empty_dir';
} & EmptyDirVolume);
export type SecretVolume = {
    name: string;
    type: 'secret';
    secretRef: string;
    items?: Array<SecretItem>;
};
export type SecretItem = {
    key: string;
    path: string;
};
export type GitRepositoryVolume = {
    name: string;
    type: 'git_repository';
    url: string;
    ref?: string;
    secretRef?: string;
    items?: Array<SecretItem>;
};
export type MemoryVolume = {
    name: string;
    type: 'memory';
    memoryRef: string;
};
export type EmptyDirVolume = {
    name: string;
    type: 'empty_dir';
    seedFrom?: Array<SecretVolumeProjection>;
};
export type SecretVolumeProjection = {
    type: 'secret';
    secretRef: string;
    items?: Array<SecretItem>;
};
export type VolumeMount = {
    name: string;
    mountPath: string;
    readOnly?: boolean;
};
export type TriggerStatus = {
    phase: ResourcePhase;
    nextDueAt: string | null;
    lastDispatchedAt: string | null;
    lastRunId: string | null;
    subscription: {
        id: string;
        phase: 'pending' | 'active' | 'inactive' | 'error';
        errorMessage: string | null;
    } | null;
};
export type CreateTriggerRequest = {
    metadata: TriggerCreateMetadata;
    spec: {
        source: {
            type: 'schedule';
            schedule: {
                type?: 'interval';
                intervalSeconds: number;
                windowSeconds?: number;
            };
        } | {
            type: 'http';
            concurrency?: HttpTriggerConcurrency;
        } | {
            type: 'inbox';
        };
        suspend?: boolean;
        template: {
            metadata?: {
                labels?: {
                    [key: string]: string;
                };
                annotations?: {
                    [key: string]: string;
                };
            };
            spec: {
                agentId: string;
                environmentId?: string | null;
                runtime?: RuntimeName;
                env?: ExecutionEnv;
                envFrom?: Array<EnvFromEntry>;
                volumes?: Array<Volume>;
                volumeMounts?: Array<VolumeMount>;
                promptTemplate: string;
            };
        };
        nextDueAt?: string;
    };
};
export type TriggerCreateMetadata = {
    name: string;
};
export type TriggerListResponse = {
    data: Array<Trigger>;
    pagination: ListPagination;
};
export type UpdateTriggerRequest = {
    metadata?: TriggerUpdateMetadata;
    spec?: {
        source?: {
            type: 'schedule';
            schedule: {
                type?: 'interval';
                intervalSeconds: number;
                windowSeconds?: number;
            };
        } | {
            type: 'http';
            concurrency?: HttpTriggerConcurrency;
        } | {
            type: 'inbox';
        };
        suspend?: boolean;
        template?: {
            metadata?: {
                labels?: {
                    [key: string]: string;
                };
                annotations?: {
                    [key: string]: string;
                };
            };
            spec?: {
                agentId?: string;
                environmentId?: string | null;
                runtime?: RuntimeName;
                env?: ExecutionEnv;
                envFrom?: Array<EnvFromEntry>;
                volumes?: Array<Volume>;
                volumeMounts?: Array<VolumeMount>;
                promptTemplate?: string;
            };
        };
        nextDueAt?: string;
    };
};
export type TriggerUpdateMetadata = {
    name?: string;
};
export type TriggerRunListResponse = {
    data: Array<TriggerRun>;
    pagination: ListPagination;
};
export type TriggerRun = {
    metadata: ResourceMetadata;
    spec: TriggerRunSpec;
    status: TriggerRunStatus;
};
export type TriggerRunSpec = {
    triggerId: string;
    scheduledFor: string | null;
    metadata: {
        [key: string]: unknown;
    };
};
export type TriggerRunStatus = {
    phase: 'claimed' | 'queued' | 'dispatching' | 'dispatched' | 'failed';
    idempotencyKey: string;
    correlationId: string;
    heartbeatAt: string | null;
    triggeredAt: string;
    sessionId: string | null;
    errorMessage: string | null;
};
export type CreateHttpTriggerRunRequest = {
    [key: string]: unknown;
};
export type Session = {
    metadata: SessionMetadata;
    spec: SessionSpec;
    status: SessionStatus;
};
export type SessionMetadata = {
    uid: string;
    projectId: string | null;
    name: string;
    description: string | null;
    labels: {
        [key: string]: string;
    };
    annotations: {
        [key: string]: string;
    };
    createdBy: string | null;
    createdAt: string;
    updatedAt: string;
};
export type SessionSpec = {
    agentId: string;
    environmentId: string | null;
    runtime: RuntimeName;
    env: ExecutionEnv;
    envFrom: Array<EnvFromEntry>;
    volumes: Array<Volume>;
    volumeMounts: Array<VolumeMount>;
};
export type SessionStatus = {
    phase: 'pending' | 'running' | 'idle' | 'closed' | 'error';
    reason: string | null;
    conditions: Array<SessionCondition>;
    bindings: SessionBindings;
    placement: SessionPlacement;
    startedAt: string | null;
    closedAt: string | null;
};
export type SessionCondition = {
    type: 'Scheduled' | 'RuntimeReady' | 'Running' | 'Completed';
    status: 'True' | 'False' | 'Unknown';
    reason: string | null;
    message: string | null;
    lastTransitionAt: string;
};
export type SessionBindings = {
    agent: {
        versionId: string;
        snapshot: SessionAgentSnapshot;
    };
    environment: {
        id: string | null;
        versionId: string | null;
        snapshot: SessionEnvironmentSnapshot;
    };
    runtime: RuntimeName;
};
export type SessionAgentSnapshot = {
    id: string;
    agentId: string;
    projectId: string;
    version: number;
    systemPrompt: string;
    provider: string | null;
    model: string | null;
    skills: Array<string>;
    subagents: Array<SessionSubagent>;
    allowedTools: Array<string>;
    mcpConnectors: Array<string>;
    identity: SessionIdentityDescriptor;
    createdAt: string;
};
export type SessionSubagent = {
    agentId: string;
    agentVersionId: string;
    version: number;
    name: string;
    description: string;
    systemPrompt: string;
    provider: string | null;
    model: string | null;
    allowedTools: Array<string>;
    skills: Array<string>;
    mcpConnectors: Array<string>;
};
export type SessionIdentityDescriptor = {
    identityId: string;
    /**
     * Realmroot internal Identity resource id. It is not the stable OIDC subject and must not be used for Inbox addressing.
     */
    agentId: string;
    issuer: string;
    /**
     * Stable OIDC subject used for Inbox addressing. New Realmroot subjects are bare UUIDv7 values; legacy opaque snapshot values remain readable.
     */
    subject: string;
    username: string;
    runtime: IdentityRuntime;
} | null;
export type SessionEnvironmentSnapshot = {
    id: string;
    environmentId: string;
    projectId: string;
    version: number;
    scope: EnvironmentScope;
    type: EnvironmentType;
    networking: EnvironmentNetworking;
    packages: EnvironmentPackages;
    variables: SessionEnvironmentJsonObject;
    createdAt: string;
} | null;
export type SessionEnvironmentJsonObject = {
    [key: string]: unknown;
};
export type SessionPlacement = {
    hostingMode: EnvironmentHostingMode;
    provider: string | null;
    model: string | null;
} | null;
export type EnvironmentHostingMode = 'cloud' | 'self_hosted';
export type CreateSessionRequest = {
    metadata?: SessionCreateMetadata;
    spec: ExecutionSpecInput;
    prompt: string;
};
export type SessionCreateMetadata = {
    name?: string;
    labels?: {
        [key: string]: string;
    };
    annotations?: {
        [key: string]: string;
    };
};
export type ExecutionSpecInput = {
    agentId: string;
    environmentId?: string | null;
    runtime?: RuntimeName;
    env?: ExecutionEnv;
    envFrom?: Array<EnvFromEntry>;
    volumes?: Array<Volume>;
    volumeMounts?: Array<VolumeMount>;
};
export type SessionListResponse = {
    data: Array<Session>;
    pagination: ListPagination;
};
export type UpdateSessionRequest = {
    metadata?: SessionUpdateMetadata;
    state?: 'closed' | 'idle';
};
export type SessionUpdateMetadata = {
    name?: string;
    labels?: {
        [key: string]: string;
    };
    annotations?: {
        [key: string]: string;
    };
};
export type SessionMessageListResponse = {
    data: Array<SessionMessage>;
    pagination: ListPagination;
};
export type SessionMessage = {
    id: string;
    sessionId: string;
    type: 'prompt';
    content: string;
    delivery: 'live' | 'queued';
    state: 'accepted' | 'delivered' | 'failed';
    error: string | null;
    createdAt: string;
    updatedAt: string;
};
export type CreateSessionMessageRequest = {
    type: 'prompt';
    requestId?: string;
    content: string;
};
export type SessionEventListResponse = {
    data: Array<SessionEvent>;
    pagination: ListPagination;
};
export type SessionEventsAccepted = {
    accepted: number;
};
export type CreateSessionEventsRequest = {
    events: Array<EnborEvent>;
};
export type EnborEvent = {
    type: 'runtime.started';
    payload: RuntimeLifecyclePayload;
} | {
    type: 'runtime.completed';
    payload: RuntimeLifecyclePayload;
} | {
    type: 'turn.started';
    payload: TurnPayload;
} | {
    type: 'turn.completed';
    payload: TurnPayload;
} | {
    type: 'message.started';
    payload: MessageEventPayload;
} | {
    type: 'message.updated';
    payload: MessageEventPayload;
} | {
    type: 'message.completed';
    payload: MessageEventPayload;
} | {
    type: 'usage.recorded';
    payload: UsageRecordedPayload;
} | {
    type: 'permission.requested';
    payload: PermissionRequestPayload;
} | {
    type: 'permission.resolved';
    payload: PermissionResolvedPayload;
} | {
    type: 'permission.denied';
    payload: PermissionDeniedPayload;
} | {
    type: 'runtime.error';
    payload: EventError;
};
export type SessionApprovalListResponse = {
    data: Array<SessionApproval>;
    pagination: ListPagination;
};
export type SessionApproval = {
    id: string;
    sessionId: string;
    toolCallId: string;
    toolName: string;
    input: {
        [key: string]: unknown;
    };
    relatedEventIds: Array<string>;
    state: 'pending' | 'approved' | 'denied';
    reason: string | null;
    /**
     * Caller-provided custom tool result recorded instead of executing the tool.
     */
    result: {
        [key: string]: unknown;
    } | null;
    requestedAt: string;
    decidedAt: string | null;
    createdAt: string;
    updatedAt: string;
};
export type SessionApprovalDecisionRequest = {
    decision: 'approve' | 'deny';
    reason?: string;
    /**
     * Caller-provided custom tool result recorded instead of executing the tool
     */
    result?: {
        [key: string]: unknown;
    };
};
export type MemoryStoreListResponse = {
    data: Array<MemoryStore>;
    pagination: ListPagination;
};
export type MemoryStore = {
    metadata: ResourceMetadata;
    spec: MemoryStoreSpec;
    status: MemoryStoreStatus;
};
export type MemoryStoreSpec = {
    [key: string]: never;
};
export type MemoryStoreStatus = {
    phase: ResourcePhase;
};
export type CreateMemoryStoreRequest = {
    metadata: ResourceCreateMetadata & unknown;
    spec?: {
        [key: string]: never;
    };
};
export type UpdateMemoryStoreRequest = {
    metadata?: ResourceUpdateMetadata;
    spec?: {
        [key: string]: never;
    };
};
export type MemoryStoreMemoryListResponse = {
    data: Array<MemoryStoreMemory>;
    pagination: ListPagination;
};
export type MemoryStoreMemory = {
    metadata: ResourceMetadata;
    spec: MemoryStoreMemorySpec;
    status: MemoryStoreMemoryStatus;
};
export type MemoryStoreMemorySpec = {
    storeId: string;
    path: string;
    content: string;
    metadata: {
        [key: string]: unknown;
    };
};
export type MemoryStoreMemoryStatus = {
    phase: ResourcePhase;
};
export type CreateMemoryStoreMemoryRequest = {
    path: string;
    content: string;
    metadata?: {
        [key: string]: unknown;
    };
};
export type UpdateMemoryStoreMemoryRequest = {
    path?: string;
    content?: string;
    metadata?: {
        [key: string]: unknown;
    };
};
export type VaultListResponse = {
    data: Array<Vault>;
    pagination: ListPagination;
};
export type Vault = {
    metadata: ResourceMetadata;
    spec: VaultSpec;
    status: VaultStatus;
};
export type VaultSpec = {
    organizationId: string;
    scope: 'project' | 'organization';
};
export type VaultStatus = {
    phase: ResourcePhase;
};
export type CreateVaultRequest = {
    metadata: ResourceCreateMetadata & unknown;
    spec: {
        scope?: 'project' | 'organization';
    };
};
export type UpdateVaultRequest = {
    metadata?: ResourceUpdateMetadata;
    spec?: {
        scope?: 'project' | 'organization';
    };
};
export type VaultCredentialListResponse = {
    data: Array<VaultCredential>;
    pagination: ListPagination;
};
export type VaultCredential = {
    metadata: ResourceMetadata;
    spec: VaultCredentialSpec;
    status: VaultCredentialStatus;
};
export type VaultCredentialSpec = {
    vaultId: string;
    organizationId: string;
    type: 'opaque' | 'enbor.dev/basic-auth' | 'enbor.dev/ssh-auth' | 'enbor.dev/tls' | 'enbor.dev/private-key-jwk' | 'enbor.dev/oauth-token' | 'enbor.dev/realmroot-agent-state';
    metadata: {
        [key: string]: unknown;
    };
};
export type VaultCredentialStatus = {
    phase: 'active' | 'revoked';
    activeVersionId: string | null;
    activeVersion: VaultCredentialVersion;
    revokedAt: string | null;
    revokedByUserId: string | null;
    revokeReason: string | null;
};
export type VaultCredentialVersion = {
    metadata: ResourceMetadata;
    spec: VaultCredentialVersionSpec;
    status: VaultCredentialVersionStatus;
} | null;
export type VaultCredentialVersionSpec = {
    credentialId: string;
    vaultId: string;
    organizationId: string;
    version: number;
    provider: 'enbor';
    secretRef: string;
    referenceName: string;
    hasSecret: boolean;
    dataKeys: Array<string>;
    metadata: VaultJsonObject;
};
export type VaultJsonObject = {
    [key: string]: unknown;
};
export type VaultCredentialVersionStatus = {
    phase: 'active' | 'superseded' | 'revoked';
    supersededAt: string | null;
    revokedAt: string | null;
};
export type CreateVaultCredentialRequest = {
    name: string;
    type: 'opaque' | 'enbor.dev/basic-auth' | 'enbor.dev/ssh-auth' | 'enbor.dev/tls' | 'enbor.dev/private-key-jwk' | 'enbor.dev/oauth-token' | 'enbor.dev/realmroot-agent-state';
    metadata?: {
        [key: string]: unknown;
    };
    secret: {
        stringData: {
            [key: string]: string;
        };
        referenceName?: string;
        metadata?: {
            [key: string]: unknown;
        };
    };
};
export type UpdateVaultCredentialRequest = {
    state?: 'revoked';
    revokeReason?: string;
    metadata?: {
        [key: string]: unknown;
    };
};
export type UpdateVaultCredentialSecretRequest = {
    stringData: {
        [key: string]: string;
    };
    referenceName?: string;
    metadata?: {
        [key: string]: unknown;
    };
};
export type VaultCredentialVersionListResponse = {
    data: Array<VaultCredentialVersion>;
    pagination: ListPagination;
};
/**
 * Selects an Enbor project in the authenticated organization. Omit to use the default project.
 */
export type EnborProjectId = string;
export type ReadConfigzData = {
    body?: never;
    path?: never;
    query?: never;
    url: '/api/v1/configz';
};
export type ReadConfigzResponses = {
    /**
     * Public browser configuration
     */
    200: PublicConfig;
};
export type ReadConfigzResponse = ReadConfigzResponses[keyof ReadConfigzResponses];
export type ReadAuthConfigData = {
    body?: never;
    path?: never;
    query?: {
        organization?: string;
    };
    url: '/api/v1/auth/config';
};
export type ReadAuthConfigResponses = {
    /**
     * Available sign-in methods
     */
    200: AuthConfig;
};
export type ReadAuthConfigResponse = ReadAuthConfigResponses[keyof ReadAuthConfigResponses];
export type ReadCurrentAuthSessionData = {
    body?: never;
    path?: never;
    query?: never;
    url: '/api/v1/auth/sessions/current';
};
export type ReadCurrentAuthSessionErrors = {
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
};
export type ReadCurrentAuthSessionError = ReadCurrentAuthSessionErrors[keyof ReadCurrentAuthSessionErrors];
export type ReadCurrentAuthSessionResponses = {
    /**
     * Current session context
     */
    200: AuthSession;
};
export type ReadCurrentAuthSessionResponse = ReadCurrentAuthSessionResponses[keyof ReadCurrentAuthSessionResponses];
export type ListProjectsData = {
    body?: never;
    path?: never;
    query?: {
        limit?: number;
        cursor?: string;
    };
    url: '/api/v1/projects';
};
export type ListProjectsErrors = {
    /**
     * Validation error
     */
    400: ErrorResponse;
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
};
export type ListProjectsError = ListProjectsErrors[keyof ListProjectsErrors];
export type ListProjectsResponses = {
    /**
     * Projects in the current organization
     */
    200: ProjectListResponse;
};
export type ListProjectsResponse = ListProjectsResponses[keyof ListProjectsResponses];
export type CreateProjectData = {
    body: CreateProjectRequest;
    path?: never;
    query?: never;
    url: '/api/v1/projects';
};
export type CreateProjectErrors = {
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * The project name already exists or the reserved Default name was used
     */
    409: ErrorResponse;
};
export type CreateProjectError = CreateProjectErrors[keyof CreateProjectErrors];
export type CreateProjectResponses = {
    /**
     * Created project
     */
    201: Project;
};
export type CreateProjectResponse = CreateProjectResponses[keyof CreateProjectResponses];
export type DeleteProjectData = {
    body?: never;
    path: {
        projectId: string;
    };
    query?: never;
    url: '/api/v1/projects/{projectId}';
};
export type DeleteProjectErrors = {
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * Project not found
     */
    404: ErrorResponse;
    /**
     * Project is the default project or still owns resources
     */
    409: ErrorResponse;
};
export type DeleteProjectError = DeleteProjectErrors[keyof DeleteProjectErrors];
export type DeleteProjectResponses = {
    /**
     * Project deleted
     */
    204: void;
};
export type DeleteProjectResponse = DeleteProjectResponses[keyof DeleteProjectResponses];
export type ReadProjectData = {
    body?: never;
    path: {
        projectId: string;
    };
    query?: never;
    url: '/api/v1/projects/{projectId}';
};
export type ReadProjectErrors = {
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * Project not found
     */
    404: ErrorResponse;
};
export type ReadProjectError = ReadProjectErrors[keyof ReadProjectErrors];
export type ReadProjectResponses = {
    /**
     * Project
     */
    200: Project;
};
export type ReadProjectResponse = ReadProjectResponses[keyof ReadProjectResponses];
export type UpdateProjectData = {
    body: UpdateProjectRequest;
    path: {
        projectId: string;
    };
    query?: never;
    url: '/api/v1/projects/{projectId}';
};
export type UpdateProjectErrors = {
    /**
     * Validation error
     */
    400: ErrorResponse;
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * Project not found
     */
    404: ErrorResponse;
    /**
     * The project name already exists, or the Default project or name is immutable
     */
    409: ErrorResponse;
};
export type UpdateProjectError = UpdateProjectErrors[keyof UpdateProjectErrors];
export type UpdateProjectResponses = {
    /**
     * Renamed project
     */
    200: Project;
};
export type UpdateProjectResponse = UpdateProjectResponses[keyof UpdateProjectResponses];
export type ListAgentsData = {
    body?: never;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path?: never;
    query?: {
        search?: string;
        createdFrom?: string;
        createdTo?: string;
        limit?: number;
        cursor?: string;
        /**
         * Filter by whether an Identity is bound, independently of scheduling readiness.
         */
        identityBound?: 'true' | 'false';
        /**
         * Exact Realmroot Agent actor id bound through the Agent Identity.
         */
        identityAgentId?: string;
        /**
         * Exact runtime of the bound Realmroot Identity.
         */
        runtime?: 'enbor' | 'codex' | 'claude-code' | 'copilot';
        /**
         * Filter by current Inbox scheduling readiness.
         */
        schedulable?: 'true' | 'false';
    };
    url: '/api/v1/agents';
};
export type ListAgentsErrors = {
    /**
     * Validation error
     */
    400: ErrorResponse;
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * The selected Enbor project does not exist in the authenticated organization
     */
    404: ErrorResponse;
};
export type ListAgentsError = ListAgentsErrors[keyof ListAgentsErrors];
export type ListAgentsResponses = {
    /**
     * Agent list
     */
    200: AgentListResponse;
};
export type ListAgentsResponse = ListAgentsResponses[keyof ListAgentsResponses];
export type CreateAgentData = {
    body: CreateAgentRequest;
    headers?: {
        'idempotency-key'?: string;
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path?: never;
    query?: never;
    url: '/api/v1/agents';
};
export type CreateAgentErrors = {
    /**
     * Validation error
     */
    400: ErrorResponse;
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * The selected Enbor project does not exist in the authenticated organization
     */
    404: ErrorResponse;
    /**
     * Identity already bound or its runtime has no registered Enbor driver
     */
    409: ErrorResponse;
};
export type CreateAgentError = CreateAgentErrors[keyof CreateAgentErrors];
export type CreateAgentResponses = {
    /**
     * Created agent
     */
    201: Agent;
};
export type CreateAgentResponse = CreateAgentResponses[keyof CreateAgentResponses];
export type DeleteAgentData = {
    body?: never;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path: {
        agentId: string;
    };
    query?: never;
    url: '/api/v1/agents/{agentId}';
};
export type DeleteAgentErrors = {
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * Agent not found
     */
    404: ErrorResponse;
};
export type DeleteAgentError = DeleteAgentErrors[keyof DeleteAgentErrors];
export type DeleteAgentResponses = {
    /**
     * Agent deleted
     */
    204: void;
};
export type DeleteAgentResponse = DeleteAgentResponses[keyof DeleteAgentResponses];
export type ReadAgentData = {
    body?: never;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path: {
        agentId: string;
    };
    query?: never;
    url: '/api/v1/agents/{agentId}';
};
export type ReadAgentErrors = {
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * Agent not found
     */
    404: ErrorResponse;
};
export type ReadAgentError = ReadAgentErrors[keyof ReadAgentErrors];
export type ReadAgentResponses = {
    /**
     * Agent
     */
    200: Agent;
};
export type ReadAgentResponse = ReadAgentResponses[keyof ReadAgentResponses];
export type UpdateAgentData = {
    body: UpdateAgentRequest;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path: {
        agentId: string;
    };
    query?: never;
    url: '/api/v1/agents/{agentId}';
};
export type UpdateAgentErrors = {
    /**
     * Validation error
     */
    400: ErrorResponse;
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * Agent not found
     */
    404: ErrorResponse;
    /**
     * A live Inbox Trigger, existing binding, or unsupported Identity runtime prevents the update
     */
    409: ErrorResponse;
};
export type UpdateAgentError = UpdateAgentErrors[keyof UpdateAgentErrors];
export type UpdateAgentResponses = {
    /**
     * Updated agent
     */
    200: Agent;
};
export type UpdateAgentResponse = UpdateAgentResponses[keyof UpdateAgentResponses];
export type ListAgentVersionsData = {
    body?: never;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path: {
        agentId: string;
    };
    query?: never;
    url: '/api/v1/agents/{agentId}/versions';
};
export type ListAgentVersionsErrors = {
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * Agent not found
     */
    404: ErrorResponse;
};
export type ListAgentVersionsError = ListAgentVersionsErrors[keyof ListAgentVersionsErrors];
export type ListAgentVersionsResponses = {
    /**
     * Agent versions
     */
    200: AgentVersionListResponse;
};
export type ListAgentVersionsResponse = ListAgentVersionsResponses[keyof ListAgentVersionsResponses];
export type ReadAgentVersionData = {
    body?: never;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path: {
        agentId: string;
        version: number;
    };
    query?: never;
    url: '/api/v1/agents/{agentId}/versions/{version}';
};
export type ReadAgentVersionErrors = {
    /**
     * Validation error
     */
    400: ErrorResponse;
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * Agent or version not found
     */
    404: ErrorResponse;
};
export type ReadAgentVersionError = ReadAgentVersionErrors[keyof ReadAgentVersionErrors];
export type ReadAgentVersionResponses = {
    /**
     * Agent version
     */
    200: AgentVersion;
};
export type ReadAgentVersionResponse = ReadAgentVersionResponses[keyof ReadAgentVersionResponses];
export type ListEnvironmentsData = {
    body?: never;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path?: never;
    query?: {
        search?: string;
        createdFrom?: string;
        createdTo?: string;
        limit?: number;
        cursor?: string;
    };
    url: '/api/v1/environments';
};
export type ListEnvironmentsErrors = {
    /**
     * Validation error
     */
    400: ErrorResponse;
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * The selected Enbor project does not exist in the authenticated organization
     */
    404: ErrorResponse;
};
export type ListEnvironmentsError = ListEnvironmentsErrors[keyof ListEnvironmentsErrors];
export type ListEnvironmentsResponses = {
    /**
     * Environment list
     */
    200: EnvironmentListResponse;
};
export type ListEnvironmentsResponse = ListEnvironmentsResponses[keyof ListEnvironmentsResponses];
export type CreateEnvironmentData = {
    body: CreateEnvironmentRequest;
    headers?: {
        'idempotency-key'?: string;
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path?: never;
    query?: never;
    url: '/api/v1/environments';
};
export type CreateEnvironmentErrors = {
    /**
     * Validation error
     */
    400: ErrorResponse;
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * The selected Enbor project does not exist in the authenticated organization
     */
    404: ErrorResponse;
    /**
     * Idempotency conflict
     */
    409: ErrorResponse;
};
export type CreateEnvironmentError = CreateEnvironmentErrors[keyof CreateEnvironmentErrors];
export type CreateEnvironmentResponses = {
    /**
     * Created environment
     */
    201: Environment;
};
export type CreateEnvironmentResponse = CreateEnvironmentResponses[keyof CreateEnvironmentResponses];
export type DeleteEnvironmentData = {
    body?: never;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path: {
        environmentId: string;
    };
    query?: never;
    url: '/api/v1/environments/{environmentId}';
};
export type DeleteEnvironmentErrors = {
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * Environment not found
     */
    404: ErrorResponse;
    /**
     * An associated Runner is busy
     */
    409: ErrorResponse;
};
export type DeleteEnvironmentError = DeleteEnvironmentErrors[keyof DeleteEnvironmentErrors];
export type DeleteEnvironmentResponses = {
    /**
     * Environment deleted
     */
    204: void;
};
export type DeleteEnvironmentResponse = DeleteEnvironmentResponses[keyof DeleteEnvironmentResponses];
export type ReadEnvironmentData = {
    body?: never;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path: {
        environmentId: string;
    };
    query?: never;
    url: '/api/v1/environments/{environmentId}';
};
export type ReadEnvironmentErrors = {
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * Environment not found
     */
    404: ErrorResponse;
};
export type ReadEnvironmentError = ReadEnvironmentErrors[keyof ReadEnvironmentErrors];
export type ReadEnvironmentResponses = {
    /**
     * Environment
     */
    200: Environment;
};
export type ReadEnvironmentResponse = ReadEnvironmentResponses[keyof ReadEnvironmentResponses];
export type UpdateEnvironmentData = {
    body: UpdateEnvironmentRequest;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path: {
        environmentId: string;
    };
    query?: never;
    url: '/api/v1/environments/{environmentId}';
};
export type UpdateEnvironmentErrors = {
    /**
     * Validation error
     */
    400: ErrorResponse;
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * Environment not found
     */
    404: ErrorResponse;
};
export type UpdateEnvironmentError = UpdateEnvironmentErrors[keyof UpdateEnvironmentErrors];
export type UpdateEnvironmentResponses = {
    /**
     * Updated environment
     */
    200: Environment;
};
export type UpdateEnvironmentResponse = UpdateEnvironmentResponses[keyof UpdateEnvironmentResponses];
export type ListEnvironmentVersionsData = {
    body?: never;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path: {
        environmentId: string;
    };
    query?: never;
    url: '/api/v1/environments/{environmentId}/versions';
};
export type ListEnvironmentVersionsErrors = {
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * Environment not found
     */
    404: ErrorResponse;
};
export type ListEnvironmentVersionsError = ListEnvironmentVersionsErrors[keyof ListEnvironmentVersionsErrors];
export type ListEnvironmentVersionsResponses = {
    /**
     * Environment versions
     */
    200: EnvironmentVersionListResponse;
};
export type ListEnvironmentVersionsResponse = ListEnvironmentVersionsResponses[keyof ListEnvironmentVersionsResponses];
export type ReadEnvironmentVersionData = {
    body?: never;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path: {
        environmentId: string;
        version: number;
    };
    query?: never;
    url: '/api/v1/environments/{environmentId}/versions/{version}';
};
export type ReadEnvironmentVersionErrors = {
    /**
     * Validation error
     */
    400: ErrorResponse;
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * Environment or version not found
     */
    404: ErrorResponse;
};
export type ReadEnvironmentVersionError = ReadEnvironmentVersionErrors[keyof ReadEnvironmentVersionErrors];
export type ReadEnvironmentVersionResponses = {
    /**
     * Environment version
     */
    200: EnvironmentVersion;
};
export type ReadEnvironmentVersionResponse = ReadEnvironmentVersionResponses[keyof ReadEnvironmentVersionResponses];
export type ListIdentitiesData = {
    body?: never;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path?: never;
    query?: {
        search?: string;
        createdFrom?: string;
        createdTo?: string;
        limit?: number;
        cursor?: string;
    };
    url: '/api/v1/identities';
};
export type ListIdentitiesErrors = {
    /**
     * Invalid cursor
     */
    400: ErrorResponse;
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * The selected Enbor project does not exist in the authenticated organization
     */
    404: ErrorResponse;
};
export type ListIdentitiesError = ListIdentitiesErrors[keyof ListIdentitiesErrors];
export type ListIdentitiesResponses = {
    /**
     * Identity list
     */
    200: IdentityListResponse;
};
export type ListIdentitiesResponse = ListIdentitiesResponses[keyof ListIdentitiesResponses];
export type CreateIdentityData = {
    body: CreateIdentityRequest;
    headers: {
        'idempotency-key': string;
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path?: never;
    query?: never;
    url: '/api/v1/identities';
};
export type CreateIdentityErrors = {
    /**
     * Invalid request
     */
    400: ErrorResponse;
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * User principal required
     */
    403: ErrorResponse;
    /**
     * The selected Enbor project does not exist in the authenticated organization
     */
    404: ErrorResponse;
    /**
     * Conflict
     */
    409: ErrorResponse;
    /**
     * Realmroot provisioning failed
     */
    502: ErrorResponse;
};
export type CreateIdentityError = CreateIdentityErrors[keyof CreateIdentityErrors];
export type CreateIdentityResponses = {
    /**
     * Identity provisioned
     */
    201: Identity;
};
export type CreateIdentityResponse = CreateIdentityResponses[keyof CreateIdentityResponses];
export type DeleteIdentityData = {
    body?: never;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path: {
        identityId: string;
    };
    query?: never;
    url: '/api/v1/identities/{identityId}';
};
export type DeleteIdentityErrors = {
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * Not found
     */
    404: ErrorResponse;
    /**
     * Identity is in use
     */
    409: ErrorResponse;
};
export type DeleteIdentityError = DeleteIdentityErrors[keyof DeleteIdentityErrors];
export type DeleteIdentityResponses = {
    /**
     * Identity deleted
     */
    204: void;
};
export type DeleteIdentityResponse = DeleteIdentityResponses[keyof DeleteIdentityResponses];
export type ReadIdentityData = {
    body?: never;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path: {
        identityId: string;
    };
    query?: never;
    url: '/api/v1/identities/{identityId}';
};
export type ReadIdentityErrors = {
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * Not found
     */
    404: ErrorResponse;
};
export type ReadIdentityError = ReadIdentityErrors[keyof ReadIdentityErrors];
export type ReadIdentityResponses = {
    /**
     * Identity
     */
    200: Identity;
};
export type ReadIdentityResponse = ReadIdentityResponses[keyof ReadIdentityResponses];
export type CreateInboxNotificationData = {
    body: InboxNotification;
    path?: never;
    query?: never;
    url: '/api/v1/inbox-notifications';
};
export type CreateInboxNotificationErrors = {
    /**
     * Invalid notification
     */
    400: ErrorResponse;
    /**
     * Invalid callback token
     */
    401: ErrorResponse;
    /**
     * Notification does not match the Subscription
     */
    403: ErrorResponse;
};
export type CreateInboxNotificationError = CreateInboxNotificationErrors[keyof CreateInboxNotificationErrors];
export type CreateInboxNotificationResponses = {
    /**
     * Notification durably accepted or previously accepted
     */
    202: InboxNotificationReceipt;
};
export type CreateInboxNotificationResponse = CreateInboxNotificationResponses[keyof CreateInboxNotificationResponses];
export type ListProvidersData = {
    body?: never;
    path?: never;
    query?: never;
    url: '/api/v1/providers';
};
export type ListProvidersErrors = {
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
};
export type ListProvidersError = ListProvidersErrors[keyof ListProvidersErrors];
export type ListProvidersResponses = {
    /**
     * Provider list
     */
    200: ProviderListResponse;
};
export type ListProvidersResponse = ListProvidersResponses[keyof ListProvidersResponses];
export type ListModelsData = {
    body?: never;
    path?: never;
    query?: never;
    url: '/api/v1/providers/models';
};
export type ListModelsErrors = {
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
};
export type ListModelsError = ListModelsErrors[keyof ListModelsErrors];
export type ListModelsResponses = {
    /**
     * All catalog models
     */
    200: ProviderModelListResponse;
};
export type ListModelsResponse = ListModelsResponses[keyof ListModelsResponses];
export type RefreshCatalogData = {
    body?: never;
    path?: never;
    query?: never;
    url: '/api/v1/providers/refresh';
};
export type RefreshCatalogErrors = {
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
};
export type RefreshCatalogError = RefreshCatalogErrors[keyof RefreshCatalogErrors];
export type RefreshCatalogResponses = {
    /**
     * Refresh result
     */
    200: CatalogRefreshResult;
};
export type RefreshCatalogResponse = RefreshCatalogResponses[keyof RefreshCatalogResponses];
export type ReadProviderData = {
    body?: never;
    path: {
        providerId: string;
    };
    query?: never;
    url: '/api/v1/providers/{providerId}';
};
export type ReadProviderErrors = {
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * Provider not found
     */
    404: ErrorResponse;
};
export type ReadProviderError = ReadProviderErrors[keyof ReadProviderErrors];
export type ReadProviderResponses = {
    /**
     * Provider
     */
    200: Provider;
};
export type ReadProviderResponse = ReadProviderResponses[keyof ReadProviderResponses];
export type ListProviderModelsData = {
    body?: never;
    path: {
        providerId: string;
    };
    query?: never;
    url: '/api/v1/providers/{providerId}/models';
};
export type ListProviderModelsErrors = {
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * Provider not found
     */
    404: ErrorResponse;
};
export type ListProviderModelsError = ListProviderModelsErrors[keyof ListProviderModelsErrors];
export type ListProviderModelsResponses = {
    /**
     * Provider models
     */
    200: ProviderModelListResponse;
};
export type ListProviderModelsResponse = ListProviderModelsResponses[keyof ListProviderModelsResponses];
export type ListRunnersData = {
    body?: never;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path?: never;
    query?: {
        search?: string;
        createdFrom?: string;
        createdTo?: string;
        limit?: number;
        cursor?: string;
        state?: 'active' | 'draining' | 'disabled' | 'offline';
        environmentId?: string;
    };
    url: '/api/v1/runners';
};
export type ListRunnersErrors = {
    /**
     * Validation error
     */
    400: ErrorResponse;
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * Forbidden
     */
    403: ErrorResponse;
    /**
     * The selected Enbor project does not exist in the authenticated organization
     */
    404: ErrorResponse;
};
export type ListRunnersError = ListRunnersErrors[keyof ListRunnersErrors];
export type ListRunnersResponses = {
    /**
     * Runner list
     */
    200: RunnerListResponse;
};
export type ListRunnersResponse = ListRunnersResponses[keyof ListRunnersResponses];
export type CreateRunnerData = {
    body: CreateRunnerRequest;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path?: never;
    query?: never;
    url: '/api/v1/runners';
};
export type CreateRunnerErrors = {
    /**
     * Validation error
     */
    400: ErrorResponse;
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * Runner device token required
     */
    403: ErrorResponse;
    /**
     * The selected Enbor project does not exist in the authenticated organization
     */
    404: ErrorResponse;
    /**
     * Conflict
     */
    409: ErrorResponse;
};
export type CreateRunnerError = CreateRunnerErrors[keyof CreateRunnerErrors];
export type CreateRunnerResponses = {
    /**
     * Created runner
     */
    201: Runner;
};
export type CreateRunnerResponse = CreateRunnerResponses[keyof CreateRunnerResponses];
export type DeleteRunnerData = {
    body?: never;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path: {
        runnerId: string;
    };
    query?: never;
    url: '/api/v1/runners/{runnerId}';
};
export type DeleteRunnerErrors = {
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * Forbidden
     */
    403: ErrorResponse;
    /**
     * Runner not found
     */
    404: ErrorResponse;
    /**
     * Runner has active work
     */
    409: ErrorResponse;
};
export type DeleteRunnerError = DeleteRunnerErrors[keyof DeleteRunnerErrors];
export type DeleteRunnerResponses = {
    /**
     * Runner deleted
     */
    204: void;
};
export type DeleteRunnerResponse = DeleteRunnerResponses[keyof DeleteRunnerResponses];
export type ReadRunnerData = {
    body?: never;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path: {
        runnerId: string;
    };
    query?: never;
    url: '/api/v1/runners/{runnerId}';
};
export type ReadRunnerErrors = {
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * Forbidden
     */
    403: ErrorResponse;
    /**
     * Runner not found
     */
    404: ErrorResponse;
    /**
     * Runner has active work
     */
    409: ErrorResponse;
};
export type ReadRunnerError = ReadRunnerErrors[keyof ReadRunnerErrors];
export type ReadRunnerResponses = {
    /**
     * Runner
     */
    200: Runner;
};
export type ReadRunnerResponse = ReadRunnerResponses[keyof ReadRunnerResponses];
export type UpdateRunnerData = {
    body: UpdateRunnerRequest;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path: {
        runnerId: string;
    };
    query?: never;
    url: '/api/v1/runners/{runnerId}';
};
export type UpdateRunnerErrors = {
    /**
     * Validation error
     */
    400: ErrorResponse;
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * Forbidden
     */
    403: ErrorResponse;
    /**
     * Runner not found
     */
    404: ErrorResponse;
    /**
     * Conflict
     */
    409: ErrorResponse;
};
export type UpdateRunnerError = UpdateRunnerErrors[keyof UpdateRunnerErrors];
export type UpdateRunnerResponses = {
    /**
     * Updated runner
     */
    200: Runner;
};
export type UpdateRunnerResponse = UpdateRunnerResponses[keyof UpdateRunnerResponses];
export type ReadRunnerHeartbeatData = {
    body?: never;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path: {
        runnerId: string;
    };
    query?: never;
    url: '/api/v1/runners/{runnerId}/heartbeat';
};
export type ReadRunnerHeartbeatErrors = {
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * Forbidden
     */
    403: ErrorResponse;
    /**
     * Runner not found
     */
    404: ErrorResponse;
};
export type ReadRunnerHeartbeatError = ReadRunnerHeartbeatErrors[keyof ReadRunnerHeartbeatErrors];
export type ReadRunnerHeartbeatResponses = {
    /**
     * Runner heartbeat
     */
    200: RunnerHeartbeat;
};
export type ReadRunnerHeartbeatResponse = ReadRunnerHeartbeatResponses[keyof ReadRunnerHeartbeatResponses];
export type PutRunnerHeartbeatData = {
    body: PutRunnerHeartbeatRequest;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path: {
        runnerId: string;
    };
    query?: never;
    url: '/api/v1/runners/{runnerId}/heartbeat';
};
export type PutRunnerHeartbeatErrors = {
    /**
     * Validation error
     */
    400: ErrorResponse;
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * Forbidden
     */
    403: ErrorResponse;
    /**
     * Runner not found
     */
    404: ErrorResponse;
    /**
     * Conflict
     */
    409: ErrorResponse;
};
export type PutRunnerHeartbeatError = PutRunnerHeartbeatErrors[keyof PutRunnerHeartbeatErrors];
export type PutRunnerHeartbeatResponses = {
    /**
     * Runner heartbeat
     */
    200: RunnerHeartbeat;
};
export type PutRunnerHeartbeatResponse = PutRunnerHeartbeatResponses[keyof PutRunnerHeartbeatResponses];
export type ConnectRunnerChannelData = {
    body?: never;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path: {
        runnerId: string;
    };
    query?: never;
    url: '/api/v1/runners/{runnerId}/channel';
};
export type ConnectRunnerChannelErrors = {
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * Forbidden
     */
    403: ErrorResponse;
    /**
     * Runner not found
     */
    404: ErrorResponse;
    /**
     * WebSocket upgrade required
     */
    426: ErrorResponse;
};
export type ConnectRunnerChannelError = ConnectRunnerChannelErrors[keyof ConnectRunnerChannelErrors];
export type ConnectRunnerChannelResponses = {
    /**
     * Runner relay channel metadata for OpenAPI clients
     */
    200: RunnerChannelMetadata;
};
export type ConnectRunnerChannelResponse = ConnectRunnerChannelResponses[keyof ConnectRunnerChannelResponses];
export type ListWorkItemsData = {
    body?: never;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path?: never;
    query?: {
        state?: 'available' | 'leased' | 'succeeded' | 'failed' | 'cancelled';
        sessionId?: string;
        runnerId?: string;
        search?: string;
        createdFrom?: string;
        createdTo?: string;
        limit?: number;
        cursor?: string;
    };
    url: '/api/v1/work-items';
};
export type ListWorkItemsErrors = {
    /**
     * Validation error
     */
    400: ErrorResponse;
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * The selected Enbor project does not exist in the authenticated organization
     */
    404: ErrorResponse;
};
export type ListWorkItemsError = ListWorkItemsErrors[keyof ListWorkItemsErrors];
export type ListWorkItemsResponses = {
    /**
     * Work item list
     */
    200: WorkItemListResponse;
};
export type ListWorkItemsResponse = ListWorkItemsResponses[keyof ListWorkItemsResponses];
export type ReadWorkItemData = {
    body?: never;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path: {
        workItemId: string;
    };
    query?: never;
    url: '/api/v1/work-items/{workItemId}';
};
export type ReadWorkItemErrors = {
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * Work item not found
     */
    404: ErrorResponse;
    /**
     * Conflict
     */
    409: ErrorResponse;
};
export type ReadWorkItemError = ReadWorkItemErrors[keyof ReadWorkItemErrors];
export type ReadWorkItemResponses = {
    /**
     * Work item
     */
    200: WorkItem;
};
export type ReadWorkItemResponse = ReadWorkItemResponses[keyof ReadWorkItemResponses];
export type ListLeasesData = {
    body?: never;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path?: never;
    query?: {
        runnerId?: string;
        state?: 'active' | 'completed' | 'failed' | 'cancelled' | 'expired';
        limit?: number;
        cursor?: string;
    };
    url: '/api/v1/leases';
};
export type ListLeasesErrors = {
    /**
     * Validation error
     */
    400: ErrorResponse;
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * Forbidden
     */
    403: ErrorResponse;
    /**
     * The selected Enbor project does not exist in the authenticated organization
     */
    404: ErrorResponse;
};
export type ListLeasesError = ListLeasesErrors[keyof ListLeasesErrors];
export type ListLeasesResponses = {
    /**
     * Lease list
     */
    200: LeaseListResponse;
};
export type ListLeasesResponse = ListLeasesResponses[keyof ListLeasesResponses];
export type CreateLeaseData = {
    body: CreateLeaseRequest;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path?: never;
    query?: never;
    url: '/api/v1/leases';
};
export type CreateLeaseErrors = {
    /**
     * Validation error
     */
    400: ErrorResponse;
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * Forbidden
     */
    403: ErrorResponse;
    /**
     * Work item or runner not found
     */
    404: ErrorResponse;
    /**
     * Work item is no longer available
     */
    409: ErrorResponse;
};
export type CreateLeaseError = CreateLeaseErrors[keyof CreateLeaseErrors];
export type CreateLeaseResponses = {
    /**
     * Created lease
     */
    201: Lease;
};
export type CreateLeaseResponse = CreateLeaseResponses[keyof CreateLeaseResponses];
export type ReadLeaseData = {
    body?: never;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path: {
        leaseId: string;
    };
    query?: never;
    url: '/api/v1/leases/{leaseId}';
};
export type ReadLeaseErrors = {
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * Forbidden
     */
    403: ErrorResponse;
    /**
     * Lease not found
     */
    404: ErrorResponse;
};
export type ReadLeaseError = ReadLeaseErrors[keyof ReadLeaseErrors];
export type ReadLeaseResponses = {
    /**
     * Lease
     */
    200: Lease;
};
export type ReadLeaseResponse = ReadLeaseResponses[keyof ReadLeaseResponses];
export type UpdateLeaseData = {
    body: UpdateLeaseRequest;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path: {
        leaseId: string;
    };
    query?: never;
    url: '/api/v1/leases/{leaseId}';
};
export type UpdateLeaseErrors = {
    /**
     * Validation error
     */
    400: ErrorResponse;
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * Forbidden
     */
    403: ErrorResponse;
    /**
     * Lease not found
     */
    404: ErrorResponse;
    /**
     * Conflict
     */
    409: ErrorResponse;
};
export type UpdateLeaseError = UpdateLeaseErrors[keyof UpdateLeaseErrors];
export type UpdateLeaseResponses = {
    /**
     * Updated lease
     */
    200: Lease;
};
export type UpdateLeaseResponse = UpdateLeaseResponses[keyof UpdateLeaseResponses];
export type ListBudgetsData = {
    body?: never;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path?: never;
    query?: never;
    url: '/api/v1/budgets';
};
export type ListBudgetsErrors = {
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * The selected Enbor project does not exist in the authenticated organization
     */
    404: ErrorResponse;
};
export type ListBudgetsError = ListBudgetsErrors[keyof ListBudgetsErrors];
export type ListBudgetsResponses = {
    /**
     * Budgets
     */
    200: BudgetListResponse;
};
export type ListBudgetsResponse = ListBudgetsResponses[keyof ListBudgetsResponses];
export type CreateBudgetData = {
    body: CreateBudgetRequest;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path?: never;
    query?: never;
    url: '/api/v1/budgets';
};
export type CreateBudgetErrors = {
    /**
     * Validation error
     */
    400: ErrorResponse;
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * The selected Enbor project does not exist in the authenticated organization
     */
    404: ErrorResponse;
    /**
     * Project deletion conflict
     */
    409: ErrorResponse;
};
export type CreateBudgetError = CreateBudgetErrors[keyof CreateBudgetErrors];
export type CreateBudgetResponses = {
    /**
     * Created budget
     */
    201: Budget;
};
export type CreateBudgetResponse = CreateBudgetResponses[keyof CreateBudgetResponses];
export type DeleteBudgetData = {
    body?: never;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path: {
        budgetId: string;
    };
    query?: never;
    url: '/api/v1/budgets/{budgetId}';
};
export type DeleteBudgetErrors = {
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * Budget not found
     */
    404: ErrorResponse;
};
export type DeleteBudgetError = DeleteBudgetErrors[keyof DeleteBudgetErrors];
export type DeleteBudgetResponses = {
    /**
     * Budget deleted
     */
    204: void;
};
export type DeleteBudgetResponse = DeleteBudgetResponses[keyof DeleteBudgetResponses];
export type ReadBudgetData = {
    body?: never;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path: {
        budgetId: string;
    };
    query?: never;
    url: '/api/v1/budgets/{budgetId}';
};
export type ReadBudgetErrors = {
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * Budget not found
     */
    404: ErrorResponse;
};
export type ReadBudgetError = ReadBudgetErrors[keyof ReadBudgetErrors];
export type ReadBudgetResponses = {
    /**
     * Budget
     */
    200: Budget;
};
export type ReadBudgetResponse = ReadBudgetResponses[keyof ReadBudgetResponses];
export type UpdateBudgetData = {
    body: UpdateBudgetRequest;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path: {
        budgetId: string;
    };
    query?: never;
    url: '/api/v1/budgets/{budgetId}';
};
export type UpdateBudgetErrors = {
    /**
     * Validation error
     */
    400: ErrorResponse;
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * Budget not found
     */
    404: ErrorResponse;
};
export type UpdateBudgetError = UpdateBudgetErrors[keyof UpdateBudgetErrors];
export type UpdateBudgetResponses = {
    /**
     * Updated budget
     */
    200: Budget;
};
export type UpdateBudgetResponse = UpdateBudgetResponses[keyof UpdateBudgetResponses];
export type ListConnectorsData = {
    body?: never;
    path?: never;
    query?: {
        search?: string;
        category?: string;
        trustLevel?: string;
        capability?: string;
        availability?: 'available' | 'unavailable';
        limit?: number;
        cursor?: string;
    };
    url: '/api/v1/connectors';
};
export type ListConnectorsErrors = {
    /**
     * Validation error
     */
    400: ErrorResponse;
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
};
export type ListConnectorsError = ListConnectorsErrors[keyof ListConnectorsErrors];
export type ListConnectorsResponses = {
    /**
     * Connector list
     */
    200: ConnectorListResponse;
};
export type ListConnectorsResponse = ListConnectorsResponses[keyof ListConnectorsResponses];
export type ReadConnectorData = {
    body?: never;
    path: {
        connectorId: string;
    };
    query?: never;
    url: '/api/v1/connectors/{connectorId}';
};
export type ReadConnectorErrors = {
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * Connector not found
     */
    404: ErrorResponse;
};
export type ReadConnectorError = ReadConnectorErrors[keyof ReadConnectorErrors];
export type ReadConnectorResponses = {
    /**
     * Connector
     */
    200: Connector;
};
export type ReadConnectorResponse = ReadConnectorResponses[keyof ReadConnectorResponses];
export type ListUsageRecordsData = {
    body?: never;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path?: never;
    query?: {
        from?: string;
        to?: string;
        providerId?: string;
        modelId?: string;
        agentId?: string;
        sessionId?: string;
        limit?: number;
        cursor?: string;
    };
    url: '/api/v1/usage-records';
};
export type ListUsageRecordsErrors = {
    /**
     * Validation error
     */
    400: ErrorResponse;
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * The selected Enbor project does not exist in the authenticated organization
     */
    404: ErrorResponse;
};
export type ListUsageRecordsError = ListUsageRecordsErrors[keyof ListUsageRecordsErrors];
export type ListUsageRecordsResponses = {
    /**
     * Usage records
     */
    200: UsageRecordListResponse;
};
export type ListUsageRecordsResponse = ListUsageRecordsResponses[keyof ListUsageRecordsResponses];
export type ReadUsageRecordData = {
    body?: never;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path: {
        recordId: string;
    };
    query?: never;
    url: '/api/v1/usage-records/{recordId}';
};
export type ReadUsageRecordErrors = {
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * Usage record not found
     */
    404: ErrorResponse;
};
export type ReadUsageRecordError = ReadUsageRecordErrors[keyof ReadUsageRecordErrors];
export type ReadUsageRecordResponses = {
    /**
     * Usage record
     */
    200: UsageRecord;
};
export type ReadUsageRecordResponse = ReadUsageRecordResponses[keyof ReadUsageRecordResponses];
export type ReadUsageSummaryData = {
    body?: never;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path?: never;
    query?: {
        groupBy?: 'provider' | 'model' | 'agent';
        from?: string;
        to?: string;
    };
    url: '/api/v1/usage-summary';
};
export type ReadUsageSummaryErrors = {
    /**
     * Validation error
     */
    400: ErrorResponse;
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * The selected Enbor project does not exist in the authenticated organization
     */
    404: ErrorResponse;
};
export type ReadUsageSummaryError = ReadUsageSummaryErrors[keyof ReadUsageSummaryErrors];
export type ReadUsageSummaryResponses = {
    /**
     * Usage summary
     */
    200: UsageSummary;
};
export type ReadUsageSummaryResponse = ReadUsageSummaryResponses[keyof ReadUsageSummaryResponses];
export type ListAuditRecordsData = {
    body?: never;
    path?: never;
    query?: {
        actorId?: string;
        projectId?: string;
        action?: string;
        resourceType?: string;
        resourceId?: string;
        outcome?: string;
        from?: string;
        to?: string;
        limit?: number;
        cursor?: string;
    };
    url: '/api/v1/audit-records';
};
export type ListAuditRecordsErrors = {
    /**
     * Validation error
     */
    400: ErrorResponse;
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
};
export type ListAuditRecordsError = ListAuditRecordsErrors[keyof ListAuditRecordsErrors];
export type ListAuditRecordsResponses = {
    /**
     * Audit records
     */
    200: AuditRecordListResponse;
};
export type ListAuditRecordsResponse = ListAuditRecordsResponses[keyof ListAuditRecordsResponses];
export type ReadAuditRecordData = {
    body?: never;
    path: {
        recordId: string;
    };
    query?: never;
    url: '/api/v1/audit-records/{recordId}';
};
export type ReadAuditRecordErrors = {
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * Audit record not found
     */
    404: ErrorResponse;
};
export type ReadAuditRecordError = ReadAuditRecordErrors[keyof ReadAuditRecordErrors];
export type ReadAuditRecordResponses = {
    /**
     * Audit record
     */
    200: AuditRecord;
};
export type ReadAuditRecordResponse = ReadAuditRecordResponses[keyof ReadAuditRecordResponses];
export type ListTriggersData = {
    body?: never;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path?: never;
    query?: {
        search?: string;
        createdFrom?: string;
        createdTo?: string;
        limit?: number;
        cursor?: string;
        /**
         * Filter by the operational toggle.
         */
        suspend?: 'true' | 'false';
    };
    url: '/api/v1/triggers';
};
export type ListTriggersErrors = {
    /**
     * Validation error
     */
    400: ErrorResponse;
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * The selected Enbor project does not exist in the authenticated organization
     */
    404: ErrorResponse;
};
export type ListTriggersError = ListTriggersErrors[keyof ListTriggersErrors];
export type ListTriggersResponses = {
    /**
     * Triggers
     */
    200: TriggerListResponse;
};
export type ListTriggersResponse = ListTriggersResponses[keyof ListTriggersResponses];
export type CreateTriggerData = {
    body: CreateTriggerRequest;
    headers?: {
        'idempotency-key'?: string;
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path?: never;
    query?: never;
    url: '/api/v1/triggers';
};
export type CreateTriggerErrors = {
    /**
     * Validation error
     */
    400: ErrorResponse;
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * Agent not found
     */
    404: ErrorResponse;
    /**
     * Conflict
     */
    409: ErrorResponse;
    /**
     * Inbox Subscription failure
     */
    502: ErrorResponse;
};
export type CreateTriggerError = CreateTriggerErrors[keyof CreateTriggerErrors];
export type CreateTriggerResponses = {
    /**
     * Created trigger
     */
    201: Trigger;
};
export type CreateTriggerResponse = CreateTriggerResponses[keyof CreateTriggerResponses];
export type DeleteTriggerData = {
    body?: never;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path: {
        triggerId: string;
    };
    query?: never;
    url: '/api/v1/triggers/{triggerId}';
};
export type DeleteTriggerErrors = {
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * Trigger not found
     */
    404: ErrorResponse;
    /**
     * Inbox Subscription failure
     */
    502: ErrorResponse;
};
export type DeleteTriggerError = DeleteTriggerErrors[keyof DeleteTriggerErrors];
export type DeleteTriggerResponses = {
    /**
     * Trigger deleted
     */
    204: void;
};
export type DeleteTriggerResponse = DeleteTriggerResponses[keyof DeleteTriggerResponses];
export type ReadTriggerData = {
    body?: never;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path: {
        triggerId: string;
    };
    query?: never;
    url: '/api/v1/triggers/{triggerId}';
};
export type ReadTriggerErrors = {
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * Trigger not found
     */
    404: ErrorResponse;
};
export type ReadTriggerError = ReadTriggerErrors[keyof ReadTriggerErrors];
export type ReadTriggerResponses = {
    /**
     * Trigger
     */
    200: Trigger;
};
export type ReadTriggerResponse = ReadTriggerResponses[keyof ReadTriggerResponses];
export type UpdateTriggerData = {
    body: UpdateTriggerRequest;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path: {
        triggerId: string;
    };
    query?: never;
    url: '/api/v1/triggers/{triggerId}';
};
export type UpdateTriggerErrors = {
    /**
     * Validation error
     */
    400: ErrorResponse;
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * Trigger not found
     */
    404: ErrorResponse;
    /**
     * Conflict
     */
    409: ErrorResponse;
    /**
     * Inbox Subscription failure
     */
    502: ErrorResponse;
};
export type UpdateTriggerError = UpdateTriggerErrors[keyof UpdateTriggerErrors];
export type UpdateTriggerResponses = {
    /**
     * Updated trigger
     */
    200: Trigger;
};
export type UpdateTriggerResponse = UpdateTriggerResponses[keyof UpdateTriggerResponses];
export type ListTriggerRunsData = {
    body?: never;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path: {
        triggerId: string;
    };
    query?: {
        search?: string;
        createdFrom?: string;
        createdTo?: string;
        limit?: number;
        cursor?: string;
        state?: 'claimed' | 'queued' | 'dispatching' | 'dispatched' | 'failed';
    };
    url: '/api/v1/triggers/{triggerId}/runs';
};
export type ListTriggerRunsErrors = {
    /**
     * Validation error
     */
    400: ErrorResponse;
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * Trigger not found
     */
    404: ErrorResponse;
};
export type ListTriggerRunsError = ListTriggerRunsErrors[keyof ListTriggerRunsErrors];
export type ListTriggerRunsResponses = {
    /**
     * Trigger runs
     */
    200: TriggerRunListResponse;
};
export type ListTriggerRunsResponse = ListTriggerRunsResponses[keyof ListTriggerRunsResponses];
export type CreateTriggerRunData = {
    body: CreateHttpTriggerRunRequest;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path: {
        triggerId: string;
    };
    query?: never;
    url: '/api/v1/triggers/{triggerId}/runs';
};
export type CreateTriggerRunErrors = {
    /**
     * Validation error
     */
    400: ErrorResponse;
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * Trigger not found
     */
    404: ErrorResponse;
    /**
     * Conflict
     */
    409: ErrorResponse;
};
export type CreateTriggerRunError = CreateTriggerRunErrors[keyof CreateTriggerRunErrors];
export type CreateTriggerRunResponses = {
    /**
     * Created trigger run
     */
    201: TriggerRun;
};
export type CreateTriggerRunResponse = CreateTriggerRunResponses[keyof CreateTriggerRunResponses];
export type ReadTriggerRunData = {
    body?: never;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path: {
        triggerId: string;
        runId: string;
    };
    query?: never;
    url: '/api/v1/triggers/{triggerId}/runs/{runId}';
};
export type ReadTriggerRunErrors = {
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * Trigger run not found
     */
    404: ErrorResponse;
};
export type ReadTriggerRunError = ReadTriggerRunErrors[keyof ReadTriggerRunErrors];
export type ReadTriggerRunResponses = {
    /**
     * Trigger run
     */
    200: TriggerRun;
};
export type ReadTriggerRunResponse = ReadTriggerRunResponses[keyof ReadTriggerRunResponses];
export type ListSessionsData = {
    body?: never;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path?: never;
    query?: {
        search?: string;
        createdFrom?: string;
        createdTo?: string;
        limit?: number;
        cursor?: string;
        state?: 'pending' | 'running' | 'idle' | 'closed' | 'error';
        labelSelector?: string;
    };
    url: '/api/v1/sessions';
};
export type ListSessionsErrors = {
    /**
     * Validation error
     */
    400: ErrorResponse;
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * The selected Enbor project does not exist in the authenticated organization
     */
    404: ErrorResponse;
};
export type ListSessionsError = ListSessionsErrors[keyof ListSessionsErrors];
export type ListSessionsResponses = {
    /**
     * Session list
     */
    200: SessionListResponse;
};
export type ListSessionsResponse = ListSessionsResponses[keyof ListSessionsResponses];
export type CreateSessionData = {
    body: CreateSessionRequest;
    headers?: {
        'idempotency-key'?: string;
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path?: never;
    query?: never;
    url: '/api/v1/sessions';
};
export type CreateSessionErrors = {
    /**
     * Validation error
     */
    400: ErrorResponse;
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * Policy denied
     */
    403: ErrorResponse;
    /**
     * Agent not found
     */
    404: ErrorResponse;
    /**
     * Conflict
     */
    409: ErrorResponse;
};
export type CreateSessionError = CreateSessionErrors[keyof CreateSessionErrors];
export type CreateSessionResponses = {
    /**
     * Created session
     */
    201: Session;
};
export type CreateSessionResponse = CreateSessionResponses[keyof CreateSessionResponses];
export type DeleteSessionData = {
    body?: never;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path: {
        sessionId: string;
    };
    query?: never;
    url: '/api/v1/sessions/{sessionId}';
};
export type DeleteSessionErrors = {
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * Session not found
     */
    404: ErrorResponse;
    /**
     * Runtime could not be stopped
     */
    409: ErrorResponse;
};
export type DeleteSessionError = DeleteSessionErrors[keyof DeleteSessionErrors];
export type DeleteSessionResponses = {
    /**
     * Session deleted
     */
    204: void;
};
export type DeleteSessionResponse = DeleteSessionResponses[keyof DeleteSessionResponses];
export type ReadSessionData = {
    body?: never;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path: {
        sessionId: string;
    };
    query?: never;
    url: '/api/v1/sessions/{sessionId}';
};
export type ReadSessionErrors = {
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * Session not found
     */
    404: ErrorResponse;
};
export type ReadSessionError = ReadSessionErrors[keyof ReadSessionErrors];
export type ReadSessionResponses = {
    /**
     * Session
     */
    200: Session;
};
export type ReadSessionResponse = ReadSessionResponses[keyof ReadSessionResponses];
export type UpdateSessionData = {
    body: UpdateSessionRequest;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path: {
        sessionId: string;
    };
    query?: never;
    url: '/api/v1/sessions/{sessionId}';
};
export type UpdateSessionErrors = {
    /**
     * Validation error
     */
    400: ErrorResponse;
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * Session not found
     */
    404: ErrorResponse;
    /**
     * Conflict
     */
    409: ErrorResponse;
};
export type UpdateSessionError = UpdateSessionErrors[keyof UpdateSessionErrors];
export type UpdateSessionResponses = {
    /**
     * Updated session
     */
    200: Session;
};
export type UpdateSessionResponse = UpdateSessionResponses[keyof UpdateSessionResponses];
export type ConnectSessionSocketData = {
    body?: never;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path: {
        sessionId: string;
    };
    query?: never;
    url: '/api/v1/sessions/{sessionId}/socket';
};
export type ConnectSessionSocketErrors = {
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * Session not found
     */
    404: ErrorResponse;
    /**
     * WebSocket upgrade required
     */
    426: ErrorResponse;
};
export type ConnectSessionSocketError = ConnectSessionSocketErrors[keyof ConnectSessionSocketErrors];
export type ListSessionMessagesData = {
    body?: never;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path: {
        sessionId: string;
    };
    query?: {
        limit?: number;
        cursor?: string;
    };
    url: '/api/v1/sessions/{sessionId}/messages';
};
export type ListSessionMessagesErrors = {
    /**
     * Validation error
     */
    400: ErrorResponse;
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * Session not found
     */
    404: ErrorResponse;
};
export type ListSessionMessagesError = ListSessionMessagesErrors[keyof ListSessionMessagesErrors];
export type ListSessionMessagesResponses = {
    /**
     * Session messages
     */
    200: SessionMessageListResponse;
};
export type ListSessionMessagesResponse = ListSessionMessagesResponses[keyof ListSessionMessagesResponses];
export type CreateSessionMessageData = {
    body: CreateSessionMessageRequest;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path: {
        sessionId: string;
    };
    query?: never;
    url: '/api/v1/sessions/{sessionId}/messages';
};
export type CreateSessionMessageErrors = {
    /**
     * Validation error
     */
    400: ErrorResponse;
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * Session not found
     */
    404: ErrorResponse;
    /**
     * Conflict
     */
    409: ErrorResponse;
    /**
     * Runtime error
     */
    500: ErrorResponse;
};
export type CreateSessionMessageError = CreateSessionMessageErrors[keyof CreateSessionMessageErrors];
export type CreateSessionMessageResponses = {
    /**
     * Message accepted
     */
    201: SessionMessage;
};
export type CreateSessionMessageResponse = CreateSessionMessageResponses[keyof CreateSessionMessageResponses];
export type ReadSessionMessageData = {
    body?: never;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path: {
        sessionId: string;
        messageId: string;
    };
    query?: never;
    url: '/api/v1/sessions/{sessionId}/messages/{messageId}';
};
export type ReadSessionMessageErrors = {
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * Session or message not found
     */
    404: ErrorResponse;
};
export type ReadSessionMessageError = ReadSessionMessageErrors[keyof ReadSessionMessageErrors];
export type ReadSessionMessageResponses = {
    /**
     * Session message
     */
    200: SessionMessage;
};
export type ReadSessionMessageResponse = ReadSessionMessageResponses[keyof ReadSessionMessageResponses];
export type ListSessionEventsData = {
    body?: never;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path: {
        sessionId: string;
    };
    query?: {
        cursor?: number | null;
        order?: 'asc' | 'desc';
        limit?: number;
        type?: 'runtime.started' | 'runtime.completed' | 'turn.started' | 'turn.completed' | 'message.started' | 'message.updated' | 'message.completed' | 'usage.recorded' | 'permission.requested' | 'permission.resolved' | 'permission.denied' | 'runtime.error';
        createdFrom?: string;
        createdTo?: string;
    };
    url: '/api/v1/sessions/{sessionId}/events';
};
export type ListSessionEventsErrors = {
    /**
     * Validation error
     */
    400: ErrorResponse;
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * Session not found
     */
    404: ErrorResponse;
};
export type ListSessionEventsError = ListSessionEventsErrors[keyof ListSessionEventsErrors];
export type ListSessionEventsResponses = {
    /**
     * Session events
     */
    200: SessionEventListResponse;
};
export type ListSessionEventsResponse = ListSessionEventsResponses[keyof ListSessionEventsResponses];
export type CreateSessionEventsData = {
    body: CreateSessionEventsRequest;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path: {
        sessionId: string;
    };
    query?: never;
    url: '/api/v1/sessions/{sessionId}/events';
};
export type CreateSessionEventsErrors = {
    /**
     * Validation error
     */
    400: ErrorResponse;
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * Forbidden
     */
    403: ErrorResponse;
    /**
     * Session not found
     */
    404: ErrorResponse;
};
export type CreateSessionEventsError = CreateSessionEventsErrors[keyof CreateSessionEventsErrors];
export type CreateSessionEventsResponses = {
    /**
     * Events accepted
     */
    201: SessionEventsAccepted;
};
export type CreateSessionEventsResponse = CreateSessionEventsResponses[keyof CreateSessionEventsResponses];
export type ListSessionApprovalsData = {
    body?: never;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path: {
        sessionId: string;
    };
    query?: never;
    url: '/api/v1/sessions/{sessionId}/approvals';
};
export type ListSessionApprovalsErrors = {
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * Session not found
     */
    404: ErrorResponse;
};
export type ListSessionApprovalsError = ListSessionApprovalsErrors[keyof ListSessionApprovalsErrors];
export type ListSessionApprovalsResponses = {
    /**
     * Session approvals
     */
    200: SessionApprovalListResponse;
};
export type ListSessionApprovalsResponse = ListSessionApprovalsResponses[keyof ListSessionApprovalsResponses];
export type ReadSessionApprovalData = {
    body?: never;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path: {
        sessionId: string;
        approvalId: string;
    };
    query?: never;
    url: '/api/v1/sessions/{sessionId}/approvals/{approvalId}';
};
export type ReadSessionApprovalErrors = {
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * Session or approval not found
     */
    404: ErrorResponse;
};
export type ReadSessionApprovalError = ReadSessionApprovalErrors[keyof ReadSessionApprovalErrors];
export type ReadSessionApprovalResponses = {
    /**
     * Session approval
     */
    200: SessionApproval;
};
export type ReadSessionApprovalResponse = ReadSessionApprovalResponses[keyof ReadSessionApprovalResponses];
export type DecideSessionApprovalData = {
    body: SessionApprovalDecisionRequest;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path: {
        sessionId: string;
        approvalId: string;
    };
    query?: never;
    url: '/api/v1/sessions/{sessionId}/approvals/{approvalId}';
};
export type DecideSessionApprovalErrors = {
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * Session or pending approval not found
     */
    404: ErrorResponse;
    /**
     * Approval already decided
     */
    409: ErrorResponse;
};
export type DecideSessionApprovalError = DecideSessionApprovalErrors[keyof DecideSessionApprovalErrors];
export type DecideSessionApprovalResponses = {
    /**
     * Decision recorded
     */
    200: SessionApproval;
};
export type DecideSessionApprovalResponse = DecideSessionApprovalResponses[keyof DecideSessionApprovalResponses];
export type ListMemoryStoresData = {
    body?: never;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path?: never;
    query?: {
        search?: string;
        createdFrom?: string;
        createdTo?: string;
        limit?: number;
        cursor?: string;
    };
    url: '/api/v1/memory-stores';
};
export type ListMemoryStoresErrors = {
    /**
     * Validation error
     */
    400: ErrorResponse;
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * The selected Enbor project does not exist in the authenticated organization
     */
    404: ErrorResponse;
};
export type ListMemoryStoresError = ListMemoryStoresErrors[keyof ListMemoryStoresErrors];
export type ListMemoryStoresResponses = {
    /**
     * Memory store list
     */
    200: MemoryStoreListResponse;
};
export type ListMemoryStoresResponse = ListMemoryStoresResponses[keyof ListMemoryStoresResponses];
export type CreateMemoryStoreData = {
    body: CreateMemoryStoreRequest;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path?: never;
    query?: never;
    url: '/api/v1/memory-stores';
};
export type CreateMemoryStoreErrors = {
    /**
     * Validation error
     */
    400: ErrorResponse;
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * The selected Enbor project does not exist in the authenticated organization
     */
    404: ErrorResponse;
    /**
     * Project deletion conflict
     */
    409: ErrorResponse;
};
export type CreateMemoryStoreError = CreateMemoryStoreErrors[keyof CreateMemoryStoreErrors];
export type CreateMemoryStoreResponses = {
    /**
     * Created memory store
     */
    201: MemoryStore;
};
export type CreateMemoryStoreResponse = CreateMemoryStoreResponses[keyof CreateMemoryStoreResponses];
export type DeleteMemoryStoreData = {
    body?: never;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path: {
        storeId: string;
    };
    query?: never;
    url: '/api/v1/memory-stores/{storeId}';
};
export type DeleteMemoryStoreErrors = {
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * Memory store not found
     */
    404: ErrorResponse;
};
export type DeleteMemoryStoreError = DeleteMemoryStoreErrors[keyof DeleteMemoryStoreErrors];
export type DeleteMemoryStoreResponses = {
    /**
     * Memory store deleted
     */
    204: void;
};
export type DeleteMemoryStoreResponse = DeleteMemoryStoreResponses[keyof DeleteMemoryStoreResponses];
export type ReadMemoryStoreData = {
    body?: never;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path: {
        storeId: string;
    };
    query?: never;
    url: '/api/v1/memory-stores/{storeId}';
};
export type ReadMemoryStoreErrors = {
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * Memory store not found
     */
    404: ErrorResponse;
};
export type ReadMemoryStoreError = ReadMemoryStoreErrors[keyof ReadMemoryStoreErrors];
export type ReadMemoryStoreResponses = {
    /**
     * Memory store
     */
    200: MemoryStore;
};
export type ReadMemoryStoreResponse = ReadMemoryStoreResponses[keyof ReadMemoryStoreResponses];
export type UpdateMemoryStoreData = {
    body: UpdateMemoryStoreRequest;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path: {
        storeId: string;
    };
    query?: never;
    url: '/api/v1/memory-stores/{storeId}';
};
export type UpdateMemoryStoreErrors = {
    /**
     * Validation error
     */
    400: ErrorResponse;
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * Memory store not found
     */
    404: ErrorResponse;
};
export type UpdateMemoryStoreError = UpdateMemoryStoreErrors[keyof UpdateMemoryStoreErrors];
export type UpdateMemoryStoreResponses = {
    /**
     * Updated memory store
     */
    200: MemoryStore;
};
export type UpdateMemoryStoreResponse = UpdateMemoryStoreResponses[keyof UpdateMemoryStoreResponses];
export type ListMemoryStoreMemoriesData = {
    body?: never;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path: {
        storeId: string;
    };
    query?: {
        limit?: number;
        cursor?: string;
    };
    url: '/api/v1/memory-stores/{storeId}/memories';
};
export type ListMemoryStoreMemoriesErrors = {
    /**
     * Validation error
     */
    400: ErrorResponse;
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * Memory store not found
     */
    404: ErrorResponse;
};
export type ListMemoryStoreMemoriesError = ListMemoryStoreMemoriesErrors[keyof ListMemoryStoreMemoriesErrors];
export type ListMemoryStoreMemoriesResponses = {
    /**
     * Memory list
     */
    200: MemoryStoreMemoryListResponse;
};
export type ListMemoryStoreMemoriesResponse = ListMemoryStoreMemoriesResponses[keyof ListMemoryStoreMemoriesResponses];
export type CreateMemoryStoreMemoryData = {
    body: CreateMemoryStoreMemoryRequest;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path: {
        storeId: string;
    };
    query?: never;
    url: '/api/v1/memory-stores/{storeId}/memories';
};
export type CreateMemoryStoreMemoryErrors = {
    /**
     * Validation error
     */
    400: ErrorResponse;
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * Memory store not found
     */
    404: ErrorResponse;
    /**
     * Memory path conflict
     */
    409: ErrorResponse;
};
export type CreateMemoryStoreMemoryError = CreateMemoryStoreMemoryErrors[keyof CreateMemoryStoreMemoryErrors];
export type CreateMemoryStoreMemoryResponses = {
    /**
     * Created memory
     */
    201: MemoryStoreMemory;
};
export type CreateMemoryStoreMemoryResponse = CreateMemoryStoreMemoryResponses[keyof CreateMemoryStoreMemoryResponses];
export type DeleteMemoryStoreMemoryData = {
    body?: never;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path: {
        storeId: string;
        memoryId: string;
    };
    query?: never;
    url: '/api/v1/memory-stores/{storeId}/memories/{memoryId}';
};
export type DeleteMemoryStoreMemoryErrors = {
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * Memory not found
     */
    404: ErrorResponse;
};
export type DeleteMemoryStoreMemoryError = DeleteMemoryStoreMemoryErrors[keyof DeleteMemoryStoreMemoryErrors];
export type DeleteMemoryStoreMemoryResponses = {
    /**
     * Memory deleted
     */
    204: void;
};
export type DeleteMemoryStoreMemoryResponse = DeleteMemoryStoreMemoryResponses[keyof DeleteMemoryStoreMemoryResponses];
export type UpdateMemoryStoreMemoryData = {
    body: UpdateMemoryStoreMemoryRequest;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path: {
        storeId: string;
        memoryId: string;
    };
    query?: never;
    url: '/api/v1/memory-stores/{storeId}/memories/{memoryId}';
};
export type UpdateMemoryStoreMemoryErrors = {
    /**
     * Validation error
     */
    400: ErrorResponse;
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * Memory not found
     */
    404: ErrorResponse;
    /**
     * Memory path conflict
     */
    409: ErrorResponse;
};
export type UpdateMemoryStoreMemoryError = UpdateMemoryStoreMemoryErrors[keyof UpdateMemoryStoreMemoryErrors];
export type UpdateMemoryStoreMemoryResponses = {
    /**
     * Updated memory
     */
    200: MemoryStoreMemory;
};
export type UpdateMemoryStoreMemoryResponse = UpdateMemoryStoreMemoryResponses[keyof UpdateMemoryStoreMemoryResponses];
export type ListVaultsData = {
    body?: never;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path?: never;
    query?: {
        search?: string;
        createdFrom?: string;
        createdTo?: string;
        limit?: number;
        cursor?: string;
    };
    url: '/api/v1/vaults';
};
export type ListVaultsErrors = {
    /**
     * Validation error
     */
    400: ErrorResponse;
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * The selected Enbor project does not exist in the authenticated organization
     */
    404: ErrorResponse;
};
export type ListVaultsError = ListVaultsErrors[keyof ListVaultsErrors];
export type ListVaultsResponses = {
    /**
     * Vault list
     */
    200: VaultListResponse;
};
export type ListVaultsResponse = ListVaultsResponses[keyof ListVaultsResponses];
export type CreateVaultData = {
    body: CreateVaultRequest;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path?: never;
    query?: never;
    url: '/api/v1/vaults';
};
export type CreateVaultErrors = {
    /**
     * Validation error
     */
    400: ErrorResponse;
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * The selected Enbor project does not exist in the authenticated organization
     */
    404: ErrorResponse;
    /**
     * Project deletion conflict
     */
    409: ErrorResponse;
};
export type CreateVaultError = CreateVaultErrors[keyof CreateVaultErrors];
export type CreateVaultResponses = {
    /**
     * Created vault
     */
    201: Vault;
};
export type CreateVaultResponse = CreateVaultResponses[keyof CreateVaultResponses];
export type DeleteVaultData = {
    body?: never;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path: {
        vaultId: string;
    };
    query?: never;
    url: '/api/v1/vaults/{vaultId}';
};
export type DeleteVaultErrors = {
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * Vault not found
     */
    404: ErrorResponse;
};
export type DeleteVaultError = DeleteVaultErrors[keyof DeleteVaultErrors];
export type DeleteVaultResponses = {
    /**
     * Vault deleted
     */
    204: void;
};
export type DeleteVaultResponse = DeleteVaultResponses[keyof DeleteVaultResponses];
export type ReadVaultData = {
    body?: never;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path: {
        vaultId: string;
    };
    query?: never;
    url: '/api/v1/vaults/{vaultId}';
};
export type ReadVaultErrors = {
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * Vault not found
     */
    404: ErrorResponse;
};
export type ReadVaultError = ReadVaultErrors[keyof ReadVaultErrors];
export type ReadVaultResponses = {
    /**
     * Vault
     */
    200: Vault;
};
export type ReadVaultResponse = ReadVaultResponses[keyof ReadVaultResponses];
export type UpdateVaultData = {
    body: UpdateVaultRequest;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path: {
        vaultId: string;
    };
    query?: never;
    url: '/api/v1/vaults/{vaultId}';
};
export type UpdateVaultErrors = {
    /**
     * Validation error
     */
    400: ErrorResponse;
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * Vault not found
     */
    404: ErrorResponse;
    /**
     * Vault scope conflict
     */
    409: ErrorResponse;
};
export type UpdateVaultError = UpdateVaultErrors[keyof UpdateVaultErrors];
export type UpdateVaultResponses = {
    /**
     * Updated vault
     */
    200: Vault;
};
export type UpdateVaultResponse = UpdateVaultResponses[keyof UpdateVaultResponses];
export type ListVaultCredentialsData = {
    body?: never;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path: {
        vaultId: string;
    };
    query?: {
        search?: string;
        createdFrom?: string;
        createdTo?: string;
        limit?: number;
        cursor?: string;
        state?: 'active' | 'revoked';
    };
    url: '/api/v1/vaults/{vaultId}/credentials';
};
export type ListVaultCredentialsErrors = {
    /**
     * Validation error
     */
    400: ErrorResponse;
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * Vault not found
     */
    404: ErrorResponse;
};
export type ListVaultCredentialsError = ListVaultCredentialsErrors[keyof ListVaultCredentialsErrors];
export type ListVaultCredentialsResponses = {
    /**
     * Credential list
     */
    200: VaultCredentialListResponse;
};
export type ListVaultCredentialsResponse = ListVaultCredentialsResponses[keyof ListVaultCredentialsResponses];
export type CreateVaultCredentialData = {
    body: CreateVaultCredentialRequest;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path: {
        vaultId: string;
    };
    query?: never;
    url: '/api/v1/vaults/{vaultId}/credentials';
};
export type CreateVaultCredentialErrors = {
    /**
     * Validation error
     */
    400: ErrorResponse;
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * Vault not found
     */
    404: ErrorResponse;
    /**
     * Vault unavailable
     */
    409: ErrorResponse;
};
export type CreateVaultCredentialError = CreateVaultCredentialErrors[keyof CreateVaultCredentialErrors];
export type CreateVaultCredentialResponses = {
    /**
     * Created credential
     */
    201: VaultCredential;
};
export type CreateVaultCredentialResponse = CreateVaultCredentialResponses[keyof CreateVaultCredentialResponses];
export type ReadVaultCredentialData = {
    body?: never;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path: {
        vaultId: string;
        credentialId: string;
    };
    query?: never;
    url: '/api/v1/vaults/{vaultId}/credentials/{credentialId}';
};
export type ReadVaultCredentialErrors = {
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * Credential not found
     */
    404: ErrorResponse;
};
export type ReadVaultCredentialError = ReadVaultCredentialErrors[keyof ReadVaultCredentialErrors];
export type ReadVaultCredentialResponses = {
    /**
     * Credential
     */
    200: VaultCredential;
};
export type ReadVaultCredentialResponse = ReadVaultCredentialResponses[keyof ReadVaultCredentialResponses];
export type UpdateVaultCredentialData = {
    body: UpdateVaultCredentialRequest;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path: {
        vaultId: string;
        credentialId: string;
    };
    query?: never;
    url: '/api/v1/vaults/{vaultId}/credentials/{credentialId}';
};
export type UpdateVaultCredentialErrors = {
    /**
     * Validation error
     */
    400: ErrorResponse;
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * Credential not found
     */
    404: ErrorResponse;
};
export type UpdateVaultCredentialError = UpdateVaultCredentialErrors[keyof UpdateVaultCredentialErrors];
export type UpdateVaultCredentialResponses = {
    /**
     * Updated credential
     */
    200: VaultCredential;
};
export type UpdateVaultCredentialResponse = UpdateVaultCredentialResponses[keyof UpdateVaultCredentialResponses];
export type UpdateVaultCredentialSecretData = {
    body: UpdateVaultCredentialSecretRequest;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path: {
        vaultId: string;
        credentialId: string;
    };
    query?: never;
    url: '/api/v1/vaults/{vaultId}/credentials/{credentialId}';
};
export type UpdateVaultCredentialSecretErrors = {
    /**
     * Validation error
     */
    400: ErrorResponse;
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * Credential not found
     */
    404: ErrorResponse;
    /**
     * Credential unavailable
     */
    409: ErrorResponse;
};
export type UpdateVaultCredentialSecretError = UpdateVaultCredentialSecretErrors[keyof UpdateVaultCredentialSecretErrors];
export type UpdateVaultCredentialSecretResponses = {
    /**
     * Updated credential
     */
    200: VaultCredential;
};
export type UpdateVaultCredentialSecretResponse = UpdateVaultCredentialSecretResponses[keyof UpdateVaultCredentialSecretResponses];
export type ListVaultCredentialVersionsData = {
    body?: never;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path: {
        vaultId: string;
        credentialId: string;
    };
    query?: {
        createdFrom?: string;
        createdTo?: string;
        limit?: number;
        cursor?: string;
        state?: 'active' | 'superseded' | 'revoked';
    };
    url: '/api/v1/vaults/{vaultId}/credentials/{credentialId}/versions';
};
export type ListVaultCredentialVersionsErrors = {
    /**
     * Validation error
     */
    400: ErrorResponse;
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * Credential not found
     */
    404: ErrorResponse;
};
export type ListVaultCredentialVersionsError = ListVaultCredentialVersionsErrors[keyof ListVaultCredentialVersionsErrors];
export type ListVaultCredentialVersionsResponses = {
    /**
     * Credential versions
     */
    200: VaultCredentialVersionListResponse;
};
export type ListVaultCredentialVersionsResponse = ListVaultCredentialVersionsResponses[keyof ListVaultCredentialVersionsResponses];
export type ReadVaultCredentialVersionData = {
    body?: never;
    headers?: {
        /**
         * Selects an Enbor project in the authenticated organization. Omit to use the default project.
         */
        'X-Enbor-Project-ID'?: string;
    };
    path: {
        vaultId: string;
        credentialId: string;
        versionId: string;
    };
    query?: never;
    url: '/api/v1/vaults/{vaultId}/credentials/{credentialId}/versions/{versionId}';
};
export type ReadVaultCredentialVersionErrors = {
    /**
     * Authentication required
     */
    401: ErrorResponse;
    /**
     * The Realmroot token lacks the scope required for this resource
     */
    403: ErrorResponse;
    /**
     * Credential version not found
     */
    404: ErrorResponse;
};
export type ReadVaultCredentialVersionError = ReadVaultCredentialVersionErrors[keyof ReadVaultCredentialVersionErrors];
export type ReadVaultCredentialVersionResponses = {
    /**
     * Credential version
     */
    200: VaultCredentialVersion;
};
export type ReadVaultCredentialVersionResponse = ReadVaultCredentialVersionResponses[keyof ReadVaultCredentialVersionResponses];
