import { PLANS, MODULE_ORDER, MODULE_NAMES, BUNDLE_DISCOUNT, quote, type ModuleFlag, type PlanSelection } from '@/config/pricing'

// A plan per module (or "Not included"), with the price summary. Used by the
// order page and Superadmin → New customer; the server computes the same quote.

export const eur = (n: number) =>
  new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: n % 1 ? 2 : 0 }).format(n)

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
      {MODULE_ORDER.map(m => (
        <fieldset key={m} className="space-y-2">
          <legend className={`${compact ? 'text-sm' : 'text-base'} font-semibold text-white mb-1`}>{MODULE_NAMES[m]}</legend>
          <div className={`grid gap-2 ${compact ? 'sm:grid-cols-4' : 'sm:grid-cols-2 lg:grid-cols-4'}`}>
            <PlanOption name={`plan-${m}`} checked={!value[m]} onSelect={() => set(m, undefined)} title="Not included" />
            {PLANS[m].map(p => (
              <PlanOption key={p.id} name={`plan-${m}`} checked={value[m] === p.id} onSelect={() => set(m, p.id)}
                title={p.name} price={`${eur(p.monthly)}/month`} detail={p.limits} />
            ))}
          </div>
        </fieldset>
      ))}

      <div className="rounded-xl border border-white/10 bg-zinc-900 p-4 text-sm space-y-1" aria-live="polite">
        {q.lines.length === 0 ? (
          <p className="text-zinc-400">Choose a plan for at least one module.</p>
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

function PlanOption({ name, checked, onSelect, title, price, detail }: {
  name: string; checked: boolean; onSelect: () => void; title: string; price?: string; detail?: string
}) {
  return (
    <label className={`rounded-xl border p-3 cursor-pointer space-y-0.5 ${checked ? 'border-brand-500 bg-brand-500/10' : 'border-white/10 bg-zinc-900 hover:border-white/20'}`}>
      <span className="flex items-center gap-2 font-medium text-white text-sm">
        <input type="radio" name={name} checked={checked} onChange={onSelect} />
        {title}
      </span>
      {price && <span className="block text-sm text-zinc-200">{price}</span>}
      {detail && <span className="block text-xs text-zinc-400">{detail}</span>}
    </label>
  )
}
