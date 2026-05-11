import { useState, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { useCollection, orderBy } from '@/hooks/useFirestore'
import type { SemesterEventDoc, SemesterCategoryDoc } from '@/types'
import { ExternalLink } from 'lucide-react'

// ─────────────────────────────────────────────────────────────────────────────
// Constants & math helpers
// ─────────────────────────────────────────────────────────────────────────────

const CX = 200, CY = 200
const R_OUTER = 160, R_INNER = 70

const MONTHS_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const MONTH_CUMUL = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365]
const START_ANGLE = -Math.PI / 2

function dateToAngle(mmdd: string): number {
  if (!mmdd?.includes('-')) return START_ANGLE
  const [m, d] = mmdd.split('-').map(Number)
  const dayFrom1 = MONTH_CUMUL[m - 1] + (d - 1)
  return START_ANGLE + (dayFrom1 / 365) * 2 * Math.PI
}

function monthStartAngle(i: number): number {
  return START_ANGLE + (MONTH_CUMUL[i] / 365) * 2 * Math.PI
}

function polar(cx: number, cy: number, r: number, angle: number) {
  return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) }
}

function sectorPath(cx: number, cy: number, r1: number, r2: number, a1: number, a2: number): string {
  const o1 = polar(cx, cy, r2, a1)
  const o2 = polar(cx, cy, r2, a2)
  const i1 = polar(cx, cy, r1, a2)
  const i2 = polar(cx, cy, r1, a1)
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
  const s = polar(cx, cy, r, a1)
  const e = polar(cx, cy, r, a2)
  const large = (a2 - a1) > Math.PI ? 1 : 0
  return `M${s.x.toFixed(2)},${s.y.toFixed(2)} A${r},${r} 0 ${large},1 ${e.x.toFixed(2)},${e.y.toFixed(2)}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Date helpers
// ─────────────────────────────────────────────────────────────────────────────

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function formatMmDd(mmdd: string): string {
  const [m, d] = mmdd.split('-').map(Number)
  if (!m || !d) return mmdd
  return `${MONTH_ABBR[m - 1]} ${d}`
}

function isEventActiveNow(ev: SemesterEventDoc, todayMmdd: string): boolean {
  const { startDate: s, endDate: e } = ev
  return s <= e
    ? todayMmdd >= s && todayMmdd <= e
    : todayMmdd >= s || todayMmdd <= e
}

function daysUntilStart(startDate: string): number {
  const today = new Date()
  const [m, d] = startDate.split('-').map(Number)
  const target = new Date(today.getFullYear(), m - 1, d)
  if (target < today) target.setFullYear(today.getFullYear() + 1)
  return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}

function getSchoolYear(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth() + 1
  const start = m >= 8 ? y : y - 1
  return `${start}/${String(start + 1).slice(-2)}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Category badge — uses the category's own hex colour
// ─────────────────────────────────────────────────────────────────────────────

function catColor(name: string, cats: SemesterCategoryDoc[]): string {
  return cats.find(c => c.name === name)?.color ?? '#94a3b8'
}

// ─────────────────────────────────────────────────────────────────────────────
// SVG Wheel component
// ─────────────────────────────────────────────────────────────────────────────

interface WheelProps {
  events: SemesterEventDoc[]
  categoryDocs: SemesterCategoryDoc[]
  selectedId: string | null
  hoveredId: string | null
  onSelect: (id: string) => void
  onHover: (id: string | null) => void
  tooltipRef: React.RefObject<HTMLDivElement | null>
}

function SemesterWheelSvg({ events, categoryDocs, selectedId, hoveredId, onSelect, onHover, tooltipRef }: WheelProps) {
  const todayMmdd = format(new Date(), 'MM-dd')
  const todayAngle = dateToAngle(todayMmdd)

  const todayOuter = polar(CX, CY, R_OUTER + 6, todayAngle)
  const todayInner = polar(CX, CY, R_INNER - 4, todayAngle)

  // Event arc lanes — assign inward-stacking radii to avoid overlaps
  const eventArcs = useMemo(() => {
    const laneOccupied: Array<Array<[number, number]>> = [] // lane → list of [a1, a2] ranges

    function rangesOverlap(a1: number, a2: number, b1: number, b2: number): boolean {
      // normalize
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
        const blocked = laneOccupied[lane].some(([b1, b2]) => rangesOverlap(a1, a2, b1, b2))
        if (!blocked) break
        lane++
      }
      laneOccupied[lane].push([a1, a2])
      const r = R_OUTER - 6 - lane * 13  // 154, 141, 128, 115...

      return { ev, a1, a2, r }
    })
  }, [events])

  return (
    <svg
      viewBox="0 0 400 400"
      className="w-full"
      style={{ maxWidth: 420, userSelect: 'none' }}
    >
      {/* Month sectors */}
      {MONTHS_ABBR.map((_, i) => {
        const a1 = monthStartAngle(i)
        const a2 = monthStartAngle(i + 1)
        return (
          <path
            key={i}
            d={sectorPath(CX, CY, R_INNER, R_OUTER, a1, a2)}
            fill={i % 2 === 0 ? 'rgba(255,255,255,0.035)' : 'rgba(255,255,255,0.065)'}
          />
        )
      })}

      {/* Dividers */}
      {MONTHS_ABBR.map((_, i) => {
        const angle = monthStartAngle(i)
        const inner = polar(CX, CY, R_INNER, angle)
        const outer = polar(CX, CY, R_OUTER, angle)
        return (
          <line key={i}
            x1={inner.x.toFixed(2)} y1={inner.y.toFixed(2)}
            x2={outer.x.toFixed(2)} y2={outer.y.toFixed(2)}
            stroke="rgba(255,255,255,0.07)" strokeWidth="1" />
        )
      })}

      {/* Month labels */}
      {MONTHS_ABBR.map((month, i) => {
        const a1 = monthStartAngle(i)
        const a2 = monthStartAngle(i + 1)
        const midAngle = (a1 + a2) / 2
        const R_LABEL = 118
        const { x: lx, y: ly } = polar(CX, CY, R_LABEL, midAngle)
        const midDeg = midAngle * 180 / Math.PI
        const textRot = midDeg + 90 + (Math.sin(midAngle) > 0 ? 180 : 0)
        return (
          <text
            key={month}
            x={lx.toFixed(2)}
            y={ly.toFixed(2)}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize="10"
            fontWeight="500"
            fill="rgba(148,163,184,0.85)"
            transform={`rotate(${textRot.toFixed(1)},${lx.toFixed(2)},${ly.toFixed(2)})`}
          >
            {month}
          </text>
        )
      })}

      {/* Event arcs */}
      {eventArcs.map(({ ev, a1, a2, r }) => {
        const isSelected = selectedId === ev.id
        const isHovered  = hoveredId === ev.id
        const active     = isSelected || isHovered
        const color      = catColor(ev.category, categoryDocs)
        const d = arcPath(CX, CY, r, a1, a2)
        return (
          <path
            key={ev.id}
            d={d}
            fill="none"
            stroke={color}
            strokeWidth={active ? 11 : 8}
            strokeLinecap="round"
            opacity={active ? 1 : 0.72}
            style={{ cursor: 'pointer', transition: 'stroke-width 0.15s, opacity 0.15s' }}
            onClick={() => onSelect(ev.id)}
            onMouseEnter={e => {
              onHover(ev.id)
              if (tooltipRef.current) {
                const rect = (e.currentTarget.closest('svg') as SVGSVGElement).getBoundingClientRect()
                const mx = (e.clientX - rect.left) / rect.width * 400
                const my = (e.clientY - rect.top) / rect.height * 400
                tooltipRef.current.style.display = 'block'
                tooltipRef.current.style.left = `${(mx / 400) * 100}%`
                tooltipRef.current.style.top  = `${(my / 400) * 100}%`
                const titleEl = tooltipRef.current.querySelector('[data-title]')
                const datesEl = tooltipRef.current.querySelector('[data-dates]')
                if (titleEl) titleEl.textContent = ev.title
                if (datesEl) datesEl.textContent = `${formatMmDd(ev.startDate)} – ${formatMmDd(ev.endDate)}`
                const dot = tooltipRef.current.querySelector('[data-dot]') as HTMLElement | null
                if (dot) dot.style.backgroundColor = color
              }
            }}
            onMouseLeave={() => {
              onHover(null)
              if (tooltipRef.current) tooltipRef.current.style.display = 'none'
            }}
          />
        )
      })}

      {/* Today line */}
      <line
        x1={todayInner.x.toFixed(2)} y1={todayInner.y.toFixed(2)}
        x2={todayOuter.x.toFixed(2)} y2={todayOuter.y.toFixed(2)}
        stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" opacity="0.9"
      />
      <circle cx={todayOuter.x.toFixed(2)} cy={todayOuter.y.toFixed(2)} r="4" fill="#ef4444" />

      {/* Center */}
      <circle cx={CX} cy={CY} r={R_INNER - 3} fill="#0f172a" />
      <text x={CX} y={CY - 10} textAnchor="middle" fontSize="10" fill="rgba(148,163,184,0.7)">Academic</text>
      <text x={CX} y={CY + 3} textAnchor="middle" fontSize="10" fill="rgba(148,163,184,0.7)">Year</text>
      <text x={CX} y={CY + 19} textAnchor="middle" fontSize="15" fontWeight="bold" fill="#f1f5f9">
        {getSchoolYear()}
      </text>
    </svg>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

export default function SemesterWheel() {
  const { data: events } = useCollection<SemesterEventDoc>('semester_events')
  const { data: categoryDocs } = useCollection<SemesterCategoryDoc>('semester_categories', [orderBy('createdAt', 'asc')])

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)

  const todayMmdd = format(new Date(), 'MM-dd')

  const activeEvents  = useMemo(() => events.filter(e => e.isActive), [events])

  const { upcoming, past } = useMemo(() => {
    const up: SemesterEventDoc[] = []
    const past: SemesterEventDoc[] = []
    for (const ev of activeEvents) {
      const active = isEventActiveNow(ev, todayMmdd)
      const days   = daysUntilStart(ev.startDate)
      if (active || days >= 0) up.push(ev)
      else past.push(ev)
    }
    up.sort((a, b) => {
      const aActive = isEventActiveNow(a, todayMmdd)
      const bActive = isEventActiveNow(b, todayMmdd)
      if (aActive !== bActive) return aActive ? -1 : 1
      return daysUntilStart(a.startDate) - daysUntilStart(b.startDate)
    })
    return { upcoming: up, past }
  }, [activeEvents, todayMmdd])

  function toggleSelect(id: string) {
    setSelectedId(prev => prev === id ? null : id)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">Semester Wheel</h1>
          <p className="text-zinc-400 text-sm mt-1">Annual recurring events across the academic calendar.</p>
        </div>
        <div className="flex items-center gap-3 text-xs text-zinc-500 flex-wrap">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-0.5 bg-red-500 rounded-full inline-block" />
            Today
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-4 h-2 rounded-full inline-block bg-brand-500 opacity-80" />
            Event arc
          </span>
        </div>
      </div>

      {/* Layout: wheel + sidebar */}
      <div className="flex flex-col lg:flex-row gap-6 items-start">

        {/* Wheel */}
        <div className="w-full lg:w-auto lg:flex-shrink-0 relative">
          <div
            className="rounded-2xl border p-4 relative"
            style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
          >
            <div className="w-[340px] sm:w-[420px] mx-auto relative">
              <SemesterWheelSvg
                events={events}
                categoryDocs={categoryDocs}
                selectedId={selectedId}
                hoveredId={hoveredId}
                onSelect={toggleSelect}
                onHover={setHoveredId}
                tooltipRef={tooltipRef}
              />
              {/* Tooltip overlay (absolute inside relative wrapper) */}
              <div
                ref={tooltipRef as React.RefObject<HTMLDivElement>}
                className="pointer-events-none absolute z-20 hidden"
                style={{ transform: 'translate(-50%, calc(-100% - 8px))', minWidth: 140 }}
              >
                <div
                  className="rounded-xl px-3 py-2 shadow-xl border text-sm"
                  style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
                >
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

        {/* Sidebar */}
        <div className="flex-1 min-w-0 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
              Semester Reminders
            </h2>
            <Link
              to="/admin/semester-events"
              className="flex items-center gap-1 text-xs text-brand-400 hover:text-brand-300 transition-colors"
            >
              Manage <ExternalLink className="w-3 h-3" />
            </Link>
          </div>

          {/* Active & Upcoming */}
          {upcoming.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Active & Upcoming
              </p>
              {upcoming.map(ev => (
                <EventCard
                  key={ev.id}
                  ev={ev}
                  todayMmdd={todayMmdd}
                  categoryDocs={categoryDocs}
                  isSelected={selectedId === ev.id}
                  onClick={() => toggleSelect(ev.id)}
                />
              ))}
            </div>
          )}

          {/* Past */}
          {past.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Past
              </p>
              {past.map(ev => (
                <EventCard
                  key={ev.id}
                  ev={ev}
                  todayMmdd={todayMmdd}
                  categoryDocs={categoryDocs}
                  isSelected={selectedId === ev.id}
                  onClick={() => toggleSelect(ev.id)}
                  dimmed
                />
              ))}
            </div>
          )}

          {activeEvents.length === 0 && (
            <div
              className="rounded-2xl border p-8 text-center"
              style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
            >
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                No active semester events. Add some from the admin panel.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Event card
// ─────────────────────────────────────────────────────────────────────────────

function EventCard({
  ev,
  todayMmdd,
  categoryDocs,
  isSelected,
  onClick,
  dimmed = false,
}: {
  ev: SemesterEventDoc
  todayMmdd: string
  categoryDocs: SemesterCategoryDoc[]
  isSelected: boolean
  onClick: () => void
  dimmed?: boolean
}) {
  const active   = isEventActiveNow(ev, todayMmdd)
  const days     = daysUntilStart(ev.startDate)
  const color = catColor(ev.category, categoryDocs)

  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-2xl border p-4 transition-all hover:shadow-sm"
      style={{
        background: isSelected
          ? `${color}18`
          : 'var(--bg-surface)',
        borderColor: isSelected
          ? `${color}55`
          : 'var(--border)',
        opacity: dimmed ? 0.55 : 1,
      }}
    >
      <div className="flex items-start gap-3">
        <span
          className="w-3 h-3 rounded-full flex-shrink-0 mt-0.5"
          style={{ backgroundColor: color }}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              {ev.title}
            </p>
            {active && (
              <span className="animate-pulse text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                Active now
              </span>
            )}
          </div>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
            {formatMmDd(ev.startDate)} – {formatMmDd(ev.endDate)}
          </p>
          {ev.description && (
            <p className="text-xs mt-1 line-clamp-1" style={{ color: 'var(--text-muted)' }}>
              {ev.description}
            </p>
          )}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <span
              className="text-[10px] px-2 py-0.5 rounded-full font-medium"
              style={{ backgroundColor: `${color}22`, color, border: `1px solid ${color}44` }}
            >
              {ev.category}
            </span>
            {!active && (
              <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                {days === 0 ? 'Starts today' : days === 1 ? 'Tomorrow' : `In ${days} days`}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  )
}
