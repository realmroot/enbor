// Pure governance policy rules. Zero outward imports — directly unit-testable.
//
// Two concerns live here: hierarchy merge (org → team → project policy objects
// combine with most-restrictive semantics) and the field-level validation rules
// for policy/budget scopes. The DB-mixed evaluation (provider decisions,
// effective-policy resolution) stays in server/policy.ts, which reuses
// mergePolicyObjects from here.

export type FieldErrors = Record<string, string>

export type PolicyScopeLevel = 'organization' | 'team' | 'project'
export type BudgetScope = 'project' | 'provider' | 'model'

// A policy decision: the verdict the policy engine returns to a runtime seam.
// Pure data — the DB-reading orchestration in server/policy.ts builds it from
// these rules.
export interface PolicyDecision {
  allowed: boolean
  category: string
  rule: string | null
  message: string
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function stringRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function includesWildcard(values: string[], candidate: string) {
  return values.includes('*') || values.includes(candidate)
}

function agentToolNameForMcp(connectorId: string, toolName: string) {
  return `mcp__${toolNamePart(connectorId)}__${toolNamePart(toolName)}`
}

function mcpConnectorToolWildcard(connectorId: string) {
  return `mcp__${toolNamePart(connectorId)}__*`
}

function toolNamePart(value: string) {
  return value
    .trim()
    .replaceAll(/[^A-Za-z0-9_-]+/g, '_')
    .replaceAll(/^_+|_+$/g, '')
}

export function parsePolicyJson<T>(value: string | null | undefined, fallback: T) {
  return value ? (JSON.parse(value) as T) : fallback
}

export function currentMonthPrefix() {
  return new Date().toISOString().slice(0, 7)
}

// ─── Policy hierarchy merge ───────────────────────────────────────────────────

const RESTRICTIVE_NETWORK_VALUES = new Set(['disabled', 'deny', 'offline'])

function isAllowListKey(key: string) {
  return key.startsWith('allowed')
}

function isUnionListKey(key: string) {
  return key.startsWith('blocked') || key.startsWith('denied') || key.startsWith('requireApproval')
}

function intersectAllowLists(current: string[], next: string[]) {
  if (current.includes('*')) {
    return next
  }
  if (next.includes('*')) {
    return current
  }
  return current.filter((item) => next.includes(item))
}

// Merges one policy object (toolPolicy/mcpPolicy/sandboxPolicy/budgetPolicy)
// across hierarchy levels ordered organization → team → project:
// blocked/denied/requireApproval lists union, allow lists intersect ('*' is
// identity), defaultEffect 'deny' is sticky, booleans AND (false is sticky),
// restrictive network/status strings are sticky, numbers take the minimum,
// nested objects shallow-merge with the most specific level last, and any
// other scalar takes the most specific level's value.
export function mergePolicyObjects(levels: Record<string, unknown>[]) {
  const merged: Record<string, unknown> = {}
  for (const level of levels) {
    for (const [key, value] of Object.entries(level)) {
      if (!(key in merged)) {
        merged[key] = value
        continue
      }
      const current = merged[key]
      if (Array.isArray(current) && Array.isArray(value)) {
        if (isUnionListKey(key)) {
          merged[key] = [...new Set([...stringArray(current), ...stringArray(value)])]
          continue
        }
        if (isAllowListKey(key)) {
          merged[key] = intersectAllowLists(stringArray(current), stringArray(value))
          continue
        }
        merged[key] = value
        continue
      }
      if (key === 'defaultEffect') {
        merged[key] = current === 'deny' || value === 'deny' ? 'deny' : value
        continue
      }
      if (typeof current === 'boolean' && typeof value === 'boolean') {
        merged[key] = current && value
        continue
      }
      if (typeof current === 'number' && typeof value === 'number') {
        merged[key] = Math.min(current, value)
        continue
      }
      if (typeof current === 'string' && RESTRICTIVE_NETWORK_VALUES.has(current)) {
        continue
      }
      if (current && value && typeof current === 'object' && typeof value === 'object' && !Array.isArray(value)) {
        merged[key] = { ...(current as Record<string, unknown>), ...(value as Record<string, unknown>) }
        continue
      }
      merged[key] = value
    }
  }
  return merged
}

// ─── Scope validation rules ───────────────────────────────────────────────────

// Team-scoped policies require a teamId; org/project scopes must not carry one.
export function validatePolicyScope(scope: { level: PolicyScopeLevel; teamId?: string }): FieldErrors | null {
  const fields: FieldErrors = {}
  if (scope.level === 'team' && !scope.teamId) {
    fields['scope.teamId'] = 'Team-scoped policies require teamId.'
  }
  if (scope.level !== 'team' && scope.teamId) {
    fields['scope.teamId'] = 'teamId is only valid for team-scoped policies.'
  }
  return Object.keys(fields).length > 0 ? fields : null
}

// Scope is the row identity and may not move after creation.
export function policyScopeChanged(
  next: { level: PolicyScopeLevel; teamId?: string },
  current: { level: PolicyScopeLevel; teamId: string | null },
) {
  return next.level !== current.level || (next.teamId ?? null) !== current.teamId
}

// Provider/model-scoped budgets need the matching identifier.
export function validateBudgetScope(input: {
  scope: BudgetScope
  providerId?: string
  modelId?: string
}): FieldErrors | null {
  const fields: FieldErrors = {}
  if (input.scope === 'provider' && !input.providerId) {
    fields.providerId = 'Provider-scoped budgets require providerId.'
  }
  if (input.scope === 'model' && !input.modelId) {
    fields.modelId = 'Model-scoped budgets require modelId.'
  }
  return Object.keys(fields).length > 0 ? fields : null
}

// ─── Sandbox runtime tool mapping ─────────────────────────────────────────────

function hostFromUrl(value: unknown) {
  if (typeof value !== 'string') {
    return null
  }
  try {
    return new URL(value).hostname || null
  } catch {
    return null
  }
}

export type SandboxRuntimeOperation =
  | { operation: 'command'; command: string | null; resourceType: 'sandbox_command'; resourceId: string }
  | { operation: 'network'; host: string | null; resourceType: 'sandbox_network'; resourceId: string }

// Maps an agent-level tool invocation to the sandbox policy operation it
// performs. bash runs a workspace command; fetch and web_search perform
// outbound network from the sandbox.
export function sandboxOperationForRuntimeTool(
  toolName: string,
  input: Record<string, unknown>,
): SandboxRuntimeOperation | null {
  if (toolName === 'bash') {
    const command = typeof input.command === 'string' ? input.command : null
    return {
      operation: 'command',
      command,
      resourceType: 'sandbox_command',
      resourceId: command?.trim().split(/\s+/)[0] ?? toolName,
    }
  }
  if (toolName === 'fetch') {
    const host = typeof input.host === 'string' ? input.host : hostFromUrl(input.url)
    return { operation: 'network', host, resourceType: 'sandbox_network', resourceId: host ?? toolName }
  }
  if (toolName === 'web_search') {
    const host = 'lite.duckduckgo.com'
    return { operation: 'network', host, resourceType: 'sandbox_network', resourceId: host }
  }
  return null
}

// ─── Effective-policy hierarchy resolution ────────────────────────────────────

export interface PolicyLevel {
  id: string
  scope: PolicyScopeLevel
  teamId: string | null
  toolPolicy: string
  mcpPolicy: string
  sandboxPolicy: string
  updatedAt: string
}

export interface EffectivePolicySource {
  scope: PolicyScopeLevel
  id: string
  teamId: string | null
}

export interface EffectivePolicy {
  source: { type: string; id: string }
  sources: EffectivePolicySource[]
  toolPolicy: Record<string, unknown>
  mcpPolicy: Record<string, unknown>
  sandboxPolicy: Record<string, unknown>
}

// Picks the applicable hierarchy rows from the candidate policy rows ordered
// most-recent-first: every organization-scope row for the caller's org, the
// team-scope rows whose teamId is in the caller's OIDC memberships, and the
// project-scope row. One row per scope/team (latest updatedAt wins) keeps the
// merge deterministic. Returns levels ordered organization → teams → project.
export function applicablePolicyLevels(rows: PolicyLevel[], memberTeams: string[]) {
  const ordered = [...rows].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  const byKey = new Map<string, PolicyLevel>()
  for (const row of ordered) {
    if (row.scope === 'team' && (!row.teamId || !memberTeams.includes(row.teamId))) {
      continue
    }
    const key = `${row.scope}:${row.teamId ?? ''}`
    if (!byKey.has(key)) {
      byKey.set(key, row)
    }
  }
  const organization = byKey.get('organization:') ?? null
  const teams = [...byKey.values()]
    .filter((row) => row.scope === 'team')
    .sort((left, right) => (left.teamId ?? '').localeCompare(right.teamId ?? ''))
  const project = byKey.get('project:') ?? null
  return [organization, ...teams, project].filter((row): row is PolicyLevel => row !== null)
}

// Builds the merged effective governance policy from the ordered hierarchy
// levels. Budgets live only in the budgets table.
export function effectivePolicyFrom(levels: PolicyLevel[]): EffectivePolicy {
  const sources: EffectivePolicySource[] = levels.map((row) => ({ scope: row.scope, id: row.id, teamId: row.teamId }))
  const mostSpecific = levels.at(-1)
  return {
    source: mostSpecific
      ? { type: mostSpecific.scope, id: mostSpecific.id }
      : { type: 'platform_default', id: 'workers-ai-default' },
    sources,
    toolPolicy: mergePolicyObjects(levels.map((row) => parsePolicyJson<Record<string, unknown>>(row.toolPolicy, {}))),
    mcpPolicy: mergePolicyObjects(levels.map((row) => parsePolicyJson<Record<string, unknown>>(row.mcpPolicy, {}))),
    sandboxPolicy: mergePolicyObjects(
      levels.map((row) => parsePolicyJson<Record<string, unknown>>(row.sandboxPolicy, {})),
    ),
  }
}

// ─── Budget decision ──────────────────────────────────────────────────────────

export interface BudgetUsageRecord {
  createdAt: string
  costMicros: number
  totalTokens: number
  sessionId: string | null
}

export interface BudgetRule {
  id: string
  providerId: string | null
  modelId: string | null
  limitType: string
  limitValue: number
  window: string
}

// Evaluates the active budgets for a provider/model against the project's
// successful usage records. Returns a denial when a matching budget window is
// exhausted. usage is the full successful-usage set; the matching window is
// filtered by createdAt prefix here.
export function evaluateBudgets(
  budgets: BudgetRule[],
  usage: BudgetUsageRecord[],
  values: { providerId: string; providerRowId: string | null; modelId: string | null },
): PolicyDecision | null {
  const month = currentMonthPrefix()
  const day = new Date().toISOString().slice(0, 10)
  for (const budget of budgets) {
    if (budget.providerId && budget.providerId !== values.providerId && budget.providerId !== values.providerRowId) {
      continue
    }
    if (budget.modelId && (values.modelId === null || budget.modelId !== values.modelId)) {
      continue
    }
    const windowPrefix = budget.window === 'day' ? day : month
    const windowUsage = usage.filter((record) => record.createdAt.startsWith(windowPrefix))
    const consumed =
      budget.limitType === 'cost_micros'
        ? windowUsage.reduce((sum, record) => sum + record.costMicros, 0)
        : budget.limitType === 'sessions'
          ? new Set(windowUsage.map((record) => record.sessionId).filter(Boolean)).size
          : windowUsage.reduce((sum, record) => sum + record.totalTokens, 0)
    if (consumed >= budget.limitValue) {
      return {
        allowed: false,
        category: 'budget',
        rule: budget.id,
        message: `Usage budget is exhausted: the ${budget.window} ${budget.limitType} limit of ${budget.limitValue} is spent.`,
      }
    }
  }
  return null
}

// Roles allowed to override a provider-access denial. Override must be an
// explicit per-request flag; it is never implied by the role alone.
const PROVIDER_OVERRIDE_ROLES = new Set(['admin', 'owner'])

export function canOverrideProviderPolicy(roles: string[]) {
  return roles.some((role) => PROVIDER_OVERRIDE_ROLES.has(role))
}

// ─── MCP connector/tool decision ──────────────────────────────────────────────

export function policyBlocksConnector(mcpPolicy: Record<string, unknown>, connectorId: string): PolicyDecision | null {
  const blockedConnectors = stringArray(mcpPolicy.blockedConnectors)
  if (includesWildcard(blockedConnectors, connectorId)) {
    return {
      allowed: false,
      category: 'mcp',
      rule: 'mcpPolicy.blockedConnectors',
      message: 'MCP connector is blocked by governance policy.',
    }
  }

  const allowedConnectors = stringArray(mcpPolicy.allowedConnectors)
  if (allowedConnectors.length > 0 && !includesWildcard(allowedConnectors, connectorId)) {
    return {
      allowed: false,
      category: 'mcp',
      rule: 'mcpPolicy.allowedConnectors',
      message: 'MCP connector is not allowed by governance policy.',
    }
  }

  if (mcpPolicy.defaultEffect === 'deny') {
    return {
      allowed: false,
      category: 'mcp',
      rule: 'mcpPolicy.defaultEffect',
      message: 'MCP connector is denied by default governance policy.',
    }
  }

  return null
}

export function policyBlocksTool(toolPolicy: Record<string, unknown>, toolName: string): PolicyDecision | null {
  if (includesWildcard(stringArray(toolPolicy.blockedTools), toolName)) {
    return {
      allowed: false,
      category: 'tool',
      rule: 'toolPolicy.blockedTools',
      message: 'Tool is blocked by governance policy.',
    }
  }

  const allowedTools = stringArray(toolPolicy.allowedTools)
  if (allowedTools.length > 0 && !includesWildcard(allowedTools, toolName)) {
    return {
      allowed: false,
      category: 'tool',
      rule: 'toolPolicy.allowedTools',
      message: 'Tool is not allowed by governance policy.',
    }
  }

  if (toolPolicy.defaultEffect === 'deny') {
    return {
      allowed: false,
      category: 'tool',
      rule: 'toolPolicy.defaultEffect',
      message: 'Tool is denied by default governance policy.',
    }
  }

  return null
}

export function policyRequiresApproval(mcpPolicy: Record<string, unknown>, connectorId: string, toolName: string) {
  const approvalModes = stringRecord(mcpPolicy.connectorApprovalModes)
  const approvalMode = approvalModes[connectorId] ?? approvalModes['*']
  return (
    approvalMode === 'require_approval' ||
    includesWildcard(stringArray(mcpPolicy.requireApprovalConnectors), connectorId) ||
    includesWildcard(stringArray(mcpPolicy.requireApprovalTools), toolName)
  )
}

export function toolPolicyRequiresApproval(toolPolicy: Record<string, unknown>, toolName: string) {
  return includesWildcard(stringArray(toolPolicy.requireApprovalTools), toolName)
}

// Agent tool attachments ({ name, ... } objects) are the only tool source;
// the snapshot's tool names gate MCP tool access.
function agentToolNames(value: unknown) {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .map((entry) =>
      typeof entry === 'string'
        ? entry
        : entry && typeof entry === 'object' && typeof (entry as { name?: unknown }).name === 'string'
          ? (entry as { name: string }).name
          : null,
    )
    .filter((name): name is string => name !== null)
}

export function sessionAllowsTool(
  session: { agentSnapshot: string | null } | null,
  connectorId: string,
  toolName: string,
) {
  if (!session?.agentSnapshot) {
    return true
  }

  const snapshot = parsePolicyJson<{ tools?: unknown }>(session.agentSnapshot, {})
  const toolNames = agentToolNames(snapshot.tools)
  if (toolNames.length === 0) {
    return false
  }

  return (
    includesWildcard(toolNames, toolName) ||
    includesWildcard(toolNames, mcpConnectorToolWildcard(connectorId)) ||
    includesWildcard(toolNames, agentToolNameForMcp(connectorId, toolName))
  )
}

export function environmentAllowsConnector(session: { environmentSnapshot: string | null } | null) {
  if (!session?.environmentSnapshot) {
    return true
  }

  const snapshot = parsePolicyJson<{ networking?: unknown }>(session.environmentSnapshot, {})
  const networking = stringRecord(snapshot.networking)
  return networking.allowMcpServers !== false
}

// ─── Sandbox runtime decision ─────────────────────────────────────────────────

function normalizeHost(value: string) {
  const trimmed = value.trim().toLowerCase()
  try {
    return new URL(trimmed).hostname
  } catch {
    return trimmed.split(':')[0] ?? trimmed
  }
}

function hostAllowed(allowedHosts: string[], host: string | null | undefined) {
  if (!host) {
    return false
  }
  const normalizedHost = normalizeHost(host)
  return allowedHosts.map(normalizeHost).some((allowedHost) => allowedHost === '*' || allowedHost === normalizedHost)
}

function environmentNetworkMode(networking: Record<string, unknown>) {
  return networking.type === 'limited' || networking.type === 'closed' ? networking.type : 'open'
}

function commandMatches(pattern: string, command: string) {
  const normalizedPattern = pattern.trim()
  const normalizedCommand = command.trim()
  return (
    normalizedPattern === normalizedCommand ||
    normalizedCommand === normalizedPattern ||
    normalizedCommand.startsWith(`${normalizedPattern} `)
  )
}

function commandMatchesAny(patterns: string[], command: string) {
  return patterns.includes('*') || patterns.some((pattern) => commandMatches(pattern, command))
}

function mergedSandboxPolicy(
  effectivePolicy: Record<string, unknown>,
  session: { environmentSnapshot: string | null } | null,
) {
  const environmentSnapshot = session?.environmentSnapshot
    ? parsePolicyJson<{ networking?: unknown }>(session.environmentSnapshot, {})
    : {}
  return {
    governance: effectivePolicy,
    environmentNetwork: stringRecord(environmentSnapshot.networking),
  }
}

// Decides a sandbox runtime operation (startup/command/network) against the
// merged governance sandbox policy and the session environment network policy.
export function evaluateSandboxRuntimeDecision(
  sandboxPolicy: Record<string, unknown>,
  session: { environmentSnapshot: string | null } | null,
  values: {
    operation: 'startup' | 'command' | 'network'
    command?: string | null | undefined
    host?: string | null | undefined
  },
): PolicyDecision {
  const policies = mergedSandboxPolicy(sandboxPolicy, session)

  if (policies.governance.enabled === false || policies.governance.status === 'disabled') {
    return {
      allowed: false,
      category: 'sandbox',
      rule: 'sandboxPolicy.enabled',
      message: 'Sandbox runtime is disabled by governance policy.',
    }
  }

  if (values.operation === 'network') {
    const environmentMode = environmentNetworkMode(policies.environmentNetwork)
    const networkPolicies = [policies.governance.network, environmentMode]
    if (
      networkPolicies.some(
        (network) =>
          network === 'disabled' ||
          network === 'deny' ||
          network === 'offline' ||
          network === 'closed' ||
          network === false,
      )
    ) {
      return {
        allowed: false,
        category: 'sandbox_network',
        rule: 'sandboxPolicy.network',
        message: 'Sandbox network access is disabled by policy.',
      }
    }

    const governanceAllowedHosts = stringArray(policies.governance.allowedHosts)
    if (governanceAllowedHosts.length > 0 && !hostAllowed(governanceAllowedHosts, values.host)) {
      return {
        allowed: false,
        category: 'sandbox_network',
        rule: 'sandboxPolicy.allowedHosts',
        message: 'Sandbox network host is not allowed by policy.',
      }
    }

    const environmentAllowedHosts = stringArray(policies.environmentNetwork.allowedHosts)
    if (environmentMode === 'limited' && !hostAllowed(environmentAllowedHosts, values.host)) {
      return {
        allowed: false,
        category: 'sandbox_network',
        rule: 'environment.networking.allowedHosts',
        message: 'Sandbox network host is not allowed by policy.',
      }
    }
  }

  if (values.operation === 'command') {
    const blockedCommands = stringArray(policies.governance.blockedCommands)
    const allowedCommands = stringArray(policies.governance.allowedCommands)
    if (!values.command && (blockedCommands.length > 0 || allowedCommands.length > 0)) {
      return {
        allowed: false,
        category: 'sandbox_command',
        rule: allowedCommands.length > 0 ? 'sandboxPolicy.allowedCommands' : 'sandboxPolicy.blockedCommands',
        message: 'Sandbox command is not allowed by policy.',
      }
    }
    if (values.command && commandMatchesAny(blockedCommands, values.command)) {
      return {
        allowed: false,
        category: 'sandbox_command',
        rule: 'sandboxPolicy.blockedCommands',
        message: 'Sandbox command is blocked by policy.',
      }
    }

    if (values.command && allowedCommands.length > 0 && !commandMatchesAny(allowedCommands, values.command)) {
      return {
        allowed: false,
        category: 'sandbox_command',
        rule: 'sandboxPolicy.allowedCommands',
        message: 'Sandbox command is not allowed by policy.',
      }
    }
  }

  return { allowed: true, category: 'sandbox', rule: null, message: 'Allowed by sandbox policy.' }
}

// ─── Platform budget ─────────────────────────────────────────────────────────

// Operator-set daily ceilings on hosted model spend, in cost micros. They bound
// what every tenant together, and each organization alone, can spend per UTC day
// on the platform's own model capacity, independent of project-owned budgets.
export interface PlatformBudgetLimits {
  dailyCostMicros: number | null
  organizationDailyCostMicros: number | null
}

export interface PlatformBudgetUsage {
  platformCostMicros: number
  organizationCostMicros: number
}

// An unset limit is unlimited. A set limit must be a non-negative integer, so a
// typo fails loudly instead of silently lifting the ceiling.
export function parsePlatformBudgetLimit(name: string, value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') {
    return null
  }
  const limit = Number(value)
  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new Error(`${name} must be a non-negative integer number of cost micros`)
  }
  return limit
}

export function platformBudgetDayStart(at: Date): string {
  return `${at.toISOString().slice(0, 10)}T00:00:00.000Z`
}

export function evaluatePlatformBudget(
  limits: PlatformBudgetLimits,
  usage: PlatformBudgetUsage,
): PolicyDecision | null {
  if (limits.dailyCostMicros !== null && usage.platformCostMicros >= limits.dailyCostMicros) {
    return {
      allowed: false,
      category: 'budget',
      rule: 'platform-daily',
      message: 'The platform daily model budget is spent; hosted model work resumes at 00:00 UTC.',
    }
  }
  if (
    limits.organizationDailyCostMicros !== null &&
    usage.organizationCostMicros >= limits.organizationDailyCostMicros
  ) {
    return {
      allowed: false,
      category: 'budget',
      rule: 'organization-daily',
      message: 'This organization has spent its daily hosted model budget; it resumes at 00:00 UTC.',
    }
  }
  return null
}
