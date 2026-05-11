import { useState, useMemo } from 'react'
import { addDays, format, startOfWeek, isToday, getDay } from 'date-fns'
import { deleteDoc, doc } from 'firebase/firestore'
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react'
import { db } from '@/lib/firebase'
import { useCollection, where } from '@/hooks/useFirestore'
import type { RoomDoc, RoomBookingDoc, RoomAvailabilityWindow } from '@/types'
import { cn } from '@/lib/utils'
import LoadingSpinner from '@/components/common/LoadingSpinner'

interface TimeSlot { startTime: string; endTime: string }

function slotKey(slot: TimeSlot, date: string, roomId: string) {
  return `${slot.startTime}_${slot.endTime}_${date}_${roomId}`
}

function isRoomAvailableForSlot(room: RoomDoc, dateStr: string, dayNum: number, slot: TimeSlot): boolean {
  const windows: RoomAvailabilityWindow[] = room.availability ?? []
  if (windows.length === 0) return true
  return windows.some(w =>
    dateStr >= w.startDate &&
    dateStr <= w.endDate &&
    w.days.includes(dayNum) &&
    w.startTime === slot.startTime &&
    w.endTime === slot.endTime,
  )
}

export default function BookingOverview() {
  const [weekOffset, setWeekOffset]       = useState(0)
  const [selectedDayIdx, setSelectedDayIdx] = useState<number>(() => {
    const d = getDay(new Date())
    return d >= 1 && d <= 5 ? d - 1 : 0
  })
  const [filterRoom, setFilterRoom] = useState('')
  const [cancelling, setCancelling] = useState(false)

  const weekStart = useMemo(() => {
    const base = startOfWeek(new Date(), { weekStartsOn: 1 })
    return addDays(base, weekOffset * 7)
  }, [weekOffset])

  const weekDays = useMemo(
    () => Array.from({ length: 5 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  )

  const selectedDay     = weekDays[selectedDayIdx]
  const selectedDateStr = format(selectedDay, 'yyyy-MM-dd')
  const selectedDayNum  = getDay(selectedDay)

  const weekStartStr = format(weekStart, 'yyyy-MM-dd')
  const weekEndStr   = format(addDays(weekStart, 4), 'yyyy-MM-dd')

  const { data: rooms }                   = useCollection<RoomDoc>('rooms', [where('isActive', '==', true)])
  const { data: bookings, loading }       = useCollection<RoomBookingDoc>(
    'room_bookings',
    [where('date', '>=', weekStartStr), where('date', '<=', weekEndStr)],
    true,
    `${weekStartStr}_${weekEndStr}`,
  )

  const sortedRooms = useMemo(
    () => [...rooms]
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name))
      .filter(r => !filterRoom || r.id === filterRoom),
    [rooms, filterRoom],
  )

  const allSortedRooms = useMemo(
    () => [...rooms].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name)),
    [rooms],
  )

  const timeSlots = useMemo((): TimeSlot[] => {
    const seen = new Map<string, TimeSlot>()
    for (const room of allSortedRooms) {
      for (const w of (room.availability ?? []) as RoomAvailabilityWindow[]) {
        if (
          w.days.includes(selectedDayNum) &&
          selectedDateStr >= w.startDate &&
          selectedDateStr <= w.endDate
        ) {
          const k = `${w.startTime}_${w.endTime}`
          if (!seen.has(k)) seen.set(k, { startTime: w.startTime, endTime: w.endTime })
        }
      }
    }
    return [...seen.values()].sort((a, b) => a.startTime.localeCompare(b.startTime))
  }, [allSortedRooms, selectedDayNum, selectedDateStr])

  const bookingMap = useMemo(() => {
    const m = new Map<string, RoomBookingDoc>()
    for (const b of bookings) {
      if (b.startTime && b.endTime) {
        m.set(slotKey({ startTime: b.startTime, endTime: b.endTime }, b.date, b.roomId), b)
      }
    }
    return m
  }, [bookings])

  async function handleCancelBooking(booking: RoomBookingDoc) {
    if (!confirm(`Cancel booking for ${booking.studentName}?`)) return
    setCancelling(true)
    try { await deleteDoc(doc(db, 'room_bookings', booking.id)) }
    finally { setCancelling(false) }
  }

  function goToday() {
    setWeekOffset(0)
    const d = getDay(new Date())
    setSelectedDayIdx(d >= 1 && d <= 5 ? d - 1 : 0)
  }

  if (loading) return <LoadingSpinner />

  const isCurrentWeek = weekOffset === 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Room Bookings</h1>
        <p className="text-zinc-400 text-sm mt-1">Overview of student room bookings. Click an occupied slot to cancel it.</p>
      </div>

      {/* Week + day navigation */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => setWeekOffset(w => w - 1)} className="p-2 rounded-lg border border-white/10 hover:bg-zinc-800 transition-colors">
          <ChevronLeft className="w-4 h-4 text-zinc-500" />
        </button>

        <div className="flex gap-1">
          {weekDays.map((day, idx) => {
            const isSelected = idx === selectedDayIdx
            const today      = isToday(day)
            return (
              <button
                key={idx}
                onClick={() => setSelectedDayIdx(idx)}
                className={cn(
                  'flex flex-col items-center w-14 py-2 rounded-xl text-sm transition-all',
                  isSelected
                    ? 'bg-brand-600 text-white font-semibold shadow-sm'
                    : today
                      ? 'bg-brand-50 text-brand-700 border border-brand-200 font-medium'
                      : 'text-zinc-400 hover:bg-zinc-800',
                )}
              >
                <span className="text-xs opacity-80">{format(day, 'EEE')}</span>
                <span className="text-base font-bold leading-tight">{format(day, 'd')}</span>
              </button>
            )
          })}
        </div>

        <button onClick={() => setWeekOffset(w => w + 1)} className="p-2 rounded-lg border border-white/10 hover:bg-zinc-800 transition-colors">
          <ChevronRight className="w-4 h-4 text-zinc-500" />
        </button>

        {!isCurrentWeek && (
          <button onClick={goToday} className="flex items-center gap-1.5 text-sm text-brand-600 hover:text-brand-800 px-3 py-2 rounded-lg hover:bg-brand-50 transition-colors">
            <CalendarDays className="w-4 h-4" /> Today
          </button>
        )}

        <span className="text-sm text-zinc-400 hidden sm:block">
          {format(weekStart, 'd MMM')} – {format(addDays(weekStart, 4), 'd MMM yyyy')}
        </span>

        <select value={filterRoom} onChange={e => setFilterRoom(e.target.value)} className="input max-w-[160px] ml-auto">
          <option value="">All rooms</option>
          {allSortedRooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </div>

      {/* Grid */}
      {timeSlots.length === 0 ? (
        <div className="bg-zinc-900 rounded-2xl border border-white/10 p-14 text-center">
          <p className="text-zinc-400 text-sm">No time slots available for {format(selectedDay, 'EEEE')}.</p>
        </div>
      ) : sortedRooms.length === 0 ? (
        <div className="bg-zinc-900 rounded-2xl border border-white/10 p-14 text-center">
          <p className="text-zinc-400 text-sm">No active rooms configured.</p>
        </div>
      ) : (
        <div className="bg-zinc-900 rounded-2xl border border-white/10 overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10 bg-zinc-900/50">
                <th className="text-left text-xs font-medium text-zinc-500 px-5 py-3 w-36">
                  {format(selectedDay, 'EEEE d MMM')}
                </th>
                {sortedRooms.map(room => (
                  <th key={room.id} className="text-center px-3 py-3 min-w-[120px]">
                    <p className="text-sm font-semibold text-zinc-200">{room.name}</p>
                    {room.description && (
                      <p className="text-xs font-normal text-zinc-400">{room.description}</p>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {timeSlots.map(slot => (
                <tr key={`${slot.startTime}_${slot.endTime}`} className="hover:bg-white/5/50 transition-colors">
                  <td className="px-5 py-3">
                    <p className="text-sm font-semibold text-zinc-200">{slot.startTime}–{slot.endTime}</p>
                  </td>
                  {sortedRooms.map(room => {
                    const booking      = bookingMap.get(slotKey(slot, selectedDateStr, room.id))
                    const isUnavailable = !isRoomAvailableForSlot(room, selectedDateStr, selectedDayNum, slot)

                    return (
                      <td key={room.id} className="px-2 py-2 text-center">
                        {isUnavailable ? (
                          <div className="w-full rounded-xl px-2 py-3.5 text-xs font-medium bg-zinc-900/50 border border-white/8 text-zinc-300">
                            —
                          </div>
                        ) : booking ? (
                          <button
                            disabled={cancelling}
                            onClick={() => handleCancelBooking(booking)}
                            title="Click to cancel this booking"
                            className="w-full rounded-xl px-2 py-3.5 text-xs font-medium transition-all border bg-rose-950/40 border-rose-800/50 text-rose-700 hover:bg-rose-100 hover:border-rose-300 active:bg-rose-200"
                          >
                            <div className="font-semibold truncate">{booking.studentName.split(' ')[0]}</div>
                            <div className="opacity-60 text-[10px] mt-0.5 truncate">{booking.studentName.split(' ').slice(1).join(' ')}</div>
                          </button>
                        ) : (
                          <div className="w-full rounded-xl px-2 py-3.5 text-xs font-medium bg-emerald-950/40 border border-emerald-800/50 text-emerald-700">
                            Free
                          </div>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-5 text-xs text-zinc-500">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-emerald-200 flex-shrink-0" /> Free
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-rose-200 flex-shrink-0" /> Booked (click to cancel)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-zinc-800 flex-shrink-0" /> Not available
        </span>
      </div>
    </div>
  )
}
