import { describe, expect, it } from 'vitest'
import {
  TIER_FEATURES, MODULE_FEATURES, hasFeature, resolveFeature, modulesFromTier, deriveProductType, effectiveModules,
  type Feature, type SchoolTier,
} from './features'

// Frozen copy of the tier model and useFeature logic as they were before
// modules existed. Everything below must keep matching it exactly — this is
// the proof that existing schools see the same features.
const LEGACY_TIER_FEATURES: Record<SchoolTier, Feature[]> = {
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
  campus: ['chat', 'calendar', 'assignments', 'lessons', 'development_plan', 'semester', 'faq'],
  rental: ['equipment', 'inventory'],
}
function legacyUseFeature(tier: SchoolTier | null, features: Record<string, boolean>, feature: Feature): boolean {
  if (features[feature] === false) return false
  if (features[feature] === true) return true
  if (tier) return LEGACY_TIER_FEATURES[tier]?.includes(feature) ?? false
  return true
}

const TIERS: (SchoolTier | null)[] = ['studio', 'academy', 'campus', 'rental', null]
const FEATURES = Object.keys(MODULE_FEATURES) as Feature[]

// Override maps seen in practice: none, production's Molkom doc (legacy
// camelCase keys, which no Feature matches), and real force-on / force-off.
const OVERRIDES: Record<string, Record<string, boolean>> = {
  none: {},
  molkom: { videoLab: true, roomBooking: true, semesterWheel: true, sharePoint: false, gdpr: true },
  forceOffChatAndProduction: { chat: false, production: false },
  forceOnEquipmentAndPrizes: { equipment: true, prizes: true },
}

describe('feature model', () => {
  it('covers exactly the 17 existing features', () => {
    expect(FEATURES.sort()).toEqual([...LEGACY_TIER_FEATURES.studio].sort())
    expect(FEATURES).toHaveLength(17)
  })

  it('leaves the tier table itself unchanged', () => {
    expect(TIER_FEATURES).toEqual(LEGACY_TIER_FEATURES)
  })

  for (const tier of TIERS) {
    for (const [overrideName, features] of Object.entries(OVERRIDES)) {
      describe(`tier ${tier ?? '(none)'}, overrides ${overrideName}`, () => {
        it.each(FEATURES)('%s: legacy path is unchanged', feature => {
          expect(resolveFeature({ tier, features }, feature)).toBe(legacyUseFeature(tier, features, feature))
        })

        it.each(FEATURES)('%s: modulesFromTier reproduces the tier', feature => {
          // The tier rewritten as modules + overrides; the school's own
          // overrides still win over the derived ones, as before
          const { modules, overrides } = modulesFromTier(tier)
          const asModules = { modules, features: { ...overrides, ...features } }
          expect(resolveFeature(asModules, feature)).toBe(legacyUseFeature(tier, features, feature))
        })
      })
    }
  }

  it('hasFeature without overrides matches the old tier lookup (useTier)', () => {
    for (const tier of TIERS) for (const f of FEATURES) {
      expect(hasFeature({ tier }, f)).toBe(tier ? LEGACY_TIER_FEATURES[tier].includes(f) : true)
    }
  })
})

describe('modules', () => {
  it('turn features on by module, with core always on', () => {
    const productionOnly = { modules: { rentalInventory: false, production: true, academy: false } }
    expect(hasFeature(productionOnly, 'production')).toBe(true)
    expect(hasFeature(productionOnly, 'equipment')).toBe(false)
    expect(hasFeature(productionOnly, 'lessons')).toBe(false)
    for (const core of ['chat', 'calendar', 'faq'] as Feature[]) expect(hasFeature(productionOnly, core)).toBe(true)
  })

  it('take precedence over the legacy tier when present', () => {
    expect(hasFeature({ tier: 'studio', modules: { rentalInventory: true, production: false, academy: false } }, 'production')).toBe(false)
  })

  it('are derived from the tier when absent', () => {
    expect(effectiveModules({ tier: 'studio' })).toEqual({ rentalInventory: true, production: true, academy: true })
    expect(effectiveModules({ tier: 'rental' })).toEqual({ rentalInventory: true, production: false, academy: false })
    expect(effectiveModules({ tier: null })).toEqual({ rentalInventory: true, production: true, academy: true })
  })
})

describe('product type', () => {
  it('keeps an explicit productType, else derives it', () => {
    expect(deriveProductType({ productType: 'rental', tier: 'studio' })).toBe('rental')
    expect(deriveProductType({ tier: 'studio' })).toBe('education')
    expect(deriveProductType({})).toBe('education')
    expect(deriveProductType({ modules: { rentalInventory: true, production: false, academy: false } })).toBe('rental')
    expect(deriveProductType({ modules: { rentalInventory: true, production: true, academy: false } })).toBe('education')
  })
})
