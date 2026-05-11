import { useMemo, useState } from 'react'
import {
  parseISO, addDays, differenceInCalendarDays,
  format, startOfWeek, endOfWeek, isWithinInterval,
  eachMonthOfInterval, startOfMonth, endOfMonth,
  getYear, addMonths,
} from 'date-fns'
import type { LessonDoc, LessonCategoryDoc, SubjectDoc } from '@/types'
import { cn } from '@/lib/utils'

// ── Geometry helpers ──────────────────────────────────────────────────────────

const CX = 380, CY = 380          // SVG center
const R_CORE     = 90             // innermost label circle
const R_SEM      = 136            // semester ring outer edge
const R_CATEGORY = 168            // category ring outer edge
const R_MONTH    = 200            // month ring outer edge
const R_WEEK     = 285            // week arcs outer edge
const R_OUTER    = 296            // outermost border
const GAP_RAD    = 0.008          // radians gap between adjacent week segments

const SUBJECT_HEX: Record<string, string> = {
  'bg-indigo-500': '#6366f1',
  'bg-violet-500': '#8b5cf6',
  'bg-pink-500':   '#ec4899',
  'bg-sky-500':    '#0ea5e9',
  'bg-teal-500':   '#14b8a6',
  'bg-emerald-500':'#10b981',
  'bg-amber-500':  '#f59e0b',
  'bg-orange-500': '#f97316',
  'bg-rose-500':   '#f43f5e',
}

/** Convert a day-offset fraction to an SVG angle (Jan 1 = top/north, clockwise).
 *  offsetFrac: fraction within the year that Jan 1 falls on — rotates the wheel
 *  so that Jan 1 always lands at -π/2 (12 o'clock). */
function fracToAngle(frac: number, offsetFrac = 0): number {
  return -Math.PI / 2 + (frac - offsetFrac) * Math.PI * 2
}

function polarXY(cx: number, cy: number, r: number, angle: number): [number, number] {
  return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)]
}

/** Draw a filled annulus (donut) segment */
function annulusPath(
  cx: number, cy: number,
  rInner: number, rOuter: number,
  a1: number, a2: number,
): string {
  const [ox1, oy1] = polarXY(cx, cy, rOuter, a1)
  const [ox2, oy2] = polarXY(cx, cy, rOuter, a2)
  const [ix1, iy1] = polarXY(cx, cy, rInner, a1)
  const [ix2, iy2] = polarXY(cx, cy, rInner, a2)
  const large = a2 - a1 > Math.PI ? 1 : 0
  return [
    `M ${ox1.toFixed(2)} ${oy1.toFixed(2)}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${ox2.toFixed(2)} ${oy2.toFixed(2)}`,
    `L ${ix2.toFixed(2)} ${iy2.toFixed(2)}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${ix1.toFixed(2)} ${iy1.toFixed(2)}`,
    'Z',
  ].join(' ')
}

// ── Props ────────────────────────────────────────────────────────────────────

interface Props {
  lessons:    LessonDoc[]
  subjects:   SubjectDoc[]
  categories: LessonCategoryDoc[]
  sem1Start:  string
  sem1End:    string
  sem2Start?: string | null
  sem2End?:   string | null
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AnnualPlanWheel({ lessons, subjects, categories, sem1Start, sem1End, sem2Start, sem2End }: Props) {
  const [hoveredWeek,   setHoveredWeek]   = useState<string | null>(null)
  const [showCategories, setShowCategories] = useState(false)

  const subjectMap  = useMemo(() => Object.fromEntries(subjects.map(s => [s.id, s])),  [subjects])
  const categoryMap = useMemo(() => Object.fromEntries(categories.map(c => [c.id, c])), [categories])

  const wheel = useMemo(() => {
    const s1Start = parseISO(sem1Start)
    const s1End   = parseISO(sem1End)
    const hasSem2 = !!(sem2Start && sem2End)
    const s2Start = hasSem2 ? parseISO(sem2Start!) : null
    const s2End   = hasSem2 ? parseISO(sem2End!)   : null

    const yearStart = s1Start
    // Always show a full 12-month span so summer after sem2 is visible
    const fullYearEnd = addMonths(s1Start, 12)
    const naturalEnd  = hasSem2 ? s2End! : s1End
    const yearEnd     = naturalEnd > fullYearEnd ? naturalEnd : fullYearEnd
    const totalDays   = differenceInCalendarDays(yearEnd, yearStart) + 1

    // Jan 1 offset: find the Jan 1 that falls within (or at start of) the year span
    const startYear    = getYear(yearStart)
    const jan1ThisYear = new Date(startYear, 0, 1)
    const jan1         = jan1ThisYear >= yearStart ? jan1ThisYear : new Date(startYear + 1, 0, 1)
    const jan1Frac     = differenceInCalendarDays(jan1, yearStart) / totalDays

    // Convenience: angle with Jan 1 at top
    const fa = (frac: number) => fracToAngle(frac, jan1Frac)

    /** Is a date in semester 1 or 2? */
    function inSem(d: Date): 1 | 2 | null {
      if (isWithinInterval(d, { start: s1Start, end: s1End })) return 1
      if (hasSem2 && s2Start && s2End && isWithinInterval(d, { start: s2Start, end: s2End })) return 2
      return null
    }

    // ── Build week segments ──────────────────────────────────────────────────
    type WeekSeg = {
      key:          string
      a1:           number
      a2:           number
      color:        string
      categoryColor: string | null
      sem:          1 | 2 | null
      weekLabel:    string
      subjectList:  string[]
      categoryName: string | null
    }

    const weekSegs: WeekSeg[] = []

    // Iterate week by week from yearStart to yearEnd
    let cursor = startOfWeek(yearStart, { weekStartsOn: 1 })
    while (cursor <= yearEnd) {
      const wStart = cursor
      const wEnd   = endOfWeek(cursor, { weekStartsOn: 1 })

      // Clamp to year range
      const clampStart = wStart < yearStart ? yearStart : wStart
      const clampEnd   = wEnd   > yearEnd   ? yearEnd   : wEnd

      const startOff = differenceInCalendarDays(clampStart, yearStart)
      const endOff   = differenceInCalendarDays(clampEnd,   yearStart) + 1

      const a1 = fa((startOff + GAP_RAD) / totalDays)
      const a2 = fa((endOff   - GAP_RAD) / totalDays)

      if (a2 <= a1) { cursor = addDays(cursor, 7); continue }

      // Determine semester (use middle of week)
      const midDay = addDays(clampStart, Math.floor((endOff - startOff) / 2))
      const sem    = inSem(midDay)

      // Find lessons in this week range
      const weekLessons = lessons.filter(l => {
        const d = l.startTime?.toDate?.()
        if (!d) return false
        return d >= clampStart && d <= addDays(clampEnd, 1)
      })

      // Group by subject → count
      const subjectCounts: Record<string, { count: number; title: string; color: string }> = {}
      for (const lesson of weekLessons) {
        const subj = subjectMap[lesson.subjectId]
        if (!subj) continue
        if (!subjectCounts[subj.id]) {
          subjectCounts[subj.id] = {
            count: 0,
            title: subj.title,
            color: SUBJECT_HEX[subj.color] ?? '#6366f1',
          }
        }
        subjectCounts[subj.id].count++
      }

      const sorted = Object.values(subjectCounts).sort((a, b) => b.count - a.count)
      const color  = sorted[0]?.color ?? (sem === 1 ? '#e2e8f0' : sem === 2 ? '#dde9f8' : '#fed7aa')

      // Dominant category
      const catCounts: Record<string, { count: number; name: string; color: string }> = {}
      for (const lesson of weekLessons) {
        if (!lesson.categoryId) continue
        const cat = categoryMap[lesson.categoryId]
        if (!cat) continue
        if (!catCounts[cat.id]) catCounts[cat.id] = { count: 0, name: cat.name, color: cat.color }
        catCounts[cat.id].count++
      }
      const sortedCats  = Object.values(catCounts).sort((a, b) => b.count - a.count)
      const categoryColor = sortedCats[0]?.color ?? null
      const categoryName  = sortedCats[0]?.name  ?? null

      weekSegs.push({
        key:           format(clampStart, 'yyyy-MM-dd'),
        a1, a2, color, categoryColor, categoryName, sem,
        weekLabel:     `${format(clampStart, 'd MMM')} – ${format(clampEnd, 'd MMM')}`,
        subjectList:   sorted.map(s => s.title),
      })

      cursor = addDays(cursor, 7)
    }

    // ── Build month markers ─────────────────────────────────────────────────
    type MonthMark = { angle: number; midAngle: number; label: string }
    const monthMarks: MonthMark[] = []

    const months = eachMonthOfInterval({ start: yearStart, end: yearEnd })
    for (const m of months) {
      const mStart = m < yearStart ? yearStart : startOfMonth(m)
      const mEnd   = endOfMonth(m) > yearEnd ? yearEnd : endOfMonth(m)
      const startFrac = differenceInCalendarDays(mStart, yearStart) / totalDays
      const midFrac   = (differenceInCalendarDays(mStart, yearStart) + differenceInCalendarDays(mEnd, mStart) / 2) / totalDays
      monthMarks.push({
        angle:    fa(startFrac),
        midAngle: fa(midFrac),
        label:    format(m, 'MMM'),
      })
    }

    // ── Today ───────────────────────────────────────────────────────────────
    const today = new Date()
    let todayAngle: number | null = null
    if (today >= yearStart && today <= yearEnd) {
      const off  = differenceInCalendarDays(today, yearStart)
      todayAngle = fa(off / totalDays)
    }

    // ── Semester arcs ───────────────────────────────────────────────────────
    const sem1StartFrac = 0
    const sem1EndFrac   = differenceInCalendarDays(s1End, yearStart) / totalDays
    const sem2StartFrac = hasSem2 ? differenceInCalendarDays(s2Start!, yearStart) / totalDays : null
    const sem2EndFrac   = hasSem2 ? differenceInCalendarDays(s2End!,   yearStart) / totalDays : null

    // Academic year label
    const y1 = getYear(s1Start)
    const y2 = getYear(hasSem2 ? s2End! : s1End)
    const yearLabel = y1 === y2 ? String(y1) : `${y1} / ${y2}`

    // Fraction where sem2 ends (for post-sem2 summer arc)
    const sem2EndFracActual = hasSem2
      ? differenceInCalendarDays(s2End!, yearStart) / totalDays
      : sem1EndFrac

    return {
      weekSegs, monthMarks, todayAngle,
      sem1StartFrac, sem1EndFrac,
      sem2StartFrac, sem2EndFrac,
      sem2EndFracActual,
      hasSem2, yearLabel, totalDays, jan1Frac, fa,
    }
  }, [lessons, subjects, categories, sem1Start, sem1End, sem2Start, sem2End, subjectMap, categoryMap])

  // Legend: unique subjects that appear in any week segment
  const legendSubjects = useMemo(() => {
    const seen = new Set<string>()
    return subjects.filter(s => {
      const hex = SUBJECT_HEX[s.color]
      if (!hex) return false
      const inWheel = lessons.some(l => l.subjectId === s.id)
      if (!inWheel || seen.has(s.id)) return false
      seen.add(s.id)
      return true
    })
  }, [subjects, lessons])

  const { weekSegs, monthMarks, todayAngle, sem1StartFrac, sem1EndFrac, sem2StartFrac, sem2EndFrac, sem2EndFracActual, hasSem2, yearLabel, jan1Frac, fa } = wheel

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col items-center gap-6 w-full">
      <svg
        viewBox="0 0 760 760"
        className="w-full mx-auto"
        style={{ overflow: 'visible' }}
      >
        {/* ── Background circle ─────────────────────────────────────────── */}
        <circle cx={CX} cy={CY} r={R_OUTER} fill="#f8fafc" stroke="#e2e8f0" strokeWidth={1} />

        {/* ── Semester background arcs ─────────────────────────────────── */}
        <path
          d={annulusPath(CX, CY, R_SEM, R_MONTH, fa(sem1StartFrac), fa(sem1EndFrac))}
          fill="#eff6ff"
        />
        {/* ── Winter/mid-year break arc ─────────────────────────────────── */}
        {hasSem2 && sem2StartFrac !== null && (
          <path
            d={annulusPath(CX, CY, R_SEM, R_MONTH, fa(sem1EndFrac), fa(sem2StartFrac))}
            fill="#fef3c7"
          />
        )}

        {/* ── Category ring background ──────────────────────────────────── */}
        <circle cx={CX} cy={CY} r={R_CATEGORY} fill="#f8fafc" />
        {hasSem2 && sem2StartFrac !== null && sem2EndFrac !== null && (
          <path
            d={annulusPath(CX, CY, R_SEM, R_MONTH, fa(sem2StartFrac), fa(sem2EndFrac))}
            fill="#f0fdf4"
          />
        )}

        {/* ── Semester labels ───────────────────────────────────────────── */}
        {(() => {
          const midFrac1 = (sem1StartFrac + sem1EndFrac) / 2
          const a1       = fa(midFrac1)
          const [lx, ly] = polarXY(CX, CY, (R_SEM + R_MONTH) / 2, a1)
          return (
            <text
              x={lx} y={ly}
              textAnchor="middle" dominantBaseline="middle"
              fontSize={13} fontWeight={600} fill="#3b82f6" letterSpacing={0.5}
              transform={`rotate(${(midFrac1 - jan1Frac) * 360}, ${lx}, ${ly})`}
            >
              SEM 1
            </text>
          )
        })()}
        {hasSem2 && sem2StartFrac !== null && sem2EndFrac !== null && (() => {
          const midFrac2 = (sem2StartFrac + sem2EndFrac) / 2
          const a2       = fa(midFrac2)
          const [lx, ly] = polarXY(CX, CY, (R_SEM + R_MONTH) / 2, a2)
          return (
            <text
              x={lx} y={ly}
              textAnchor="middle" dominantBaseline="middle"
              fontSize={13} fontWeight={600} fill="#16a34a" letterSpacing={0.5}
              transform={`rotate(${(midFrac2 - jan1Frac) * 360}, ${lx}, ${ly})`}
            >
              SEM 2
            </text>
          )
        })()}

        {/* ── Break label (between sem1 and sem2) ──────────────────────── */}
        {hasSem2 && sem2StartFrac !== null && (() => {
          const midFrac  = (sem1EndFrac + sem2StartFrac) / 2
          const a        = fa(midFrac)
          const [lx, ly] = polarXY(CX, CY, (R_SEM + R_MONTH) / 2, a)
          const gapFrac  = sem2StartFrac - sem1EndFrac
          return (
            <>
              {gapFrac > 0.01 && (
                <text
                  x={lx} y={ly}
                  textAnchor="middle" dominantBaseline="middle"
                  fontSize={12} fontWeight={600} fill="#92400e" letterSpacing={0.5}
                  transform={`rotate(${(midFrac - jan1Frac) * 360}, ${lx}, ${ly})`}
                >
                  Break
                </text>
              )}
            </>
          )
        })()}

        {/* ── Summer break arc + label (after sem2) ────────────────────── */}
        {(() => {
          const endFrac = hasSem2 ? sem2EndFracActual : sem1EndFrac
          if (endFrac >= 0.99) return null
          const midFrac  = (endFrac + 1) / 2
          const a        = fa(midFrac)
          const [lx, ly] = polarXY(CX, CY, (R_SEM + R_MONTH) / 2, a)
          return (
            <>
              <path
                d={annulusPath(CX, CY, R_SEM, R_MONTH, fa(endFrac), fa(1))}
                fill="#fef3c7"
              />
              <text
                x={lx} y={ly}
                textAnchor="middle" dominantBaseline="middle"
                fontSize={12} fontWeight={600} fill="#92400e" letterSpacing={0.5}
                transform={`rotate(${(midFrac - jan1Frac) * 360}, ${lx}, ${ly})`}
              >
                Summer
              </text>
            </>
          )
        })()}

        {/* ── Month dividers + labels ───────────────────────────────────── */}
        {monthMarks.map((m, i) => {
          const [x1, y1] = polarXY(CX, CY, R_SEM, m.angle)
          const [x2, y2] = polarXY(CX, CY, R_WEEK + 8, m.angle)
          const [lx, ly] = polarXY(CX, CY, (R_CATEGORY + R_WEEK) / 2, m.midAngle)
          const rotDeg   = (m.midAngle + Math.PI / 2) * (180 / Math.PI)
          return (
            <g key={i}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#cbd5e1" strokeWidth={1.2} />
              <text
                x={lx} y={ly}
                textAnchor="middle" dominantBaseline="middle"
                fontSize={14} fontWeight={500} fill="#64748b"
                transform={`rotate(${rotDeg}, ${lx}, ${ly})`}
              >
                {m.label}
              </text>
            </g>
          )
        })}

        {/* ── Week arcs ─────────────────────────────────────────────────── */}
        {weekSegs.map(seg => {
          const isHovered = hoveredWeek === seg.key
          return (
            <path
              key={seg.key}
              d={annulusPath(CX, CY, R_MONTH, R_WEEK, seg.a1, seg.a2)}
              fill={seg.color}
              opacity={isHovered ? 1 : 0.85}
              stroke={isHovered ? '#1e293b' : 'white'}
              strokeWidth={isHovered ? 1.2 : 0.5}
              style={{ cursor: 'pointer', transition: 'opacity 0.1s' }}
              onMouseEnter={() => setHoveredWeek(seg.key)}
              onMouseLeave={() => setHoveredWeek(null)}
            />
          )
        })}

        {/* ── Category ring arcs ────────────────────────────────────────── */}
        {showCategories && weekSegs.map(seg => (
          <path
            key={`cat-${seg.key}`}
            d={annulusPath(CX, CY, R_SEM, R_CATEGORY, seg.a1, seg.a2)}
            fill={seg.categoryColor ?? (seg.sem ? '#e2e8f0' : '#f1f5f9')}
            opacity={0.9}
            stroke="white"
            strokeWidth={0.4}
          />
        ))}

        {/* ── Ring borders ──────────────────────────────────────────────── */}
        <circle cx={CX} cy={CY} r={R_WEEK}     fill="none" stroke="#e2e8f0" strokeWidth={0.5} />
        <circle cx={CX} cy={CY} r={R_MONTH}    fill="none" stroke="#e2e8f0" strokeWidth={0.5} />
        <circle cx={CX} cy={CY} r={R_CATEGORY} fill="none" stroke="#e2e8f0" strokeWidth={0.5} />
        <circle cx={CX} cy={CY} r={R_SEM}      fill="none" stroke="#e2e8f0" strokeWidth={0.5} />

        {/* ── Center ────────────────────────────────────────────────────── */}
        <circle cx={CX} cy={CY} r={R_CORE} fill="white" stroke="#e2e8f0" strokeWidth={1} />
        <text x={CX} y={CY - 10} textAnchor="middle" dominantBaseline="middle" fontSize={20} fontWeight={700} fill="#0f172a">
          {yearLabel}
        </text>
        <text x={CX} y={CY + 14} textAnchor="middle" dominantBaseline="middle" fontSize={13} fill="#94a3b8">
          Annual Plan
        </text>

        {/* ── Today pointer ─────────────────────────────────────────────── */}
        {todayAngle !== null && (() => {
          const [px, py] = polarXY(CX, CY, R_WEEK + 12, todayAngle)
          const [qx, qy] = polarXY(CX, CY, R_WEEK - 2,  todayAngle)
          const rotDeg   = todayAngle * (180 / Math.PI) + 90
          return (
            <g>
              <line x1={px} y1={py} x2={qx} y2={qy} stroke="#ef4444" strokeWidth={3} strokeLinecap="round" />
              <circle cx={px} cy={py} r={6} fill="#ef4444" />
            </g>
          )
        })()}

        {/* ── Hovered week tooltip ─────────────────────────────────────── */}
        {hoveredWeek && (() => {
          const seg = weekSegs.find(s => s.key === hoveredWeek)
          if (!seg) return null
          const midAngle = (seg.a1 + seg.a2) / 2
          const [tx, ty] = polarXY(CX, CY, R_WEEK + 40, midAngle)
          const lines    = [seg.weekLabel, ...(seg.categoryName ? [`📂 ${seg.categoryName}`] : []), ...seg.subjectList.slice(0, 3)]
          const boxW     = 180, boxH = lines.length * 22 + 16
          const bx       = Math.max(5, Math.min(tx - boxW / 2, 760 - boxW - 5))
          const by       = Math.max(5, Math.min(ty - boxH / 2, 760 - boxH - 5))
          return (
            <g style={{ pointerEvents: 'none' }}>
              <rect x={bx} y={by} width={boxW} height={boxH} rx={8} fill="#1e293b" opacity={0.92} />
              {lines.map((line, i) => (
                <text
                  key={i}
                  x={bx + boxW / 2} y={by + 14 + i * 22}
                  textAnchor="middle" dominantBaseline="middle"
                  fontSize={i === 0 ? 13 : 12}
                  fontWeight={i === 0 ? 600 : 400}
                  fill={i === 0 ? 'white' : '#94a3b8'}
                >
                  {line}
                </text>
              ))}
            </g>
          )
        })()}
      </svg>

      {/* ── Controls + Legend ───────────────────────────────────────────────── */}
      <div className="w-full flex flex-col items-center gap-3">
        {categories.length > 0 && (
          <div className="flex gap-1 bg-zinc-800 rounded-xl p-1">
            <button
              onClick={() => setShowCategories(false)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${!showCategories ? 'bg-zinc-900 shadow-sm text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              Subjects
            </button>
            <button
              onClick={() => setShowCategories(true)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${showCategories ? 'bg-zinc-900 shadow-sm text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              Categories
            </button>
          </div>
        )}

        {!showCategories && legendSubjects.length > 0 && (
          <div className="flex flex-wrap justify-center gap-x-4 gap-y-1.5">
            {legendSubjects.map(s => (
              <div key={s.id} className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded-full flex-shrink-0" style={{ background: SUBJECT_HEX[s.color] ?? '#6366f1' }} />
                <span className="text-xs text-zinc-400">{s.iconEmoji} {s.title}</span>
              </div>
            ))}
            {hasSem2 && (
              <div className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded-full flex-shrink-0" style={{ background: '#fef3c7', border: '1px solid #fbbf24' }} />
                <span className="text-xs text-zinc-400">Summer break</span>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-full flex-shrink-0 bg-red-500" />
              <span className="text-xs text-zinc-400">Today</span>
            </div>
          </div>
        )}

        {showCategories && categories.length > 0 && (
          <div className="flex flex-wrap justify-center gap-x-4 gap-y-1.5">
            {categories.map(c => (
              <div key={c.id} className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded-full flex-shrink-0" style={{ background: c.color }} />
                <span className="text-xs text-zinc-400">{c.name}</span>
              </div>
            ))}
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-full flex-shrink-0 bg-red-500" />
              <span className="text-xs text-zinc-400">Today</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
