import { useState, useMemo, useEffect, useRef } from 'react'
import type { EventInput } from '@fullcalendar/core'
import { MapPin, CheckCircle2, Clock, ChevronLeft, ChevronRight, Plus, CalendarClock } from 'lucide-react'
import type { SubjectDoc } from '@/types'
import SubjectCover from '@/components/subjects/SubjectCover'
import { cn } from '@/lib/utils'
import {
  format, startOfWeek, addDays, addWeeks, subWeeks,
  isSameDay, isToday, parseISO,
  startOfMonth, endOfMonth, addMonths, eachWeekOfInterval, isSameMonth,
} from 'date-fns'
import { enGB } from 'date-fns/locale'

export interface MobileAgendaViewProps {
  events: EventInput[]
  onEventClick: (ev: EventInput) => void
  onAddClick?: (dateStr: string, timeStr: string) => void
  initialDate?: Date
  subjects?: SubjectDoc[]   // enables subject photos on the current session card
  // 'mobile': sticky week strip above a page-scrolled timeline.
  // 'desktop': month calendar in a sticky left column, timeline on the right.
  variant?: 'mobile' | 'desktop'
}

type Kind = 'lesson' | 'synced' | 'personal' | 'assignment'
const KIND_LABEL: Record<Kind, string> = { lesson: 'Lessons', synced: 'Outlook', personal: 'Personal', assignment: 'Deadlines' }

function kindOf(ev: EventInput): Kind {
  const ep = ev.extendedProps ?? {}
  if (ep.type === 'assignment') return 'assignment'
  if (ep.isPersonal) return 'personal'
  if (ep.isSynced) return 'synced'
  return 'lesson'
}

function cleanTitle(ev: EventInput) {
  return String(ev.title).replace(/^📅 |^📋 Due: /g, '')
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

function computeWeekOffset(date: Date) {
  const base   = startOfWeek(new Date(), { weekStartsOn: 1 })
  const target = startOfWeek(date,        { weekStartsOn: 1 })
  return Math.round((target.getTime() - base.getTime()) / (7 * 24 * 60 * 60 * 1000))
}

function getMonthWeeks(ms: Date) {
  return eachWeekOfInterval(
    { start: ms, end: endOfMonth(ms) },
    { weekStartsOn: 1 },
  ).map(ws => Array.from({ length: 7 }, (_, i) => addDays(ws, i)))
}

const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

export default function MobileAgendaView({ events, onEventClick, onAddClick, initialDate, subjects = [], variant = 'mobile' }: MobileAgendaViewProps) {
  const isDesktop = variant === 'desktop'
  const [kindFilter, setKindFilter] = useState<Kind | 'all'>('all')
  // Re-render every minute so Completed / In Session / Upcoming stay current
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(t) }, [])
  const subjectMap = useMemo(() => Object.fromEntries(subjects.map(s => [s.id, s])), [subjects])
  const [selectedDate, setSelectedDate] = useState(() => initialDate ?? new Date())
  const [weekOffset,   setWeekOffset]   = useState(() => initialDate ? computeWeekOffset(initialDate) : 0)
  const [isExpanded,   setIsExpanded]   = useState(isDesktop)
  const [monthOffset,  setMonthOffset]  = useState(0)

  // Drag pixel offset for 3-panel track (synced ref+state)
  const dragPxRef             = useRef(0)
  const [dragPx, _setDragPx] = useState(0)
  function setDragPx(v: number) { dragPxRef.current = v; _setDragPx(v) }

  const [isSnapping, setIsSnapping] = useState(false)

  // Stale-closure-safe mirrors
  const isExpandedRef = useRef(false)
  useEffect(() => { isExpandedRef.current = isExpanded }, [isExpanded])

  // Touch refs
  const tStartX = useRef(0)
  const tStartY = useRef(0)
  const tPhase  = useRef<'idle' | 'h' | 'v'>('idle')

  const stripRef     = useRef<HTMLDivElement>(null)

  // ── Derived ──────────────────────────────────────────────────────────────

  const currentWeekStart = useMemo(
    () => addWeeks(startOfWeek(new Date(), { weekStartsOn: 1 }), weekOffset),
    [weekOffset],
  )

  // Use Wednesday of the current week as month anchor (avoids Mon=prev-month edge case)
  const weekAnchorMonth = useMemo(
    () => startOfMonth(addDays(currentWeekStart, 3)),
    [currentWeekStart],
  )

  const referenceMonth = useMemo(
    () => addMonths(isExpanded ? startOfMonth(selectedDate) : weekAnchorMonth, monthOffset),
    [isExpanded, selectedDate, weekAnchorMonth, monthOffset],
  )

  const weekPanels = useMemo(() => [-1, 0, 1].map(o => {
    const ws = addWeeks(currentWeekStart, o)
    return { weekStart: ws, days: Array.from({ length: 7 }, (_, i) => addDays(ws, i)) }
  }), [currentWeekStart])

  const monthPanels = useMemo(() => [-1, 0, 1].map(o => {
    const ms = addMonths(referenceMonth, o)
    return { month: ms, weeks: getMonthWeeks(ms) }
  }), [referenceMonth])

  const dotDays = useMemo(() => {
    const set = new Set<string>()
    for (const ev of events) {
      if (ev.extendedProps?.isBlock || ev.extendedProps?.isSemesterMarker) continue
      const s = toDate(ev.start); if (!s) continue
      set.add(format(s, 'yyyy-MM-dd'))
    }
    return set
  }, [events])

  const selectedDateStr = format(selectedDate, 'yyyy-MM-dd')
  useEffect(() => { setKindFilter('all') }, [selectedDateStr])

  const dayEvents = useMemo(() => {
    const out: EventInput[] = []
    for (const ev of events) {
      if (ev.extendedProps?.isBlock || ev.extendedProps?.isSemesterMarker) continue
      const start = toDate(ev.start)
      if (!start) continue
      if (ev.allDay) {
        const ss = format(start, 'yyyy-MM-dd')
        const end = toDate(ev.end)
        const ee  = end ? format(end, 'yyyy-MM-dd') : ss
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

  // ── Navigation ───────────────────────────────────────────────────────────

  function prevWeek()  { setWeekOffset(o => o - 1); setSelectedDate(d => subWeeks(d, 1)) }
  function nextWeek()  { setWeekOffset(o => o + 1); setSelectedDate(d => addWeeks(d, 1)) }
  function prevMonth() { setMonthOffset(o => o - 1) }
  function nextMonth() { setMonthOffset(o => o + 1) }
  function goToday()   { setWeekOffset(0); setMonthOffset(0); setSelectedDate(new Date()); setIsExpanded(false) }

  // Snap 3-panel track to prev (dir=1) or next (dir=-1), then update state
  const doSnapRef = useRef<(dir: -1 | 1) => void>(() => {})
  doSnapRef.current = (dir: -1 | 1) => {
    const W = stripRef.current?.clientWidth ?? 375
    setIsSnapping(true)
    setDragPx(dir * W)
    setTimeout(() => {
      if (dir === -1) isExpandedRef.current ? nextMonth() : nextWeek()
      else            isExpandedRef.current ? prevMonth() : prevWeek()
      setDragPx(0)
      setIsSnapping(false)
    }, 240)
  }

  // ── Strip touch ──────────────────────────────────────────────────────────

  useEffect(() => {
    const el = stripRef.current
    if (!el) return

    const onStart = (e: TouchEvent) => {
      tStartX.current = e.touches[0].clientX
      tStartY.current = e.touches[0].clientY
      tPhase.current  = 'idle'
      setIsSnapping(false)
    }

    const onMove = (e: TouchEvent) => {
      const dx = e.touches[0].clientX - tStartX.current
      const dy = e.touches[0].clientY - tStartY.current
      const adx = Math.abs(dx), ady = Math.abs(dy)

      if (tPhase.current === 'idle') {
        if (adx > 6 && adx >= ady) tPhase.current = 'h'
        else if (ady > 6)          tPhase.current = 'v'
      }

      if (tPhase.current === 'h') {
        e.preventDefault()
        setDragPx(dx)
      } else if (tPhase.current === 'v') {
        e.preventDefault()
        if (!isExpandedRef.current && dy > 28) {
          setIsExpanded(true); setMonthOffset(0); setDragPx(0); tPhase.current = 'idle'
        } else if (isExpandedRef.current && dy < -28) {
          setIsExpanded(false); setDragPx(0); tPhase.current = 'idle'
        }
      }
    }

    const onEnd = () => {
      if (tPhase.current !== 'h') { tPhase.current = 'idle'; return }
      tPhase.current = 'idle'
      const dp = dragPxRef.current
      const W  = el.clientWidth
      if (Math.abs(dp) >= W * 0.28) doSnapRef.current(dp < 0 ? -1 : 1)
      else { setIsSnapping(true); setDragPx(0); setTimeout(() => setIsSnapping(false), 240) }
    }

    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove',  onMove,  { passive: false })
    el.addEventListener('touchend',   onEnd,   { passive: true })
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove',  onMove)
      el.removeEventListener('touchend',   onEnd)
    }
  }, [])

  // ── Render ───────────────────────────────────────────────────────────────

  const trackStyle: React.CSSProperties = {
    display: 'flex',
    width: '300%',
    transform: `translateX(calc(-33.333% + ${dragPx}px))`,
    transition: isSnapping ? 'transform 0.24s ease-out' : 'none',
    willChange: 'transform',
  }

  const kindsToday = Array.from(new Set(dayEvents.map(kindOf)))
  const shown  = kindFilter === 'all' ? dayEvents : dayEvents.filter(e => kindOf(e) === kindFilter)
  const allDay = shown.filter(e => e.allDay)
  const timed  = shown.filter(e => !e.allDay)

  const totalMinutes = timed.reduce((sum, ev) => {
    const a = toDate(ev.start), b = toDate(ev.end)
    return a && b ? sum + Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000)) : sum
  }, 0)
  const totalLabel = totalMinutes === 0 ? '' : totalMinutes < 60 ? `${totalMinutes}m` : `${Math.floor(totalMinutes / 60)}h${totalMinutes % 60 ? ` ${totalMinutes % 60}m` : ''}`

  function statusOf(ev: EventInput): 'past' | 'current' | 'upcoming' {
    const a = toDate(ev.start), b = toDate(ev.end) ?? a
    if (!a || !b) return 'upcoming'
    if (b <= now) return 'past'
    if (a <= now) return 'current'
    return 'upcoming'
  }

  function dayTile(day: Date, onClick: () => void, compact = false) {
    const sel     = isSameDay(day, selectedDate)
    const tod     = isToday(day)
    const hasDot  = dotDays.has(format(day, 'yyyy-MM-dd'))
    const weekend = day.getDay() === 0 || day.getDay() === 6
    return (
      <button
        onClick={onClick}
        className={cn(
          'flex-1 flex flex-col items-center rounded-xl transition-all mx-0.5',
          compact ? 'py-1' : 'py-1.5',
          sel
            ? 'bg-brand-500 text-white shadow-[0_0_18px_rgba(255,107,53,0.65)] scale-105 z-10'
            : weekend ? 'bg-zinc-950/40 hover:bg-zinc-800' : 'bg-zinc-950/70 hover:bg-zinc-800',
        )}
      >
        {!compact && (
          <span className={cn('text-[10px] font-medium', sel ? 'text-brand-900 font-semibold uppercase tracking-wider' : weekend ? 'text-zinc-600' : 'text-zinc-400')}>
            {format(day, 'EEE', { locale: enGB })}
          </span>
        )}
        <span className={cn(
          'font-semibold leading-tight',
          compact ? 'text-[13px]' : 'text-[15px] mt-0.5',
          sel ? 'text-white font-bold' : tod ? 'text-brand-400' : weekend ? 'text-zinc-500' : 'text-zinc-100',
        )}>
          {format(day, 'd')}
        </span>
        <span className={cn('w-1.5 h-1.5 mt-0.5 rounded-full', sel ? 'bg-white' : hasDot ? (tod ? 'bg-brand-500' : 'bg-zinc-500') : 'bg-transparent')} />
      </button>
    )
  }

  return (
    <div className={isDesktop ? 'lg:grid lg:grid-cols-[minmax(280px,340px)_1fr] lg:gap-6 lg:items-start' : 'flex flex-col'}>

      {/* ── Week strip / month card — sticks below the header while the page scrolls ── */}
      <div className={isDesktop ? 'lg:sticky lg:top-4 z-20 mb-4 lg:mb-0' : 'sticky-below-header z-20 -mx-4 px-2 pt-2 pb-1'} style={isDesktop ? undefined : { background: 'var(--bg-primary)' }}>
      <div
        ref={stripRef}
        className="select-none p-2.5 rounded-2xl bg-zinc-900 shadow-md"
        style={{
          overflow: 'hidden',
          maxHeight: isDesktop ? undefined : isExpanded ? '400px' : '140px',
          transition: 'max-height 0.32s ease-out',
          touchAction: isDesktop ? 'auto' : 'none',
        }}
      >
        {/* Month + week pill + arrows */}
        <div className="flex items-center justify-between px-1 pb-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="font-display text-base font-bold text-zinc-100 capitalize truncate">
              {format(referenceMonth, 'MMMM yyyy', { locale: enGB })}
            </span>
            {(!isExpanded || isDesktop) && (
              <span className="px-2 py-0.5 rounded-full bg-zinc-700 text-zinc-300 text-[10px] font-medium whitespace-nowrap">
                Week {format(isExpanded ? selectedDate : currentWeekStart, 'w', { locale: enGB, weekStartsOn: 1, firstWeekContainsDate: 4 })}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {!(isToday(selectedDate) && weekOffset === 0 && monthOffset === 0) && (
              <button onClick={goToday} className="px-2 h-7 rounded-lg bg-brand-500/15 text-brand-300 text-[11px] font-semibold">Today</button>
            )}
            <button aria-label="Previous" onClick={() => isExpanded ? prevMonth() : prevWeek()} className="w-7 h-7 flex items-center justify-center rounded-lg bg-zinc-800 text-zinc-400 hover:text-zinc-100">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button aria-label="Next" onClick={() => isExpanded ? nextMonth() : nextWeek()} className="w-7 h-7 flex items-center justify-center rounded-lg bg-zinc-800 text-zinc-400 hover:text-zinc-100">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Expanded month: weekday letters header */}
        {isExpanded && (
          <div className="flex items-center">
            {DAY_LETTERS.map((l, i) => (
              <div key={i} className="flex-1 text-center text-[10px] font-semibold text-zinc-500 pb-1">{l}</div>
            ))}
          </div>
        )}

        {/* 3-panel sliding track — clipped so neighbouring weeks don't peek into the card padding */}
        <div className="overflow-hidden py-1">
        <div style={trackStyle}>
          {isExpanded
            ? monthPanels.map(({ month, weeks }, pi) => (
              <div key={pi} style={{ width: '33.333%' }} className="space-y-1 pb-1">
                {weeks.map((days, wi) => (
                  <div key={wi} className="flex items-center">
                    {days.map((day, di) => (
                      <div key={di} className={cn('flex-1 flex', !isSameMonth(day, month) && 'opacity-35')}>
                        {dayTile(day, () => {
                          setSelectedDate(day)
                          setWeekOffset(computeWeekOffset(day))
                          setMonthOffset(0)
                          if (!isDesktop) setIsExpanded(false)
                        }, true)}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ))
            : weekPanels.map(({ days }, pi) => (
              <div key={pi} style={{ width: '33.333%' }} className="flex items-center py-1">
                {days.map((day, di) => <div key={di} className="flex-1 flex">{dayTile(day, () => setSelectedDate(day))}</div>)}
              </div>
            ))
          }
        </div>
        </div>

        {/* Pull handle */}
        {!isDesktop && (
          <div className="flex justify-center pt-1.5">
            <div className="w-8 h-[3px] rounded-full bg-zinc-700" />
          </div>
        )}
      </div>
      </div>

      {/* ── Event list ──────────────────────────────────────────────────── */}
      <div className={isDesktop ? 'min-w-0' : 'pt-3 pb-4'}>
        {/* Filter pills — only when the day mixes kinds of events */}
        {kindsToday.length > 1 && (
          <div className="flex items-center gap-2 overflow-x-auto pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {(['all', ...kindsToday] as const).map(k => (
              <button
                key={k}
                onClick={() => setKindFilter(k)}
                className={cn(
                  'flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-medium transition-all',
                  kindFilter === k
                    ? 'bg-brand-500 text-white font-semibold shadow-[0_0_12px_rgba(255,107,53,0.4)]'
                    : 'bg-zinc-800 text-zinc-400 hover:text-zinc-100',
                )}
              >
                {k === 'all' ? `All (${dayEvents.length})` : KIND_LABEL[k]}
              </button>
            ))}
          </div>
        )}

        {/* Day header */}
        <div className="flex items-center justify-between pb-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-2.5 h-2.5 rounded-full bg-brand-500 shadow-[0_0_8px_#ff6b35] flex-shrink-0" />
            <span className="text-xs font-bold text-zinc-100 uppercase tracking-wider truncate">
              {isToday(selectedDate) ? 'Today' : format(selectedDate, 'EEEE', { locale: enGB })} Timeline
            </span>
          </div>
          <span className="text-[11px] text-zinc-400 flex-shrink-0 flex items-center gap-2">
            <span>
            {format(selectedDate, 'd MMM', { locale: enGB })}
            {timed.length > 0 && ` · ${timed.length} ${timed.length === 1 ? 'session' : 'sessions'}`}
            {totalLabel && ` • ${totalLabel}`}
            </span>
            {onAddClick && shown.length > 0 && (
              <button
                aria-label="Add event"
                onClick={() => onAddClick(selectedDateStr, '09:00')}
                className="w-7 h-7 flex items-center justify-center rounded-lg bg-brand-500 text-white shadow-[0_0_12px_rgba(255,107,53,0.4)] active:scale-95 transition-transform"
              >
                <Plus className="w-4 h-4" />
              </button>
            )}
          </span>
        </div>

        {shown.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3 rounded-2xl bg-zinc-900/60">
            <CalendarClock className="w-8 h-8 text-zinc-600" />
            <p className="text-zinc-400 text-sm">Nothing scheduled</p>
            {onAddClick && (
              <button onClick={() => onAddClick(selectedDateStr, '09:00')} className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-brand-500 text-white text-xs font-semibold shadow-[0_0_12px_rgba(255,107,53,0.4)] active:scale-95 transition-transform">
                <Plus className="w-3.5 h-3.5" /> Add event
              </button>
            )}
          </div>
        ) : (
          <>
            {/* All-day chips */}
            {allDay.length > 0 && (
              <div className="space-y-1.5 mb-4">
                {allDay.map(ev => {
                  const color = String(ev.backgroundColor ?? '#ff6b35')
                  return (
                    <button
                      key={String(ev.id)}
                      onClick={() => onEventClick(ev)}
                      className="w-full flex items-center gap-3 text-left rounded-xl px-3 py-2.5 bg-zinc-900 hover:bg-zinc-800 transition-colors"
                    >
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}` }} />
                      <p className="flex-1 min-w-0 text-sm font-semibold text-zinc-100 truncate">{cleanTitle(ev)}</p>
                      <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500 flex-shrink-0">
                        {kindOf(ev) === 'assignment' ? 'Due' : 'All day'}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}

            {/* Timeline */}
            {timed.length > 0 && (
              <div className="relative flex flex-col gap-4 pl-5">
                <div className="absolute left-[7px] top-3 bottom-3 w-0.5 bg-zinc-700" />
                {timed.map(ev => {
                  const start   = toDate(ev.start)
                  const end     = toDate(ev.end)
                  const status  = statusOf(ev)
                  const ep      = ev.extendedProps ?? {}
                  const loc     = ep.isOnline ? 'Online' : (ep.classroom || ep.location || '')
                  const subjTitle = ep.subjectTitle || ep.className || ''
                  const subject = ep.subjectId ? subjectMap[ep.subjectId] : undefined
                  const color   = String(ev.backgroundColor ?? '#ff6b35')
                  const range   = start ? `${fmt(start)} – ${end ? fmt(end) : ''}` : ''
                  const kind    = kindOf(ev)

                  return (
                    <div key={String(ev.id)} className="relative flex flex-col gap-1">
                      {/* Dot on the line */}
                      {status === 'current'
                        ? <span className="absolute -left-[19px] top-1 w-3.5 h-3.5 rounded-full bg-brand-500 shadow-[0_0_12px_rgba(255,107,53,0.9)] animate-pulse z-10" />
                        : status === 'past'
                          ? <span className="absolute -left-[18px] top-1 w-3 h-3 rounded-full bg-ember-tertiary shadow-[0_0_8px_rgba(78,222,163,0.8)] z-10" />
                          : <span className="absolute -left-[18px] top-1 w-3 h-3 rounded-full bg-zinc-700 ring-2 ring-zinc-950 z-10" />}

                      {/* Time + status line */}
                      <div className="flex items-center justify-between text-[11px]">
                        <span className={cn('font-mono tabular-nums', status === 'current' ? 'text-brand-300 font-bold' : status === 'past' ? 'text-ember-tertiary font-semibold' : 'text-zinc-400')}>
                          {range}{start && end && <span className="font-sans text-zinc-500 font-normal"> · {duration(start, end)}</span>}
                        </span>
                        {status === 'current'
                          ? <span className="px-2 py-0.5 rounded-full bg-brand-500/20 text-brand-300 font-semibold">In Session</span>
                          : status === 'past'
                            ? <span className="flex items-center gap-1 text-ember-tertiary"><CheckCircle2 className="w-3.5 h-3.5" /> Completed</span>
                            : <span className="flex items-center gap-1 text-zinc-500"><Clock className="w-3.5 h-3.5" /> Upcoming</span>}
                      </div>

                      {/* Card */}
                      <button
                        onClick={() => onEventClick(ev)}
                        className={cn(
                          'relative w-full text-left rounded-2xl overflow-hidden transition-colors active:scale-[0.99]',
                          status === 'current' ? 'bg-zinc-900 shadow-xl ring-1 ring-brand-500/30' : 'bg-zinc-900/80 shadow-sm hover:bg-zinc-900',
                          status === 'past' && 'opacity-80',
                        )}
                      >
                        {status === 'current' && (
                          <div className="absolute top-0 right-0 w-32 h-32 bg-brand-500/10 rounded-full blur-2xl pointer-events-none" />
                        )}
                        {status === 'current' && subject && (
                          <SubjectCover subject={subject} className="h-28">
                            {loc && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-black/50 backdrop-blur text-brand-300 text-[10px] font-semibold uppercase tracking-wider">
                                <MapPin className="w-3 h-3" /> {loc}
                              </span>
                            )}
                          </SubjectCover>
                        )}
                        <div className="relative p-3.5 flex items-start gap-3">
                          <span className="w-1 self-stretch rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                          <div className="flex-1 min-w-0">
                            <p className={cn('font-display font-semibold text-zinc-100 leading-snug', status === 'current' ? 'text-base' : 'text-[15px]')}>
                              {cleanTitle(ev)}
                            </p>
                            {(subjTitle || (loc && !(status === 'current' && subject))) && (
                              <div className="flex items-center gap-1.5 text-xs text-zinc-400 mt-1 min-w-0">
                                {loc && !(status === 'current' && subject) && (
                                  <>
                                    <MapPin className="w-3.5 h-3.5 text-brand-400 flex-shrink-0" />
                                    <span className="truncate">{loc}</span>
                                  </>
                                )}
                                {subjTitle && loc && !(status === 'current' && subject) && <span className="text-zinc-600">•</span>}
                                {subjTitle && <span className="truncate">{subjTitle}</span>}
                              </div>
                            )}
                          </div>
                          {kind !== 'lesson' && (
                            <span className="px-2 py-0.5 rounded-md bg-zinc-800 text-zinc-400 text-[10px] font-medium flex-shrink-0">{KIND_LABEL[kind].replace(/s$/, '')}</span>
                          )}
                        </div>
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
