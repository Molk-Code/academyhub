import { cn } from '@/lib/utils'
import type { RoomAvailabilityWindow } from '@/types'
import { Trash2 } from 'lucide-react'

export const DAY_LABELS: Record<number, string> = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 0: 'Sun' }
export const DAYS_ORDER = [1, 2, 3, 4, 5, 6, 0]

export function WindowRow({ w, onChange, onRemove }: {
  w: RoomAvailabilityWindow
  onChange: (patch: Partial<RoomAvailabilityWindow>) => void
  onRemove: () => void
}) {
  return (
    <div className="border border-white/10 rounded-xl p-3 space-y-3 bg-zinc-900/50">
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1 flex-wrap">
          {DAYS_ORDER.map(d => (
            <button key={d} type="button"
              onClick={() => {
                const days = w.days.includes(d) ? w.days.filter(x => x !== d) : [...w.days, d]
                onChange({ days })
              }}
              className={cn(
                'px-2 py-1 rounded-lg text-xs font-medium border transition-colors',
                w.days.includes(d) ? 'bg-brand-600 border-brand-600 text-white' : 'bg-zinc-900 border-white/10 text-zinc-500 hover:border-white/15',
              )}
            >{DAY_LABELS[d]}</button>
          ))}
        </div>
        <button type="button" onClick={onRemove} className="p-1.5 text-zinc-300 hover:text-rose-500 transition-colors flex-shrink-0">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-zinc-500 font-medium block mb-1">From time</label>
          <input type="time" value={w.startTime} onChange={e => onChange({ startTime: e.target.value })} className="input text-sm py-1.5" />
        </div>
        <div>
          <label className="text-xs text-zinc-500 font-medium block mb-1">Until time</label>
          <input type="time" value={w.endTime} onChange={e => onChange({ endTime: e.target.value })} className="input text-sm py-1.5" />
        </div>
      </div>
      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={w.useSemesterDates !== false}
          onChange={e => onChange({ useSemesterDates: e.target.checked })}
          className="rounded border-white/20 bg-zinc-800 text-brand-500 focus:ring-brand-500"
        />
        <span className="text-xs text-zinc-400">Use semester dates automatically</span>
      </label>
      {w.useSemesterDates === false && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-zinc-500 font-medium block mb-1">Period start</label>
            <input type="date" value={w.startDate} onChange={e => onChange({ startDate: e.target.value })} className="input text-sm py-1.5" />
          </div>
          <div>
            <label className="text-xs text-zinc-500 font-medium block mb-1">Period end</label>
            <input type="date" value={w.endDate} onChange={e => onChange({ endDate: e.target.value })} className="input text-sm py-1.5" />
          </div>
        </div>
      )}
    </div>
  )
}
