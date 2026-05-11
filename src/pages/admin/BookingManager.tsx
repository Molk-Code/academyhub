import { useState, useMemo } from 'react'
import { deleteDoc, doc } from 'firebase/firestore'
import { format, addDays, startOfWeek } from 'date-fns'
import { CalendarCheck, Trash2, ChevronLeft, ChevronRight } from 'lucide-react'
import { db } from '@/lib/firebase'
import { useCollection, where } from '@/hooks/useFirestore'
import type { RoomBookingDoc, RoomDoc, TimeBlockDoc } from '@/types'
import LoadingSpinner from '@/components/common/LoadingSpinner'

export default function BookingManager() {
  const [weekOffset, setWeekOffset] = useState(0)
  const [filterRoom, setFilterRoom] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)

  const weekStart = useMemo(() => {
    const base = startOfWeek(new Date(), { weekStartsOn: 1 })
    return addDays(base, weekOffset * 7)
  }, [weekOffset])

  const weekStartStr = format(weekStart, 'yyyy-MM-dd')
  const weekEndStr = format(addDays(weekStart, 6), 'yyyy-MM-dd')

  const { data: rooms } = useCollection<RoomDoc>('rooms')
  const { data: blocks } = useCollection<TimeBlockDoc>('time_blocks')
  const { data: bookings, loading } = useCollection<RoomBookingDoc>(
    'room_bookings',
    [where('date', '>=', weekStartStr), where('date', '<=', weekEndStr)],
    true,
    `${weekStartStr}_${weekEndStr}`,
  )

  const roomMap = Object.fromEntries(rooms.map(r => [r.id, r]))
  const blockMap = Object.fromEntries(blocks.map(b => [b.id, b]))

  const filtered = bookings
    .filter(b => !filterRoom || b.roomId === filterRoom)
    .sort((a, b) => a.date.localeCompare(b.date) || (blockMap[a.blockId ?? '']?.startTime ?? '').localeCompare(blockMap[b.blockId ?? '']?.startTime ?? ''))

  async function cancelBooking(id: string) {
    if (!confirm('Cancel this booking?')) return
    setDeleting(id)
    try {
      await deleteDoc(doc(db, 'room_bookings', id))
    } finally {
      setDeleting(null)
    }
  }

  if (loading) return <LoadingSpinner />

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Room Bookings</h1>
        <p className="text-zinc-400 text-sm mt-1">View and manage all student bookings.</p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setWeekOffset(w => w - 1)}
          className="p-2 rounded-lg border border-white/10 hover:bg-zinc-800 transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-sm font-medium text-zinc-300 min-w-[180px] text-center">
          {format(weekStart, 'd MMM')} – {format(addDays(weekStart, 6), 'd MMM yyyy')}
        </span>
        <button
          onClick={() => setWeekOffset(w => w + 1)}
          className="p-2 rounded-lg border border-white/10 hover:bg-zinc-800 transition-colors"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
        {weekOffset !== 0 && (
          <button
            onClick={() => setWeekOffset(0)}
            className="text-sm text-brand-600 hover:text-brand-800 px-3 py-2 rounded-lg hover:bg-brand-50 transition-colors"
          >
            This week
          </button>
        )}
        <select
          value={filterRoom}
          onChange={e => setFilterRoom(e.target.value)}
          className="input max-w-[200px] ml-auto"
        >
          <option value="">All rooms</option>
          {[...rooms].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map(r => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
      </div>

      <div className="bg-zinc-900 rounded-2xl border border-white/10 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="py-16 text-center">
            <CalendarCheck className="w-10 h-10 text-slate-200 mx-auto mb-3" />
            <p className="text-zinc-400 text-sm">No bookings found for this period.</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10">
                <th className="text-left text-xs font-medium text-zinc-500 px-5 py-3">Date</th>
                <th className="text-left text-xs font-medium text-zinc-500 px-4 py-3">Time block</th>
                <th className="text-left text-xs font-medium text-zinc-500 px-4 py-3">Room</th>
                <th className="text-left text-xs font-medium text-zinc-500 px-4 py-3">Student</th>
                <th className="text-left text-xs font-medium text-zinc-500 px-4 py-3">Booked at</th>
                <th className="w-16 px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map(booking => {
                const room = roomMap[booking.roomId]
                const block = blockMap[booking.blockId ?? '']
                const bookedAt = booking.createdAt?.toDate?.()
                return (
                  <tr key={booking.id} className="hover:bg-white/5 transition-colors">
                    <td className="px-5 py-3">
                      <p className="text-sm font-medium text-zinc-100">
                        {format(new Date(booking.date), 'EEE d MMM')}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm text-zinc-300">{block?.label ?? booking.blockId}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm text-zinc-300">{room?.name ?? booking.roomId}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-zinc-100">{booking.studentName}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-xs text-zinc-400">
                        {bookedAt ? format(bookedAt, 'HH:mm, d MMM') : '—'}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => cancelBooking(booking.id)}
                        disabled={deleting === booking.id}
                        className="p-1.5 text-zinc-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition-colors"
                        title="Cancel booking"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-xs text-zinc-400">{filtered.length} booking{filtered.length !== 1 ? 's' : ''} shown.</p>
    </div>
  )
}
