import { Check } from 'lucide-react'
import { PLANS, MODULE_ORDER, MODULE_NAMES, BUNDLE_DISCOUNT, quote, type ModuleFlag, type PlanSelection } from '@/config/pricing'
import { MODULE_INFO } from '@/config/modules'
import type { ModuleId } from '@/lib/features'

// Modules first: three cards. Choosing one opens its plans (the first plan is
// picked to start with). Used by the order page and Superadmin → New customer;
// the server computes the same quote.

export const eur = (n: number) =>
  new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: n % 1 ? 2 : 0 }).format(n)

const MODULE_ID: Record<ModuleFlag, ModuleId> = { rentalInventory: 'rental_inventory', production: 'production', academy: 'academy' }

export default function PlanPicker({ value, onChange, compact = false }: {
  value: PlanSelection
  onChange: (v: PlanSelection) => void
  compact?: boolean
}) {
  const set = (m: ModuleFlag, id: string | undefined) => {
    const next = { ...value }
    if (id) next[m] = id; else delete next[m]
    onChange(next)
  }
  const q = quote(value)

  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-3 gap-3">
        {MODULE_ORDER.map(m => {
          const on = !!value[m]
          const from = Math.min(...PLANS[m].map(p => p.monthly))
          return (
            <button key={m} type="button" aria-pressed={on} onClick={() => set(m, on ? undefined : PLANS[m][0].id)}
              className={`text-left rounded-xl border p-4 space-y-1.5 transition-colors ${on ? 'border-brand-500 bg-brand-500/10' : 'border-white/10 bg-zinc-900 hover:border-white/25'}`}>
              <span className="flex items-center justify-between gap-2">
                <span className={`${compact ? 'text-sm' : 'text-base'} font-semibold text-white`}>{MODULE_NAMES[m]}</span>
                <span className={`w-5 h-5 rounded-full border flex items-center justify-center flex-shrink-0 ${on ? 'bg-brand-500 border-brand-500' : 'border-white/30'}`} aria-hidden="true">
                  {on && <Check className="w-3.5 h-3.5 text-white" />}
                </span>
              </span>
              {!compact && <span className="block text-xs text-zinc-400">{MODULE_INFO[MODULE_ID[m]].tagline}</span>}
              <span className="block text-xs text-zinc-300">From {eur(from)}/month</span>
            </button>
          )
        })}
      </div>

      {MODULE_ORDER.filter(m => value[m]).map(m => (
        <fieldset key={m} className="space-y-2">
          <legend className="text-sm font-semibold text-zinc-200 mb-1">{MODULE_NAMES[m]}: choose a plan</legend>
          <div className="grid sm:grid-cols-3 gap-2">
            {PLANS[m].map(p => {
              const checked = value[m] === p.id
              return (
                <label key={p.id} className={`rounded-xl border p-3 cursor-pointer space-y-0.5 ${checked ? 'border-brand-500 bg-brand-500/10' : 'border-white/10 bg-zinc-900 hover:border-white/20'}`}>
                  <span className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex items-center gap-2 font-medium text-white">
                      <input type="radio" name={`plan-${m}`} checked={checked} onChange={() => set(m, p.id)} />
                      {p.name}
                    </span>
                    <span className="text-zinc-200">{eur(p.monthly)}/mo</span>
                  </span>
                  <span className="block text-xs text-zinc-400">{p.limits}</span>
                </label>
              )
            })}
          </div>
        </fieldset>
      ))}

      <div className="rounded-xl border border-white/10 bg-zinc-900 p-4 text-sm space-y-1" aria-live="polite">
        {q.lines.length === 0 ? (
          <p className="text-zinc-400">Choose one or more modules above.</p>
        ) : (
          <>
            {q.discountRate > 0 && (
              <p className="flex justify-between text-zinc-400">
                <span>All three modules: {Math.round(q.discountRate * 100)}% off</span>
                <span><s>{eur(q.subtotalMonthly)}</s></span>
              </p>
            )}
            <p className="flex justify-between font-semibold text-white">
              <span>Per month</span><span>{eur(q.monthly)}</span>
            </p>
            <p className="flex justify-between text-zinc-400">
              <span>Billed annually</span><span>{eur(q.annual)} per year</span>
            </p>
            <p className="text-xs text-zinc-500 pt-1">Prices excl. VAT, per organisation.{q.lines.length < 3 && ` All three modules: ${Math.round(BUNDLE_DISCOUNT * 100)}% off.`}</p>
          </>
        )}
      </div>
    </div>
  )
}
