import { useState, useMemo, useEffect } from 'react'
import { collection, updateDoc, doc, getDocs, onSnapshot } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useCollection, orderBy, where } from '@/hooks/useFirestore'
import { cn } from '@/lib/utils'
import type {
  ProductionPeriodDoc, PeriodAllocationDoc, ProductionDoc, UserDoc, CohortDoc,
  ProductionShootingDayDoc, ProductionCrewAssignmentDoc, CrewRoleDoc, EquipmentDoc, EquipmentBookingDoc,
} from '@/types'
import { CalendarRange, Plus, Pencil, Trash2 } from 'lucide-react'
import LoadingSpinner from '@/components/common/LoadingSpinner'
import { PeriodCallSheetLoader } from '@/components/production/PeriodCallSheetLoader'
import { buildColorMap } from './productionPeriodShared'
import { PeriodForm } from './PeriodForm'
import { MasterCalendar } from './MasterCalendar'
import { CrewView } from './CrewView'
import { BudgetOverview } from './BudgetOverview'

// ── Teacher page ──────────────────────────────────────────────────────────────

export default function TeacherProductionPeriod({
  embedded = false, cohortId: cohortIdProp,
}: { embedded?: boolean; cohortId?: string }) {
  const { data: cohorts } = useCollection<CohortDoc>('cohorts', [orderBy('name', 'asc')])
  const [internalCohortId, setInternalCohortId] = useState('')
  const cohortId = embedded ? (cohortIdProp ?? '') : internalCohortId
  const setCohortId = embedded ? (() => {}) : setInternalCohortId

  const { data: periods, loading: periodsLoading } = useCollection<ProductionPeriodDoc>(
    'production_periods',
    cohortId ? [where('cohortId', '==', cohortId), orderBy('startDate', 'desc')] : [orderBy('startDate', 'desc')],
    embedded || !!cohortId,
    cohortId,
  )
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null)
  const period = periods.find(p => p.id === selectedPeriodId) ?? periods[0] ?? null
  // The class the currently-open period actually belongs to — used to scope
  // productions/students once a period is selected, independent of the
  // outer "all classes" filter.
  const periodCohortId = period?.cohortId || cohortId

  const { data: allocations } = useCollection<PeriodAllocationDoc>(
    period ? `production_periods/${period.id}/allocations` : 'production_periods/none/allocations',
    [],
    !!period,
    period?.id,
  )

  const { data: allProductionsRaw } = useCollection<ProductionDoc>(
    'productions',
    periodCohortId ? [where('cohortId', '==', periodCohortId)] : [],
    !!periodCohortId,
    periodCohortId,
  )
  // Only show productions linked to the current period
  const allProductions = period
    ? allProductionsRaw.filter(p => p.periodId === period.id)
    : []

  // Load shooting days + crew for each linked production
  const [prodDayData, setProdDayData] = useState<Record<string, {
    days: ProductionShootingDayDoc[]
    crewIds: string[]
    crewAssignments: ProductionCrewAssignmentDoc[]
  }>>({})

  useEffect(() => {
    if (!allProductions.length) { setProdDayData({}); return }
    let mounted = true
    const unsubs: (() => void)[] = []
    allProductions.forEach(prod => {
      getDocs(collection(db, `productions/${prod.id}/crew`)).then(crewSnap => {
        if (!mounted) return
        const crewAssignments = crewSnap.docs.map(d => ({ id: d.id, ...d.data() } as ProductionCrewAssignmentDoc))
        const crewIds = crewAssignments
          .filter(c => c.assignedUid)
          .map(c => c.assignedUid as string)
        const unsub = onSnapshot(collection(db, `productions/${prod.id}/shootingDays`), snap => {
          if (!mounted) return
          const days = snap.docs.map(d => ({ id: d.id, ...d.data() })) as ProductionShootingDayDoc[]
          setProdDayData(prev => ({ ...prev, [prod.id]: { days, crewIds, crewAssignments } }))
        })
        unsubs.push(unsub)
      })
    })
    return () => { mounted = false; unsubs.forEach(u => u()) }
  }, [allProductions.map(p => p.id).join(',')])  // eslint-disable-line react-hooks/exhaustive-deps

  const colorMap = useMemo(() => buildColorMap(allProductions), [allProductions])

  // ── Budget data (teacher-only page, so unfiltered reads are permitted) ───
  const { data: crewRoles } = useCollection<CrewRoleDoc>('crew_roles')
  const { data: equipmentCatalog } = useCollection<EquipmentDoc>('equipment')
  const equipmentById = useMemo(
    () => Object.fromEntries(equipmentCatalog.map(e => [e.id, e])),
    [equipmentCatalog],
  )
  const { data: equipmentBookings } = useCollection<EquipmentBookingDoc>('equipment_bookings')
  const { data: students } = useCollection<UserDoc>(
    'users',
    periodCohortId ? [where('cohortId', '==', periodCohortId), where('role', '==', 'student')] : [],
    !!periodCohortId,
    periodCohortId,
  )

  useEffect(() => {
    if (!embedded && cohorts.length && !cohortId) setCohortId(cohorts[0].id)
  }, [embedded, cohorts, cohortId])

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
      {!embedded && cohorts.length > 1 && (
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
                {periods.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.title}{!cohortId ? ` — ${cohorts.find(c => c.id === p.cohortId)?.name ?? ''}` : ''}
                  </option>
                ))}
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
            <BudgetOverview
              period={period}
              productions={allProductions}
              prodDayData={prodDayData}
              crewRoles={crewRoles}
              equipmentBookings={equipmentBookings}
              equipmentById={equipmentById}
            />
          )}
        </>
      )}

      {/* Modals */}
      {showPeriodForm && (
        <PeriodForm
          cohortId={cohortId}
          cohorts={cohorts}
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
