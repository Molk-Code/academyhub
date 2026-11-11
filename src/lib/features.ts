import type { SchoolTier } from '@/types'

export type { SchoolTier }

export type ProductType = 'education' | 'rental'

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

// Legacy tiers — still how every existing school doc is configured
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
  rental: ['equipment', 'inventory'],
}

/** Legacy lookup: no tier means no restriction */
export function hasTierFeature(tier: SchoolTier | undefined | null, feature: Feature): boolean {
  if (!tier) return true
  return TIER_FEATURES[tier]?.includes(feature) ?? false
}

// ── Modules ──────────────────────────────────────────────────────────────────
// Sold separately or together; core is always included. Stored on the school
// doc as schools/{id}.modules. Schools without that field keep their tier.

export type ModuleId = 'rental_inventory' | 'production' | 'academy'

/** Shape of schools/{id}.modules */
export interface ModuleFlags {
  rentalInventory: boolean
  production: boolean
  academy: boolean
}

export const MODULE_IDS: ModuleId[] = ['academy', 'production', 'rental_inventory']

export const MODULE_FLAG: Record<ModuleId, keyof ModuleFlags> = {
  rental_inventory: 'rentalInventory',
  production:       'production',
  academy:          'academy',
}

export const MODULE_FEATURES: Record<Feature, ModuleId | 'core'> = {
  production:       'production',
  equipment:        'rental_inventory',
  inventory:        'rental_inventory',
  booking:          'academy',
  vehicles:         'academy',
  food_box:         'academy',
  checkin_devices:  'academy',
  resources:        'academy',
  prizes:           'academy',
  video_lab:        'academy',
  assignments:      'academy',
  lessons:          'academy',
  development_plan: 'academy',
  semester:         'academy',
  chat:             'core',
  calendar:         'core',
  faq:              'core',
}

export const ALL_MODULES: ModuleFlags = { rentalInventory: true, production: true, academy: true }

export function isModuleOn(modules: ModuleFlags, module: ModuleId): boolean {
  return modules[MODULE_FLAG[module]] === true
}

/** A feature as granted by modules alone (core always on), before overrides */
export function moduleHasFeature(modules: ModuleFlags, feature: Feature): boolean {
  const module = MODULE_FEATURES[feature]
  return module === 'core' || isModuleOn(modules, module)
}

/**
 * The modules + per-feature overrides that reproduce a legacy tier exactly
 * (proven feature by feature in features.test.ts):
 * - studio, or no tier: everything
 * - academy: Academy
 * - campus: Academy without logistics, check-in devices, resources, prizes, video lab
 * - rental: Rental & Inventory without the core chat, calendar and FAQ
 */
export function modulesFromTier(tier: SchoolTier | undefined | null): { modules: ModuleFlags; overrides: Partial<Record<Feature, boolean>> } {
  switch (tier) {
    case 'academy':
      return { modules: { rentalInventory: false, production: false, academy: true }, overrides: {} }
    case 'campus':
      return {
        modules: { rentalInventory: false, production: false, academy: true },
        overrides: { booking: false, vehicles: false, food_box: false, checkin_devices: false, resources: false, prizes: false, video_lab: false },
      }
    case 'rental':
      return { modules: { rentalInventory: true, production: false, academy: false }, overrides: { chat: false, calendar: false, faq: false } }
    default:
      return { modules: { ...ALL_MODULES }, overrides: {} }
  }
}

export interface FeatureSource {
  tier?: SchoolTier | null
  modules?: ModuleFlags | null
  /** Per-feature admin overrides (schools/{id}.features); they always win */
  features?: Record<string, boolean>
}

/** Uses modules when the school has them, otherwise its legacy tier */
export function hasFeature(school: FeatureSource, feature: Feature): boolean {
  if (school.modules) return moduleHasFeature(school.modules, feature)
  return hasTierFeature(school.tier, feature)
}

/** What a school actually gets: an explicit override wins, then hasFeature */
export function resolveFeature(school: FeatureSource, feature: Feature): boolean {
  const override = school.features?.[feature]
  if (override === false) return false
  if (override === true) return true
  return hasFeature(school, feature)
}

/** Enabled modules: explicit, or derived from the legacy tier */
export function effectiveModules(school: FeatureSource): ModuleFlags {
  return school.modules ? { ...school.modules } : modulesFromTier(school.tier).modules
}

/** Product type for screens that still branch on it */
export function deriveProductType(school: FeatureSource & { productType?: ProductType | null }): ProductType {
  if (school.productType) return school.productType
  const m = school.modules
  if (m && m.rentalInventory && !m.production && !m.academy) return 'rental'
  return 'education'
}

/**
 * Whether signed-out visitors may use the public rental shop (/shop).
 * Module-based schools: the publicShop flag, off unless switched on.
 * Legacy schools: exactly as before — open only in rental mode.
 */
export function publicShopOpen(school: FeatureSource & { productType?: ProductType | null; publicShop?: boolean | null }): boolean {
  if (school.modules) return school.modules.rentalInventory === true && school.publicShop === true
  return school.productType === 'rental'
}

/** The legacy tier closest to a set of modules, for screens still reading `tier` (null: none matches) */
export function tierFromModules(m: ModuleFlags): SchoolTier | null {
  if (m.academy && m.production && m.rentalInventory) return 'studio'
  if (m.academy && !m.production && !m.rentalInventory) return 'academy'
  if (m.rentalInventory && !m.academy && !m.production) return 'rental'
  return null
}

// Which module owns each collection (top-level name) — the same table as
// firestore.rules. Collections not listed are core. Used to skip queries
// the rules would refuse when a school has a module off.
const ACADEMY_COLLECTIONS = `lessons lessonCategories lessonBlocks classrooms subjects assignments tests submissions
  checklists progress points_log development_plans plan_comments teacher_assessments teacher_notes todos
  semester_events semester_categories prizes prize_claims resource_folders team_resources videos video_lab
  video_comments guest_teachers guest_teacher_bookings attendance_sessions absence_reports qr_display_devices
  rooms room_bookings room_slots time_blocks vehicles minivan_bookings food_box_orders`.split(/\s+/)
const PRODUCTION_COLLECTIONS = ['productions', 'production_periods']
const RENTAL_COLLECTIONS = `equipment equipment_categories equipment_bookings inventory_presets inventory_projects
  scan_sessions`.split(/\s+/)

export const COLLECTION_MODULE: Record<string, ModuleId> = Object.fromEntries([
  ...ACADEMY_COLLECTIONS.map(c => [c, 'academy']),
  ...PRODUCTION_COLLECTIONS.map(c => [c, 'production']),
  ...RENTAL_COLLECTIONS.map(c => [c, 'rental_inventory']),
]) as Record<string, ModuleId>

const SETTINGS_MODULE: Record<string, ModuleId> = {
  booking: 'academy', semester: 'academy', production: 'production',
  equipment_gtin: 'rental_inventory', inventory_stats_resets: 'rental_inventory',
}

/**
 * Whether a client may read this path under the school's modules (mirrors
 * the rules). Legacy schools (no modules): always. `docId` matters only for
 * settings/{docId}.
 */
export function collectionAllowed(modules: ModuleFlags | null | undefined, collectionPath: string, docId?: string | null): boolean {
  if (!modules) return true
  const segments = collectionPath.split('/').filter(Boolean)
  const top = segments[0]
  if (top === 'crew_roles') return modules.production || modules.rentalInventory
  if (top === 'settings') {
    const id = segments[1] ?? docId
    if (!id) return modules.academy && modules.production && modules.rentalInventory
    return SETTINGS_MODULE[id] ? isModuleOn(modules, SETTINGS_MODULE[id]) : true
  }
  const module = COLLECTION_MODULE[top]
  return !module || isModuleOn(modules, module)
}
