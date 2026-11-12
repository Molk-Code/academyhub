import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  TIER_FEATURES, MODULE_FEATURES, hasFeature, resolveFeature, modulesFromTier, deriveProductType, effectiveModules,
  publicShopOpen, tierFromModules, COLLECTION_MODULE, collectionAllowed,
  type Feature, type SchoolTier, type ModuleId,
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
    // Explicit modules decide over a stale stored productType
    expect(deriveProductType({ productType: 'education', modules: { rentalInventory: true, production: false, academy: false } })).toBe('rental')
    expect(deriveProductType({ productType: 'rental', modules: { rentalInventory: true, production: true, academy: false } })).toBe('education')
  })
})

describe('public shop', () => {
  it('legacy schools: open exactly when it was — rental mode only', () => {
    expect(publicShopOpen({ tier: 'studio', productType: 'education' })).toBe(false)
    expect(publicShopOpen({ tier: 'rental', productType: 'rental' })).toBe(true)
    expect(publicShopOpen({ tier: 'studio', productType: 'education', publicShop: true })).toBe(false)
  })
  it('module-based schools: off unless switched on, and only with Rental & Inventory', () => {
    const rental = { rentalInventory: true, production: false, academy: false }
    expect(publicShopOpen({ modules: rental })).toBe(false)
    expect(publicShopOpen({ modules: rental, publicShop: true })).toBe(true)
    expect(publicShopOpen({ modules: { ...rental, rentalInventory: false }, publicShop: true })).toBe(false)
  })
})

describe('tierFromModules', () => {
  it('maps the module sets that have a legacy tier', () => {
    expect(tierFromModules({ academy: true, production: true, rentalInventory: true })).toBe('studio')
    expect(tierFromModules({ academy: true, production: false, rentalInventory: false })).toBe('academy')
    expect(tierFromModules({ academy: false, production: false, rentalInventory: true })).toBe('rental')
    expect(tierFromModules({ academy: false, production: true, rentalInventory: false })).toBeNull()
  })
})

describe('collection → module table', () => {
  // Top-level collections and the module their rules require, read from firestore.rules
  const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf-8')
  const FLAG: Record<string, ModuleId> = { academy: 'academy', production: 'production', rentalInventory: 'rental_inventory' }
  const fromRules: Record<string, ModuleId> = {}
  for (const block of rules.split(/\n    match \//).slice(1)) {
    const name = block.match(/^([a-zA-Z_]+)\/\{/)?.[1]
    if (!name || name === 'settings' || name === 'crew_roles' || name === 'production_teams') continue
    // The whole first allow statement (they can span lines) up to its ';'
    const first = block.match(/\n\s+allow [^;]*;/)?.[0] ?? ''
    const flag = first.match(/moduleOn\('([a-zA-Z]+)'\)/)?.[1]
    if (flag) fromRules[name] = FLAG[flag]
  }

  it('matches the moduleOn() gates in firestore.rules', () => {
    expect(Object.keys(fromRules).length).toBeGreaterThan(40)
    expect(COLLECTION_MODULE).toEqual(fromRules)
  })

  it('lets legacy schools read everything and blocks off modules', () => {
    expect(collectionAllowed(null, 'productions')).toBe(true)
    const prodOff = { academy: true, production: false, rentalInventory: true }
    expect(collectionAllowed(prodOff, 'productions')).toBe(false)
    expect(collectionAllowed(prodOff, 'productions/p1/scenes')).toBe(false)
    expect(collectionAllowed(prodOff, 'lessons')).toBe(true)
    expect(collectionAllowed(prodOff, 'users')).toBe(true)
    expect(collectionAllowed(prodOff, 'production_teams')).toBe(true)
    expect(collectionAllowed(prodOff, 'crew_roles')).toBe(true)
    expect(collectionAllowed({ ...prodOff, rentalInventory: false }, 'crew_roles')).toBe(false)
    expect(collectionAllowed(prodOff, 'settings', 'production')).toBe(false)
    expect(collectionAllowed(prodOff, 'settings', 'nav_visibility')).toBe(true)
    expect(collectionAllowed(prodOff, 'settings')).toBe(false)
  })
})
