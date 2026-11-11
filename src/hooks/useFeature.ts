import { useSchool } from '@/contexts/SchoolContext'
import { hasFeature, resolveFeature, type Feature } from '@/lib/features'

export { type Feature }

export function useFeature(feature: Feature): boolean {
  const { features, tier, modules } = useSchool()
  // A per-feature override always wins (admin can force-show or force-hide a
  // feature); then modules when the school has them, else its legacy tier
  // (no tier = no restriction)
  return resolveFeature({ tier, modules, features }, feature)
}

export function useTier() {
  const { tier, modules } = useSchool()
  return {
    tier: tier ?? null,
    hasFeature: (f: Feature) => hasFeature({ tier, modules }, f),
  }
}
