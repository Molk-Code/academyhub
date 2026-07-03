export type Tier = 'free' | 'starter' | 'pro' | 'enterprise'

export interface TierDef {
  label: string
  maxStudents: number
  features: string[]
}

export const TIER_DEFS: Record<Tier, TierDef> = {
  free: {
    label: 'Free',
    maxStudents: 10,
    features: ['dashboard', 'calendar', 'checkin', 'assignments', 'resources', 'faq', 'profile'],
  },
  starter: {
    label: 'Starter',
    maxStudents: 50,
    features: [
      'dashboard', 'calendar', 'checkin', 'assignments', 'resources', 'faq', 'profile',
      'myPlan', 'prizes', 'chat', 'semester',
    ],
  },
  pro: {
    label: 'Pro',
    maxStudents: 200,
    features: [
      'dashboard', 'calendar', 'checkin', 'assignments', 'resources', 'faq', 'profile',
      'myPlan', 'prizes', 'chat', 'semester',
      'booking', 'production', 'equipment', 'vehicles', 'foodBoxes',
    ],
  },
  enterprise: {
    label: 'Enterprise',
    maxStudents: Infinity,
    features: ['*'],
  },
}

export function tierHasFeature(tier: Tier, feature: string): boolean {
  const def = TIER_DEFS[tier]
  if (!def) return false
  if (def.features.includes('*')) return true
  return def.features.includes(feature)
}
