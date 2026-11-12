import { useState } from 'react'
import { doc, setDoc } from 'firebase/firestore'
import { Settings2, Pencil, Check, X } from 'lucide-react'
import { db } from '@/lib/firebase'
import { useCollection } from '@/hooks/useFirestore'
import { cn } from '@/lib/utils'
import type { BookingSettingsDoc, CohortDoc, RoomBookingLimit } from '@/types'

type Period = RoomBookingLimit['period']
interface Row { max: string; period: Period }
// Per-class rows; `null` = the class follows the default rule
type Draft = { def: Row; byCohort: Record<string, Row | null> }

const toRow = (l: RoomBookingLimit): Row => ({ max: l.max !== null ? String(l.max) : '', period: l.period })
const toLimit = (r: Row): RoomBookingLimit => ({
  max: r.max.trim() === '' ? null : Math.max(1, parseInt(r.max, 10) || 1),
  period: r.period,
})
const label = (l: RoomBookingLimit) => (l.max !== null ? `${l.max} / ${l.period}` : 'Unlimited')

// Max room bookings per student: one default rule, optionally overridden per class.
export default function RoomLimitSettings({ settings }: { settings: BookingSettingsDoc | null }) {
  const { data: cohorts } = useCollection<CohortDoc>('cohorts')
  const sortedCohorts = [...cohorts].sort((a, b) => a.name.localeCompare(b.name, 'sv'))

  const defaultLimit: RoomBookingLimit = {
    max: settings?.maxBookingsPerWeek ?? null,
    period: settings?.maxBookingsPeriod ?? 'week',
  }
  const overrides = settings?.roomLimitsByCohort ?? {}

  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)

  function startEdit() {
    setDraft({
      def: toRow(defaultLimit),
      byCohort: Object.fromEntries(sortedCohorts.map(c => [c.id, overrides[c.id] ? toRow(overrides[c.id]) : null])),
    })
  }

  async function save() {
    if (!draft) return
    setSaving(true)
    try {
      const def = toLimit(draft.def)
      const byCohort: Record<string, RoomBookingLimit> = {}
      for (const [id, row] of Object.entries(draft.byCohort)) if (row) byCohort[id] = toLimit(row)
      // mergeFields replaces the map wholesale, so removed overrides disappear
      await setDoc(doc(db, 'settings', 'booking'), {
        maxBookingsPerWeek: def.max,
        maxBookingsPeriod: def.period,
        roomLimitsByCohort: byCohort,
      }, { mergeFields: ['maxBookingsPerWeek', 'maxBookingsPeriod', 'roomLimitsByCohort'] })
      setDraft(null)
    } finally {
      setSaving(false)
    }
  }

  function editor(row: Row, onChange: (r: Row) => void) {
    return (
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={1}
          placeholder="Unlimited"
          value={row.max}
          onChange={e => onChange({ ...row, max: e.target.value })}
          className="input w-28 text-sm py-1.5 text-center"
        />
        <div className="flex rounded-lg border border-white/10 overflow-hidden">
          {(['day', 'week'] as const).map(p => (
            <button
              key={p}
              type="button"
              onClick={() => onChange({ ...row, period: p })}
              className={cn(
                'px-3 py-1.5 text-sm font-medium transition-colors',
                row.period === p ? 'bg-brand-600 text-white' : 'text-zinc-400 hover:bg-zinc-800',
              )}
            >
              per {p}
            </button>
          ))}
        </div>
      </div>
    )
  }

  function badge(l: RoomBookingLimit, muted = false) {
    return (
      <span className={cn(
        'text-sm font-semibold px-3 py-1 rounded-full',
        l.max !== null && !muted ? 'bg-brand-50 text-brand-800' : 'bg-zinc-800 text-zinc-500',
      )}>
        {label(l)}
      </span>
    )
  }

  return (
    <div className="bg-zinc-900 rounded-2xl border border-white/10 p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-brand-50 flex items-center justify-center flex-shrink-0">
            <Settings2 className="w-4.5 h-4.5 text-brand-600" />
          </div>
          <div>
            <p className="text-sm font-medium text-zinc-200">Max room bookings per student</p>
            <p className="text-xs text-zinc-400 mt-0.5">Limits how many room slots a student can book per day or per calendar week. Classes can have their own rule.</p>
          </div>
        </div>
        {draft ? (
          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={save} disabled={saving} className="btn-primary py-1.5 px-3 text-sm flex items-center gap-1.5">
              <Check className="w-3.5 h-3.5" />{saving ? 'Saving…' : 'Save'}
            </button>
            <button onClick={() => setDraft(null)} className="btn-secondary py-1.5 px-3 text-sm flex items-center gap-1.5">
              <X className="w-3.5 h-3.5" />Cancel
            </button>
          </div>
        ) : (
          <button aria-label="Edit" onClick={startEdit} className="p-1.5 text-zinc-400 hover:text-zinc-300 rounded-lg hover:bg-zinc-800 transition-colors">
            <Pencil className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="divide-y divide-white/5 border-t border-white/5">
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 pb-3">
          <p className="text-sm font-medium text-zinc-200">Default <span className="text-zinc-500 font-normal">(all classes)</span></p>
          {draft
            ? editor(draft.def, r => setDraft({ ...draft, def: r }))
            : badge(defaultLimit)}
        </div>

        {sortedCohorts.map(c => {
          const own = draft ? draft.byCohort[c.id] : overrides[c.id] ? toRow(overrides[c.id]) : null
          return (
            <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="flex items-center gap-2 min-w-0">
                {c.color && <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: c.color }} />}
                <p className="text-sm text-zinc-300 truncate">{c.name}</p>
              </div>
              {draft ? (
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={own !== null}
                      onChange={e => setDraft({
                        ...draft,
                        byCohort: { ...draft.byCohort, [c.id]: e.target.checked ? { ...draft.def } : null },
                      })}
                    />
                    Own rule
                  </label>
                  {own && editor(own, r => setDraft({ ...draft, byCohort: { ...draft.byCohort, [c.id]: r } }))}
                </div>
              ) : own ? (
                badge(toLimit(own))
              ) : (
                <span className="text-xs text-zinc-500">Default · {label(defaultLimit)}</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
