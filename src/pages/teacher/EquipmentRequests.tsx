import { useState, useMemo } from 'react'
import { updateDoc, doc, addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useCollection, orderBy } from '@/hooks/useFirestore'
import { cn } from '@/lib/utils'
import type { EquipmentBookingDoc } from '@/types'
import { Package, CheckCircle, XCircle, ChevronRight } from 'lucide-react'
import LoadingSpinner from '@/components/common/LoadingSpinner'
import { useNavigate } from 'react-router-dom'

const STATUS_STYLE: Record<string, string> = {
  pending:       'text-amber-300 bg-amber-900/30 border-amber-700/40',
  confirmed:     'text-blue-300 bg-blue-900/30 border-blue-700/40',
  'checked-out': 'text-orange-300 bg-orange-900/30 border-orange-700/40',
  returned:      'text-green-300 bg-green-900/30 border-green-700/40',
  cancelled:     'text-zinc-400 bg-zinc-800/40 border-zinc-600/40',
}

type StatusFilter = 'pending' | 'confirmed' | 'all'

export default function EquipmentRequests() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending')
  const [denyTarget, setDenyTarget] = useState<EquipmentBookingDoc | null>(null)
  const [denyReason, setDenyReason] = useState('')
  const [denySubmitting, setDenySubmitting] = useState(false)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  const { data: bookings, loading } = useCollection<EquipmentBookingDoc>(
    'equipment_bookings',
    [orderBy('createdAt', 'desc')],
  )

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return bookings
    return bookings.filter(b => b.status === statusFilter)
  }, [bookings, statusFilter])

  const pendingCount = useMemo(() => bookings.filter(b => b.status === 'pending').length, [bookings])

  async function handleConfirm(booking: EquipmentBookingDoc) {
    setConfirmingId(booking.id)
    try {
      await updateDoc(doc(db, 'equipment_bookings', booking.id), { status: 'confirmed' })
    } finally {
      setConfirmingId(null)
    }
  }

  async function handleDeny() {
    if (!denyTarget) return
    setDenySubmitting(true)
    try {
      await updateDoc(doc(db, 'equipment_bookings', denyTarget.id), {
        status: 'cancelled',
        teacherNotes: denyReason.trim(),
      })
      setDenyTarget(null)
      setDenyReason('')
    } finally {
      setDenySubmitting(false)
    }
  }

  async function handleCreateProject(booking: EquipmentBookingDoc) {
    if (!profile) return
    const ref = await addDoc(collection(db, 'inventory_projects'), {
      name: booking.projectName,
      borrowers: [booking.studentName],
      borrowerIds: [booking.studentId],
      equipmentManagerId: profile.uid,
      equipmentManagerName: profile.displayName ?? '',
      cohortId: booking.cohortId ?? '',
      checkoutDate: booking.checkoutDate,
      returnDate: booking.returnDate,
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    navigate(`/teacher/inventory/project/${ref.id}`)
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <div className="flex items-center gap-3">
        <Package className="w-5 h-5 text-brand-400" />
        <h1 className="text-xl font-bold text-zinc-100">Equipment Requests</h1>
        {pendingCount > 0 && (
          <span className="min-w-[22px] h-[22px] flex items-center justify-center rounded-full bg-amber-500 text-white text-xs font-bold px-1.5">
            {pendingCount}
          </span>
        )}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 bg-zinc-900 border border-white/10 rounded-xl p-1 w-fit">
        {([['pending', 'Pending'], ['confirmed', 'Confirmed'], ['all', 'All']] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setStatusFilter(id)}
            className={cn(
              'px-4 py-1.5 text-sm font-medium rounded-lg transition-colors',
              statusFilter === id ? 'bg-brand-600 text-white' : 'text-zinc-400 hover:text-zinc-200',
            )}
          >
            {label}
            {id === 'pending' && pendingCount > 0 && (
              <span className="ml-1.5 text-[10px] bg-amber-500 text-white rounded-full px-1.5 py-px font-bold">{pendingCount}</span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><LoadingSpinner /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-zinc-500">
          <Package className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">{statusFilter === 'pending' ? 'No pending requests' : 'No requests found'}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(booking => (
            <div key={booking.id} className="bg-zinc-900 border border-white/8 rounded-2xl p-4 space-y-3">
              {/* Header */}
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-zinc-100">{booking.projectName}</p>
                    <span className={cn('text-[10px] font-bold tracking-wider px-2 py-0.5 rounded-full border capitalize', STATUS_STYLE[booking.status])}>
                      {booking.status.replace('-', ' ')}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400">{booking.studentName} · {booking.studentEmail}</p>
                  <p className="text-xs text-zinc-500">
                    {booking.checkoutDate} → {booking.returnDate}
                  </p>
                </div>

                {/* Actions */}
                {booking.status === 'pending' && (
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={() => handleConfirm(booking)}
                      disabled={confirmingId === booking.id}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white rounded-lg transition-colors"
                    >
                      <CheckCircle className="w-3.5 h-3.5" />
                      Confirm
                    </button>
                    <button
                      onClick={() => { setDenyTarget(booking); setDenyReason('') }}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded-lg transition-colors"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      Deny
                    </button>
                  </div>
                )}
                {booking.status === 'confirmed' && (
                  <button
                    onClick={() => handleCreateProject(booking)}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-brand-700 hover:bg-brand-600 text-white rounded-lg transition-colors flex-shrink-0"
                  >
                    Create Inventory Project
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Items */}
              {booking.items?.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {booking.items.map((item, i) => (
                    <span key={i} className="text-xs bg-zinc-800 text-zinc-300 px-2.5 py-1 rounded-full">
                      {item.quantity}× {item.equipmentName}
                    </span>
                  ))}
                </div>
              )}

              {booking.teacherNotes && (
                <p className="text-xs text-zinc-500 italic border-l-2 border-brand-500/30 pl-2">{booking.teacherNotes}</p>
              )}

              {booking.productionTitle && (
                <div className="mt-2 p-3 bg-white/5 rounded-xl">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs font-semibold text-zinc-300">🎬 {booking.productionTitle}</p>
                    {booking.productionId && (
                      <a
                        href={`/production/planning/${booking.productionId}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-orange-400 hover:text-orange-300 underline"
                      >
                        View plan →
                      </a>
                    )}
                  </div>
                  {booking.productionReadiness && (
                    <div className="flex flex-wrap gap-3 text-xs">
                      <span className={booking.productionReadiness.hasBreakdown ? 'text-emerald-400' : 'text-red-400'}>
                        {booking.productionReadiness.hasBreakdown ? '✓' : '✕'} Breakdown
                      </span>
                      <span className={booking.productionReadiness.hasCrew ? 'text-emerald-400' : 'text-red-400'}>
                        {booking.productionReadiness.hasCrew ? '✓' : '✕'} Crew
                      </span>
                      <span className={booking.productionReadiness.hasCast ? 'text-emerald-400' : 'text-red-400'}>
                        {booking.productionReadiness.hasCast ? '✓' : '✕'} Cast
                      </span>
                      <span className={booking.productionReadiness.hasLocations ? 'text-emerald-400' : 'text-red-400'}>
                        {booking.productionReadiness.hasLocations ? '✓' : '✕'} Locations
                      </span>
                      <span className={booking.productionReadiness.hasSchedule ? 'text-emerald-400' : 'text-red-400'}>
                        {booking.productionReadiness.hasSchedule ? '✓' : '✕'} Schedule
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Deny modal */}
      {denyTarget && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-white/10 rounded-2xl p-6 w-full max-w-md space-y-4">
            <h3 className="text-base font-semibold text-zinc-100">Deny request</h3>
            <p className="text-sm text-zinc-400">
              Denying <span className="text-zinc-200 font-medium">"{denyTarget.projectName}"</span> by {denyTarget.studentName}.
            </p>
            <div>
              <label className="label">Reason (optional — sent to student)</label>
              <textarea
                value={denyReason}
                onChange={e => setDenyReason(e.target.value)}
                rows={3}
                className="input resize-none"
                placeholder="Equipment unavailable, dates conflict…"
              />
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDenyTarget(null)}
                className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeny}
                disabled={denySubmitting}
                className="px-4 py-2 text-sm bg-rose-700 hover:bg-rose-600 disabled:opacity-50 text-white rounded-lg transition-colors"
              >
                {denySubmitting ? 'Denying…' : 'Deny Request'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
