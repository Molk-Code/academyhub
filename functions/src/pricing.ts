// The price list: a plan per module, € per month, billed annually, ex VAT,
// per organisation. The order page and Superadmin show it
// (src/config/pricing.ts re-exports this file), and orders store the quote
// computed here, so a price can't be changed in the browser.
// Limits (docs/claude-code-modules.md, "Plans, limits and Plus"): a warning
// at WARN_PCT, new items blocked at BLOCK_PCT, existing data never deleted.
// The setup copies the plan and its limits to the school doc (planSelection,
// maxAssets, maxStudents), where the superadmin can override them.

export const CURRENCY = 'EUR'
/** Off the sum when all three modules are ordered */
export const BUNDLE_DISCOUNT = 0.2

export type ModuleFlag = 'academy' | 'production' | 'rentalInventory'

export interface Plan {
  id: string
  name: string
  /** € per month, billed annually */
  monthly: number
  limits: string
  /** Students included (Academy plans): set as the school's maxStudents. Absent = unlimited */
  maxStudents?: number
  /** Assets included (Rental & Inventory plans): set as the school's maxAssets. Absent = unlimited */
  maxAssets?: number
  /** Not offered on the order page yet (customers can't pick it; the superadmin can) */
  hidden?: boolean
}

export const PLANS: Record<ModuleFlag, Plan[]> = {
  rentalInventory: [
    { id: 'starter',  name: 'Starter',  monthly: 19,  limits: 'Up to 50 assets', maxAssets: 50 },
    { id: 'standard', name: 'Standard', monthly: 79,  limits: 'Up to 200 assets', maxAssets: 200 },
    // Hidden until the rental summary/CSV export (brief Phase 3) and a comparison with other rental tools are done
    { id: 'plus',     name: 'Plus',     monthly: 179, limits: 'Unlimited assets, multiple locations, custom domain for the rental shop, exports and API, priority support', hidden: true },
  ],
  production: [
    { id: 'starter',  name: 'Starter',  monthly: 19,  limits: '' },
    { id: 'standard', name: 'Standard', monthly: 69,  limits: '' },
    // Hidden until a comparison with StudioBinder-class tools is done
    { id: 'plus',     name: 'Plus',     monthly: 149, limits: 'Unlimited users, advanced budgeting and exports, priority support', hidden: true },
  ],
  academy: [
    { id: 'starter',  name: 'Starter',  monthly: 59,  limits: 'Up to 30 students', maxStudents: 30 },
    { id: 'standard', name: 'Standard', monthly: 149, limits: 'Up to 70 students', maxStudents: 70 },
    { id: 'plus',     name: 'Plus',     monthly: 299, limits: 'Unlimited students, several programs or classes, Microsoft sign-in, reports and analytics, branded login page, priority support' },
  ],
}

export const MODULE_NAMES: Record<ModuleFlag, string> = { academy: 'Academy', production: 'Production', rentalInventory: 'Rental & Inventory' }
export const MODULE_ORDER: ModuleFlag[] = ['rentalInventory', 'production', 'academy']

/** Chosen plan id per module; a module left out isn't ordered */
export type PlanSelection = Partial<Record<ModuleFlag, string>>

export interface Quote {
  currency: string
  lines: { module: ModuleFlag; plan: string; monthly: number }[]
  /** Sum of the plans, € per month */
  subtotalMonthly: number
  discountRate: number
  /** € per month after any bundle discount */
  monthly: number
  /** € per year (what is invoiced) */
  annual: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function planFor(module: ModuleFlag, id: string | undefined): Plan | undefined {
  return id ? PLANS[module].find(p => p.id === id) : undefined
}

/** A problem with the selection, or null */
export function selectionProblem(sel: unknown): string | null {
  if (!sel || typeof sel !== 'object') return 'Choose a plan.'
  const entries = Object.entries(sel as Record<string, unknown>).filter(([, v]) => v !== undefined && v !== null && v !== '')
  if (!entries.length) return 'Choose a plan for at least one module.'
  for (const [k, v] of entries) {
    if (!(k in PLANS)) return `Unknown module ${k}.`
    if (typeof v !== 'string' || !planFor(k as ModuleFlag, v)) return `Unknown plan ${String(v)} for ${MODULE_NAMES[k as ModuleFlag]}.`
  }
  return null
}

export function quote(sel: PlanSelection): Quote {
  const lines = MODULE_ORDER.flatMap(m => {
    const p = planFor(m, sel[m])
    return p ? [{ module: m, plan: p.id, monthly: p.monthly }] : []
  })
  const subtotalMonthly = lines.reduce((s, l) => s + l.monthly, 0)
  const discountRate = lines.length === 3 ? BUNDLE_DISCOUNT : 0
  const monthly = round2(subtotalMonthly * (1 - discountRate))
  return { currency: CURRENCY, lines, subtotalMonthly, discountRate, monthly, annual: round2(monthly * 12) }
}

/** "Rental & Inventory Standard + Academy Small" */
export function planLabel(sel: PlanSelection): string {
  return MODULE_ORDER.flatMap(m => {
    const p = planFor(m, sel[m])
    return p ? [`${MODULE_NAMES[m]} ${p.name}`] : []
  }).join(' + ')
}

export function modulesFor(sel: PlanSelection): Record<ModuleFlag, boolean> {
  return { academy: !!sel.academy, production: !!sel.production, rentalInventory: !!sel.rentalInventory }
}

// ── Limits and plan features ─────────────────────────────────────────────────

/** Admins see a warning from this share of the limit */
export const WARN_PCT = 90
/** New items are blocked from this share of the limit (existing ones are never touched) */
export const BLOCK_PCT = 110

export type LimitKind = 'assets' | 'students'
export const LIMIT_FIELD: Record<LimitKind, 'maxAssets' | 'maxStudents'> = { assets: 'maxAssets', students: 'maxStudents' }
export const LIMIT_MODULE: Record<LimitKind, ModuleFlag> = { assets: 'rentalInventory', students: 'academy' }

export type LimitState = 'ok' | 'warn' | 'over' | 'blocked'

/** Where usage stands against a limit; no limit (null) is always ok. Whole-number maths, as in firestore.rules */
export function limitState(used: number, limit: number | null | undefined): LimitState {
  if (limit == null) return 'ok'
  if (used * 100 >= limit * BLOCK_PCT) return 'blocked'
  if (used >= limit) return 'over'
  if (used * 100 >= limit * WARN_PCT) return 'warn'
  return 'ok'
}

/** Whether one more item may be added */
export const canAddOne = (used: number, limit: number | null | undefined) => limitState(used, limit) !== 'blocked'

/** The next plan up that raises the limit (null: none), to name in an upgrade message */
export function upgradeFor(kind: LimitKind, planId: string | undefined): Plan | null {
  const plans = PLANS[LIMIT_MODULE[kind]]
  const field = LIMIT_FIELD[kind]
  const i = plans.findIndex(p => p.id === planId)
  const current = i >= 0 ? plans[i][field] : undefined
  return plans.slice(i + 1).find(p => p[field] === undefined || (current !== undefined && p[field]! > current)) ?? null
}

/** Features that need a higher plan of their module (lower plans: the feature is hidden or read-only) */
export const PLAN_FEATURES = {
  kits:          { module: 'rentalInventory', plan: 'standard', label: 'Kits' },
  maintenance:   { module: 'rentalInventory', plan: 'standard', label: 'Maintenance log' },
  rentalExport:  { module: 'rentalInventory', plan: 'plus',     label: 'Rental summaries and CSV export' },
  academyExport: { module: 'academy',         plan: 'standard', label: 'Term reports (PDF and CSV)' },
} as const satisfies Record<string, { module: ModuleFlag; plan: string; label: string }>

export type PlanFeature = keyof typeof PLAN_FEATURES

/**
 * Whether a school's plan includes a feature. Schools without a stored plan
 * (every school set up before plans existed) keep everything.
 */
export function planHasFeature(selection: PlanSelection | null | undefined, feature: PlanFeature): boolean {
  if (!selection) return true
  const { module, plan } = PLAN_FEATURES[feature]
  const plans = PLANS[module]
  const have = plans.findIndex(p => p.id === selection[module])
  return have >= 0 && have >= plans.findIndex(p => p.id === plan)
}
