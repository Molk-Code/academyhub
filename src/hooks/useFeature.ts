import { useSchool } from '@/contexts/SchoolContext'
import { hasFeature, type Feature } from '@/lib/features'

export { type Feature }

export function useFeature(feature: Feature): boolean {
  const { features, isBeta, tier } = useSchool()

  // Per-feature override always wins (admin can force-show or force-hide a feature)
  if (features[feature] === false) return false
  if (features[feature] === true) return true

  // Tier is set → enforce it regardless of isBeta
  if (tier) return hasFeature(tier, feature)

  // No tier configured: beta schools get everything, others get everything too
  // (null tier = no restriction, for schools not yet assigned a tier)
  return true
}

export function useTier() {
  const { tier } = useSchool()
  return {
    tier: tier ?? null,
    hasFeature: (f: Feature) => hasFeature(tier, f),
  }
}
