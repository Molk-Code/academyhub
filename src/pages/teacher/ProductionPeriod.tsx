import { useState, useMemo, useEffect } from 'react'
import {
  collection, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, getDocs, onSnapshot,
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
  CalendarRange, Plus, X, Check, Pencil, Trash2,
  AlertTriangle, Clock, MapPin, Users, Settings,
} from 'lucide-react'
import {
  eachDayOfInterval, format, isToday, isWeekend, parseISO,
  addDays, getDay,
} from 'date-fns'
import LoadingSpinner from '@/components/common/LoadingSpinner'
import { PeriodCallSheetLoader } from '@/components/production/PeriodCallSheetLoader'

// ── Shared helpers (duplicated from student page to keep files independent) ──

const PROD_COLORS = [
  '#3b82f6','#ef4444','#22c55e','#f97316',
  '#8b5cf6','#ec4899','#06b6d4','#eab308',
  '#10b981','#6366f1','#f43f5e','#84cc16',
]

function timesOverlap(s1: string, e1: string, s2: string, e2: string): boolean {
  if (!s1 || !e1 || !s2 || !e2) return true
  return s1 < e2 && s2 < e1
}

function buildColorMap(productions: ProductionDoc[]): Record<string, string> {
  const sorted = [...productions].sort((a, b) => a.id.localeCompare(b.id))
  return Object.fromEntries(sorted.map((p, i) => [p.id, PROD_COLORS[i % PROD_COLORS.length]]))
}

function buildConflicts(allocations: PeriodAllocationDoc[]): Set<string> {
  const byDate: Record<string, PeriodAllocationDoc[]> = {}
  for (const a of allocations) {
    if (!byDate[a.date]) byDate[a.date] = []
    byDate[a.date].push(a)
  }
  const conflictDates = new Set<string>()
  for (const [, dayAllocs] of Object.entries(byDate)) {
    for (let i = 0; i < dayAllocs.length; i++) {
      for (let j = i + 1; j < dayAllocs.length; j++) {
        const a = dayAllocs[i], b = dayAllocs[j]
        if (!timesOverlap(a.startTime, a.endTime, b.startTime, b.endTime)) continue
        if (a.location && b.location && a.location.trim().toLowerCase() === b.location.trim().toLowerCase())
          conflictDates.add(a.date)
        if (a.crewNeeded.some(uid => b.crewNeeded.includes(uid)))
          conflictDates.add(a.date)
      }
    }
  }
  return conflictDates
}

// ── Period form (create / edit) ───────────────────────────────────────────────

function PeriodForm({ cohortId, existing, onClose }: {
  cohortId: string
  existing: ProductionPeriodDoc | null
  onClose: () => void
}) {
  const { profile } = useAuth()
  const [title,              setTitle]              = useState(existing?.title ?? '')
  const [startDate,          setStartDate]          = useState(existing?.startDate ?? '')
  const [endDate,            setEndDate]            = useState(existing?.endDate ?? '')
  const [notes,              setNotes]              = useState(existing?.notes ?? '')
  const [budgetPerProduction,setBudgetPerProduction] = useState(existing?.budgetPerProduction != null ? String(existing.budgetPerProduction) : '')
  const [budgetCurrency,     setBudgetCurrency]     = useState(existing?.budgetCurrency ?? 'SEK')
  const [budgetNotes,        setBudgetNotes]        = useState(existing?.budgetNotes ?? '')
  const [saving,             setSaving]             = useState(false)
  const [error,              setError]              = useState<string | null>(null)

  async function handleSave() {
    if (!title.trim() || !startDate || !endDate) return
    if (!cohortId) { setError('No cohort selected. Please select a cohort first.'); return }
    setSaving(true)
    setError(null)

    // Auto-generate workingDays = all weekdays in range
    let workingDays: string[] = []
    if (!existing) {
      try {
        const dates = eachDayOfInterval({ start: parseISO(startDate), end: parseISO(endDate) })
        workingDays = dates
          .filter(d => !isWeekend(d))
          .map(d => format(d, 'yyyy-MM-dd'))
      } catch {}
    }

    const payload = {
      title:   title.trim(),
      cohortId,
      startDate,
      endDate,
      notes:   notes.trim(),
      budgetPerProduction: budgetPerProduction !== '' ? Number(budgetPerProduction) : null,
      budgetCurrency:      budgetCurrency.trim() || 'SEK',
      budgetNotes:         budgetNotes.trim(),
      ...(existing ? {} : { workingDays, createdBy: profile?.uid ?? '' }),
    }
    try {
      if (existing) {
        await updateDoc(doc(db, 'production_periods', existing.id), payload)
      } else {
        await addDoc(collection(db, 'production_periods'), { ...payload, createdAt: serverTimestamp() })
      }
      onClose()
    } catch (e: any) {
      console.error(e)
      setError(e?.message ?? 'Failed to save. Check your permissions.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/10">
          <Settings className="w-4 h-4 text-brand-400" />
          <h2 className="text-sm font-semibold text-zinc-100 flex-1">
            {existing ? 'Edit production period' : 'New production period'}
          </h2>
          <button onClick={onClose} className="p-1.5 text-zinc-500 hover:text-zinc-300 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="label">Title</label>
            <input
              value={title} onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Spring Production Period 2025"
              className="input"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Start date</label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="input [color-scheme:dark]" />
            </div>
            <div>
              <label className="label">End date</label>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="input [color-scheme:dark]" />
            </div>
          </div>
          {!existing && (
            <p className="text-xs text-zinc-500">All weekdays in the date range will be set as working days. You can toggle individual days afterwards by clicking the column header.</p>
          )}
          <div>
            <label className="label">Notes <span className="text-zinc-500 font-normal">(optional)</span></label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="input resize-none" placeholder="Any period-level notes…" />
          </div>
          <div className="border-t border-white/8 pt-4 space-y-3">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">💰 Budget</p>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="label">Budget per production <span className="text-zinc-500 font-normal">(optional)</span></label>
                <input
                  type="number" min={0}
                  value={budgetPerProduction}
                  onChange={e => setBudgetPerProduction(e.target.value)}
                  className="input"
                  placeholder="e.g. 15000"
                />
              </div>
              <div className="w-24">
                <label className="label">Currency</label>
                <input value={budgetCurrency} onChange={e => setBudgetCurrency(e.target.value)} className="input" placeholder="SEK" />
              </div>
            </div>
            <div>
              <label className="label">Budget notes <span className="text-zinc-500 font-normal">(optional)</span></label>
              <textarea value={budgetNotes} onChange={e => setBudgetNotes(e.target.value)} rows={2} className="input resize-none" placeholder="What the budget covers, rules, etc." />
            </div>
          </div>
        </div>
        {error && (
          <div className="mx-5 mb-2 flex items-start gap-2 text-xs text-rose-400 bg-rose-950/40 border border-rose-800/50 rounded-xl px-3 py-2.5">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
        <div className="flex items-center gap-2 px-5 py-4 border-t border-white/10">
          <button onClick={handleSave} disabled={saving || !title.trim() || !startDate || !endDate}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-brand-600 text-white hover:bg-brand-500 rounded-xl transition-colors disabled:opacity-50">
            <Check className="w-3.5 h-3.5" /> {existing ? 'Save' : 'Create'}
          </button>
          <button onClick={onClose} className="ml-auto text-sm text-zinc-500 hover:text-zinc-300 px-3 py-2">Cancel</button>
        </div>
      </div>
    </div>
  )
}

// ── Allocation Editor ─────────────────────────────────────────────────────────

function AllocationEditor({ periodId, date, production, existing, allAllocations, students, color, onClose }: {
  periodId: string
  date: string
  production: ProductionDoc
  existing: PeriodAllocationDoc | null
  allAllocations: PeriodAllocationDoc[]
  students: UserDoc[]
  color: string
  onClose: () => void
}) {
  const [startTime,  setStartTime]  = useState(existing?.startTime ?? '08:00')
  const [endTime,    setEndTime]    = useState(existing?.endTime ?? '17:00')
  const [location,   setLocation]   = useState(existing?.location ?? '')
  const [crewNeeded, setCrewNeeded] = useState<string[]>(existing?.crewNeeded ?? [])
  const [notes,      setNotes]      = useState(existing?.notes ?? '')
  const [saving,     setSaving]     = useState(false)
  const [warnings,   setWarnings]   = useState<string[]>([])

  // Auto-populate from production's own shooting day
  useEffect(() => {
    if (existing) return
    import('firebase/firestore').then(({ getDocs, query, collection: col, where: fWhere }) => {
      getDocs(query(col(db, `productions/${production.id}/shootingDays`), fWhere('date', '==', date)))
        .then(snap => {
          if (snap.empty) return
          const day = snap.docs[0].data() as any
          if (day.startTime) setStartTime(day.startTime)
          if (day.endTime)   setEndTime(day.endTime)
        })
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function checkConflicts(): string[] {
    const issues: string[] = []
    const others = allAllocations.filter(a =>
      a.date === date && a.productionId !== production.id && a.id !== (existing?.id ?? ''),
    )
    for (const other of others) {
      if (!timesOverlap(startTime, endTime, other.startTime, other.endTime)) continue
      const shared = crewNeeded.filter(uid => other.crewNeeded.includes(uid))
      if (shared.length) {
        const names = shared.map(uid => students.find(s => s.uid === uid)?.displayName ?? uid)
        issues.push(`${names.join(', ')} is also in "${other.productionTitle}" at the same time`)
      }
      if (location && other.location && location.trim().toLowerCase() === other.location.trim().toLowerCase())
        issues.push(`Location "${location}" is already booked by "${other.productionTitle}"`)
    }
    return issues
  }

  async function handleSave() {
    setSaving(true)
    const ws = checkConflicts()
    setWarnings(ws)
    const payload = {
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
        await updateDoc(doc(db, `production_periods/${periodId}/allocations`, existing.id), payload)
      } else {
        await addDoc(collection(db, `production_periods/${periodId}/allocations`), { ...payload, createdAt: serverTimestamp() })
      }
      if (ws.length === 0) onClose()
    } catch (e) { console.error(e) } finally { setSaving(false) }
  }

  async function handleDelete() {
    if (!existing || !confirm('Remove this allocation?')) return
    await deleteDoc(doc(db, `production_periods/${periodId}/allocations`, existing.id))
    onClose()
  }

  function toggleCrew(uid: string) {
    setCrewNeeded(prev => prev.includes(uid) ? prev.filter(u => u !== uid) : [...prev, uid])
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
          <button onClick={onClose} className="p-1.5 text-zinc-500 hover:text-zinc-300"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="flex items-center gap-3">
            <Clock className="w-4 h-4 text-zinc-500 flex-shrink-0" />
            <div className="flex items-center gap-2 flex-1">
              <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)}
                className="bg-zinc-800 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-brand-500/30 w-28 [color-scheme:dark]" />
              <span className="text-zinc-500 text-sm">–</span>
              <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)}
                className="bg-zinc-800 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-brand-500/30 w-28 [color-scheme:dark]" />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <MapPin className="w-4 h-4 text-zinc-500 flex-shrink-0" />
            <input value={location} onChange={e => setLocation(e.target.value)}
              placeholder="Shooting location…"
              className="flex-1 bg-zinc-800 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-brand-500/30 placeholder:text-zinc-600" />
          </div>
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
                  )}>
                    <input type="checkbox" checked={crewNeeded.includes(s.uid)}
                      onChange={() => toggleCrew(s.uid)} className="w-3.5 h-3.5 accent-brand-500 flex-shrink-0" />
                    <span className="truncate text-xs">{s.displayName}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          <textarea value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="Notes (optional)…" rows={2}
            className="w-full bg-zinc-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-zinc-200 resize-none focus:outline-none focus:ring-1 focus:ring-brand-500/30 placeholder:text-zinc-600" />
          {warnings.length > 0 && (
            <div className="space-y-1.5">
              {warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-amber-400 bg-amber-950/40 border border-amber-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  <span>{w}</span>
                </div>
              ))}
              <p className="text-xs text-zinc-500">Conflicts are advisory — you can still save.</p>
            </div>
          )}
        </div>
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
          <button onClick={onClose} className="ml-auto text-sm text-zinc-500 hover:text-zinc-300 px-3 py-2">Cancel</button>
        </div>
      </div>
    </div>
  )
}

// ── Master Calendar ───────────────────────────────────────────────────────────

function MasterCalendar({ period, productions, allocations, students, onCellClick, onToggleWorkingDay }: {
  period: ProductionPeriodDoc
  productions: ProductionDoc[]
  allocations: PeriodAllocationDoc[]
  students: UserDoc[]
  onCellClick: (date: string, prod: ProductionDoc) => void
  onToggleWorkingDay: (date: string) => void
}) {
  const colorMap      = useMemo(() => buildColorMap(productions), [productions])
  const conflictDates = useMemo(() => buildConflicts(allocations), [allocations])

  const dates = useMemo(() => {
    if (!period.startDate || !period.endDate) return []
    try { return eachDayOfInterval({ start: parseISO(period.startDate), end: parseISO(period.endDate) }) }
    catch { return [] }
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
        {/* Header */}
        <div className="flex bg-zinc-900 border-b border-white/10">
          <div className="w-44 min-w-[11rem] px-3 py-2.5 text-xs font-semibold text-zinc-400 uppercase tracking-wider flex-shrink-0 sticky left-0 bg-zinc-900 z-10 border-r border-white/8">
            Production
          </div>
          {dates.map(date => {
            const ds   = format(date, 'yyyy-MM-dd')
            const wday = !period.workingDays.includes(ds)
            const today = isToday(date)
            return (
              <div key={ds}
                onClick={() => onToggleWorkingDay(ds)}
                title={wday ? 'Click to mark as working day' : 'Click to mark as non-shooting day'}
                className={cn(
                  COL_W, 'flex-shrink-0 px-1 py-2 text-center border-r border-white/5 last:border-r-0 cursor-pointer select-none transition-colors',
                  today ? 'bg-amber-900/30 hover:bg-amber-900/40' : wday ? 'bg-zinc-900/40 hover:bg-zinc-800/60' : 'bg-zinc-900 hover:bg-white/5',
                )}
              >
                <p className={cn('text-[10px] font-bold uppercase tracking-wide', today ? 'text-amber-400' : wday ? 'text-zinc-600' : 'text-zinc-400')}>
                  {format(date, 'EEE')}
                </p>
                <p className={cn('text-xs font-semibold', today ? 'text-amber-300' : wday ? 'text-zinc-600' : 'text-zinc-200')}>
                  {format(date, 'd MMM')}
                </p>
                {conflictDates.has(ds) && <span className="text-[9px] text-rose-400 font-bold">⚠</span>}
                {wday && <span className="text-[8px] text-zinc-600">—</span>}
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
                return (
                  <div key={ds}
                    onClick={() => alloc && onCellClick(ds, prod)}
                    className={cn(
                      COL_W, 'flex-shrink-0 border-r border-white/5 last:border-r-0 min-h-[3rem] p-1 transition-colors',
                      wday ? 'bg-zinc-900/40' : today ? 'bg-amber-950/10' : '',
                      alloc ? 'cursor-pointer hover:bg-white/5' : '',
                    )}
                  >
                    {alloc ? (
                      <div
                        className="rounded-lg px-1.5 py-1 text-[10px] leading-tight h-full min-h-[2.5rem] flex flex-col justify-center"
                        style={{ background: color + '33', borderLeft: `2px solid ${color}` }}
                      >
                        <p className="font-semibold truncate" style={{ color }}>
                          {alloc.startTime && alloc.endTime ? `${alloc.startTime}–${alloc.endTime}` : '●'}
                        </p>
                        {alloc.location && (
                          <p className="truncate" style={{ color: color + 'bb' }}>{alloc.location}</p>
                        )}
                      </div>
                    ) : null}
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
                  {conflictDates.has(ds) && <span className="text-[10px] font-bold text-rose-400 bg-rose-900/30 rounded px-1">⚠</span>}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Crew availability view ────────────────────────────────────────────────────

function CrewView({ allocations, students, productions }: {
  allocations: PeriodAllocationDoc[]
  students: UserDoc[]
  productions: ProductionDoc[]
}) {
  const colorMap = useMemo(() => buildColorMap(productions), [productions])

  const byStudent = useMemo(() => {
    const m: Record<string, PeriodAllocationDoc[]> = {}
    for (const s of students) m[s.uid] = []
    for (const a of allocations)
      for (const uid of a.crewNeeded)
        if (m[uid]) m[uid].push(a)
    return m
  }, [allocations, students])

  return (
    <div className="space-y-3">
      {students.length === 0 && <p className="text-zinc-500 text-sm text-center py-8">No students in this cohort.</p>}
      {students.map(s => {
        const days = byStudent[s.uid] ?? []
        return (
          <div key={s.uid} className="bg-zinc-900 border border-white/10 rounded-xl p-3 flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-zinc-100">{s.displayName}</p>
              <p className="text-xs text-zinc-500">{days.length} shooting day{days.length !== 1 ? 's' : ''}</p>
            </div>
            <div className="flex flex-wrap gap-1 justify-end">
              {days.sort((a, b) => a.date.localeCompare(b.date)).map(a => (
                <span key={a.id}
                  className="text-[10px] px-1.5 py-0.5 rounded-md font-medium"
                  style={{ background: (colorMap[a.productionId] ?? '#6366f1') + '33', color: colorMap[a.productionId] ?? '#6366f1' }}
                >
                  {format(parseISO(a.date), 'd MMM')}
                </span>
              ))}
              {days.length === 0 && <span className="text-[10px] text-zinc-600">No days assigned</span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Budget overview ───────────────────────────────────────────────────────────

function BudgetOverview({ period, productions }: { period: ProductionPeriodDoc; productions: ProductionDoc[] }) {
  const currency = period.budgetCurrency || 'SEK'
  const limit    = period.budgetPerProduction ?? null

  return (
    <div className="space-y-4">
      {limit != null && (
        <div className="flex items-center gap-3 bg-brand-900/20 border border-brand-500/20 rounded-xl px-4 py-3 text-sm">
          <span className="text-brand-400 font-semibold">Budget per production:</span>
          <span className="text-zinc-200 font-bold">{limit.toLocaleString('sv-SE')} {currency}</span>
          {period.budgetNotes && <span className="text-zinc-500 ml-2">— {period.budgetNotes}</span>}
        </div>
      )}
      {productions.length === 0 && (
        <p className="text-zinc-500 text-sm text-center py-8">No productions linked to this period yet.</p>
      )}
      {productions.length > 0 && (
        <div className="bg-zinc-900 border border-white/10 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10">
                <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider">Production</th>
                {limit != null && (
                  <th className="px-4 py-3 text-right text-xs font-semibold text-zinc-400 uppercase tracking-wider">Budget limit</th>
                )}
                <th className="px-4 py-3 text-right text-xs font-semibold text-zinc-400 uppercase tracking-wider">Type</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {productions.map(prod => (
                <tr key={prod.id} className="hover:bg-white/3 transition-colors">
                  <td className="px-4 py-3 text-zinc-200 font-medium">{prod.title}</td>
                  {limit != null && (
                    <td className="px-4 py-3 text-right text-zinc-300">
                      {(prod.budgetLimit ?? limit).toLocaleString('sv-SE')} {currency}
                    </td>
                  )}
                  <td className="px-4 py-3 text-right">
                    <span className={cn(
                      'text-xs px-2 py-0.5 rounded-full font-medium',
                      prod.productionType === 'side' ? 'bg-amber-900/30 text-amber-400' : 'bg-brand-900/30 text-brand-400',
                    )}>
                      {prod.productionType === 'side' ? 'Side project' : 'Period'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Teacher page ──────────────────────────────────────────────────────────────

export default function TeacherProductionPeriod({ embedded = false }: { embedded?: boolean }) {
  const { data: cohorts } = useCollection<CohortDoc>('cohorts', [orderBy('name', 'asc')])
  const [cohortId, setCohortId] = useState('')

  const { data: periods, loading: periodsLoading } = useCollection<ProductionPeriodDoc>(
    'production_periods',
    cohortId ? [where('cohortId', '==', cohortId), orderBy('startDate', 'desc')] : [],
    !!cohortId,
  )
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null)
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

  const colorMap = useMemo(() => buildColorMap(allProductions), [allProductions])
  const { data: students } = useCollection<UserDoc>(
    'users',
    cohortId ? [where('cohortId', '==', cohortId), where('role', '==', 'student')] : [],
    !!cohortId,
  )

  useEffect(() => {
    if (cohorts.length && !cohortId) setCohortId(cohorts[0].id)
  }, [cohorts, cohortId])

  useEffect(() => {
    if (periods.length && !selectedPeriodId) setSelectedPeriodId(periods[0].id)
  }, [periods, selectedPeriodId])

  const [tab,          setTab]          = useState<'calendar' | 'crew' | 'budget'>('calendar')
  const [showPeriodForm, setShowPeriodForm] = useState(false)
  const [editingPeriod,  setEditingPeriod]  = useState<ProductionPeriodDoc | null>(null)
  const [previewDay, setPreviewDay] = useState<{ productionId: string; productionTitle: string; date: string } | null>(null)

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

  async function handleToggleWorkingDay(date: string) {
    if (!period) return
    const isWorking = period.workingDays.includes(date)
    const { arrayUnion, arrayRemove } = await import('firebase/firestore')
    await updateDoc(doc(db, 'production_periods', period.id), {
      workingDays: isWorking ? arrayRemove(date) : arrayUnion(date),
    })
  }

  async function handleDeletePeriod() {
    if (!period || !confirm(`Delete "${period.title}"? This will remove all allocations.`)) return
    // Delete subcollection allocations first (client-side batch)
    const { getDocs, writeBatch } = await import('firebase/firestore')
    const batch = writeBatch(db)
    const snap = await getDocs(collection(db, `production_periods/${period.id}/allocations`))
    snap.docs.forEach(d => batch.delete(d.ref))
    batch.delete(doc(db, 'production_periods', period.id))
    await batch.commit()
    setSelectedPeriodId(null)
  }

  if (!cohortId && cohorts.length === 0) return <LoadingSpinner />

  return (
    <div className="space-y-6">
      {/* Header */}
      {!embedded && (
        <div className="flex flex-wrap items-start gap-3 justify-between">
          <div>
            <h1 className="page-title flex items-center gap-2">
              <CalendarRange className="w-6 h-6 text-brand-500" /> Production Period
            </h1>
            <p className="text-zinc-500 text-sm mt-1">
              Master calendar for all productions. Click column headers to toggle working days.
            </p>
          </div>
        </div>
      )}
      {/* New Period button — always visible */}
      <div className="flex justify-end">
        <button onClick={() => { setEditingPeriod(null); setShowPeriodForm(true) }}
          className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white text-sm font-medium hover:bg-brand-500 rounded-xl transition-colors">
          <Plus className="w-4 h-4" /> New Period
        </button>
      </div>

      {/* Cohort picker */}
      {cohorts.length > 1 && (
        <div className="flex items-center gap-2">
          <label className="text-xs text-zinc-500 font-medium">Cohort:</label>
          <select value={cohortId} onChange={e => { setCohortId(e.target.value); setSelectedPeriodId(null) }}
            className="bg-zinc-800 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-brand-500/30">
            {cohorts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}

      {periodsLoading && <LoadingSpinner />}

      {!periodsLoading && periods.length === 0 && (
        <div className="text-center py-16 text-zinc-500 text-sm">
          No production periods yet. Create one to get started.
        </div>
      )}

      {periods.length > 0 && (
        <>
          {/* Period selector + controls */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-center gap-2 flex-1 flex-wrap">
              <select value={selectedPeriodId ?? ''} onChange={e => setSelectedPeriodId(e.target.value)}
                className="bg-zinc-800 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-brand-500/30">
                {periods.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
              {period && (
                <>
                  <button onClick={() => { setEditingPeriod(period); setShowPeriodForm(true) }}
                    className="p-1.5 text-zinc-500 hover:text-zinc-300 transition-colors rounded-lg hover:bg-white/5">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={handleDeletePeriod}
                    className="p-1.5 text-zinc-500 hover:text-rose-400 transition-colors rounded-lg hover:bg-white/5">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
            </div>
            <div className="flex items-center bg-zinc-800/60 rounded-xl p-1 gap-0.5">
              {([['calendar', 'Calendar'], ['crew', 'Crew'], ['budget', '💰 Budget']] as const).map(([id, label]) => (
                <button key={id} onClick={() => setTab(id)}
                  className={cn(
                    'px-3 py-1.5 text-xs font-medium rounded-lg transition-colors',
                    tab === id ? 'bg-brand-600 text-white' : 'text-zinc-400 hover:text-zinc-200',
                  )}
                >{label}</button>
              ))}
            </div>
          </div>

          {period?.notes && (
            <p className="text-sm text-zinc-400 italic border-l-2 border-brand-500/40 pl-3">{period.notes}</p>
          )}

          {tab === 'calendar' && period && (
            <MasterCalendar
              period={period}
              productions={allProductions}
              allocations={virtualAllocations}
              students={students}
              onCellClick={(date, prod) => setPreviewDay({ productionId: prod.id, productionTitle: prod.title, date })}
              onToggleWorkingDay={handleToggleWorkingDay}
            />
          )}

          {tab === 'crew' && (
            <CrewView allocations={virtualAllocations} students={students} productions={allProductions} />
          )}

          {tab === 'budget' && period && (
            <BudgetOverview period={period} productions={allProductions} />
          )}
        </>
      )}

      {/* Modals */}
      {showPeriodForm && (
        <PeriodForm
          cohortId={cohortId}
          existing={editingPeriod}
          onClose={() => { setShowPeriodForm(false); setEditingPeriod(null) }}
        />
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
