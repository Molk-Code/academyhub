import { BookOpen, ClipboardList, CalendarDays, User } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CalendarCategory } from '@/lib/calendarFilters'

const CHIP: Record<CalendarCategory, { label: string; icon: typeof BookOpen }> = {
  lessons:   { label: 'Lessons',   icon: BookOpen },
  deadlines: { label: 'Deadlines', icon: ClipboardList },
  outlook:   { label: 'Outlook',   icon: CalendarDays },
  mine:      { label: 'Mine',      icon: User },
}

interface Props {
  available: CalendarCategory[]
  isOn: (c: CalendarCategory) => boolean
  onToggle: (c: CalendarCategory) => void
  anyHidden: boolean
  onShowAll: () => void
  className?: string
}

/** Lessons / Deadlines / Outlook / Mine — which sources the calendar shows */
export default function CalendarFilterChips({ available, isOn, onToggle, anyHidden, onShowAll, className }: Props) {
  if (available.length < 2) return null
  return (
    <div className={cn('flex items-center gap-1.5 flex-wrap', className)} role="group" aria-label="Show in calendar">
      {available.map(c => {
        const { label, icon: Icon } = CHIP[c]
        const on = isOn(c)
        return (
          <button
            key={c}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(c)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
              on
                ? 'border-brand-500/50 bg-brand-500/15 text-zinc-100'
                : 'border-white/10 bg-transparent text-zinc-500 line-through decoration-zinc-600 hover:text-zinc-300',
            )}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        )
      })}
      {anyHidden && (
        <button type="button" onClick={onShowAll} className="text-xs text-zinc-400 hover:text-zinc-200 underline-offset-2 hover:underline ml-1">
          Show all
        </button>
      )}
    </div>
  )
}
