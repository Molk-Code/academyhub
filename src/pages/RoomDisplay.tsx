/**
 * Public room display page — designed for iPad/screen at room entrances.
 * Requires Firestore public read rules for: rooms, room_bookings.
 *
 * Add to firestore.rules:
 *   match /rooms/{id}         { allow read: if true; }
 *   match /room_bookings/{id} { allow read: if true; }
 */
import { useState, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { format, addDays, startOfWeek, isSameDay } from 'date-fns'
import { useCollection, where } from '@/hooks/useFirestore'
import type { RoomDoc, RoomBookingDoc, RoomAvailabilityWindow } from '@/types'
import { cn } from '@/lib/utils'

interface TimeSlot { startTime: string; endTime: string }

function nowMinutes() {
  const now = new Date()
  return now.getHours() * 60 + now.getMinutes()
}

function parseMinutes(t: string) {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

function slotStatus(slot: TimeSlot, isCurrentDay = true): 'past' | 'current' | 'upcoming' {
  if (!isCurrentDay) return 'upcoming'
  const now   = nowMinutes()
  const start = parseMinutes(slot.startTime)
  const end   = parseMinutes(slot.endTime)
  if (now >= end)   return 'past'
  if (now >= start) return 'current'
  return 'upcoming'
}

function bookingKey(slot: TimeSlot, date: string, roomId: string) {
  return `${slot.startTime}_${slot.endTime}_${date}_${roomId}`
}

function roomHasSlot(room: RoomDoc, slot: TimeSlot, dateStr: string, dayNum: number): boolean {
  return (room.availability ?? []).some((w: RoomAvailabilityWindow) =>
    w.days.includes(dayNum) &&
    dateStr >= w.startDate &&
    dateStr <= w.endDate &&
    w.startTime === slot.startTime &&
    w.endTime === slot.endTime,
  )
}

function deriveSlots(rooms: RoomDoc[], todayStr: string, todayDayNum: number): TimeSlot[] {
  const seen = new Map<string, TimeSlot>()
  for (const room of rooms) {
    for (const w of (room.availability ?? []) as RoomAvailabilityWindow[]) {
      if (
        w.days.includes(todayDayNum) &&
        todayStr >= w.startDate &&
        todayStr <= w.endDate
      ) {
        const k = `${w.startTime}_${w.endTime}`
        if (!seen.has(k)) seen.set(k, { startTime: w.startTime, endTime: w.endTime })
      }
    }
  }
  return [...seen.values()].sort((a, b) => a.startTime.localeCompare(b.startTime))
}

// ── Single-room iPad view ────────────────────────────────────────────────────

function SingleRoomDisplay({
  room, slots, bookingMap, todayStr, now, onBack,
}: {
  room: RoomDoc
  slots: TimeSlot[]
  bookingMap: Map<string, RoomBookingDoc>
  todayStr: string
  now: Date
  onBack: () => void
}) {
  const currentSlot = slots.find(s => slotStatus(s) === 'current')

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
      <div className="px-10 pt-10 pb-6 flex items-start justify-between border-b border-white/10">

        <div>
          <button onClick={onBack} className="text-gray-500 hover:text-gray-300 text-sm font-medium mb-2 flex items-center gap-1 transition-colors">
            ← All rooms
          </button>
          <p className="text-gray-400 text-lg font-medium tracking-widest uppercase mb-1">
            {format(now, 'EEEE, d MMMM yyyy')}
          </p>
          <h1 className="text-6xl font-black tracking-tight">{room.name.toUpperCase()}</h1>
          {room.description && (
            <p className="text-gray-400 text-xl mt-2">{room.description}</p>
          )}
        </div>
        <div className="text-right">
          <p className="text-5xl font-mono font-bold tabular-nums">{format(now, 'HH:mm')}</p>
          <p className="text-gray-500 text-sm mt-1 uppercase tracking-widest">Local time</p>
        </div>
      </div>

      {currentSlot && (() => {
        const booking = bookingMap.get(bookingKey(currentSlot, todayStr, room.id))
        return (
          <div className={cn(
            'mx-10 mt-6 rounded-2xl p-6 border-2',
            booking ? 'bg-rose-900/40 border-rose-500/60' : 'bg-emerald-900/40 border-emerald-500/60',
          )}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold tracking-widest uppercase text-gray-400 mb-1">
                  Now · {currentSlot.startTime}–{currentSlot.endTime}
                </p>
                <p className={cn('text-4xl font-black', booking ? 'text-rose-300' : 'text-emerald-300')}>
                  {booking ? booking.studentName : 'AVAILABLE'}
                </p>
              </div>
              <div className={cn(
                'px-6 py-3 rounded-xl text-2xl font-black tracking-wide',
                booking ? 'bg-rose-500/30 text-rose-300' : 'bg-emerald-500/30 text-emerald-300',
              )}>
                {booking ? 'OCCUPIED' : 'FREE'}
              </div>
            </div>
          </div>
        )
      })()}

      <div className="flex-1 px-10 pt-6 pb-10 space-y-3">
        {slots.length === 0 ? (
          <p className="text-gray-600 text-2xl text-center mt-16">No bookings scheduled today.</p>
        ) : (
          slots.map(slot => {
            const status    = slotStatus(slot)
            const booking   = bookingMap.get(bookingKey(slot, todayStr, room.id))
            const isCurrent = status === 'current'
            const isPast    = status === 'past'
            if (isCurrent) return null

            return (
              <div
                key={`${slot.startTime}_${slot.endTime}`}
                className={cn(
                  'flex items-center gap-6 rounded-xl px-6 py-4 border',
                  isPast
                    ? 'bg-zinc-900/3 border-white/5 opacity-40'
                    : booking
                      ? 'bg-rose-900/20 border-rose-800/40'
                      : 'bg-zinc-900/5 border-white/10',
                )}
              >
                <div className="w-32 flex-shrink-0">
                  <p className={cn('text-2xl font-bold tabular-nums', isPast ? 'text-gray-600' : 'text-gray-200')}>
                    {slot.startTime}
                  </p>
                  <p className="text-gray-600 text-sm">{slot.endTime}</p>
                </div>
                <div className="flex-1">
                  {booking
                    ? <p className={cn('text-2xl font-bold', isPast ? 'text-gray-600' : 'text-rose-300')}>{booking.studentName}</p>
                    : <p className={cn('text-2xl font-semibold', isPast ? 'text-gray-600' : 'text-gray-400')}>Available</p>
                  }
                </div>
                {!isPast && (
                  <div className={cn(
                    'px-4 py-1.5 rounded-lg text-sm font-bold tracking-wide',
                    booking ? 'bg-rose-500/20 text-rose-400' : 'bg-emerald-500/20 text-emerald-400',
                  )}>
                    {booking ? 'TAKEN' : 'FREE'}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

// ── All-rooms grid view ───────────────────────────────────────────────────────

function AllRoomsDisplay({
  rooms, slots, bookingMap, displayDate, now, onPrevWeek, onNextWeek, onSelectDay, onSelectRoom,
}: {
  rooms: RoomDoc[]
  slots: TimeSlot[]
  bookingMap: Map<string, RoomBookingDoc>
  displayDate: Date
  now: Date
  onPrevWeek: () => void
  onNextWeek: () => void
  onSelectDay: (d: Date) => void
  onSelectRoom: (room: RoomDoc) => void
}) {
  const isToday      = isSameDay(displayDate, now)
  const displayStr   = format(displayDate, 'yyyy-MM-dd')
  const displayDayNum = displayDate.getDay()
  const gridCols     = `80px repeat(${rooms.length}, 1fr)`

  const weekDays = useMemo(() => {
    const mon = startOfWeek(displayDate, { weekStartsOn: 1 })
    return Array.from({ length: 5 }, (_, i) => addDays(mon, i))
  }, [displayDate])

  // Current-time progress line
  const timeLineTop = useMemo(() => {
    if (!isToday || slots.length === 0) return null
    const idx = slots.findIndex(s => slotStatus(s, true) === 'current')
    if (idx < 0) return null
    const slot    = slots[idx]
    const nowMins = now.getHours() * 60 + now.getMinutes()
    const start   = parseMinutes(slot.startTime)
    const end     = parseMinutes(slot.endTime)
    const progress = Math.max(0, Math.min(1, (nowMins - start) / (end - start)))
    return `${((idx + progress) / slots.length) * 100}%`
  }, [isToday, slots, now])

  return (
    <div
      style={{ height: '100dvh', overflow: 'hidden', display: 'flex', flexDirection: 'column', background: '#030712', color: '#fff', paddingTop: 'env(safe-area-inset-top, 0px)' }}
    >
      {/* ── Header: 64px ── */}
      <div style={{ height: 56, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px' }}>
        <div>
          <h1 style={{ fontSize: 'clamp(16px, 2vw, 24px)', fontWeight: 900, letterSpacing: '0.06em', lineHeight: 1, margin: 0, color: '#fff' }}>
            ROOM BOOKINGS
          </h1>
          <p style={{ fontSize: 13, marginTop: 4, color: '#71717a', display: 'flex', alignItems: 'center', gap: 6 }}>
            {format(displayDate, 'EEEE, d MMMM yyyy')}
            {isToday && <span style={{ color: '#f87171', fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Today</span>}
          </p>
        </div>
        <p className="font-mono tabular-nums" style={{ fontSize: 'clamp(20px, 2.5vw, 30px)', fontWeight: 700, color: '#fff', lineHeight: 1 }}>
          {format(now, 'HH:mm')}
        </p>
      </div>

      {/* ── Day nav: 44px ── */}
      <div style={{ height: 44, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5, padding: '0 20px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <button onClick={onPrevWeek} className="bg-zinc-800 hover:bg-zinc-700 text-gray-300 rounded-lg font-medium transition-colors" style={{ padding: '5px 10px', fontSize: 11 }}>← Prev</button>
        {weekDays.map(d => {
          const active = isSameDay(d, displayDate)
          const isNow  = isSameDay(d, now)
          return (
            <button
              key={d.toISOString()}
              onClick={() => onSelectDay(d)}
              style={{ padding: '5px 8px', fontSize: 11, lineHeight: 1.2, minWidth: 44 }}
              className={cn(
                'rounded-lg font-medium transition-colors text-center',
                active ? 'bg-brand-600 text-white' : isNow ? 'bg-zinc-700 text-brand-400 border border-brand-500/40' : 'bg-zinc-800 hover:bg-zinc-700 text-gray-400',
              )}
            >
              <span className="block" style={{ fontSize: 10 }}>{format(d, 'EEE')}</span>
              <span className="block" style={{ fontSize: 14, fontWeight: 700 }}>{format(d, 'd')}</span>
            </button>
          )
        })}
        <button onClick={onNextWeek} className="bg-zinc-800 hover:bg-zinc-700 text-gray-300 rounded-lg font-medium transition-colors" style={{ padding: '5px 10px', fontSize: 11 }}>Next →</button>
        {!isToday && (
          <button onClick={() => onSelectDay(now)} className="ml-auto bg-brand-900/40 border border-brand-600/40 text-brand-400 hover:bg-brand-900/60 rounded-lg font-medium transition-colors" style={{ padding: '5px 10px', fontSize: 11 }}>Today</button>
        )}
      </div>

      {/* ── Column headers: 36px ── */}
      <div style={{ height: 36, flexShrink: 0, display: 'grid', gridTemplateColumns: gridCols, padding: '0 20px', borderBottom: '1px solid rgba(255,255,255,0.1)', alignItems: 'flex-end', paddingBottom: 5 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#52525b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Time</div>
        {rooms.map(r => (
          <div key={r.id} style={{ display: 'flex', justifyContent: 'center', padding: '0 2px' }}>
            <button
              onClick={() => onSelectRoom(r)}
              className="hover:text-white hover:underline transition-colors"
              style={{ fontSize: 'clamp(10px, 1vw, 13px)', fontWeight: 700, color: '#d4d4d8', textAlign: 'center', width: '100%' }}
            >
              {r.name}
            </button>
          </div>
        ))}
      </div>

      {/* ── Slot rows: flex: 1 each ── */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '0 20px' }}>
        {slots.length === 0 ? (
          <p style={{ color: '#3f3f46', fontSize: 20, textAlign: 'center', marginTop: 40 }}>No bookings scheduled for this day.</p>
        ) : slots.map(slot => {
          const status    = slotStatus(slot, isToday)
          const isCurrent = status === 'current'
          const isPast    = status === 'past'
          return (
            <div
              key={`${slot.startTime}_${slot.endTime}`}
              style={{
                flex: 1,
                minHeight: 0,
                display: 'grid',
                gridTemplateColumns: gridCols,
                borderTop: '1px solid rgba(255,255,255,0.05)',
                opacity: isPast ? 0.35 : 1,
              }}
            >
              {/* Time cell — orange left border on current row instead of a horizontal line */}
              <div style={{
                display: 'flex', flexDirection: 'column', justifyContent: 'center', paddingRight: 8,
                borderLeft: isCurrent ? '3px solid #f97316' : '3px solid transparent',
                paddingLeft: 6,
              }}>
                <p className="tabular-nums" style={{ fontSize: 'clamp(13px, 1.6vw, 18px)', fontWeight: 700, color: isCurrent ? '#fb923c' : '#d4d4d8', lineHeight: 1, margin: 0 }}>
                  {slot.startTime}
                </p>
                <p style={{ fontSize: 'clamp(10px, 1.1vw, 12px)', color: '#52525b', opacity: 0.5, marginTop: 2 }}>{slot.endTime}</p>
                {isCurrent && (
                  <span style={{ display: 'inline-block', marginTop: 3, fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', background: 'rgba(249,115,22,0.15)', color: '#f97316', padding: '2px 6px', borderRadius: 999, textTransform: 'uppercase' }}>NOW</span>
                )}
              </div>
              {/* Room cells */}
              {rooms.map(room => {
                const booking   = bookingMap.get(bookingKey(slot, displayStr, room.id))
                const available = roomHasSlot(room, slot, displayStr, displayDayNum)
                const bg = booking
                  ? isCurrent ? 'rgba(136,19,55,0.5)'  : isPast ? 'rgba(136,19,55,0.1)'  : 'rgba(136,19,55,0.2)'
                  : !available ? 'rgba(0,0,0,0)'
                  : isPast    ? 'rgba(39,39,42,0.2)'
                  : isCurrent ? 'rgba(6,78,59,0.5)'    : 'rgba(6,78,59,0.3)'
                return (
                  <div
                    key={room.id}
                    style={{
                      borderLeft: '1px solid rgba(255,255,255,0.05)',
                      background: bg,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {booking ? (
                      <span style={{
                        fontSize: 'clamp(10px, 1.1vw, 13px)',
                        fontWeight: 700,
                        color: isCurrent ? '#fda4af' : isPast ? '#9f1239' : '#fecdd3',
                        textAlign: 'center',
                        padding: '0 4px',
                      }}>
                        {booking.studentName}
                      </span>
                    ) : !available ? (
                      <span style={{
                        fontSize: 'clamp(9px, 1vw, 11px)',
                        fontWeight: 500,
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                        color: 'rgba(255,255,255,0.12)',
                      }}>
                        Unavailable
                      </span>
                    ) : (
                      <span style={{
                        fontSize: 'clamp(9px, 1vw, 12px)',
                        fontWeight: 600,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        color: isCurrent ? 'rgba(52,211,153,0.9)' : isPast ? 'rgba(255,255,255,0.1)' : 'rgba(52,211,153,0.35)',
                      }}>
                        Free
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>

      {/* ── Footer: 32px ── */}
      <div style={{ height: 32, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#3f3f46', textTransform: 'uppercase', letterSpacing: '0.12em', paddingBottom: 6 }}>
        Updates in real time · CineForge
      </div>
    </div>
  )
}

// ── Root component ────────────────────────────────────────────────────────────

export default function RoomDisplay() {
  const [searchParams, setSearchParams] = useSearchParams()
  const roomParam = searchParams.get('room')

  const [now,        setNow]        = useState(new Date())
  const [dayOffset,  setDayOffset]  = useState(0)   // days from today


  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(id)
  }, [])

  const displayDate = useMemo(() => addDays(now, dayOffset), [now, dayOffset])
  const displayStr  = format(displayDate, 'yyyy-MM-dd')
  const displayDayNum = displayDate.getDay()

  const { data: allRooms, loading: roomsLoading, error: roomsError } = useCollection<RoomDoc>('rooms', [where('isActive', '==', true)])
  const { data: bookings, error: bookingsError } = useCollection<RoomBookingDoc>(
    'room_bookings',
    [where('date', '==', displayStr)],
    true,
    displayStr,
  )

  const sortedRooms = useMemo(
    () => [...allRooms].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [allRooms],
  )

  const slots = useMemo(
    () => deriveSlots(sortedRooms, displayStr, displayDayNum),
    [sortedRooms, displayStr, displayDayNum],
  )

  const bookingMap = useMemo(() => {
    const m = new Map<string, RoomBookingDoc>()
    for (const b of bookings) {
      if (b.startTime && b.endTime) {
        m.set(bookingKey({ startTime: b.startTime, endTime: b.endTime }, b.date, b.roomId), b)
      }
    }
    return m
  }, [bookings])

  if (roomsError) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center p-8">
        <div className="text-center space-y-2">
          <p className="text-rose-400 text-xl font-bold">Firestore error</p>
          <p className="text-gray-400 text-sm font-mono">{roomsError.message}</p>
        </div>
      </div>
    )
  }

  if (roomsLoading) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        <p className="text-gray-400 text-lg">Loading…</p>
      </div>
    )
  }

  const singleRoom = roomParam
    ? sortedRooms.find(r =>
        r.name.split(' ').pop()?.toUpperCase() === roomParam.toUpperCase() ||
        r.name.toUpperCase() === roomParam.toUpperCase()
      )
    : null

  if (singleRoom) {
    return <SingleRoomDisplay room={singleRoom} slots={slots} bookingMap={bookingMap} todayStr={displayStr} now={now} onBack={() => setSearchParams({})} />
  }

  return (
    <AllRoomsDisplay
      rooms={sortedRooms}
      slots={slots}
      bookingMap={bookingMap}
      displayDate={displayDate}
      now={now}
      onPrevWeek={() => setDayOffset(o => o - 7)}
      onNextWeek={() => setDayOffset(o => o + 7)}
      onSelectDay={d => {
        // Normalize both to midnight to avoid rounding issues with time-of-day
        const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
        const dMidnight     = new Date(d.getFullYear(),   d.getMonth(),   d.getDate()).getTime()
        setDayOffset(Math.round((dMidnight - todayMidnight) / 86400000))
      }}
      onSelectRoom={r => setSearchParams({ room: r.name })}
    />
  )
}
