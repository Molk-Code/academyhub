<title>Mobile Agenda View</title>
import { useState, useMemo, useEffect, useRef } from 'react'
import type { EventInput } from '@fullcalendar/core'
import { MapPin } from 'lucide-react'
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

export default function MobileAgendaView({ events, onEventClick, onAddClick, initialDate }: MobileAgendaViewProps) {
  const [selectedDate, setSelectedDate] = useState(() => initialDate ?? new Date())
  const [weekOffset,   setWeekOffset]   = useState(() => initialDate ? computeWeekOffset(initialDate) : 0)
  const [isExpanded,   setIsExpanded]   = useState(false)
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
  const eventListRef = useRef<HTMLDivElement>(null)

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

  // ── Event list: block page pull-to-refresh on overscroll ─────────────────

  useEffect(() => {
    const el = eventListRef.current
    if (!el) return
    let sy = 0
    const onStart = (e: TouchEvent) => { sy = e.touches[0].clientY }
    const onMove  = (e: TouchEvent) => {
      const dy = e.touches[0].clientY - sy
      const atTop    = el.scrollTop <= 0
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1
      if ((atTop && dy > 0) || (atBottom && dy < 0)) e.preventDefault()
    }
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove',  onMove,  { passive: false })
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove',  onMove)
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

  const allDay = dayEvents.filter(e => e.allDay)
  const timed  = dayEvents.filter(e => !e.allDay)

  return (
    <div
      className="flex flex-col"
      style={{ height: 'calc(100dvh - 10rem - env(safe-area-inset-top,0px) - env(safe-area-inset-bottom,0px))', overflow: 'hidden' }}
    >

      {/* ── Strip section ──────────────────────────────────────────────── */}
      <div
        ref={stripRef}
        className="flex-shrink-0 border-b select-none"
        style={{
          overflow: 'hidden',
          maxHeight: isExpanded ? '360px' : '118px',
          transition: 'max-height 0.32s ease-out',
          background: 'var(--bg-surface)',
          borderColor: 'var(--border)',
          touchAction: 'none',
        }}
      >
        {/* Top bar: month/year + Today + arrows */}
        <div className="flex items-center justify-between px-3 pt-2 pb-1">
          <span className="text-sm font-bold capitalize" style={{ color: 'var(--text-primary)' }}>
            {format(referenceMonth, 'MMMM yyyy', { locale: enGB })}
          </span>
          <div className="flex items-center gap-0.5">
            <button onClick={goToday} className="text-xs font-semibold px-2 py-1 rounded-lg transition-colors" style={{ color: 'var(--brand)' }}>
              Today
            </button>
            <button onClick={() => isExpanded ? prevMonth() : prevWeek()} className="px-2 py-1 text-zinc-400 hover:bg-white/8 rounded-lg transition-colors text-sm leading-none">‹</button>
            <button onClick={() => isExpanded ? nextMonth() : nextWeek()} className="px-2 py-1 text-zinc-400 hover:bg-white/8 rounded-lg transition-colors text-sm leading-none">›</button>
          </div>
        </div>

        {/* Fixed day-letter header */}
        <div className="flex items-center" style={{ paddingLeft: 32 }}>
          {DAY_LETTERS.map((l, i) => (
            <div key={i} className="flex-1 text-center text-[10px] font-semibold text-zinc-500 pb-1">{l}</div>
          ))}
        </div>

        {/* 3-panel sliding track */}
        <div style={trackStyle}>
          {isExpanded
            ? monthPanels.map(({ month, weeks }, pi) => (
              <div key={pi} style={{ width: '33.333%' }} className="pb-1">
                {weeks.map((days, wi) => (
                  <div key={wi} className="flex items-center">
                    <span className="w-8 text-center text-[9px] font-medium text-zinc-600 flex-shrink-0">
                      w{format(days[0], 'w')}
                    </span>
                    {days.map((day, di) => {
                      const sel     = isSameDay(day, selectedDate)
                      const tod     = isToday(day)
                      const hasDot  = dotDays.has(format(day, 'yyyy-MM-dd'))
                      const inMonth = isSameMonth(day, month)
                      return (
                        <button
                          key={di}
                          onClick={() => {
                            setSelectedDate(day)
                            setWeekOffset(computeWeekOffset(day))
                            setMonthOffset(0)
                            setIsExpanded(false)
                          }}
                          className="flex-1 flex flex-col items-center py-0.5"
                        >
                          <span className={`w-7 h-7 flex items-center justify-center rounded-full text-[13px] font-semibold
                            ${sel ? 'bg-brand-500 text-white'
                              : tod ? 'ring-1 ring-brand-500 text-brand-400'
                              : inMonth ? 'text-zinc-200'
                              : 'text-zinc-600'}`}
                          >
                            {format(day, 'd')}
                          </span>
                          <span className={`w-1 h-1 rounded-full ${hasDot && !sel ? 'bg-zinc-500' : 'bg-transparent'}`} />
                        </button>
                      )
                    })}
                  </div>
                ))}
              </div>
            ))
            : weekPanels.map(({ weekStart, days }, pi) => (
              <div key={pi} style={{ width: '33.333%' }} className="flex items-center pb-2">
                <span className="w-8 text-center text-[9px] font-medium text-zinc-600 flex-shrink-0">
                  w{format(weekStart, 'w')}
                </span>
                {days.map((day, di) => {
                  const sel    = isSameDay(day, selectedDate)
                  const tod    = isToday(day)
                  const hasDot = dotDays.has(format(day, 'yyyy-MM-dd'))
                  return (
                    <button
                      key={di}
                      onClick={() => setSelectedDate(day)}
                      className="flex-1 flex flex-col items-center gap-0.5 py-0.5"
                    >
                      <span className={`w-7 h-7 flex items-center justify-center rounded-full text-[13px] font-semibold transition-colors
                        ${sel ? 'bg-brand-500 text-white'
                          : tod ? 'ring-1 ring-brand-500 text-brand-400'
                          : 'text-zinc-200'}`}
                      >
                        {format(day, 'd')}
                      </span>
                      <span className={`w-1 h-1 rounded-full ${hasDot && !sel ? 'bg-zinc-500' : 'bg-transparent'}`} />
                    </button>
                  )
                })}
              </div>
            ))
          }
        </div>

        {/* Pull handle */}
        <div className="flex justify-center pb-1.5 pt-0.5">
          <div className="w-8 h-[3px] rounded-full bg-zinc-700" />
        </div>
      </div>

      {/* ── Day header ──────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 px-4 py-2 border-b" style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)' }}>
        <p className="text-xs font-semibold text-zinc-400 capitalize">
          {format(selectedDate, 'EEEE d MMMM', { locale: enGB })}
        </p>
      </div>

      {/* ── Event list ──────────────────────────────────────────────────── */}
      <div
        ref={eventListRef}
        className="flex-1 overflow-y-auto"
        style={{ background: 'var(--bg-primary)', overscrollBehavior: 'none' }}
      >
        {dayEvents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 gap-2">
            <p className="text-zinc-500 text-sm">No events</p>
            {onAddClick && (
              <button onClick={() => onAddClick(selectedDateStr, '09:00')} className="text-sm font-medium" style={{ color: 'var(--brand)' }}>
                + Add event
              </button>
            )}
          </div>
        ) : (
          <div>
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
                  <div className="flex-shrink-0 w-14 text-right pt-0.5">
                    {start && <p className="text-[13px] font-bold leading-tight" style={{ color: 'var(--text-primary)' }}>{fmt(start)}</p>}
                    {start && end && (
                      <>
                        <p className="text-[10px] text-zinc-400 mt-0.5 leading-tight">{fmt(end)}</p>
                        <p className="text-[9px] text-zinc-600 mt-0.5 leading-tight">{duration(start, end)}</p>
                      </>
                    )}
                  </div>
                  <div className="w-[3px] self-stretch rounded-full flex-shrink-0 mt-0.5" style={{ backgroundColor: color, minHeight: '2.5rem' }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-semibold leading-snug" style={{ color: 'var(--text-primary)' }}>{rawTitle}</p>
                    {subj && <p className="text-[11px] text-zinc-400 mt-0.5">{subj}</p>}
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
