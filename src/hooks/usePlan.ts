import { useSchool } from '@/contexts/SchoolContext'
import {
  LIMIT_MODULE, MODULE_NAMES, limitState, planFor, planHasFeature, upgradeFor,
  type LimitKind, type LimitState, type Plan, type PlanFeature,
} from '@/config/pricing'

export interface LimitInfo {
  kind: LimitKind
  used: number
  /** null: unlimited */
  limit: number | null
  state: LimitState
  /** e.g. "Academy Starter" */
  planLabel: string | null
  /** The plan to upgrade to for a higher limit */
  next: Plan | null
}

/**
 * The school's plan: which plan features it includes and where usage stands
 * against its limits. Schools without a stored plan keep every feature and
 * have no limits.
 */
export function usePlan() {
  const { planSelection, limits, usage } = useSchool()
  const limit = (kind: LimitKind, liveCount?: number): LimitInfo => {
    const module = LIMIT_MODULE[kind]
    const max = planSelection ? limits[kind] : null
    const used = liveCount ?? usage?.[kind] ?? 0
    const plan = planFor(module, planSelection?.[module])
    return {
      kind, used, limit: max, state: limitState(used, max),
      planLabel: plan ? `${MODULE_NAMES[module]} ${plan.name}` : null,
      next: upgradeFor(kind, planSelection?.[module]),
    }
  }
  return {
    hasPlan: !!planSelection,
    has: (feature: PlanFeature) => planHasFeature(planSelection, feature),
    limit,
  }
}
