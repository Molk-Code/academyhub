// The price list: a plan per module, € per month, billed annually, ex VAT,
// per organisation. The order page and Superadmin show it
// (src/config/pricing.ts re-exports this file), and orders store the quote
// computed here, so a price can't be changed in the browser.
// Limits are what each plan includes; the app doesn't enforce them yet,
// except the student limit (maxStudents on the school).

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
  /** Students included (Academy plans): set as the school's maxStudents */
  maxStudents?: number
}

export const PLANS: Record<ModuleFlag, Plan[]> = {
  rentalInventory: [
    { id: 'starter',  name: 'Starter',  monthly: 49,  limits: 'Up to 500 assets, 5 staff users' },
    { id: 'standard', name: 'Standard', monthly: 99,  limits: 'Up to 2,500 assets, 15 staff users, public rental shop' },
    { id: 'plus',     name: 'Plus',     monthly: 179, limits: 'Unlimited assets, multiple locations, priority support' },
  ],
  production: [
    { id: 'team',   name: 'Team',   monthly: 69,  limits: 'Up to 5 users, 3 active productions' },
    { id: 'studio', name: 'Studio', monthly: 149, limits: 'Up to 15 users, unlimited productions' },
  ],
  academy: [
    { id: 'small',  name: 'Small',  monthly: 129, limits: 'Up to 50 students', maxStudents: 50 },
    { id: 'medium', name: 'Medium', monthly: 249, limits: 'Up to 150 students', maxStudents: 150 },
    { id: 'large',  name: 'Large',  monthly: 449, limits: 'Up to 400 students (more on request)', maxStudents: 400 },
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
