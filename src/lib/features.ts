import type { SchoolTier } from '@/types'

export type { SchoolTier }

export type Feature =
  | 'production'
  | 'equipment'
  | 'inventory'
  | 'booking'
  | 'vehicles'
  | 'food_box'
  | 'checkin_devices'
  | 'resources'
  | 'prizes'
  | 'video_lab'
  | 'chat'
  | 'calendar'
  | 'assignments'
  | 'lessons'
  | 'development_plan'
  | 'semester'
  | 'faq'

export const TIER_FEATURES: Record<SchoolTier, Feature[]> = {
  studio: [
    'production', 'equipment', 'inventory', 'booking', 'vehicles',
    'food_box', 'checkin_devices', 'resources', 'prizes', 'video_lab',
    'chat', 'calendar', 'assignments', 'lessons', 'development_plan',
    'semester', 'faq',
  ],
  academy: [
    'booking', 'vehicles', 'food_box', 'checkin_devices', 'resources',
    'prizes', 'video_lab', 'chat', 'calendar', 'assignments', 'lessons',
    'development_plan', 'semester', 'faq',
  ],
  campus: [
    'chat', 'calendar', 'assignments', 'lessons', 'development_plan',
    'semester', 'faq',
  ],
}

export function hasFeature(tier: SchoolTier | undefined | null, feature: Feature): boolean {
  if (!tier) return true
  return TIER_FEATURES[tier]?.includes(feature) ?? false
}
