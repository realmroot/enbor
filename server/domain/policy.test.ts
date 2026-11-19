import { describe, expect, it } from 'vitest'
import {
  applicablePolicyLevels,
  canOverrideProviderPolicy,
  effectivePolicyFrom,
  environmentAllowsConnector,
  evaluateBudgets,
  evaluatePlatformBudget,
  evaluateSandboxRuntimeDecision,
  mergePolicyObjects,
  type PolicyLevel,
  parsePlatformBudgetLimit,
  parsePolicyJson,
  platformBudgetDayStart,
  policyBlocksConnector,
  policyBlocksTool,
  policyRequiresApproval,
  policyScopeChanged,
  type SandboxRuntimeOperation,
  sandboxOperationForRuntimeTool,
  sessionAllowsTool,
  toolPolicyRequiresApproval,
  validateBudgetScope,
  validatePolicyScope,
} from './policy'

type NetworkOp = Extract<SandboxRuntimeOperation, { operation: 'network' }>
type CommandOp = Extract<SandboxRuntimeOperation, { operation: 'command' }>

describe('mergePolicyObjects', () => {
  it('unions blocked/denied/requireApproval lists across levels', () => {
    const merged = mergePolicyObjects([{ blockedTools: ['a'] }, { blockedTools: ['b'] }, { blockedTools: ['a', 'c'] }])
    expect(merged.blockedTools).toEqual(['a', 'b', 'c'])
  })

  it('intersects allow lists, with * as identity', () => {
    expect(mergePolicyObjects([{ allowedTools: ['*'] }, { allowedTools: ['a', 'b'] }]).allowedTools).toEqual(['a', 'b'])
    expect(mergePolicyObjects([{ allowedTools: ['a', 'b'] }, { allowedTools: ['b', 'c'] }]).allowedTools).toEqual(['b'])
  })

  it('makes defaultEffect deny sticky', () => {
    expect(mergePolicyObjects([{ defaultEffect: 'deny' }, { defaultEffect: 'allow' }]).defaultEffect).toBe('deny')
    expect(mergePolicyObjects([{ defaultEffect: 'allow' }, { defaultEffect: 'deny' }]).defaultEffect).toBe('deny')
  })

  it('ANDs booleans (false sticky) and takes the minimum number', () => {
    expect(mergePolicyObjects([{ enabled: true }, { enabled: false }]).enabled).toBe(false)
    expect(mergePolicyObjects([{ limit: 10 }, { limit: 3 }, { limit: 7 }]).limit).toBe(3)
  })

  it('keeps a restrictive network string sticky against a later relaxed value', () => {
    expect(mergePolicyObjects([{ network: 'offline' }, { network: 'unrestricted' }]).network).toBe('offline')
  })

  it('shallow-merges nested objects with the most specific level last', () => {
    const merged = mergePolicyObjects([{ approvals: { a: 1, b: 1 } }, { approvals: { b: 2, c: 2 } }])
    expect(merged.approvals).toEqual({ a: 1, b: 2, c: 2 })
  })

  it('takes the most specific scalar for unrelated keys', () => {
    expect(mergePolicyObjects([{ mode: 'a' }, { mode: 'b' }]).mode).toBe('b')
  })
})

describe('validatePolicyScope', () => {
  it('requires teamId for team scope', () => {
    expect(validatePolicyScope({ level: 'team' })).toEqual({ 'scope.teamId': expect.any(String) })
    expect(validatePolicyScope({ level: 'team', teamId: 't1' })).toBeNull()
  })

  it('rejects teamId on non-team scopes', () => {
    expect(validatePolicyScope({ level: 'project', teamId: 't1' })).toEqual({ 'scope.teamId': expect.any(String) })
    expect(validatePolicyScope({ level: 'project' })).toBeNull()
  })
})

describe('policyScopeChanged', () => {
  it('detects level and teamId changes', () => {
    expect(policyScopeChanged({ level: 'project' }, { level: 'project', teamId: null })).toBe(false)
    expect(policyScopeChanged({ level: 'organization' }, { level: 'project', teamId: null })).toBe(true)
    expect(policyScopeChanged({ level: 'team', teamId: 't2' }, { level: 'team', teamId: 't1' })).toBe(true)
  })
})

describe('validateBudgetScope', () => {
  it('requires the matching identifier for provider/model scopes', () => {
    expect(validateBudgetScope({ scope: 'provider' })).toEqual({ providerId: expect.any(String) })
    expect(validateBudgetScope({ scope: 'model' })).toEqual({ modelId: expect.any(String) })
    expect(validateBudgetScope({ scope: 'provider', providerId: 'p1' })).toBeNull()
    expect(validateBudgetScope({ scope: 'project' })).toBeNull()
  })
})

function policyLevel(overrides: Partial<PolicyLevel> & Pick<PolicyLevel, 'id' | 'scope' | 'updatedAt'>): PolicyLevel {
  return {
    teamId: null,
    toolPolicy: '{}',
    mcpPolicy: '{}',
    sandboxPolicy: '{}',
    ...overrides,
  }
}

describe('[spec: governance/policy-hierarchy] applicablePolicyLevels', () => {
  it('orders org → teams → project and keeps the latest row per scope/team', () => {
    const rows: PolicyLevel[] = [
      policyLevel({ id: 'org_old', scope: 'organization', updatedAt: '2026-01-01' }),
      policyLevel({ id: 'org_new', scope: 'organization', updatedAt: '2026-02-01' }),
      policyLevel({ id: 'team_a', scope: 'team', teamId: 'team_a', updatedAt: '2026-01-10' }),
      policyLevel({ id: 'proj', scope: 'project', updatedAt: '2026-01-05' }),
    ]
    const levels = applicablePolicyLevels(rows, ['team_a'])
    expect(levels.map((level) => level.id)).toEqual(['org_new', 'team_a', 'proj'])
  })

  it('drops team rows whose teamId is not in the caller memberships', () => {
    const rows: PolicyLevel[] = [
      policyLevel({ id: 'team_a', scope: 'team', teamId: 'team_a', updatedAt: '2026-01-01' }),
      policyLevel({ id: 'team_b', scope: 'team', teamId: 'team_b', updatedAt: '2026-01-01' }),
    ]
    expect(applicablePolicyLevels(rows, ['team_b']).map((level) => level.id)).toEqual(['team_b'])
    expect(applicablePolicyLevels(rows, [])).toEqual([])
  })
})

describe('[spec: governance/policy-hierarchy] effectivePolicyFrom', () => {
  it('reports the most specific level as the source and the platform default when empty', () => {
    expect(effectivePolicyFrom([]).source).toEqual({ type: 'platform_default', id: 'workers-ai-default' })
    const levels: PolicyLevel[] = [
      policyLevel({ id: 'org', scope: 'organization', updatedAt: '2026-01-01' }),
      policyLevel({ id: 'proj', scope: 'project', updatedAt: '2026-01-01' }),
    ]
    expect(effectivePolicyFrom(levels).source).toEqual({ type: 'project', id: 'proj' })
  })

  it('merges the policy objects across levels', () => {
    const levels: PolicyLevel[] = [
      policyLevel({ id: 'org', scope: 'organization', updatedAt: '2026-01-01', toolPolicy: '{"blockedTools":["a"]}' }),
      policyLevel({ id: 'proj', scope: 'project', updatedAt: '2026-01-01', toolPolicy: '{"blockedTools":["b"]}' }),
    ]
    const effective = effectivePolicyFrom(levels)
    expect(effective.toolPolicy.blockedTools).toEqual(['a', 'b'])
  })
})

describe('[spec: governance/model-budget] evaluateBudgets', () => {
  const month = new Date().toISOString().slice(0, 7)

  it('denies when a matching budget window is exhausted', () => {
    const budgets = [
      { id: 'b', providerId: null, modelId: null, limitType: 'tokens', limitValue: 100, window: 'month' },
    ]
    const usage = [{ createdAt: `${month}-01T00:00:00.000Z`, costMicros: 0, totalTokens: 150, sessionId: 's1' }]
    expect(evaluateBudgets(budgets, usage, { providerId: 'p', providerRowId: null, modelId: 'm' })?.category).toBe(
      'budget',
    )
  })

  it('skips budgets scoped to a different provider/model', () => {
    const budgets = [
      { id: 'b', providerId: 'other', modelId: null, limitType: 'tokens', limitValue: 1, window: 'month' },
    ]
    const usage = [{ createdAt: `${month}-01T00:00:00.000Z`, costMicros: 0, totalTokens: 9999, sessionId: 's1' }]
    expect(evaluateBudgets(budgets, usage, { providerId: 'p', providerRowId: null, modelId: 'm' })).toBeNull()
  })
})

describe('canOverrideProviderPolicy', () => {
  it('allows only admin/owner roles', () => {
    expect(canOverrideProviderPolicy(['admin'])).toBe(true)
    expect(canOverrideProviderPolicy(['owner'])).toBe(true)
    expect(canOverrideProviderPolicy(['member'])).toBe(false)
    expect(canOverrideProviderPolicy([])).toBe(false)
  })
})

describe('mcp connector/tool rules', () => {
  it('blocks connectors by block list, allow list, and default deny', () => {
    expect(policyBlocksConnector({ blockedConnectors: ['c'] }, 'c')?.rule).toBe('mcpPolicy.blockedConnectors')
    expect(policyBlocksConnector({ allowedConnectors: ['other'] }, 'c')?.rule).toBe('mcpPolicy.allowedConnectors')
    expect(policyBlocksConnector({ defaultEffect: 'deny' }, 'c')?.rule).toBe('mcpPolicy.defaultEffect')
    expect(policyBlocksConnector({ allowedConnectors: ['c'] }, 'c')).toBeNull()
  })

  it('blocks tools symmetrically', () => {
    expect(policyBlocksTool({ blockedTools: ['t'] }, 't')?.rule).toBe('toolPolicy.blockedTools')
    expect(policyBlocksTool({ allowedTools: ['*'] }, 't')).toBeNull()
  })

  it('detects approval requirements from mode, connector, and tool lists', () => {
    expect(policyRequiresApproval({ connectorApprovalModes: { c: 'require_approval' } }, 'c', 't')).toBe(true)
    expect(policyRequiresApproval({ requireApprovalTools: ['t'] }, 'c', 't')).toBe(true)
    expect(policyRequiresApproval({}, 'c', 't')).toBe(false)
    expect(toolPolicyRequiresApproval({ requireApprovalTools: ['*'] }, 't')).toBe(true)
  })
})

describe('session/environment tool gating', () => {
  it('allows when no agent snapshot and gates by snapshot tool names', () => {
    expect(sessionAllowsTool(null, 'c', 't')).toBe(true)
    expect(sessionAllowsTool({ agentSnapshot: '{"tools":[]}' }, 'c', 't')).toBe(false)
    expect(sessionAllowsTool({ agentSnapshot: '{"tools":["mcp__c__*"]}' }, 'c', 't')).toBe(true)
    expect(sessionAllowsTool({ agentSnapshot: '{"tools":["mcp__c__t"]}' }, 'c', 't')).toBe(true)
  })

  it('gates connectors by the environment networking capability flag', () => {
    expect(environmentAllowsConnector(null)).toBe(true)
    expect(environmentAllowsConnector({ environmentSnapshot: '{"networking":{"allowMcpServers":false}}' })).toBe(false)
    expect(environmentAllowsConnector({ environmentSnapshot: '{"networking":{"allowMcpServers":true}}' })).toBe(true)
  })
})

describe('[spec: governance/sandbox-restrictions] sandboxOperationForRuntimeTool', () => {
  it('maps bash to a command op and fetch to a network op', () => {
    expect(sandboxOperationForRuntimeTool('bash', { command: 'ls -la' })).toEqual({
      operation: 'command',
      command: 'ls -la',
      resourceType: 'sandbox_command',
      resourceId: 'ls',
    })
    expect(sandboxOperationForRuntimeTool('fetch', { url: 'https://api.example.com/x' })).toEqual({
      operation: 'network',
      host: 'api.example.com',
      resourceType: 'sandbox_network',
      resourceId: 'api.example.com',
    })
    expect(sandboxOperationForRuntimeTool('web_search', { query: 'managed agents' })).toEqual({
      operation: 'network',
      host: 'lite.duckduckgo.com',
      resourceType: 'sandbox_network',
      resourceId: 'lite.duckduckgo.com',
    })
    expect(sandboxOperationForRuntimeTool('other.tool', {})).toBeNull()
  })
})

describe('[spec: governance/sandbox-restrictions] evaluateSandboxRuntimeDecision', () => {
  it('denies when sandbox is disabled', () => {
    expect(evaluateSandboxRuntimeDecision({ enabled: false }, null, { operation: 'command', command: 'ls' }).rule).toBe(
      'sandboxPolicy.enabled',
    )
  })

  it('denies when sandbox status is disabled', () => {
    expect(
      evaluateSandboxRuntimeDecision({ status: 'disabled' }, null, { operation: 'command', command: 'ls' }).rule,
    ).toBe('sandboxPolicy.enabled')
  })

  it('blocks network when governance network is off or host is not allowed', () => {
    expect(evaluateSandboxRuntimeDecision({ network: 'deny' }, null, { operation: 'network', host: 'x' }).rule).toBe(
      'sandboxPolicy.network',
    )
    expect(
      evaluateSandboxRuntimeDecision({ allowedHosts: ['ok.com'] }, null, { operation: 'network', host: 'bad.com' })
        .rule,
    ).toBe('sandboxPolicy.allowedHosts')
    expect(
      evaluateSandboxRuntimeDecision({ allowedHosts: ['ok.com'] }, null, { operation: 'network', host: 'ok.com' })
        .allowed,
    ).toBe(true)
  })

  it('blocks network when governance network is false', () => {
    expect(evaluateSandboxRuntimeDecision({ network: false }, null, { operation: 'network', host: 'x' }).rule).toBe(
      'sandboxPolicy.network',
    )
  })

  it('blocks network when governance network is offline', () => {
    expect(evaluateSandboxRuntimeDecision({ network: 'offline' }, null, { operation: 'network', host: 'x' }).rule).toBe(
      'sandboxPolicy.network',
    )
  })

  it('blocks network with wildcard allowed host that matches', () => {
    expect(
      evaluateSandboxRuntimeDecision({ allowedHosts: ['*'] }, null, { operation: 'network', host: 'any.com' }).allowed,
    ).toBe(true)
  })

  it('blocks commands by block list and gates by allow list', () => {
    expect(
      evaluateSandboxRuntimeDecision({ blockedCommands: ['rm'] }, null, { operation: 'command', command: 'rm -rf /' })
        .rule,
    ).toBe('sandboxPolicy.blockedCommands')
    expect(
      evaluateSandboxRuntimeDecision({ allowedCommands: ['ls'] }, null, { operation: 'command', command: 'cat x' })
        .rule,
    ).toBe('sandboxPolicy.allowedCommands')
    expect(
      evaluateSandboxRuntimeDecision({ allowedCommands: ['ls'] }, null, { operation: 'command', command: 'ls -la' })
        .allowed,
    ).toBe(true)
  })

  it('blocks a null command when command policies are present', () => {
    expect(
      evaluateSandboxRuntimeDecision({ blockedCommands: ['rm'] }, null, { operation: 'command', command: null }).rule,
    ).toBe('sandboxPolicy.blockedCommands')
  })

  it('blocks a null command when allowed command policy is present', () => {
    expect(
      evaluateSandboxRuntimeDecision({ allowedCommands: ['ls'] }, null, { operation: 'command', command: null }).rule,
    ).toBe('sandboxPolicy.allowedCommands')
  })

  it('allows a startup operation without restriction', () => {
    expect(evaluateSandboxRuntimeDecision({}, null, { operation: 'startup' }).allowed).toBe(true)
  })

  it('applies the session environment limited networking hosts', () => {
    const session = {
      environmentSnapshot:
        '{"networking":{"type":"limited","allowMcpServers":false,"allowPackageManagers":true,"allowedHosts":["ok.com"]}}',
    }
    expect(evaluateSandboxRuntimeDecision({}, session, { operation: 'network', host: 'bad.com' }).rule).toBe(
      'environment.networking.allowedHosts',
    )
    expect(evaluateSandboxRuntimeDecision({}, session, { operation: 'network', host: 'ok.com' }).allowed).toBe(true)
  })

  it('blocks network when environment networking is closed', () => {
    const session = {
      environmentSnapshot: '{"networking":{"type":"closed","allowMcpServers":false,"allowPackageManagers":false}}',
    }
    expect(evaluateSandboxRuntimeDecision({}, session, { operation: 'network', host: 'any.com' }).rule).toBe(
      'sandboxPolicy.network',
    )
  })

  it('blocks network when governance allowedHosts is set but host is null', () => {
    // host is null → hostAllowed returns false
    expect(
      evaluateSandboxRuntimeDecision({ allowedHosts: ['ok.com'] }, null, { operation: 'network', host: null }).rule,
    ).toBe('sandboxPolicy.allowedHosts')
  })

  it('blocks network when environment restricted and host is null', () => {
    const session = {
      environmentSnapshot:
        '{"networking":{"type":"limited","allowMcpServers":false,"allowPackageManagers":true,"allowedHosts":["ok.com"]}}',
    }
    expect(evaluateSandboxRuntimeDecision({}, session, { operation: 'network', host: null }).rule).toBe(
      'environment.networking.allowedHosts',
    )
  })

  it('normalizes host URLs when checking allowedHosts', () => {
    expect(
      evaluateSandboxRuntimeDecision({ allowedHosts: ['ok.com'] }, null, {
        operation: 'network',
        host: 'https://ok.com',
      }).allowed,
    ).toBe(true)
  })
})

describe('parsePolicyJson', () => {
  it('returns the fallback for falsy values', () => {
    expect(parsePolicyJson(null, {})).toEqual({})
    expect(parsePolicyJson(undefined, { default: true })).toEqual({ default: true })
    expect(parsePolicyJson('', { fallback: 1 })).toEqual({ fallback: 1 })
  })

  it('parses a valid JSON string', () => {
    expect(parsePolicyJson('{"key":"value"}', {})).toEqual({ key: 'value' })
  })
})

describe('mergePolicyObjects additional branches', () => {
  it('unions denied-prefix lists', () => {
    const merged = mergePolicyObjects([{ deniedProviders: ['a'] }, { deniedProviders: ['b'] }])
    expect(merged.deniedProviders).toContain('a')
    expect(merged.deniedProviders).toContain('b')
  })

  it('unions requireApproval-prefix lists', () => {
    const merged = mergePolicyObjects([{ requireApprovalConnectors: ['a'] }, { requireApprovalConnectors: ['b'] }])
    expect(merged.requireApprovalConnectors).toContain('a')
    expect(merged.requireApprovalConnectors).toContain('b')
  })

  it('replaces non-union non-allow arrays with the later value', () => {
    const merged = mergePolicyObjects([{ items: ['a'] }, { items: ['b'] }])
    expect(merged.items).toEqual(['b'])
  })

  it('keeps a non-restrictive string when next also is non-restrictive', () => {
    expect(mergePolicyObjects([{ network: 'unrestricted' }, { network: 'allow' }]).network).toBe('allow')
  })

  it('uses the later value when a nested object is replaced by a non-object', () => {
    expect(mergePolicyObjects([{ nested: { a: 1 } }, { nested: 'scalar' }]).nested).toBe('scalar')
  })

  it('intersects both-wildcard allow lists (identity)', () => {
    expect(mergePolicyObjects([{ allowedTools: ['*'] }, { allowedTools: ['*'] }]).allowedTools).toEqual(['*'])
  })

  it('does not add deny when both effects are allow (defaultEffect non-deny)', () => {
    expect(mergePolicyObjects([{ defaultEffect: 'allow' }, { defaultEffect: 'allow' }]).defaultEffect).toBe('allow')
  })

  it('intersects: next is wildcard, returns current as intersection identity', () => {
    // current=['a','b'], next=['*'] — hits the `if (next.includes('*'))` branch
    expect(mergePolicyObjects([{ allowedTools: ['a', 'b'] }, { allowedTools: ['*'] }]).allowedTools).toEqual(['a', 'b'])
  })
})

describe('sandboxOperationForRuntimeTool additional branches', () => {
  it('uses the fetch host field directly when provided', () => {
    const result = sandboxOperationForRuntimeTool('fetch', { host: 'api.example.com' })
    expect(result?.resourceId).toBe('api.example.com')
  })

  it('uses toolName as resourceId when no host or url', () => {
    const result = sandboxOperationForRuntimeTool('fetch', {}) as NetworkOp | null
    expect(result?.resourceId).toBe('fetch')
    expect(result?.host).toBeNull()
  })

  it('uses toolName as resourceId for bash when command is missing', () => {
    const result = sandboxOperationForRuntimeTool('bash', {}) as CommandOp | null
    expect(result?.command).toBeNull()
    expect(result?.resourceId).toBe('bash')
  })

  it('extracts hostname from a URL for fetch', () => {
    const result = sandboxOperationForRuntimeTool('fetch', {
      url: 'https://api.example.com/path',
    }) as NetworkOp | null
    expect(result?.host).toBe('api.example.com')
  })

  it('returns null host when url is invalid', () => {
    const result = sandboxOperationForRuntimeTool('fetch', { url: 'not-a-url' }) as NetworkOp | null
    expect(result?.host).toBeNull()
  })

  it('returns null when url has no hostname (e.g. file protocol)', () => {
    // file:///path has empty hostname — triggers the `|| null` fallback
    const result = sandboxOperationForRuntimeTool('fetch', { url: 'file:///etc/passwd' }) as NetworkOp | null
    expect(result?.host).toBeNull()
  })

  it('returns null host when url field is not a string', () => {
    const result = sandboxOperationForRuntimeTool('fetch', { url: 42 }) as NetworkOp | null
    expect(result?.host).toBeNull()
  })
})

describe('[spec: governance/model-budget] evaluateBudgets additional branches', () => {
  const today = new Date().toISOString().slice(0, 10)
  const month = new Date().toISOString().slice(0, 7)

  it('denies on a cost_micros budget exhaustion', () => {
    const budgets = [
      { id: 'b', providerId: null, modelId: null, limitType: 'cost_micros', limitValue: 100, window: 'month' },
    ]
    const usage = [{ createdAt: `${month}-01T00:00:00.000Z`, costMicros: 200, totalTokens: 0, sessionId: 's1' }]
    expect(evaluateBudgets(budgets, usage, { providerId: 'p', providerRowId: null, modelId: null })?.category).toBe(
      'budget',
    )
  })

  it('denies on a sessions budget exhaustion', () => {
    const budgets = [
      { id: 'b', providerId: null, modelId: null, limitType: 'sessions', limitValue: 1, window: 'month' },
    ]
    const usage = [
      { createdAt: `${month}-01T00:00:00.000Z`, costMicros: 0, totalTokens: 0, sessionId: 's1' },
      { createdAt: `${month}-01T00:00:00.000Z`, costMicros: 0, totalTokens: 0, sessionId: 's2' },
    ]
    expect(evaluateBudgets(budgets, usage, { providerId: 'p', providerRowId: null, modelId: null })?.category).toBe(
      'budget',
    )
  })

  it('uses day window prefix for daily budgets', () => {
    const budgets = [{ id: 'b', providerId: null, modelId: null, limitType: 'tokens', limitValue: 10, window: 'day' }]
    const usage = [{ createdAt: `${today}T00:00:00.000Z`, costMicros: 0, totalTokens: 50, sessionId: 's1' }]
    expect(evaluateBudgets(budgets, usage, { providerId: 'p', providerRowId: null, modelId: null })?.category).toBe(
      'budget',
    )
  })

  it('matches budget by providerRowId when providerId does not match', () => {
    const budgets = [
      { id: 'b', providerId: 'row_id', modelId: null, limitType: 'tokens', limitValue: 10, window: 'month' },
    ]
    const usage = [{ createdAt: `${month}-01T00:00:00.000Z`, costMicros: 0, totalTokens: 50, sessionId: 's1' }]
    const result = evaluateBudgets(budgets, usage, {
      providerId: 'external-id',
      providerRowId: 'row_id',
      modelId: null,
    })
    expect(result?.category).toBe('budget')
  })

  it('skips a model-scoped budget when the session has no model', () => {
    const budgets = [
      { id: 'b', providerId: null, modelId: 'gpt-4o', limitType: 'tokens', limitValue: 1, window: 'month' },
    ]
    const usage = [{ createdAt: `${month}-01T00:00:00.000Z`, costMicros: 0, totalTokens: 50, sessionId: 's1' }]
    expect(evaluateBudgets(budgets, usage, { providerId: 'p', providerRowId: null, modelId: null })).toBeNull()
  })

  it('skips null-sessionId entries when counting sessions', () => {
    const budgets = [
      { id: 'b', providerId: null, modelId: null, limitType: 'sessions', limitValue: 1, window: 'month' },
    ]
    const usage = [{ createdAt: `${month}-01T00:00:00.000Z`, costMicros: 0, totalTokens: 0, sessionId: null }]
    // One usage record but with null sessionId; the Set should be empty → 0 sessions → not exhausted
    expect(evaluateBudgets(budgets, usage, { providerId: 'p', providerRowId: null, modelId: null })).toBeNull()
  })

  it('skips a model-scoped budget when the model does not match', () => {
    const budgets = [
      { id: 'b', providerId: null, modelId: 'gpt-4o', limitType: 'tokens', limitValue: 1, window: 'month' },
    ]
    const usage = [{ createdAt: `${month}-01T00:00:00.000Z`, costMicros: 0, totalTokens: 50, sessionId: 's1' }]
    // modelId is set but does not match → skip
    expect(evaluateBudgets(budgets, usage, { providerId: 'p', providerRowId: null, modelId: 'gpt-3.5' })).toBeNull()
  })
})

describe('applicablePolicyLevels additional branches', () => {
  it('drops a team row with no teamId', () => {
    const rows: PolicyLevel[] = [policyLevel({ id: 'team_no_id', scope: 'team', updatedAt: '2026-01-01' })]
    expect(applicablePolicyLevels(rows, ['anything'])).toEqual([])
  })

  it('sorts multiple team rows by teamId', () => {
    const rows: PolicyLevel[] = [
      policyLevel({ id: 'team_b', scope: 'team', teamId: 'team_b', updatedAt: '2026-01-01' }),
      policyLevel({ id: 'team_a', scope: 'team', teamId: 'team_a', updatedAt: '2026-01-01' }),
    ]
    const levels = applicablePolicyLevels(rows, ['team_a', 'team_b'])
    expect(levels.map((l) => l.id)).toEqual(['team_a', 'team_b'])
  })
})

describe('environmentAllowsConnector additional branches', () => {
  it('allows when environment allows MCP servers', () => {
    expect(environmentAllowsConnector({ environmentSnapshot: '{"networking":{"allowMcpServers":true}}' })).toBe(true)
  })

  it('denies when environment blocks MCP servers', () => {
    expect(environmentAllowsConnector({ environmentSnapshot: '{"networking":{"allowMcpServers":false}}' })).toBe(false)
  })

  it('allows when networking omits the MCP flag', () => {
    expect(environmentAllowsConnector({ environmentSnapshot: '{"networking":{}}' })).toBe(true)
  })
})

describe('sessionAllowsTool additional branches', () => {
  it('denies when agentSnapshot has no tools field', () => {
    expect(sessionAllowsTool({ agentSnapshot: '{}' }, 'c', 't')).toBe(false)
  })

  it('allows when tool name is in snapshot tools as a string entry', () => {
    expect(sessionAllowsTool({ agentSnapshot: '{"tools":["t"]}' }, 'c', 't')).toBe(true)
  })

  it('denies when agentSnapshot is empty string', () => {
    expect(sessionAllowsTool({ agentSnapshot: null }, 'c', 't')).toBe(true)
  })

  it('handles tool entries that are name-keyed objects', () => {
    expect(sessionAllowsTool({ agentSnapshot: '{"tools":[{"name":"t"}]}' }, 'c', 't')).toBe(true)
  })

  it('ignores non-string non-object tool entries', () => {
    expect(sessionAllowsTool({ agentSnapshot: '{"tools":[42, null, {}]}' }, 'c', 't')).toBe(false)
  })
})

describe('policyBlocksConnector additional branches', () => {
  it('returns null when connector is in the allowed list', () => {
    expect(policyBlocksConnector({ allowedConnectors: ['github'] }, 'github')).toBeNull()
  })

  it('blocks with wildcard blocker', () => {
    expect(policyBlocksConnector({ blockedConnectors: ['*'] }, 'anything')?.rule).toBe('mcpPolicy.blockedConnectors')
  })
})

describe('policyBlocksTool additional branches', () => {
  it('returns null when tool is in the allowed list', () => {
    expect(policyBlocksTool({ allowedTools: ['web_search'] }, 'web_search')).toBeNull()
  })

  it('returns null when default effect is not deny', () => {
    expect(policyBlocksTool({}, 'web_search')).toBeNull()
  })

  it('blocks when tool is not in the non-wildcard allowedTools list', () => {
    expect(policyBlocksTool({ allowedTools: ['other'] }, 'web_search')?.rule).toBe('toolPolicy.allowedTools')
  })

  it('blocks when defaultEffect is deny and no explicit lists', () => {
    expect(policyBlocksTool({ defaultEffect: 'deny' }, 'web_search')?.rule).toBe('toolPolicy.defaultEffect')
  })
})

describe('policyRequiresApproval additional branches', () => {
  it('applies the wildcard connector approval mode', () => {
    expect(policyRequiresApproval({ connectorApprovalModes: { '*': 'require_approval' } }, 'any_connector', 't')).toBe(
      true,
    )
  })

  it('returns false when the connector mode is not require_approval', () => {
    expect(policyRequiresApproval({ connectorApprovalModes: { c: 'auto' } }, 'c', 't')).toBe(false)
  })

  it('requires approval by wildcard connector list', () => {
    expect(policyRequiresApproval({ requireApprovalConnectors: ['*'] }, 'any', 't')).toBe(true)
  })

  it('requires approval by wildcard tool list', () => {
    expect(policyRequiresApproval({ requireApprovalTools: ['*'] }, 'c', 'any')).toBe(true)
  })
})

describe('validatePolicyScope additional branches', () => {
  it('passes for an organization scope without teamId', () => {
    expect(validatePolicyScope({ level: 'organization' })).toBeNull()
  })
})

describe('[spec: governance/platform-daily-budget] platform budget', () => {
  const limits = { dailyCostMicros: 100, organizationDailyCostMicros: 40 }

  it('allows usage below both limits', () => {
    expect(evaluatePlatformBudget(limits, { platformCostMicros: 99, organizationCostMicros: 39 })).toBeNull()
  })

  it('denies once the platform limit is spent', () => {
    expect(evaluatePlatformBudget(limits, { platformCostMicros: 100, organizationCostMicros: 0 })).toMatchObject({
      allowed: false,
      category: 'budget',
      rule: 'platform-daily',
    })
  })

  it('denies once the organization limit is spent', () => {
    expect(evaluatePlatformBudget(limits, { platformCostMicros: 50, organizationCostMicros: 40 })).toMatchObject({
      category: 'budget',
      rule: 'organization-daily',
    })
  })

  it('treats an unset limit as unlimited', () => {
    expect(
      evaluatePlatformBudget(
        { dailyCostMicros: null, organizationDailyCostMicros: null },
        { platformCostMicros: 1e12, organizationCostMicros: 1e12 },
      ),
    ).toBeNull()
  })

  it('parses limits and rejects invalid values', () => {
    expect(parsePlatformBudgetLimit('X', undefined)).toBeNull()
    expect(parsePlatformBudgetLimit('X', ' ')).toBeNull()
    expect(parsePlatformBudgetLimit('X', '110000')).toBe(110000)
    expect(parsePlatformBudgetLimit('X', '0')).toBe(0)
    expect(() => parsePlatformBudgetLimit('X', '-1')).toThrow('X must be')
    expect(() => parsePlatformBudgetLimit('X', '1.5')).toThrow('X must be')
    expect(() => parsePlatformBudgetLimit('X', 'ten')).toThrow('X must be')
  })

  it('starts the budget day at 00:00 UTC', () => {
    expect(platformBudgetDayStart(new Date('2026-11-19T23:59:59.999Z'))).toBe('2026-11-19T00:00:00.000Z')
  })
})
