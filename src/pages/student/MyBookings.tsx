import { useEffect, useMemo, useState } from 'react'
import { collectionGroup, onSnapshot } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useFeature } from '@/hooks/useFeature'
import { useCollection, useDocument, where } from '@/hooks/useFirestore'
import { markFoodBoxSeen, markMinivanSeen } from '@/hooks/useBookingBadge'
import type { InventoryProjectDoc, InventoryItemDoc, FoodBoxOrderDoc, MinivanBookingDoc } from '@/types'
import { cn } from '@/lib/utils'
import {
  ClipboardList, Package, UtensilsCrossed, Car,
  AlertTriangle, CheckCircle2, XCircle, Clock, RotateCcw,
} from 'lucide-react'

function today() {
  return new Date().toISOString().slice(0, 10)
}

function fmtDate(d: string) {
  if (!d) return '—'
  try {
    return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return d }
}

function overdueDays(returnDate: string): number {
  if (!returnDate) return 0
  const diff = Math.round((new Date(today()).getTime() - new Date(returnDate + 'T00:00:00').getTime()) / 86400000)
  return diff > 0 ? diff : 0
}

// ── Generic status pill ──────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, string> = {
  active:       'bg-blue-950/40 text-blue-300 border-blue-800/50',
  'checked-out':'bg-blue-950/40 text-blue-300 border-blue-800/50',
  returned:     'bg-emerald-950/40 text-emerald-300 border-emerald-800/50',
  archived:     'bg-zinc-800 text-zinc-500 border-white/10',
  damaged:      'bg-amber-950/40 text-amber-300 border-amber-800/50',
  missing:      'bg-rose-950/40 text-rose-300 border-rose-800/50',
  pending:      'bg-amber-950/40 text-amber-300 border-amber-800/50',
  confirmed:    'bg-emerald-950/40 text-emerald-300 border-emerald-800/50',
  approved:     'bg-emerald-950/40 text-emerald-300 border-emerald-800/50',
  cancelled:    'bg-zinc-800 text-zinc-500 border-white/10',
  rejected:     'bg-rose-950/40 text-rose-300 border-rose-800/50',
}

const STATUS_ICON: Record<string, React.ReactNode> = {
  active:        <Clock className="w-3 h-3" />,
  'checked-out': <Package className="w-3 h-3" />,
  returned:      <CheckCircle2 className="w-3 h-3" />,
  archived:      <CheckCircle2 className="w-3 h-3" />,
  damaged:       <AlertTriangle className="w-3 h-3" />,
  missing:       <AlertTriangle className="w-3 h-3" />,
  pending:       <Clock className="w-3 h-3" />,
  confirmed:     <CheckCircle2 className="w-3 h-3" />,
  approved:      <CheckCircle2 className="w-3 h-3" />,
  cancelled:     <XCircle className="w-3 h-3" />,
  rejected:      <XCircle className="w-3 h-3" />,
}

function StatusPill({ status }: { status: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border capitalize flex-shrink-0', STATUS_STYLE[status] ?? 'bg-zinc-800 text-zinc-400 border-white/10')}>
      {STATUS_ICON[status]}
      {status.replace('-', ' ')}
    </span>
  )
}

// ── Data hooks ────────────────────────────────────────────────────────────────

function useProjectItems(projectIds: string[]) {
  const [items, setItems] = useState<(InventoryItemDoc & { projectId: string })[]>([])
  useEffect(() => {
    const unsub = onSnapshot(collectionGroup(db, 'items'), snap => {
      setItems(snap.docs.map(d => {
        const projectId = d.ref.parent.parent?.id ?? ''
        return { id: d.id, projectId, ...d.data() } as InventoryItemDoc & { projectId: string }
      }))
    })
    return unsub
  }, [])
  const idSet = useMemo(() => new Set(projectIds), [projectIds])
  return useMemo(() => items.filter(i => idSet.has(i.projectId)), [items, idSet])
}

function useEquipmentProjects(uid: string, enabled: boolean) {
  const { data: projects } = useCollection<InventoryProjectDoc>(
    'inventory_projects',
    enabled ? [where('borrowerIds', 'array-contains', uid)] : [],
    enabled,
  )
  const sorted = useMemo(
    () => [...projects].sort((a, b) => ((b.createdAt as any)?.seconds ?? 0) - ((a.createdAt as any)?.seconds ?? 0)),
    [projects],
  )
  const items = useProjectItems(sorted.map(p => p.id))
  return { projects: sorted, items }
}

function useFoodBoxOrders(uid: string, enabled: boolean) {
  const { data: orders } = useCollection<FoodBoxOrderDoc>(
    'food_box_orders',
    enabled ? [where('studentId', '==', uid)] : [],
    enabled,
  )
  return useMemo(
    () => [...orders].sort((a, b) => ((b.createdAt as any)?.toMillis?.() ?? 0) - ((a.createdAt as any)?.toMillis?.() ?? 0)),
    [orders],
  )
}

function useMinivanBookings(uid: string, enabled: boolean) {
  const { data: bookings } = useCollection<MinivanBookingDoc>(
    'minivan_bookings',
    enabled ? [where('studentId', '==', uid)] : [],
    enabled,
  )
  return useMemo(
    () => [...bookings].sort((a, b) => ((b.createdAt as any)?.toMillis?.() ?? 0) - ((a.createdAt as any)?.toMillis?.() ?? 0)),
    [bookings],
  )
}

// ── Equipment projects section ───────────────────────────────────────────────

function EquipmentProjectsSection({ projects, items }: {
  projects: InventoryProjectDoc[]
  items: (InventoryItemDoc & { projectId: string })[]
}) {
  if (projects.length === 0) return null

  return (
    <div className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-300">
        <Package className="w-4 h-4" /> Equipment Projects
      </h2>
      <div className="space-y-2">
        {projects.map(p => {
          const pItems = items.filter(i => i.projectId === p.id)
          const isOverdue = p.returnDate < today() && p.status !== 'returned' && p.status !== 'archived'
          const days = isOverdue ? overdueDays(p.returnDate) : 0
          return (
            <div key={p.id} className="bg-zinc-900 rounded-xl border border-white/10 overflow-hidden">
              <div className="px-4 py-3 space-y-2">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-zinc-200">{p.name}</p>
                    <p className="text-xs text-zinc-400 mt-0.5">{fmtDate(p.checkoutDate)} → {fmtDate(p.returnDate)}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {isOverdue && (
                      <span className="flex items-center gap-1 text-xs font-semibold bg-rose-950/60 text-rose-300 border border-rose-800/50 px-2 py-0.5 rounded-full">
                        <AlertTriangle className="w-3 h-3" /> {days}d overdue
                      </span>
                    )}
                    <StatusPill status={p.status} />
                  </div>
                </div>
                {pItems.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {pItems.map(i => (
                      <span
                        key={i.id}
                        className={cn(
                          'text-xs px-2.5 py-1 rounded-full border',
                          i.status === 'checked-out' ? 'bg-blue-950/30 text-blue-300 border-blue-800/40' :
                          i.status === 'returned'     ? 'bg-emerald-950/30 text-emerald-300 border-emerald-800/40' :
                          i.status === 'damaged'       ? 'bg-amber-950/30 text-amber-300 border-amber-800/40' :
                                                          'bg-rose-950/30 text-rose-300 border-rose-800/40',
                        )}
                      >
                        {i.equipmentName}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-zinc-500">No equipment scanned out yet</p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Food box section ─────────────────────────────────────────────────────────

function FoodBoxSection({ orders }: { orders: FoodBoxOrderDoc[] }) {
  if (orders.length === 0) return null

  return (
    <div className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-300">
        <UtensilsCrossed className="w-4 h-4" /> Food Boxes
      </h2>
      <div className="space-y-2">
        {orders.map(o => {
          const effectiveDate = o.adminDate ?? o.date
          const effectiveTime = o.adminPickupTime ?? o.pickupTime
          const meals = [
            o.morningStudents?.length ? `☕ ×${o.morningStudents.length}` : '',
            o.lunchStudents?.length   ? `🥗 ×${o.lunchStudents.length}`   : '',
            o.dinnerStudents?.length  ? `🍽️ ×${o.dinnerStudents.length}`  : '',
          ].filter(Boolean).join('  ')
          return (
            <div key={o.id} className="bg-zinc-900 rounded-xl border border-white/10 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="text-sm font-medium text-zinc-200">
                  {effectiveDate}{effectiveTime ? ` · ${effectiveTime}` : ''}
                </p>
                <p className="text-xs text-zinc-400 mt-0.5">{meals || 'No meals selected'}</p>
              </div>
              <StatusPill status={o.status} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Minivan section ──────────────────────────────────────────────────────────

function MinivanSection({ bookings }: { bookings: MinivanBookingDoc[] }) {
  if (bookings.length === 0) return null

  return (
    <div className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-300">
        <Car className="w-4 h-4" /> Mini Van
      </h2>
      <div className="space-y-2">
        {bookings.map(b => {
          const depDate = b.adminDateFrom ?? b.dateFrom
          const depTime = b.adminTimeFrom ?? b.timeFrom
          const retDate = b.adminDateTo   ?? b.dateTo
          const retTime = b.adminTimeTo   ?? b.timeTo
          return (
            <div key={b.id} className="bg-zinc-900 rounded-xl border border-white/10 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="text-sm font-medium text-zinc-200">{b.destination}{b.vehicle ? ` · ${b.vehicle}` : ''}</p>
                <p className="text-xs text-zinc-400 mt-0.5">{depDate} {depTime} → {retDate} {retTime}</p>
              </div>
              <StatusPill status={b.status} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function MyBookings() {
  const { profile } = useAuth()
  const uid = profile?.uid ?? ''
  const canEquipment = useFeature('equipment')
  const canFoodBox   = useFeature('food_box')
  const canVehicles  = useFeature('vehicles')
  const { data: navVis } = useDocument<{ id: string; student: Record<string, boolean> }>('settings', 'nav_visibility')

  const showEquipment = canEquipment && navVis?.student?.['equipment'] !== false
  const showFoodBox   = canFoodBox   && navVis?.student?.['foodBox']   !== false
  const showVehicles  = canVehicles  && navVis?.student?.['vehicle']   !== false

  const { projects, items } = useEquipmentProjects(uid, !!uid && showEquipment)
  const foodOrders          = useFoodBoxOrders(uid, !!uid && showFoodBox)
  const vanBookings         = useMinivanBookings(uid, !!uid && showVehicles)

  useEffect(() => {
    if (!uid) return
    if (showFoodBox)  markFoodBoxSeen(uid)
    if (showVehicles) markMinivanSeen(uid)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid])

  if (!profile) return null

  const nothingToShow = projects.length === 0 && foodOrders.length === 0 && vanBookings.length === 0

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="page-title flex items-center gap-2">
          <ClipboardList className="w-5 h-5" /> My Bookings
        </h1>
        <p className="text-zinc-400 text-sm mt-1">Everything you've booked or checked out, in one place.</p>
      </div>

      {nothingToShow ? (
        <div className="text-center py-16 text-zinc-500">
          <RotateCcw className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Nothing booked yet.</p>
        </div>
      ) : (
        <>
          {showEquipment && <EquipmentProjectsSection projects={projects} items={items} />}
          {showFoodBox   && <FoodBoxSection orders={foodOrders} />}
          {showVehicles  && <MinivanSection bookings={vanBookings} />}
        </>
      )}
    </div>
  )
}
