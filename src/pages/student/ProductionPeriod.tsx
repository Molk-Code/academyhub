import { useState, useMemo, useEffect } from 'react'
import {
  collection, addDoc, updateDoc, deleteDoc, doc, getDoc,
  serverTimestamp, getDocs, onSnapshot,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useCollection, orderBy, where } from '@/hooks/useFirestore'
import { cn } from '@/lib/utils'
import type {
  ProductionPeriodDoc, PeriodAllocationDoc, ProductionDoc, UserDoc, CohortDoc,
  ProductionShootingDayDoc, ProductionCrewAssignmentDoc,
} from '@/types'
import {
  CalendarRange, Plus, X, ChevronLeft, ChevronRight,
  AlertTriangle, Clock, MapPin, Users, Check, Pencil, Trash2,
} from 'lucide-react'
import { eachDayOfInterval, format, isToday, isWeekend, parseISO } from 'date-fns'
import LoadingSpinner from '@/components/common/LoadingSpinner'
import { PeriodCallSheetLoader } from '@/components/production/PeriodCallSheetLoader'

// ── Constants ─────────────────────────────────────────────────────────────────

const PROD_COLORS = [
  '#3b82f6','#ef4444','#22c55e','#f97316',
  '#8b5cf6','#ec4899','#06b6d4','#eab308',
  '#10b981','#6366f1','#f43f5e','#84cc16',
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function timesOverlap(s1: string, e1: string, s2: string, e2: string): boolean {
  if (!s1 || !e1 || !s2 || !e2) return true // assume overlap if times missing
  return s1 < e2 && s2 < e1
}

function buildColorMap(productions: ProductionDoc[]): Record<string, string> {
  const sorted = [...productions].sort((a, b) => a.id.localeCompare(b.id))
  return Object.fromEntries(sorted.map((p, i) => [p.id, PROD_COLORS[i % PROD_COLORS.length]]))
}

function buildConflicts(
  allocations: PeriodAllocationDoc[],
): Set<string> {
  const byDate: Record<string, PeriodAllocationDoc[]> = {}
  for (const a of allocations) {
    if (!byDate[a.date]) byDate[a.date] = []
    byDate[a.date].push(a)
  }
  const conflictDates = new Set<string>()
  for (const [date, dayAllocs] of Object.entries(byDate)) {
    for (let i = 0; i < dayAllocs.length; i++) {
      for (let j = i + 1; j < dayAllocs.length; j++) {
        const a = dayAllocs[i], b = dayAllocs[j]
        if (!timesOverlap(a.startTime, a.endTime, b.startTime, b.endTime)) continue
        // Same location conflict
        if (a.location && b.location && a.location.trim().toLowerCase() === b.location.trim().toLowerCase()) {
          conflictDates.add(date)
        }
        // Shared crew conflict
        const sharedCrew = a.crewNeeded.some(uid => b.crewNeeded.includes(uid))
        if (sharedCrew) conflictDates.add(date)
      }
    }
  }
  return conflictDates
}

// ── Allocation Editor ─────────────────────────────────────────────────────────

interface EditorProps {
  periodId: string
  date: string
  production: ProductionDoc
  existing: PeriodAllocationDoc | null
  allAllocations: PeriodAllocationDoc[]
  students: UserDoc[]
  color: string
  onClose: () => void
  canEdit: boolean
}

function AllocationEditor({
  periodId, date, production, existing, allAllocations,
  students, color, onClose, canEdit,
}: EditorProps) {
  const [startTime,   setStartTime]   = useState(existing?.startTime ?? '08:00')
  const [endTime,     setEndTime]     = useState(existing?.endTime ?? '17:00')
  const [location,    setLocation]    = useState(existing?.location ?? '')
  const [crewNeeded,  setCrewNeeded]  = useState<string[]>(existing?.crewNeeded ?? [])
  const [notes,       setNotes]       = useState(existing?.notes ?? '')
  const [saving,      setSaving]      = useState(false)
  const [warnings,    setWarnings]    = useState<string[]>([])

  // Auto-populate from the production's own shooting schedule
  useEffect(() => {
    if (existing) return
    getDoc(collection(db, `productions/${production.id}/shootingDays`) as any)
      .catch(() => null) // just a best-effort populate
    // Load shooting days for this production+date
    const unsub = (() => {
      const ref = collection(db, `productions/${production.id}/shootingDays`)
      import('firebase/firestore').then(({ getDocs, query, where: fWhere }) => {
        getDocs(query(ref, fWhere('date', '==', date))).then(snap => {
          if (snap.empty) return
          const day = snap.docs[0].data() as any
          if (day.startTime) setStartTime(day.startTime)
          if (day.endTime)   setEndTime(day.endTime)
        })
      })
    })()
    return () => void unsub
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function checkConflicts(): string[] {
    const issues: string[] = []
    const others = allAllocations.filter(a =>
      a.date === date &&
      a.productionId !== production.id &&
      a.id !== (existing?.id ?? ''),
    )
    for (const other of others) {
      if (!timesOverlap(startTime, endTime, other.startTime, other.endTime)) continue
      const shared = crewNeeded.filter(uid => other.crewNeeded.includes(uid))
      if (shared.length) {
        const names = shared.map(uid => students.find(s => s.uid === uid)?.displayName ?? uid)
        issues.push(`${names.join(', ')} is also needed in "${other.productionTitle}" at the same time`)
      }
      if (location && other.location &&
          location.trim().toLowerCase() === other.location.trim().toLowerCase()) {
        issues.push(`Location "${location}" is already booked by "${other.productionTitle}" at the same time`)
      }
    }
    return issues
  }

  async function handleSave() {
    setSaving(true)
    const ws = checkConflicts()
    setWarnings(ws)
    const payload: Omit<PeriodAllocationDoc, 'id'> = {
      productionId:    production.id,
      productionTitle: production.title,
      date,
      startTime,
      endTime,
      location:    location.trim(),
      crewNeeded,
      notes:       notes.trim(),
      color,
    }
    try {
      if (existing) {
        await updateDoc(
          doc(db, `production_periods/${periodId}/allocations`, existing.id),
          payload,
        )
      } else {
        await addDoc(
          collection(db, `production_periods/${periodId}/allocations`),
          { ...payload, createdAt: serverTimestamp() },
        )
      }
      if (ws.length === 0) onClose()
    } catch (e) {
      console.error(e)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!existing || !confirm('Remove this allocation?')) return
    await deleteDoc(doc(db, `production_periods/${periodId}/allocations`, existing.id))
    onClose()
  }

  function toggleCrew(uid: string) {
    setCrewNeeded(prev =>
      prev.includes(uid) ? prev.filter(u => u !== uid) : [...prev, uid],
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/10">
          <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: color }} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-zinc-100 truncate">{production.title}</p>
            <p className="text-xs text-zinc-400">{format(parseISO(date), 'EEEE, d MMMM yyyy')}</p>
          </div>
          <button onClick={onClose} className="p-1.5 text-zinc-500 hover:text-zinc-300 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Time block */}
          <div className="flex items-center gap-3">
            <Clock className="w-4 h-4 text-zinc-500 flex-shrink-0" />
            <div className="flex items-center gap-2 flex-1">
              <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} disabled={!canEdit}
                className="bg-zinc-800 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-brand-500/30 w-28 [color-scheme:dark]" />
              <span className="text-zinc-500 text-sm">–</span>
              <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} disabled={!canEdit}
                className="bg-zinc-800 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-brand-500/30 w-28 [color-scheme:dark]" />
            </div>
          </div>

          {/* Location */}
          <div className="flex items-center gap-3">
            <MapPin className="w-4 h-4 text-zinc-500 flex-shrink-0" />
            <input
              value={location} onChange={e => setLocation(e.target.value)} disabled={!canEdit}
              placeholder="Shooting location…"
              className="flex-1 bg-zinc-800 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-brand-500/30 placeholder:text-zinc-600"
            />
          </div>

          {/* Crew */}
          {students.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-zinc-500" />
                <p className="text-xs font-medium text-zinc-400">Crew needed</p>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {students.map(s => (
                  <label key={s.uid} className={cn(
                    'flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer text-sm transition-colors',
                    crewNeeded.includes(s.uid) ? 'bg-brand-900/40 text-brand-300' : 'text-zinc-400 hover:bg-zinc-800',
                    !canEdit && 'pointer-events-none',
                  )}>
                    <input type="checkbox" checked={crewNeeded.includes(s.uid)}
                      onChange={() => canEdit && toggleCrew(s.uid)}
                      className="w-3.5 h-3.5 accent-brand-500 flex-shrink-0" />
                    <span className="truncate text-xs">{s.displayName}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Notes */}
          <textarea
            value={notes} onChange={e => setNotes(e.target.value)} disabled={!canEdit}
            placeholder="Notes (optional)…" rows={2}
            className="w-full bg-zinc-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-zinc-200 resize-none focus:outline-none focus:ring-1 focus:ring-brand-500/30 placeholder:text-zinc-600"
          />

          {/* Conflict warnings */}
          {warnings.length > 0 && (
            <div className="space-y-1.5">
              {warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-amber-400 bg-amber-950/40 border border-amber-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  <span>{w}</span>
                </div>
              ))}
              {canEdit && (
                <p className="text-xs text-zinc-500">Conflicts are advisory — you can still save.</p>
              )}
            </div>
          )}
        </div>

        {canEdit && (
          <div className="flex items-center gap-2 px-5 py-4 border-t border-white/10">
            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-brand-600 text-white hover:bg-brand-500 rounded-xl transition-colors disabled:opacity-50">
              <Check className="w-3.5 h-3.5" />
              {warnings.length > 0 ? 'Save anyway' : existing ? 'Save changes' : 'Add allocation'}
            </button>
            {existing && (
              <button onClick={handleDelete}
                className="flex items-center gap-1.5 px-3 py-2 text-sm text-zinc-500 hover:text-rose-400 transition-colors rounded-xl">
                <Trash2 className="w-3.5 h-3.5" /> Remove
              </button>
            )}
            <button onClick={onClose} className="ml-auto text-sm text-zinc-500 hover:text-zinc-300 transition-colors px-3 py-2">
              Cancel
            </button>
          </div>
        )}
        {!canEdit && (
          <div className="px-5 py-4 border-t border-white/10">
            <button onClick={onClose} className="text-sm text-zinc-400 hover:text-zinc-200 transition-colors">Close</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Master Calendar Grid ──────────────────────────────────────────────────────

interface CalendarProps {
  period: ProductionPeriodDoc
  productions: ProductionDoc[]
  allocations: PeriodAllocationDoc[]
  students: UserDoc[]
  canEdit: boolean
  canEditProduction: (prodId: string) => boolean
  onCellClick: (date: string, prod: ProductionDoc) => void
  onToggleWorkingDay?: (date: string) => void
  isTeacher?: boolean
}

function MasterCalendar({
  period, productions, allocations, students, canEdit,
  canEditProduction, onCellClick, onToggleWorkingDay, isTeacher,
}: CalendarProps) {
  const colorMap = useMemo(() => buildColorMap(productions), [productions])
  const conflictDates = useMemo(() => buildConflicts(allocations), [allocations])

  const dates = useMemo(() => {
    if (!period.startDate || !period.endDate) return []
    return eachDayOfInterval({ start: parseISO(period.startDate), end: parseISO(period.endDate) })
  }, [period.startDate, period.endDate])

  const allocMap = useMemo(() => {
    const m: Record<string, Record<string, PeriodAllocationDoc>> = {}
    for (const a of allocations) {
      if (!m[a.productionId]) m[a.productionId] = {}
      m[a.productionId][a.date] = a
    }
    return m
  }, [allocations])

  const COL_W = 'w-24 min-w-[6rem]'

  return (
    <div className="overflow-x-auto rounded-2xl border border-white/10">
      <div className="min-w-max">
        {/* Header row */}
        <div className="flex bg-zinc-900 border-b border-white/10">
          <div className="w-44 min-w-[11rem] px-3 py-2.5 text-xs font-semibold text-zinc-400 uppercase tracking-wider flex-shrink-0 sticky left-0 bg-zinc-900 z-10 border-r border-white/8">
            Production
          </div>
          {dates.map(date => {
            const ds    = format(date, 'yyyy-MM-dd')
            const wday  = !period.workingDays.includes(ds)
            const today = isToday(date)
            return (
              <div
                key={ds}
                onClick={() => isTeacher && onToggleWorkingDay?.(ds)}
                className={cn(
                  COL_W, 'flex-shrink-0 px-1 py-2 text-center border-r border-white/5 last:border-r-0',
                  today ? 'bg-amber-900/30' : wday ? 'bg-zinc-900/60' : 'bg-zinc-900',
                  isTeacher && 'cursor-pointer hover:bg-white/5 transition-colors',
                )}
              >
                <p className={cn('text-[10px] font-bold uppercase tracking-wide', today ? 'text-amber-400' : wday ? 'text-zinc-600' : 'text-zinc-400')}>
                  {format(date, 'EEE')}
                </p>
                <p className={cn('text-xs font-semibold', today ? 'text-amber-300' : wday ? 'text-zinc-600' : 'text-zinc-200')}>
                  {format(date, 'd MMM')}
                </p>
                {conflictDates.has(ds) && (
                  <span className="text-[9px] text-rose-400 font-bold">⚠</span>
                )}
              </div>
            )
          })}
        </div>

        {/* Production rows */}
        {productions.map(prod => {
          const color = colorMap[prod.id]
          return (
            <div key={prod.id} className="flex border-b border-white/5 last:border-b-0">
              <div className="w-44 min-w-[11rem] px-3 py-2.5 flex-shrink-0 sticky left-0 bg-zinc-950 z-10 border-r border-white/8 flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
                <span className="text-xs text-zinc-200 truncate font-medium">{prod.title}</span>
              </div>
              {dates.map(date => {
                const ds    = format(date, 'yyyy-MM-dd')
                const wday  = !period.workingDays.includes(ds)
                const today = isToday(date)
                const alloc = allocMap[prod.id]?.[ds]
                const canE  = canEditProduction(prod.id)

                return (
                  <div
                    key={ds}
                    onClick={() => (canE || alloc) && onCellClick(ds, prod)}
                    className={cn(
                      COL_W, 'flex-shrink-0 border-r border-white/5 last:border-r-0 min-h-[3rem] p-1 transition-colors',
                      wday ? 'bg-zinc-900/40' : today ? 'bg-amber-950/10' : '',
                      canE && !wday ? 'cursor-pointer hover:bg-white/5' : '',
                      !canE && alloc ? 'cursor-pointer' : '',
                    )}
                  >
                    {alloc && (
                      <div
                        className="rounded-lg px-1.5 py-1 text-[10px] leading-tight h-full min-h-[2.5rem] flex flex-col justify-center"
                        style={{ background: color + '33', borderLeft: `2px solid ${color}` }}
                      >
                        <p className="font-semibold truncate" style={{ color }}>
                          {alloc.startTime && alloc.endTime ? `${alloc.startTime}–${alloc.endTime}` : '●'}
                        </p>
                        {alloc.location && (
                          <p className="text-zinc-300 truncate" style={{ color: color + 'bb' }}>{alloc.location}</p>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}

        {/* Conflicts row */}
        {conflictDates.size > 0 && (
          <div className="flex bg-zinc-950/50">
            <div className="w-44 min-w-[11rem] px-3 py-2 flex-shrink-0 sticky left-0 bg-zinc-950 z-10 border-r border-white/8 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-rose-400 flex-shrink-0" />
              <span className="text-[10px] text-rose-400 font-semibold uppercase tracking-wider">Conflicts</span>
            </div>
            {dates.map(date => {
              const ds = format(date, 'yyyy-MM-dd')
              return (
                <div key={ds} className={cn(COL_W, 'flex-shrink-0 border-r border-white/5 last:border-r-0 min-h-[2rem] flex items-center justify-center')}>
                  {conflictDates.has(ds) && (
                    <span className="text-[10px] font-bold text-rose-400 bg-rose-900/30 rounded px-1">⚠</span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ProductionPeriod({ embedded = false }: { embedded?: boolean }) {
  const { profile } = useAuth()
  const uid = profile?.uid ?? ''
  const cohortId = profile?.cohortId ?? ''

  const [tab, setTab] = useState<'calendar' | 'mine'>('calendar')
  const [editorState, setEditorState] = useState<{ date: string; prod: ProductionDoc } | null>(null)

  const { data: periods, loading: periodsLoading } = useCollection<ProductionPeriodDoc>(
    'production_periods',
    cohortId ? [where('cohortId', '==', cohortId), orderBy('startDate', 'desc')] : [],
    !!cohortId,
  )
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null)
  const [previewDay, setPreviewDay] = useState<{ productionId: string; productionTitle: string; date: string } | null>(null)
  const period = periods.find(p => p.id === selectedPeriodId) ?? periods[0] ?? null

  const { data: allocations } = useCollection<PeriodAllocationDoc>(
    period ? `production_periods/${period.id}/allocations` : 'production_periods/none/allocations',
    [],
    !!period,
    period?.id,
  )

  const { data: allProductionsRaw } = useCollection<ProductionDoc>(
    'productions',
    cohortId ? [where('cohortId', '==', cohortId)] : [],
    !!cohortId,
  )
  // Only show productions linked to the current period
  const allProductions = period
    ? allProductionsRaw.filter(p => p.periodId === period.id)
    : []

  // Load shooting days + crew for each linked production
  const [prodDayData, setProdDayData] = useState<Record<string, {
    days: ProductionShootingDayDoc[]
    crewIds: string[]
  }>>({})

  useEffect(() => {
    if (!allProductions.length) { setProdDayData({}); return }
    let mounted = true
    const unsubs: (() => void)[] = []
    allProductions.forEach(prod => {
      getDocs(collection(db, `productions/${prod.id}/crew`)).then(crewSnap => {
        if (!mounted) return
        const crewIds = crewSnap.docs
          .map(d => d.data() as ProductionCrewAssignmentDoc)
          .filter(c => c.assignedUid)
          .map(c => c.assignedUid as string)
        const unsub = onSnapshot(collection(db, `productions/${prod.id}/shootingDays`), snap => {
          if (!mounted) return
          const days = snap.docs.map(d => ({ id: d.id, ...d.data() })) as ProductionShootingDayDoc[]
          setProdDayData(prev => ({ ...prev, [prod.id]: { days, crewIds } }))
        })
        unsubs.push(unsub)
      })
    })
    return () => { mounted = false; unsubs.forEach(u => u()) }
  }, [allProductions.map(p => p.id).join(',')])  // eslint-disable-line react-hooks/exhaustive-deps

  const { data: students } = useCollection<UserDoc>(
    'users',
    cohortId ? [where('cohortId', '==', cohortId), where('role', '==', 'student')] : [],
    !!cohortId,
  )

  useEffect(() => {
    if (periods.length && !selectedPeriodId) setSelectedPeriodId(periods[0].id)
  }, [periods, selectedPeriodId])

  const colorMap = useMemo(() => buildColorMap(allProductions), [allProductions])

  // Build virtual allocations from production shooting days
  const virtualAllocations = useMemo<PeriodAllocationDoc[]>(() => {
    return allProductions.flatMap(prod => {
      const data = prodDayData[prod.id]
      if (!data) return []
      return data.days
        .filter(day => day.date)
        .map(day => ({
          id: `${prod.id}_${day.id}`,
          productionId: prod.id,
          productionTitle: prod.title,
          date: day.date,
          startTime: day.startTime ?? '',
          endTime: day.endTime ?? '',
          location: '',
          crewNeeded: data.crewIds,
          notes: day.notes ?? '',
          color: colorMap[prod.id] ?? '#6366f1',
        }))
    })
  }, [allProductions, prodDayData, colorMap])

  // My shooting days (based on virtual allocations)
  const myAllocations = useMemo(
    () => virtualAllocations.filter(a => a.crewNeeded.includes(uid)).sort((a, b) => a.date.localeCompare(b.date)),
    [virtualAllocations, uid],
  )

  if (periodsLoading) return <LoadingSpinner />

  return (
    <div className="space-y-6">
      {/* Page header */}
      {!embedded && (
        <div>
          <h1 className="page-title flex items-center gap-2">
            <CalendarRange className="w-6 h-6 text-brand-500" /> Production Period
          </h1>
          <p className="text-zinc-500 text-sm mt-1">
            Master calendar showing all productions across the production period.
          </p>
        </div>
      )}

      {periods.length === 0 && (
        <div className="text-center py-16 text-zinc-500 text-sm">
          No production period has been set up yet. Ask your teacher to create one.
        </div>
      )}

      {periods.length > 0 && (
        <>
          {/* Period selector + tab switcher */}
          <div className="flex flex-wrap items-center gap-3">
            {periods.length > 1 && (
              <select
                value={selectedPeriodId ?? ''}
                onChange={e => setSelectedPeriodId(e.target.value)}
                className="bg-zinc-800 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-brand-500/30"
              >
                {periods.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
            )}
            {periods.length === 1 && (
              <h2 className="text-base font-semibold text-zinc-200">{period?.title}</h2>
            )}
            <div className="flex items-center bg-zinc-800/60 rounded-xl p-1 gap-0.5 ml-auto">
              {([['calendar', 'Calendar'], ['mine', 'My Shooting Days']] as const).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  className={cn(
                    'px-3 py-1.5 text-xs font-medium rounded-lg transition-colors',
                    tab === id ? 'bg-brand-600 text-white' : 'text-zinc-400 hover:text-zinc-200',
                  )}
                >{label}</button>
              ))}
            </div>
          </div>

          {tab === 'calendar' && period && (
            <MasterCalendar
              period={period}
              productions={allProductions}
              allocations={virtualAllocations}
              students={students}
              canEdit={false}
              canEditProduction={() => false}
              onCellClick={(date, prod) => setPreviewDay({ productionId: prod.id, productionTitle: prod.title, date })}
            />
          )}

          {tab === 'mine' && (
            <div className="space-y-3">
              {myAllocations.length === 0 && (
                <div className="text-center py-12 text-zinc-500 text-sm">
                  You haven't been assigned to any shooting days yet.
                </div>
              )}
              {myAllocations.map(a => {
                const color = colorMap[a.productionId] ?? '#6366f1'
                return (
                  <div key={a.id} className="bg-zinc-900 border border-white/10 rounded-xl p-4 flex items-start gap-3">
                    <div className="w-1 self-stretch rounded-full flex-shrink-0" style={{ background: color }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-zinc-100">{a.productionTitle}</p>
                      <p className="text-xs text-zinc-400 mt-0.5">{format(parseISO(a.date), 'EEEE, d MMMM yyyy')}</p>
                      <div className="flex flex-wrap gap-3 mt-2 text-xs text-zinc-400">
                        {(a.startTime || a.endTime) && (
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {a.startTime && <span className="font-semibold text-emerald-400">{a.startTime}</span>}
                            {a.startTime && a.endTime && ' – '}
                            {a.endTime}
                          </span>
                        )}
                        {a.location && (
                          <span className="flex items-center gap-1">
                            <MapPin className="w-3 h-3" />{a.location}
                          </span>
                        )}
                      </div>
                      {a.notes && <p className="text-xs text-zinc-500 italic mt-1">{a.notes}</p>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {previewDay && (
        <PeriodCallSheetLoader
          productionId={previewDay.productionId}
          productionTitle={previewDay.productionTitle}
          date={previewDay.date}
          onClose={() => setPreviewDay(null)}
        />
      )}
    </div>
  )
}
