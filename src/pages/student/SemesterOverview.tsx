import { useState, useMemo, useRef } from 'react'
import { format } from 'date-fns'
import { useCollection, orderBy } from '@/hooks/useFirestore'
import type { SemesterEventDoc, SemesterCategoryDoc } from '@/types'

// ── Constants & math (mirrors SemesterWheel) ──────────────────────────────────

const CX = 200, CY = 200
const R_OUTER = 160, R_INNER = 70
const MONTHS_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const MONTH_CUMUL = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365]
const START_ANGLE = -Math.PI / 2

function dateToAngle(mmdd: string): number {
  if (!mmdd?.includes('-')) return START_ANGLE
  const [m, d] = mmdd.split('-').map(Number)
  return START_ANGLE + ((MONTH_CUMUL[m - 1] + (d - 1)) / 365) * 2 * Math.PI
}
function monthStartAngle(i: number): number {
  return START_ANGLE + (MONTH_CUMUL[i] / 365) * 2 * Math.PI
}
function polar(cx: number, cy: number, r: number, a: number) {
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }
}
function sectorPath(cx: number, cy: number, r1: number, r2: number, a1: number, a2: number): string {
  const o1 = polar(cx, cy, r2, a1), o2 = polar(cx, cy, r2, a2)
  const i1 = polar(cx, cy, r1, a2), i2 = polar(cx, cy, r1, a1)
  const large = (a2 - a1) > Math.PI ? 1 : 0
  return [
    `M${o1.x.toFixed(2)},${o1.y.toFixed(2)}`,
    `A${r2},${r2} 0 ${large},1 ${o2.x.toFixed(2)},${o2.y.toFixed(2)}`,
    `L${i1.x.toFixed(2)},${i1.y.toFixed(2)}`,
    `A${r1},${r1} 0 ${large},0 ${i2.x.toFixed(2)},${i2.y.toFixed(2)}`,
    'Z',
  ].join(' ')
}
function arcPath(cx: number, cy: number, r: number, a1: number, a2: number): string {
  if (a2 < a1) a2 += 2 * Math.PI
  if (Math.abs(a2 - a1) < 0.03) a2 = a1 + 0.03
  const s = polar(cx, cy, r, a1), e = polar(cx, cy, r, a2)
  return `M${s.x.toFixed(2)},${s.y.toFixed(2)} A${r},${r} 0 ${(a2-a1)>Math.PI?1:0},1 ${e.x.toFixed(2)},${e.y.toFixed(2)}`
}

function getSchoolYear(): string {
  const now = new Date(), y = now.getFullYear(), m = now.getMonth() + 1
  const start = m >= 8 ? y : y - 1
  return `${start}/${String(start + 1).slice(-2)}`
}
function catColor(name: string, cats: SemesterCategoryDoc[]): string {
  return cats.find(c => c.name === name)?.color ?? '#94a3b8'
}

function formatMmDd(mmdd: string): string {
  const [m, d] = mmdd.split('-').map(Number)
  if (!m || !d) return mmdd
  return `${MONTHS_ABBR[m - 1]} ${d}`
}

function isEventActiveNow(ev: SemesterEventDoc, today: string): boolean {
  const { startDate: s, endDate: e } = ev
  return s <= e ? today >= s && today <= e : today >= s || today <= e
}
function isEventPast(ev: SemesterEventDoc, today: string): boolean {
  if (isEventActiveNow(ev, today)) return false
  const { startDate: s, endDate: e } = ev
  return s <= e ? e < today : e < today && s > today
}
function daysUntilStart(startDate: string): number {
  const today = new Date(); today.setHours(0,0,0,0)
  const [m, d] = startDate.split('-').map(Number)
  const target = new Date(today.getFullYear(), m - 1, d)
  if (target < today) target.setFullYear(today.getFullYear() + 1)
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}
function daysSinceEnd(endDate: string): number {
  const today = new Date(); today.setHours(0,0,0,0)
  const [m, d] = endDate.split('-').map(Number)
  let target = new Date(today.getFullYear(), m - 1, d)
  if (target > today) target.setFullYear(today.getFullYear() - 1)
  return Math.round((today.getTime() - target.getTime()) / (1000 * 60 * 60 * 24))
}

// ── SVG Wheel (read-only, click-to-highlight) ─────────────────────────────────

function WheelSvg({
  events, categoryDocs, selectedId, hoveredId, onSelect, onHover, tooltipRef,
}: {
  events: SemesterEventDoc[]
  categoryDocs: SemesterCategoryDoc[]
  selectedId: string | null
  hoveredId: string | null
  onSelect: (id: string) => void
  onHover: (id: string | null) => void
  tooltipRef: React.RefObject<HTMLDivElement | null>
}) {
  const todayMmdd = format(new Date(), 'MM-dd')
  const todayAngle = dateToAngle(todayMmdd)
  const todayOuter = polar(CX, CY, R_OUTER + 6, todayAngle)
  const todayInner = polar(CX, CY, R_INNER - 4, todayAngle)

  const eventArcs = useMemo(() => {
    const laneOccupied: Array<Array<[number, number]>> = []
    function rangesOverlap(a1: number, a2: number, b1: number, b2: number) {
      if (a2 < a1) a2 += 2 * Math.PI
      if (b2 < b1) b2 += 2 * Math.PI
      return a1 < b2 && a2 > b1
    }
    return events.filter(e => e.isActive).map(ev => {
      const a1 = dateToAngle(ev.startDate)
      let a2 = dateToAngle(ev.endDate)
      if (a2 < a1) a2 += 2 * Math.PI
      if (Math.abs(a2 - a1) < 0.03) a2 = a1 + 0.03
      let lane = 0
      while (true) {
        if (!laneOccupied[lane]) { laneOccupied[lane] = []; break }
        if (!laneOccupied[lane].some(([b1, b2]) => rangesOverlap(a1, a2, b1, b2))) break
        lane++
      }
      laneOccupied[lane].push([a1, a2])
      return { ev, a1, a2, r: R_OUTER - 6 - lane * 13 }
    })
  }, [events])

  return (
    <svg viewBox="0 0 400 400" className="w-full" style={{ maxWidth: 420, userSelect: 'none' }}>
      {/* Month sectors */}
      {MONTHS_ABBR.map((_, i) => {
        const a1 = monthStartAngle(i), a2 = monthStartAngle(i + 1)
        return (
          <path
            key={i}
            d={sectorPath(CX, CY, R_INNER, R_OUTER, a1, a2)}
            fill={i % 2 === 0 ? 'rgba(30,41,59,0.9)' : 'rgba(15,23,42,0.9)'}
          />
        )
      })}
      {/* Month labels */}
      {MONTHS_ABBR.map((abbr, i) => {
        const mid = (monthStartAngle(i) + monthStartAngle(i + 1)) / 2
        const lp = polar(CX, CY, (R_INNER + R_OUTER) / 2, mid)
        return (
          <text
            key={abbr}
            x={lp.x} y={lp.y}
            textAnchor="middle" dominantBaseline="middle"
            fontSize="9" fill="rgba(148,163,184,0.7)"
            transform={`rotate(${(mid * 180 / Math.PI) + 90},${lp.x},${lp.y})`}
          >{abbr}</text>
        )
      })}
      {/* Spoke lines */}
      {MONTHS_ABBR.map((_, i) => {
        const a = monthStartAngle(i)
        const inner = polar(CX, CY, R_INNER, a), outer = polar(CX, CY, R_OUTER, a)
        return (
          <line
            key={i}
            x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y}
            stroke="rgba(30,41,59,1)" strokeWidth="1"
          />
        )
      })}
      {/* Event arcs */}
      {eventArcs.map(({ ev, a1, a2, r }) => {
        const color = catColor(ev.category, categoryDocs)
        const isHov = hoveredId === ev.id
        const isSel = selectedId === ev.id
        return (
          <path
            key={ev.id}
            d={arcPath(CX, CY, r, a1, a2)}
            fill="none"
            stroke={color}
            strokeWidth={isHov || isSel ? 10 : 7}
            strokeLinecap="round"
            opacity={isHov || isSel ? 1 : 0.75}
            style={{ cursor: 'pointer', transition: 'stroke-width 0.15s, opacity 0.15s' }}
            onClick={() => onSelect(ev.id)}
            onMouseEnter={e => {
              onHover(ev.id)
              if (tooltipRef.current) {
                const svg = (e.target as SVGPathElement).closest('svg')!
                const rect = svg.getBoundingClientRect()
                const mid = (a1 + a2) / 2
                const tp = polar(CX, CY, r, mid)
                const scaleX = rect.width / 400, scaleY = rect.height / 400
                Object.assign(tooltipRef.current.style, {
                  display: 'block',
                  left: `${tp.x * scaleX}px`,
                  top: `${tp.y * scaleY}px`,
                })
                const dot = tooltipRef.current.querySelector('[data-dot]') as HTMLElement | null
                const title = tooltipRef.current.querySelector('[data-title]') as HTMLElement | null
                const dates = tooltipRef.current.querySelector('[data-dates]') as HTMLElement | null
                if (dot) dot.style.backgroundColor = color
                if (title) title.textContent = ev.title
                if (dates) dates.textContent = `${formatMmDd(ev.startDate)} – ${formatMmDd(ev.endDate)}`
              }
            }}
            onMouseLeave={() => {
              onHover(null)
              if (tooltipRef.current) tooltipRef.current.style.display = 'none'
            }}
          />
        )
      })}
      {/* Today marker */}
      <line
        x1={todayOuter.x} y1={todayOuter.y}
        x2={todayInner.x} y2={todayInner.y}
        stroke="#ef4444" strokeWidth="2" strokeLinecap="round"
      />
      {/* Centre */}
      <circle cx={CX} cy={CY} r={R_INNER} fill="rgba(15,23,42,0.95)" />
      <text x={CX} y={CY - 13} textAnchor="middle" fontSize="10" fill="rgba(148,163,184,0.7)">School year</text>
      <text x={CX} y={CY + 3}  textAnchor="middle" fontSize="10" fill="rgba(148,163,184,0.7)">Year</text>
      <text x={CX} y={CY + 19} textAnchor="middle" fontSize="15" fontWeight="bold" fill="#f1f5f9">
        {getSchoolYear()}
      </text>
    </svg>
  )
}

// ── Event card (read-only) ─────────────────────────────────────────────────────

function EventCard({
  ev, todayMmdd, categoryDocs, isSelected, onClick, dimmed = false,
}: {
  ev: SemesterEventDoc
  todayMmdd: string
  categoryDocs: SemesterCategoryDoc[]
  isSelected: boolean
  onClick: () => void
  dimmed?: boolean
}) {
  const active = isEventActiveNow(ev, todayMmdd)
  const past   = !active && isEventPast(ev, todayMmdd)
  const days   = daysUntilStart(ev.startDate)
  const color  = catColor(ev.category, categoryDocs)

  return (
    <button
      onClick={onClick}
      className="w-full text-left"
    >
      <div
        className="flex items-start gap-3 p-3 rounded-xl border transition-all"
        style={{
          background: isSelected ? `${color}18` : 'var(--bg-surface)',
          borderColor: isSelected ? `${color}60` : 'var(--border)',
          opacity: dimmed ? 0.5 : 1,
        }}
      >
        <div className="w-1 self-stretch rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{ev.title}</p>
            {active && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 bg-emerald-900/40 text-emerald-400 border border-emerald-700/40">
                Active
              </span>
            )}
            {!active && !past && days <= 14 && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 bg-amber-900/40 text-amber-400 border border-amber-700/40">
                {days}d
              </span>
            )}
          </div>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
            {formatMmDd(ev.startDate)} – {formatMmDd(ev.endDate)}
            {ev.category && <span className="ml-1.5 opacity-60">· {ev.category}</span>}
          </p>
          {ev.description && (
            <p className="text-xs mt-1 leading-snug" style={{ color: 'var(--text-secondary)', opacity: 0.7 }}>
              {ev.description}
            </p>
          )}
        </div>
      </div>
    </button>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SemesterOverview() {
  const { data: events }       = useCollection<SemesterEventDoc>('semester_events')
  const { data: categoryDocs } = useCollection<SemesterCategoryDoc>('semester_categories', [orderBy('createdAt', 'asc')])

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [hoveredId,  setHoveredId]  = useState<string | null>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)

  const todayMmdd = format(new Date(), 'MM-dd')

  const activeEvents = useMemo(() => events.filter(e => e.isActive), [events])

  const { activeNow, upcoming, past } = useMemo(() => {
    const activeNow: SemesterEventDoc[] = [], upcoming: SemesterEventDoc[] = [], past: SemesterEventDoc[] = []
    for (const ev of activeEvents) {
      if (isEventActiveNow(ev, todayMmdd))  activeNow.push(ev)
      else if (isEventPast(ev, todayMmdd))  past.push(ev)
      else                                  upcoming.push(ev)
    }
    upcoming.sort((a, b) => daysUntilStart(a.startDate) - daysUntilStart(b.startDate))
    past.sort((a, b) => daysSinceEnd(a.endDate) - daysSinceEnd(b.endDate))
    return { activeNow, upcoming, past }
  }, [activeEvents, todayMmdd])

  function toggleSelect(id: string) { setSelectedId(prev => prev === id ? null : id) }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Semester Overview</h1>
        <p className="text-zinc-400 text-sm mt-1">Key dates and recurring events across the academic year.</p>
      </div>

      <div className="flex flex-col lg:flex-row gap-6 items-start">
        {/* Wheel */}
        <div className="w-full lg:w-auto lg:flex-shrink-0">
          <div className="rounded-2xl border p-4 relative" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
            <div className="w-[340px] sm:w-[420px] mx-auto relative">
              <WheelSvg
                events={events}
                categoryDocs={categoryDocs}
                selectedId={selectedId}
                hoveredId={hoveredId}
                onSelect={toggleSelect}
                onHover={setHoveredId}
                tooltipRef={tooltipRef}
              />
              <div
                ref={tooltipRef as React.RefObject<HTMLDivElement>}
                className="pointer-events-none absolute z-20 hidden"
                style={{ transform: 'translate(-50%, calc(-100% - 8px))', minWidth: 140 }}
              >
                <div className="rounded-xl px-3 py-2 shadow-xl border text-sm" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span data-dot className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: '#fff' }} />
                    <span data-title className="font-semibold" style={{ color: 'var(--text-primary)' }} />
                  </div>
                  <span data-dates className="text-xs" style={{ color: 'var(--text-secondary)' }} />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar list */}
        <div className="flex-1 min-w-0 space-y-5">
          <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Events</h2>

          {activeNow.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-emerald-500 flex items-center gap-1.5">
                <span className="animate-pulse w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                Active Now
              </p>
              {activeNow.map(ev => (
                <EventCard key={ev.id} ev={ev} todayMmdd={todayMmdd} categoryDocs={categoryDocs}
                  isSelected={selectedId === ev.id} onClick={() => toggleSelect(ev.id)} />
              ))}
            </div>
          )}

          {upcoming.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Coming Up</p>
              {upcoming.map(ev => (
                <EventCard key={ev.id} ev={ev} todayMmdd={todayMmdd} categoryDocs={categoryDocs}
                  isSelected={selectedId === ev.id} onClick={() => toggleSelect(ev.id)} />
              ))}
            </div>
          )}

          {past.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-zinc-600">Past</p>
              {past.map(ev => (
                <EventCard key={ev.id} ev={ev} todayMmdd={todayMmdd} categoryDocs={categoryDocs}
                  isSelected={selectedId === ev.id} onClick={() => toggleSelect(ev.id)} dimmed />
              ))}
            </div>
          )}

          {activeEvents.length === 0 && (
            <div className="rounded-2xl border p-8 text-center" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>No semester events have been added yet.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
