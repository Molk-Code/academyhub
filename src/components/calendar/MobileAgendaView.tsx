<title>Mobile Agenda View</title>
import { useState, useMemo, useEffect, useRef } from 'react'
import type { EventInput } from '@fullcalendar/core'
import { ChevronLeft, ChevronRight, MapPin } from 'lucide-react'
import {
  format, startOfWeek, addDays, addWeeks, subWeeks,
  isSameDay, isToday, parseISO,
} from 'date-fns'
import { enGB } from 'date-fns/locale'

export interface MobileAgendaViewProps {
  events: EventInput[]
  onEventClick: (ev: EventInput) => void
  onAddClick?: (dateStr: string, timeStr: string) => void
}

function toDate(val: EventInput['start'] | EventInput['end']): Date | null {
  if (!val) return null
  if (val instanceof Date) return val
  if (typeof val === 'number') return new Date(val)
  if (typeof val === 'string') {
    try { return parseISO(val) } catch { return new Date(val) }
  }
  return null
}

function fmt(d: Date) { return format(d, 'HH:mm') }

function duration(start: Date, end: Date) {
  const m = Math.round((end.getTime() - start.getTime()) / 60000)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60); const r = m % 60
  return r ? `${h}h ${r}m` : `${h}h`
}

const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

export default function MobileAgendaView({ events, onEventClick, onAddClick }: MobileAgendaViewProps) {
  const [selectedDate, setSelectedDate] = useState(() => new Date())
  const [weekOffset, setWeekOffset]     = useState(0)
  const weekStart = useMemo(
    () => addWeeks(startOfWeek(new Date(), { weekStartsOn: 1 }), weekOffset),
    [weekOffset],
  )
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])

  // Keep selectedDate in the visible week when navigating
  function prevWeek() {
    setWeekOffset(o => o - 1)
    setSelectedDate(d => subWeeks(d, 1))
  }
  function nextWeek() {
    setWeekOffset(o => o + 1)
    setSelectedDate(d => addWeeks(d, 1))
  }
  function goToday() {
    setWeekOffset(0)
    setSelectedDate(new Date())
  }

  // Snap week strip to whichever week contains selectedDate whenever it changes externally
  useEffect(() => {
    const expected = Math.round(
      (startOfWeek(selectedDate, { weekStartsOn: 1 }).getTime() -
       startOfWeek(new Date(), { weekStartsOn: 1 }).getTime()) /
      (7 * 24 * 3600 * 1000),
    )
    setWeekOffset(expected)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selectedDateStr = format(selectedDate, 'yyyy-MM-dd')

  // Collect events that fall on selectedDate
  const dayEvents = useMemo(() => {
    const out: EventInput[] = []
    for (const ev of events) {
      if (ev.extendedProps?.isBlock) continue          // ghost blocks — teacher only
      if (ev.extendedProps?.isSemesterMarker) continue // not useful in list form
      const start = toDate(ev.start)
      if (!start) continue
      if (ev.allDay) {
        const ss = format(start, 'yyyy-MM-dd')
        const end = toDate(ev.end)
        const ee = end ? format(end, 'yyyy-MM-dd') : ss
        if (selectedDateStr >= ss && selectedDateStr < ee) out.push(ev)
        else if (ss === selectedDateStr) out.push(ev)
      } else {
        if (format(start, 'yyyy-MM-dd') === selectedDateStr) out.push(ev)
      }
    }
    return out.sort((a, b) => {
      if (a.allDay && !b.allDay) return -1
      if (!a.allDay && b.allDay) return 1
      const as = toDate(a.start); const bs = toDate(b.start)
      if (!as || !bs) return 0
      return as.getTime() - bs.getTime()
    })
  }, [events, selectedDateStr])

  // Event dot map per day
  const dotDays = useMemo(() => {
    const set = new Set<string>()
    for (const ev of events) {
      if (ev.extendedProps?.isBlock || ev.extendedProps?.isSemesterMarker) continue
      const s = toDate(ev.start); if (!s) continue
      set.add(format(s, 'yyyy-MM-dd'))
    }
    return set
  }, [events])

  const monthLabel = format(selectedDate, 'MMMM yyyy', { locale: enGB })
  const weekNum    = format(weekStart, 'w')

  const allDay  = dayEvents.filter(e => e.allDay)
  const timed   = dayEvents.filter(e => !e.allDay)

  return (
    <div className="flex flex-col" style={{ height: 'calc(100dvh - 13.5rem - env(safe-area-inset-top,0px) - env(safe-area-inset-bottom,0px))' }}>

      {/* ── Week strip ─────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 border-b" style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)' }}>
        {/* Month + nav */}
        <div className="flex items-center justify-between px-3 pt-2 pb-1">
          <span className="text-sm font-bold capitalize" style={{ color: 'var(--text-primary)' }}>
            {monthLabel}
          </span>
          <div className="flex items-center gap-0.5">
            <button
              onClick={goToday}
              className="text-xs font-semibold px-2 py-1 rounded-lg transition-colors"
              style={{ color: 'var(--brand)' }}
            >
              Today
            </button>
            <button onClick={prevWeek} className="p-1.5 rounded-lg text-zinc-400 hover:bg-white/8 transition-colors">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button onClick={nextWeek} className="p-1.5 rounded-lg text-zinc-400 hover:bg-white/8 transition-colors">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Day strip */}
        <div className="flex items-center pb-2">
          <span className="w-8 text-center text-[9px] font-medium text-zinc-600 flex-shrink-0">w{weekNum}</span>
          {days.map((day, i) => {
            const isSelected = isSameDay(day, selectedDate)
            const isTod      = isToday(day)
            const hasDot     = dotDays.has(format(day, 'yyyy-MM-dd'))
            return (
              <button
                key={i}
                onClick={() => setSelectedDate(day)}
                className="flex-1 flex flex-col items-center gap-0.5 py-0.5"
              >
                <span className={`text-[10px] font-medium ${isSelected ? 'text-brand-400' : isTod ? 'text-brand-500' : 'text-zinc-500'}`}>
                  {DAY_LETTERS[i]}
                </span>
                <span className={`w-7 h-7 flex items-center justify-center rounded-full text-[13px] font-semibold transition-colors
                  ${isSelected
                    ? 'bg-brand-500 text-white'
                    : isTod
                      ? 'ring-1 ring-brand-500 text-brand-400'
                      : 'text-zinc-200'
                  }`}
                >
                  {format(day, 'd')}
                </span>
                <span className={`w-1 h-1 rounded-full ${hasDot && !isSelected ? 'bg-zinc-500' : 'bg-transparent'}`} />
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Day header ─────────────────────────────────────────────────────── */}
      <div
        className="flex-shrink-0 px-4 py-2 border-b"
        style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)' }}
      >
        <p className="text-xs font-semibold text-zinc-400 capitalize">
          {format(selectedDate, 'EEEE d MMMM', { locale: enGB })}
        </p>
      </div>

      {/* ── Event list ─────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto" style={{ background: 'var(--bg-primary)' }}>
        {dayEvents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 gap-2">
            <p className="text-zinc-500 text-sm">No events</p>
            {onAddClick && (
              <button
                onClick={() => onAddClick(selectedDateStr, '09:00')}
                className="text-sm font-medium"
                style={{ color: 'var(--brand)' }}
              >
                + Add event
              </button>
            )}
          </div>
        ) : (
          <div>
            {/* All-day events */}
            {allDay.length > 0 && (
              <div className="px-4 py-2 space-y-1.5 border-b" style={{ borderColor: 'var(--border)' }}>
                {allDay.map(ev => (
                  <button
                    key={String(ev.id)}
                    onClick={() => onEventClick(ev)}
                    className="w-full flex items-center gap-3 text-left rounded-xl px-3 py-2.5 hover:bg-white/5 transition-colors"
                    style={{ background: `${String(ev.backgroundColor ?? '#6366f1')}22` }}
                  >
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: String(ev.backgroundColor ?? '#6366f1') }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                        {String(ev.title).replace(/^📅 |^📋 Due: /g, '')}
                      </p>
                    </div>
                    <span className="text-[10px] text-zinc-500 flex-shrink-0">All day</span>
                  </button>
                ))}
              </div>
            )}

            {/* Timed events */}
            {timed.map((ev, idx) => {
              const start    = toDate(ev.start)
              const end      = toDate(ev.end)
              const color    = String(ev.backgroundColor ?? '#6366f1')
              const loc      = ev.extendedProps?.classroom || ev.extendedProps?.location || ''
              const subj     = ev.extendedProps?.subjectTitle || ev.extendedProps?.className || ''
              const rawTitle = String(ev.title).replace(/^📅 /g, '')

              return (
                <button
                  key={String(ev.id)}
                  onClick={() => onEventClick(ev)}
                  className={`w-full flex items-start gap-3 px-4 py-3.5 text-left hover:bg-white/[0.03] active:bg-white/[0.06] transition-colors ${idx < timed.length - 1 ? 'border-b' : ''}`}
                  style={{ borderColor: 'var(--border)' }}
                >
                  {/* Time */}
                  <div className="flex-shrink-0 w-12 text-right pt-0.5">
                    {start && <p className="text-[13px] font-bold" style={{ color: 'var(--text-primary)' }}>{fmt(start)}</p>}
                    {start && end && <p className="text-[10px] text-zinc-500 mt-0.5">{duration(start, end)}</p>}
                  </div>

                  {/* Color bar */}
                  <div
                    className="w-[3px] self-stretch rounded-full flex-shrink-0 mt-0.5"
                    style={{ backgroundColor: color, minHeight: '2.5rem' }}
                  />

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-semibold leading-snug" style={{ color: 'var(--text-primary)' }}>
                      {rawTitle}
                    </p>
                    {subj && (
                      <p className="text-[11px] text-zinc-400 mt-0.5">{subj}</p>
                    )}
                    {loc && (
                      <div className="flex items-center gap-1 mt-1">
                        <MapPin className="w-3 h-3 text-zinc-500 flex-shrink-0" />
                        <span className="text-[11px] text-zinc-400 truncate">{loc}</span>
                      </div>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
