import { describe, expect, it, vi } from 'vitest'
import { createPlatformBudgetGate } from './platform-budget'

const clock = () => new Date('2026-11-19T08:30:00.000Z')

function usage(platform: number, organization: number) {
  return {
    costMicrosSince: vi.fn(async (_since: string, organizationId?: string) =>
      organizationId === undefined ? platform : organization,
    ),
  }
}

describe('[spec: governance/platform-daily-budget] platform budget gate', () => {
  it('sums the current UTC day for the platform and the organization', async () => {
    const repo = usage(10, 5)
    const gate = createPlatformBudgetGate(
      { PLATFORM_DAILY_COST_LIMIT_MICROS: '100', ORGANIZATION_DAILY_COST_LIMIT_MICROS: '50' },
      repo,
      clock,
    )

    await expect(gate.check('org_1')).resolves.toBeNull()
    expect(repo.costMicrosSince).toHaveBeenCalledWith('2026-11-19T00:00:00.000Z')
    expect(repo.costMicrosSince).toHaveBeenCalledWith('2026-11-19T00:00:00.000Z', 'org_1')
  })

  it('denies when the platform limit is spent', async () => {
    const gate = createPlatformBudgetGate({ PLATFORM_DAILY_COST_LIMIT_MICROS: '100' }, usage(100, 0), clock)

    await expect(gate.check('org_1')).resolves.toMatchObject({ allowed: false, rule: 'platform-daily' })
  })

  it('denies when the organization limit is spent', async () => {
    const repo = usage(0, 50)
    const gate = createPlatformBudgetGate({ ORGANIZATION_DAILY_COST_LIMIT_MICROS: '50' }, repo, clock)

    await expect(gate.check('org_1')).resolves.toMatchObject({ allowed: false, rule: 'organization-daily' })
    expect(repo.costMicrosSince).toHaveBeenCalledTimes(1)
  })

  it('reads no usage when no limit is set', async () => {
    const repo = usage(1e9, 1e9)
    const gate = createPlatformBudgetGate({}, repo)

    await expect(gate.check('org_1')).resolves.toBeNull()
    expect(repo.costMicrosSince).not.toHaveBeenCalled()
  })

  it('reads the current UTC day from the system clock by default', async () => {
    const repo = usage(0, 0)
    const gate = createPlatformBudgetGate({ PLATFORM_DAILY_COST_LIMIT_MICROS: '100' }, repo)

    await gate.check('org_1')

    expect(repo.costMicrosSince).toHaveBeenCalledWith(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`)
  })

  it('rejects an invalid limit at construction', () => {
    expect(() => createPlatformBudgetGate({ PLATFORM_DAILY_COST_LIMIT_MICROS: 'lots' }, usage(0, 0))).toThrow(
      'PLATFORM_DAILY_COST_LIMIT_MICROS',
    )
  })
})
