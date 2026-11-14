// The price list: a plan per module, € per month, billed annually, ex VAT,
// per organisation. The order page and Superadmin show it
// (src/config/pricing.ts re-exports this file), and orders store the quote
// computed here, so a price can't be changed in the browser.
// Limits are soft (docs/claude-code-modules.md, "Plans, limits and Plus"):
// counted and warned about, never blocking. Only maxStudents is stored on
// the school today.

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
  /** Assets included (Rental & Inventory plans). Absent = unlimited. A soft limit (see docs/claude-code-modules.md) */
  maxAssets?: number
}

export const PLANS: Record<ModuleFlag, Plan[]> = {
  rentalInventory: [
    { id: 'starter',  name: 'Starter',  monthly: 19,  limits: 'Up to 50 assets', maxAssets: 50 },
    { id: 'standard', name: 'Standard', monthly: 79,  limits: 'Up to 200 assets', maxAssets: 200 },
    { id: 'plus',     name: 'Plus',     monthly: 179, limits: 'Unlimited assets, multiple locations, custom domain for the rental shop, exports and API, priority support' },
  ],
  production: [
    { id: 'starter',  name: 'Starter',  monthly: 19,  limits: '' },
    { id: 'standard', name: 'Standard', monthly: 69,  limits: '' },
    { id: 'plus',     name: 'Plus',     monthly: 149, limits: 'Unlimited users, advanced budgeting and exports, priority support' },
  ],
  academy: [
    { id: 'starter',  name: 'Starter',  monthly: 59,  limits: 'Up to 40 students', maxStudents: 40 },
    { id: 'standard', name: 'Standard', monthly: 149, limits: 'Up to 100 students', maxStudents: 100 },
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
