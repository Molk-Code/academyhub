import { useState, useMemo } from 'react'
import { addDays, format, startOfWeek, isToday, getDay } from 'date-fns'
import { collection, addDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore'
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useCollection, useDocument, where } from '@/hooks/useFirestore'
import type { RoomDoc, RoomBookingDoc, RoomAvailabilityWindow, BookingSettingsDoc, SemesterSettingsDoc } from '@/types'
import { cn } from '@/lib/utils'
import LoadingSpinner from '@/components/common/LoadingSpinner'

interface TimeSlot { startTime: string; endTime: string }

function slotKey(slot: TimeSlot, date: string, roomId: string) {
  return `${slot.startTime}_${slot.endTime}_${date}_${roomId}`
}

function isRoomAvailableForSlot(
  room: RoomDoc,
  dateStr: string,
  dayNum: number,
  slot: TimeSlot,
  semDates?: { start: string; end: string },
): boolean {
  const windows: RoomAvailabilityWindow[] = room.availability ?? []
  if (windows.length === 0) {
    // No windows configured — fall back to semester dates if known
    if (semDates) return dateStr >= semDates.start && dateStr <= semDates.end
    return true
  }
  return windows.some(w => {
    const useSem = w.useSemesterDates !== false
    if (useSem && !semDates) return w.days.includes(dayNum) && w.startTime === slot.startTime && w.endTime === slot.endTime
    const start = useSem ? semDates!.start : w.startDate
    const end   = useSem ? semDates!.end   : w.endDate
    return (
      dateStr >= start &&
      dateStr <= end &&
      w.days.includes(dayNum) &&
      w.startTime === slot.startTime &&
      w.endTime === slot.endTime
    )
  })
}

export default function RoomBooking({ standalone = false }: { standalone?: boolean }) {
  const { profile } = useAuth()

  const [weekOffset, setWeekOffset] = useState(0)
  const [selectedDayIdx, setSelectedDayIdx] = useState<number>(() => {
    const d = getDay(new Date())
    return d === 0 ? 6 : d - 1  // Mon=0 … Sat=5, Sun=6
  })
  const [acting, setActing] = useState(false)

  const weekStart = useMemo(() => {
    const base = startOfWeek(new Date(), { weekStartsOn: 1 })
    return addDays(base, weekOffset * 7)
  }, [weekOffset])

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  )

  const selectedDay      = weekDays[selectedDayIdx]
  const selectedDateStr  = format(selectedDay, 'yyyy-MM-dd')
  const selectedDayNum   = getDay(selectedDay)

  const weekStartStr = format(weekStart, 'yyyy-MM-dd')
  const weekEndStr   = format(addDays(weekStart, 6), 'yyyy-MM-dd')

  const { data: rooms } = useCollection<RoomDoc>('rooms', [where('isActive', '==', true)])
  const { data: bookings, loading } = useCollection<RoomBookingDoc>(
    'room_bookings',
    [where('date', '>=', weekStartStr), where('date', '<=', weekEndStr)],
    true,
    `${weekStartStr}_${weekEndStr}`,
  )
  const { data: bookingSettings } = useDocument<BookingSettingsDoc>('settings', 'booking')
  const { data: semester }        = useDocument<SemesterSettingsDoc>('settings', 'semester')

  const sortedRooms = useMemo(
    () => [...rooms].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name)),
    [rooms],
  )

  // Declare semester dates early so timeSlots useMemo can use them
  const semStartStr = semester?.startDate ?? null
  const semEndStr   = semester?.sem2End ?? semester?.endDate ?? null
  const semDates    = semStartStr && semEndStr ? { start: semStartStr, end: semEndStr } : undefined

  // Derive unique time slots from all rooms' availability windows for the selected day/date
  const timeSlots = useMemo((): TimeSlot[] => {
    const seen = new Map<string, TimeSlot>()
    for (const room of sortedRooms) {
      for (const w of (room.availability ?? [])) {
        const useSem = w.useSemesterDates !== false
        if (useSem && !semDates) {
          if (w.days.includes(selectedDayNum)) {
            const k = `${w.startTime}_${w.endTime}`
            if (!seen.has(k)) seen.set(k, { startTime: w.startTime, endTime: w.endTime })
          }
          continue
        }
        const start = useSem ? semDates!.start : w.startDate
        const end   = useSem ? semDates!.end   : w.endDate
        if (
          w.days.includes(selectedDayNum) &&
          selectedDateStr >= start &&
          selectedDateStr <= end
        ) {
          const k = `${w.startTime}_${w.endTime}`
          if (!seen.has(k)) seen.set(k, { startTime: w.startTime, endTime: w.endTime })
        }
      }
    }
    return [...seen.values()].sort((a, b) => a.startTime.localeCompare(b.startTime))
  }, [sortedRooms, selectedDayNum, selectedDateStr, semDates])

  const bookingMap = useMemo(() => {
    const m = new Map<string, RoomBookingDoc>()
    for (const b of bookings) {
      if (b.startTime && b.endTime) {
        m.set(slotKey({ startTime: b.startTime, endTime: b.endTime }, b.date, b.roomId), b)
      }
    }
    return m
  }, [bookings])

  const maxBookingsPerWeek = bookingSettings?.maxBookingsPerWeek ?? null
  const myWeeklyBookings = useMemo(
    () => bookings.filter(b => b.studentId === profile?.uid).length,
    [bookings, profile?.uid],
  )
  const weeklyLimitReached = maxBookingsPerWeek !== null && myWeeklyBookings >= maxBookingsPerWeek

  const todayStr   = format(new Date(), 'yyyy-MM-dd')
  const nowTimeStr = format(new Date(), 'HH:mm')

  function isSlotExpired(slot: TimeSlot): boolean {
    if (selectedDateStr < todayStr) return true
    if (selectedDateStr === todayStr) return slot.endTime <= nowTimeStr
    return false
  }

  async function handleCellClick(slot: TimeSlot, room: RoomDoc) {
    if (!profile || acting || isSlotExpired(slot)) return
    const key      = slotKey(slot, selectedDateStr, room.id)
    const existing = bookingMap.get(key)

    if (existing) {
      if (existing.studentId !== profile.uid) return
      if (!confirm('Cancel your booking for this slot?')) return
      setActing(true)
      try { await deleteDoc(doc(db, 'room_bookings', existing.id)) }
      finally { setActing(false) }
      return
    }

    if (weeklyLimitReached) return

    setActing(true)
    try {
      await addDoc(collection(db, 'room_bookings'), {
        roomId:      room.id,
        startTime:   slot.startTime,
        endTime:     slot.endTime,
        date:        selectedDateStr,
        studentId:   profile.uid,
        studentName: profile.displayName,
        createdAt:   serverTimestamp(),
      })
    } finally {
      setActing(false)
    }
  }

  function goToday() {
    setWeekOffset(0)
    const d = getDay(new Date())
    setSelectedDayIdx(d === 0 ? 6 : d - 1)
  }

  if (loading) return <LoadingSpinner />

  const isCurrentWeek = weekOffset === 0

  const canGoPrev = semStartStr ? weekEndStr > semStartStr : true
  const canGoNext = semEndStr   ? weekStartStr < semEndStr : true

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        {standalone && (
          <div>
            <h1 className="page-title">Room Booking</h1>
            <p className="text-zinc-400 text-sm mt-1">Book an editing room for a time slot. One booking per slot per day.</p>
          </div>
        )}
        {maxBookingsPerWeek !== null && (
          <div
            className="flex-shrink-0 text-sm font-medium px-4 py-2 rounded-xl border"
            style={weeklyLimitReached
              ? { background: 'rgba(239,68,68,0.10)', borderColor: 'rgba(239,68,68,0.30)', color: '#fca5a5' }
              : { background: 'var(--bg-elevated)', borderColor: 'var(--border)', color: 'var(--text-primary)' }
            }
          >
            {myWeeklyBookings} / {maxBookingsPerWeek} bookings this week
          </div>
        )}
      </div>

      {/* Week + day navigation */}
      <div className="space-y-2">
        {/* Row 1: arrows + week label */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => canGoPrev && setWeekOffset(w => w - 1)}
            disabled={!canGoPrev}
            className="p-2 rounded-lg border border-white/10 hover:bg-zinc-800 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-4 h-4 text-zinc-500" />
          </button>
          <span className="flex-1 text-sm text-zinc-400 text-center">
            {format(weekStart, 'd MMM')} – {format(addDays(weekStart, 6), 'd MMM yyyy')}
          </span>
          <button
            onClick={() => canGoNext && setWeekOffset(w => w + 1)}
            disabled={!canGoNext}
            className="p-2 rounded-lg border border-white/10 hover:bg-zinc-800 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronRight className="w-4 h-4 text-zinc-500" />
          </button>
          {!isCurrentWeek && (
            <button onClick={goToday} className="flex items-center gap-1.5 text-sm text-brand-400 hover:text-brand-300 px-3 py-2 rounded-lg hover:bg-zinc-800 transition-colors">
              <CalendarDays className="w-4 h-4" /> Today
            </button>
          )}
        </div>

        {/* Row 2: day pills */}
        <div className="flex gap-1">
          {weekDays.map((day, idx) => {
            const isSelected = idx === selectedDayIdx
            const today = isToday(day)
            return (
              <button
                key={idx}
                onClick={() => setSelectedDayIdx(idx)}
                className={cn(
                  'flex flex-col items-center flex-1 py-2 rounded-xl text-sm transition-all',
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
                  <th key={room.id} className="text-center px-3 py-3 min-w-[110px]">
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
                    const booking        = bookingMap.get(slotKey(slot, selectedDateStr, room.id))
                    const isBooked      = !!booking
                    const isMine        = booking?.studentId === profile?.uid
                    const isUnavailable = !isRoomAvailableForSlot(room, selectedDateStr, selectedDayNum, slot, semDates)
                    const isPast        = isSlotExpired(slot)
                    const isLimitHit    = !isBooked && !isMine && weeklyLimitReached

                    return (
                      <td key={room.id} className="px-2 py-2 text-center">
                        <button
                          disabled={isUnavailable || isPast || (isBooked && !isMine) || isLimitHit || acting}
                          onClick={() => handleCellClick(slot, room)}
                          className={cn(
                            'w-full rounded-xl px-2 py-3.5 text-xs font-medium transition-all border select-none',
                            isUnavailable || isPast
                              ? 'bg-zinc-800 border-white/10 text-zinc-400 cursor-not-allowed'
                              : isMine
                                ? 'bg-amber-400 border-amber-500 text-amber-950 hover:bg-amber-500 active:bg-amber-600'
                                : isBooked
                                  ? 'bg-rose-500 border-rose-600 text-white cursor-not-allowed'
                                  : isLimitHit
                                    ? 'bg-zinc-800 border-white/10 text-zinc-400 cursor-not-allowed'
                                    : 'bg-emerald-500 border-emerald-600 text-white hover:bg-emerald-600 active:bg-emerald-700',
                          )}
                        >
                          {isUnavailable ? (
                            <div className="font-medium">—</div>
                          ) : isPast ? (
                            <div className="font-medium text-zinc-500">Past</div>
                          ) : isMine ? (
                            <div>
                              <div className="font-semibold">You</div>
                              <div className="opacity-60 text-[10px] mt-0.5">tap to cancel</div>
                            </div>
                          ) : isBooked ? (
                            <div>
                              <div className="font-medium">Taken</div>
                              <div className="opacity-50 text-[10px] mt-0.5 truncate">{booking.studentName.split(' ')[0]}</div>
                            </div>
                          ) : isLimitHit ? (
                            <div className="font-medium">—</div>
                          ) : (
                            <div className="font-medium">Free</div>
                          )}
                        </button>
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
      <div className="flex items-center gap-5 text-xs text-zinc-500 flex-wrap">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-emerald-500 flex-shrink-0" /> Free
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-amber-400 flex-shrink-0" /> Your booking (tap to cancel)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-rose-500 flex-shrink-0" /> Taken
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-zinc-700 flex-shrink-0" /> Not available
        </span>
      </div>
    </div>
  )
}
