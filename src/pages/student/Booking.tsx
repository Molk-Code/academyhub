import { useState, useMemo, useEffect } from 'react'
import { DoorOpen, UtensilsCrossed, Car, Clock, CheckCircle2, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { useCollection, where } from '@/hooks/useFirestore'
import { markFoodBoxSeen, markMinivanSeen, useStudentBookingTabBadges } from '@/hooks/useBookingBadge'
import type { FoodBoxOrderDoc, MinivanBookingDoc } from '@/types'
import RoomBooking    from './RoomBooking'
import FoodBoxOrder   from './FoodBoxOrder'
import MinivanBooking from './MinivanBooking'

type Tab = 'room' | 'food' | 'minivan'

const TABS: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'room',    label: 'Room Booking', icon: DoorOpen        },
  { id: 'food',    label: 'Food Box',     icon: UtensilsCrossed },
  { id: 'minivan', label: 'Vehicles',     icon: Car             },
]

// ── Status badge ──────────────────────────────────────────────────────────────

type AnyStatus = 'pending' | 'confirmed' | 'cancelled' | 'approved' | 'rejected'

const STATUS_STYLE: Record<AnyStatus, string> = {
  pending:   'bg-amber-950/40 text-amber-300 border-amber-800/50',
  confirmed: 'bg-emerald-950/40 text-emerald-300 border-emerald-800/50',
  approved:  'bg-emerald-950/40 text-emerald-300 border-emerald-800/50',
  cancelled: 'bg-zinc-800 text-zinc-500 border-white/10',
  rejected:  'bg-rose-950/40 text-rose-300 border-rose-800/50',
}

const STATUS_ICON: Record<AnyStatus, React.ReactNode> = {
  pending:   <Clock className="w-3 h-3" />,
  confirmed: <CheckCircle2 className="w-3 h-3" />,
  approved:  <CheckCircle2 className="w-3 h-3" />,
  cancelled: <XCircle className="w-3 h-3" />,
  rejected:  <XCircle className="w-3 h-3" />,
}

function StatusBadge({ status }: { status: AnyStatus }) {
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border', STATUS_STYLE[status])}>
      {STATUS_ICON[status]}
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  )
}

// ── Food box order history ────────────────────────────────────────────────────

function FoodBoxHistory() {
  const { profile } = useAuth()
  const { data: raw } = useCollection<FoodBoxOrderDoc>(
    'food_box_orders',
    profile ? [where('studentId', '==', profile.uid)] : [],
    !!profile,
  )
  const orders = useMemo(
    () => [...raw].sort((a, b) => ((b.createdAt as any)?.toMillis?.() ?? 0) - ((a.createdAt as any)?.toMillis?.() ?? 0)),
    [raw],
  )
  const [openId, setOpenId] = useState<string | null>(null)

  if (!orders.length) return null

  return (
    <div className="space-y-3 max-w-lg mx-auto">
      <h2 className="text-sm font-semibold text-zinc-300">Your Orders</h2>
      <div className="space-y-2">
        {orders.map(o => {
          const meals = [
            o.morningStudents?.length ? `☕ ×${o.morningStudents.length}` : '',
            o.lunchStudents?.length   ? `🥗 ×${o.lunchStudents.length}`   : '',
            o.dinnerStudents?.length  ? `🍽️ ×${o.dinnerStudents.length}`  : '',
          ].filter(Boolean).join('  ')
          const effectiveDate = o.adminDate ?? o.date
          const effectiveTime = o.adminPickupTime ?? o.pickupTime
          const isOpen = openId === o.id
          return (
            <div key={o.id} className="bg-zinc-900 rounded-xl border border-white/10 overflow-hidden">
              <button
                onClick={() => setOpenId(isOpen ? null : o.id)}
                className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-white/5 transition-colors"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-zinc-200">
                      {effectiveDate}{effectiveTime ? ` · ${effectiveTime}` : ''}
                    </p>
                    {o.pickupTimeModified && (
                      <span className="text-[10px] font-bold bg-amber-100 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded-full">⏰ Updated</span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-400 mt-0.5">{meals}</p>
                </div>
                <StatusBadge status={o.status} />
              </button>
              {isOpen && (
                <div className="border-t border-white/8 px-4 py-3 space-y-2 text-sm text-zinc-400">
                  {o.pickupTimeModified && (
                    <p className="text-xs font-semibold text-amber-700 bg-amber-950/40 border border-amber-800/50 rounded-lg px-3 py-2">
                      ⏰ Schedule updated by admin — Date: {effectiveDate}{effectiveTime ? `, pick-up at ${effectiveTime}` : ''}
                    </p>
                  )}
                  <p><span className="text-zinc-400">Contact:</span> {o.contactPerson} · {o.phoneNumber}</p>
                  {o.morningStudents?.length > 0 && (
                    <div>
                      <p className="font-medium">☕ Morning ({o.morningStudents.length})</p>
                      <p className="text-xs text-zinc-400">{o.morningStudents.join(', ')}</p>
                      {o.morningDiet && <p className="text-xs text-zinc-400">Diet: {o.morningDiet}</p>}
                    </div>
                  )}
                  {o.lunchStudents?.length > 0 && (
                    <div>
                      <p className="font-medium">🥗 Lunchbox ({o.lunchStudents.length})</p>
                      <p className="text-xs text-zinc-400">{o.lunchStudents.join(', ')}</p>
                      <p className="text-xs text-zinc-400">Can heat: {o.lunchCanHeat === null ? '–' : o.lunchCanHeat ? 'Yes' : 'No'}{o.lunchDiet ? ` · Diet: ${o.lunchDiet}` : ''}</p>
                    </div>
                  )}
                  {o.dinnerStudents?.length > 0 && (
                    <div>
                      <p className="font-medium">🍽️ Dinnerbox ({o.dinnerStudents.length})</p>
                      <p className="text-xs text-zinc-400">{o.dinnerStudents.join(', ')}</p>
                      <p className="text-xs text-zinc-400">Can heat: {o.dinnerCanHeat === null ? '–' : o.dinnerCanHeat ? 'Yes' : 'No'}{o.dinnerDiet ? ` · Diet: ${o.dinnerDiet}` : ''}</p>
                    </div>
                  )}
                  {o.otherNotes && <p className="text-xs text-zinc-500 bg-zinc-900/50 rounded-lg px-3 py-2">📝 {o.otherNotes}</p>}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Minivan booking history ───────────────────────────────────────────────────

function MinivanHistory() {
  const { profile } = useAuth()
  const { data: raw } = useCollection<MinivanBookingDoc>(
    'minivan_bookings',
    profile ? [where('studentId', '==', profile.uid)] : [],
    !!profile,
  )
  const bookings = useMemo(
    () => [...raw].sort((a, b) => ((b.createdAt as any)?.toMillis?.() ?? 0) - ((a.createdAt as any)?.toMillis?.() ?? 0)),
    [raw],
  )
  const [openId, setOpenId] = useState<string | null>(null)

  if (!bookings.length) return null

  return (
    <div className="space-y-3 max-w-lg mx-auto">
      <h2 className="text-sm font-semibold text-zinc-300">Your Requests</h2>
      <div className="space-y-2">
        {bookings.map(b => {
          const depDate = b.adminDateFrom ?? b.dateFrom
          const depTime = b.adminTimeFrom ?? b.timeFrom
          const retDate = b.adminDateTo   ?? b.dateTo
          const retTime = b.adminTimeTo   ?? b.timeTo
          const isOpen  = openId === b.id
          return (
            <div key={b.id} className="bg-zinc-900 rounded-xl border border-white/10 overflow-hidden">
              <button
                onClick={() => setOpenId(isOpen ? null : b.id)}
                className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-white/5 transition-colors"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-zinc-200">{b.destination}</p>
                    {b.scheduleModified && (
                      <span className="text-[10px] font-bold bg-amber-100 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded-full">⏰ Updated</span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-400 mt-0.5">{depDate} {depTime} → {retDate} {retTime}</p>
                </div>
                <StatusBadge status={b.status} />
              </button>
              {isOpen && (
                <div className="border-t border-white/8 px-4 py-3 space-y-2 text-sm text-zinc-400">
                  {b.scheduleModified && (
                    <p className="text-xs font-semibold text-amber-700 bg-amber-950/40 border border-amber-800/50 rounded-lg px-3 py-2">
                      ⏰ Schedule updated by admin — Departure: {depDate} at {depTime}, Return: {retDate} at {retTime}
                    </p>
                  )}
                  {b.vehicle && <p><span className="text-zinc-400">Vehicle:</span> {b.vehicle}</p>}
                  <p><span className="text-zinc-400">Destination:</span> {b.destination}</p>
                  <p><span className="text-zinc-400">Purpose:</span> {b.purpose}</p>
                  <p><span className="text-zinc-400">Driver:</span> {b.driverName}</p>
                  <p><span className="text-zinc-400">Contact:</span> {b.contactPerson} · {b.phoneNumber}</p>
                  {b.notes && <p className="text-xs text-zinc-500 bg-zinc-900/50 rounded-lg px-3 py-2">📝 {b.notes}</p>}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Main Booking hub ──────────────────────────────────────────────────────────

export default function Booking() {
  const { profile } = useAuth()
  const [tab, setTab] = useState<Tab>('room')
  const tabBadges = useStudentBookingTabBadges()

  // Clear the badge only when the relevant tab is viewed
  useEffect(() => {
    if (!profile?.uid) return
    if (tab === 'food')    markFoodBoxSeen(profile.uid)
    if (tab === 'minivan') markMinivanSeen(profile.uid)
  }, [tab, profile?.uid])

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">Booking</h1>
        <p className="text-zinc-500 text-sm mt-1">Book rooms, order food boxes, or request the school minivan.</p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 bg-zinc-800 rounded-xl p-1 w-fit">
        {TABS.map(({ id, label, icon: Icon }) => {
          const badge = id === 'food' ? tabBadges.food : id === 'minivan' ? tabBadges.van : 0
          return (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              'relative flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all',
              tab === id
                ? 'bg-zinc-900 text-zinc-100 shadow-sm'
                : 'text-zinc-500 hover:text-zinc-300',
            )}
          >
            <Icon className="w-4 h-4" />
            {label}
            {badge > 0 && tab !== id && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-4 flex items-center justify-center rounded-full bg-rose-500 text-white text-[9px] font-bold px-1 leading-none">
                {badge}
              </span>
            )}
          </button>
          )
        })}
      </div>

      {tab === 'room' && <RoomBooking />}

      {tab === 'food' && (
        <div className="space-y-8">
          <FoodBoxOrder />
          <FoodBoxHistory />
        </div>
      )}

      {tab === 'minivan' && (
        <div className="space-y-8">
          <MinivanBooking />
          <MinivanHistory />
        </div>
      )}
    </div>
  )
}
