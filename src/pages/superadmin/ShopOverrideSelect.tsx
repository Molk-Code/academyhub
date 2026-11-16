// The superadmin's master switch for a school's public rental shop
// (functions/src/shop.ts): normally the school admin opens and closes it;
// "Always open" / "Always closed" override their choice.

export type ShopOverride = 'on' | 'off' | null

export default function ShopOverrideSelect({ value, onChange, disabled, adminOpen }: {
  value: ShopOverride
  onChange: (v: ShopOverride) => void
  disabled?: boolean
  /** The school admin's own choice, when known */
  adminOpen?: boolean | null
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-sm text-zinc-100">Public rental shop</p>
        <p className="text-xs text-zinc-500 max-w-md">
          Signed-out visitors browse equipment and send requests at /shop. The school admin opens and closes it
          (Equipment → Public shop); this overrides them.
          {adminOpen != null && ` The school admin has it ${adminOpen ? 'open' : 'closed'}.`}
        </p>
      </div>
      <select className="input w-56" value={value ?? ''} disabled={disabled} aria-label="Public rental shop"
        onChange={e => onChange((e.target.value || null) as ShopOverride)}>
        <option value="">School admin decides</option>
        <option value="on">Always open</option>
        <option value="off">Always closed</option>
      </select>
    </div>
  )
}
