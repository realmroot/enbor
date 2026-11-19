import { evaluatePlatformBudget, parsePlatformBudgetLimit, platformBudgetDayStart } from '@server/domain/policy'
import type { PlatformBudgetGate, UsageRepo } from '@server/usecases/ports'
import type { Env } from '../../env'

export function createPlatformBudgetGate(
  env: Pick<Env, 'PLATFORM_DAILY_COST_LIMIT_MICROS' | 'ORGANIZATION_DAILY_COST_LIMIT_MICROS'>,
  usage: Pick<UsageRepo, 'costMicrosSince'>,
  clock: () => Date = () => new Date(),
): PlatformBudgetGate {
  const limits = {
    dailyCostMicros: parsePlatformBudgetLimit('PLATFORM_DAILY_COST_LIMIT_MICROS', env.PLATFORM_DAILY_COST_LIMIT_MICROS),
    organizationDailyCostMicros: parsePlatformBudgetLimit(
      'ORGANIZATION_DAILY_COST_LIMIT_MICROS',
      env.ORGANIZATION_DAILY_COST_LIMIT_MICROS,
    ),
  }
  return {
    async check(organizationId) {
      if (limits.dailyCostMicros === null && limits.organizationDailyCostMicros === null) {
        return null
      }
      const since = platformBudgetDayStart(clock())
      const [platformCostMicros, organizationCostMicros] = await Promise.all([
        limits.dailyCostMicros === null ? 0 : usage.costMicrosSince(since),
        limits.organizationDailyCostMicros === null ? 0 : usage.costMicrosSince(since, organizationId),
      ])
      const decision = evaluatePlatformBudget(limits, { platformCostMicros, organizationCostMicros })
      return decision ? { ...decision, allowed: false } : null
    },
  }
}
