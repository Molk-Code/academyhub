import { useState, useMemo } from 'react'
import { addDays, format, startOfWeek, parseISO, isToday, getDay } from 'date-fns'
import { deleteDoc, doc, collection, addDoc, updateDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { Plus, Pencil, Trash2, ChevronLeft, ChevronRight, Check, X,
  ToggleLeft, ToggleRight, Building2, ChevronDown, ChevronUp, Settings2, CalendarDays, Copy, ExternalLink } from 'lucide-react'
import { nanoid } from 'nanoid'
import { db } from '@/lib/firebase'
import { useCollection, useDocument, where } from '@/hooks/useFirestore'
import type { RoomBookingDoc, RoomDoc, RoomAvailabilityWindow, BookingSettingsDoc, SemesterSettingsDoc } from '@/types'
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

// ── Constants ─────────────────────────────────────────────────────────────────

const DAY_LABELS: Record<number, string> = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 0: 'Sun' }
const DAYS_ORDER = [1, 2, 3, 4, 5, 6, 0]

// ── Availability window helpers ───────────────────────────────────────────────

function addMinutes(time: string, mins: number): string {
  const [h, m] = time.split(':').map(Number)
  const total  = Math.min(h * 60 + m + mins, 23 * 60 + 59)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

function durationMinutes(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  return (eh * 60 + em) - (sh * 60 + sm)
}

function blankWindow(existing: RoomAvailabilityWindow[] = [], semester?: { startDate: string; endDate: string } | null): RoomAvailabilityWindow {
  const today       = new Date().toISOString().slice(0, 10)
  const nextYear    = `${new Date().getFullYear() + 1}-12-31`
  const last        = existing.length > 0 ? existing[existing.length - 1] : null
  const duration    = last ? durationMinutes(last.startTime, last.endTime) : 0
  const newStart    = last ? last.endTime : '08:00'
  const newEnd      = last && duration > 0 ? addMinutes(newStart, duration) : '17:00'
  const defaultFrom = semester?.startDate ?? today
  const defaultTo   = semester?.endDate ?? nextYear
  return {
    id:        nanoid(8),
    days:      last ? [...last.days] : [1,2,3,4,5],
    startTime: newStart,
    endTime:   newEnd,
    startDate: last ? last.startDate : defaultFrom,
    endDate:   last ? last.endDate : defaultTo,
  }
}

function WindowRow({ w, onChange, onRemove }: {
  w: RoomAvailabilityWindow
  onChange: (patch: Partial<RoomAvailabilityWindow>) => void
  onRemove: () => void
}) {
  return (
    <div className="border border-white/10 rounded-xl p-3 space-y-3 bg-zinc-900/50">
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1 flex-wrap">
          {DAYS_ORDER.map(d => (
            <button key={d} type="button"
              onClick={() => {
                const days = w.days.includes(d) ? w.days.filter(x => x !== d) : [...w.days, d]
                onChange({ days })
              }}
              className={cn(
                'px-2 py-1 rounded-lg text-xs font-medium border transition-colors',
                w.days.includes(d) ? 'bg-brand-600 border-brand-600 text-white' : 'bg-zinc-900 border-white/10 text-zinc-500 hover:border-white/15',
              )}
            >{DAY_LABELS[d]}</button>
          ))}
        </div>
        <button type="button" onClick={onRemove} className="p-1.5 text-zinc-300 hover:text-rose-500 transition-colors flex-shrink-0">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-zinc-500 font-medium block mb-1">From time</label>
          <input type="time" value={w.startTime} onChange={e => onChange({ startTime: e.target.value })} className="input text-sm py-1.5" />
        </div>
        <div>
          <label className="text-xs text-zinc-500 font-medium block mb-1">Until time</label>
          <input type="time" value={w.endTime} onChange={e => onChange({ endTime: e.target.value })} className="input text-sm py-1.5" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-zinc-500 font-medium block mb-1">Period start</label>
          <input type="date" value={w.startDate} onChange={e => onChange({ startDate: e.target.value })} className="input text-sm py-1.5" />
        </div>
        <div>
          <label className="text-xs text-zinc-500 font-medium block mb-1">Period end</label>
          <input type="date" value={w.endDate} onChange={e => onChange({ endDate: e.target.value })} className="input text-sm py-1.5" />
        </div>
      </div>
    </div>
  )
}

// ── Room modal ────────────────────────────────────────────────────────────────

interface RoomForm { name: string; description: string; availability: RoomAvailabilityWindow[] }

function RoomModal({ modal, rooms, semester, onClose }: {
  modal: 'add' | { room: RoomDoc }
  rooms: RoomDoc[]
  semester: { startDate: string; endDate: string } | null
  onClose: () => void
}) {
  const isAdd = modal === 'add'
  const [form, setForm] = useState<RoomForm>(() => isAdd
    ? { name: '', description: '', availability: [] }
    : { name: (modal as any).room.name, description: (modal as any).room.description, availability: (modal as any).room.availability ?? [] }
  )
  const [saving, setSaving]   = useState(false)
  const [error,  setError]    = useState('')
  const [open,   setOpen]     = useState(!isAdd && (form.availability.length > 0))

  function updateWindow(id: string, patch: Partial<RoomAvailabilityWindow>) {
    setForm(f => ({ ...f, availability: f.availability.map(w => w.id === id ? { ...w, ...patch } : w) }))
  }

  async function save() {
    if (!form.name.trim()) return
    setSaving(true); setError('')
    try {
      const payload = { name: form.name.trim(), description: form.description.trim(), availability: form.availability }
      if (isAdd) {
        await addDoc(collection(db, 'rooms'), { ...payload, isActive: true, order: rooms.length, createdAt: serverTimestamp() })
      } else {
        await updateDoc(doc(db, 'rooms', (modal as any).room.id), payload)
      }
      onClose()
    } catch (e: any) {
      setError(`${e?.code ?? 'error'}: ${e?.message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-zinc-900 rounded-2xl shadow-xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold text-zinc-100">{isAdd ? 'Add room' : 'Edit room'}</h2>
        <div className="space-y-3">
          <div>
            <label className="label">Room name</label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Room A" className="input" autoFocus />
          </div>
          <div>
            <label className="label">Description <span className="text-zinc-400 font-normal">(optional)</span></label>
            <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="e.g. Editing room with 2 workstations" className="input" />
          </div>
        </div>

        <div className="border border-white/10 rounded-xl overflow-hidden">
          <button type="button" onClick={() => setOpen(o => !o)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-zinc-300 hover:bg-white/5 transition-colors">
            <span>Availability windows{form.availability.length > 0 && <span className="ml-2 text-xs font-normal text-zinc-400">{form.availability.length} window{form.availability.length !== 1 ? 's' : ''}</span>}</span>
            {open ? <ChevronUp className="w-4 h-4 text-zinc-400" /> : <ChevronDown className="w-4 h-4 text-zinc-400" />}
          </button>
          {open && (
            <div className="px-4 pb-4 space-y-3 border-t border-white/8">
              <p className="text-xs text-zinc-400 pt-3">Define when this room can be booked. Leave empty for always available.</p>
              {form.availability.map(w => (
                <WindowRow key={w.id} w={w} onChange={patch => updateWindow(w.id, patch)}
                  onRemove={() => setForm(f => ({ ...f, availability: f.availability.filter(x => x.id !== w.id) }))} />
              ))}
              <button type="button"
                onClick={() => { setForm(f => ({ ...f, availability: [...f.availability, blankWindow(f.availability, semester)] })); setOpen(true) }}
                className="flex items-center gap-1.5 text-sm text-brand-600 hover:text-brand-800 transition-colors">
                <Plus className="w-4 h-4" /> Add window
              </button>
            </div>
          )}
        </div>

        {error && <p className="text-xs text-rose-400 bg-rose-950/40 rounded-lg px-3 py-2">{error}</p>}
        <div className="flex gap-2 pt-2">
          <button onClick={save} disabled={!form.name.trim() || saving} className="btn-primary py-2 px-5 flex items-center gap-2">
            <Check className="w-4 h-4" />{saving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={onClose} className="btn-secondary py-2 px-5 flex items-center gap-2">
            <X className="w-4 h-4" />Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function BookingHub() {
  // ── Bookings state ────────────────────────────────────────────────────────
  const [weekOffset, setWeekOffset]         = useState(0)
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

  const { data: rooms,    loading: roomsLoading }    = useCollection<RoomDoc>('rooms')
  const { data: bookings, loading: bookingsLoading } = useCollection<RoomBookingDoc>(
    'room_bookings',
    [where('date', '>=', weekStartStr), where('date', '<=', weekEndStr)],
    true, `${weekStartStr}_${weekEndStr}`,
  )

  const allSortedRooms = useMemo(
    () => [...rooms].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [rooms],
  )

  const sortedRooms = useMemo(
    () => allSortedRooms.filter(r => !filterRoom || r.id === filterRoom),
    [allSortedRooms, filterRoom],
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

  async function cancelBooking(booking: RoomBookingDoc) {
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

  // ── Rooms state ───────────────────────────────────────────────────────────
  const [roomModal,   setRoomModal]   = useState<'add' | { room: RoomDoc } | null>(null)
  const [deleteRoomId, setDeleteRoomId] = useState<string | null>(null)
  const [deletingRoom, setDeletingRoom] = useState(false)

  const [copiedUrl, setCopiedUrl] = useState(false)

  async function copyRoomDisplayUrl() {
    await navigator.clipboard.writeText(`${window.location.origin}/room-display`)
    setCopiedUrl(true)
    setTimeout(() => setCopiedUrl(false), 2000)
  }

  // ── Settings state ────────────────────────────────────────────────────────
  const { data: bookingSettings } = useDocument<BookingSettingsDoc>('settings', 'booking')
  const { data: semesterSettings } = useDocument<SemesterSettingsDoc>('settings', 'semester')
  const semester = semesterSettings?.startDate && semesterSettings?.endDate
    ? { startDate: semesterSettings.startDate, endDate: semesterSettings.endDate }
    : null
  const [maxWeeklyInput, setMaxWeeklyInput] = useState<string>('')
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [settingsEditing, setSettingsEditing] = useState(false)
  const currentMax = bookingSettings?.maxBookingsPerWeek ?? null

  function startEditSettings() {
    setMaxWeeklyInput(currentMax !== null ? String(currentMax) : '')
    setSettingsEditing(true)
  }

  async function saveSettings() {
    setSettingsSaving(true)
    try {
      const val = maxWeeklyInput.trim() === '' ? null : Math.max(1, parseInt(maxWeeklyInput, 10) || 1)
      await setDoc(doc(db, 'settings', 'booking'), { maxBookingsPerWeek: val }, { merge: true })
      setSettingsEditing(false)
    } finally {
      setSettingsSaving(false)
    }
  }

  async function toggleActive(room: RoomDoc) {
    await updateDoc(doc(db, 'rooms', room.id), { isActive: !room.isActive })
  }

  async function confirmDeleteRoom() {
    if (!deleteRoomId) return
    setDeletingRoom(true)
    try { await deleteDoc(doc(db, 'rooms', deleteRoomId)); setDeleteRoomId(null) }
    finally { setDeletingRoom(false) }
  }

  if (roomsLoading || bookingsLoading) return <LoadingSpinner />

  return (
    <div className="space-y-10">
      <div>
        <h1 className="page-title">Room Bookings</h1>
        <p className="text-zinc-400 text-sm mt-1">Manage bookings and configure which rooms are available.</p>
      </div>

      {/* Room display URL card */}
      <div
        className="bg-zinc-900 rounded-xl border border-white/8 overflow-hidden"
        style={{ borderLeft: '4px solid #10b981' }}
      >
        <div className="px-5 py-4 flex items-center gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-zinc-500 uppercase tracking-widest font-semibold mb-1">Room Display URL</p>
            <p className="font-mono text-sm text-zinc-200 truncate">{`${window.location.origin}/room-display`}</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <a
              href="/room-display"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 btn-secondary py-1.5 px-3 text-sm"
            >
              Open <ExternalLink className="w-3.5 h-3.5" />
            </a>
            <button
              onClick={copyRoomDisplayUrl}
              className="flex items-center gap-1.5 btn-secondary py-1.5 px-3 text-sm"
            >
              {copiedUrl ? 'Copied!' : <><Copy className="w-3.5 h-3.5" /> Copy URL</>}
            </button>
          </div>
        </div>
      </div>

      {/* ── Bookings section ─────────────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="text-base font-semibold text-zinc-200">Bookings</h2>

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
                      ? 'bg-rose-700 text-white font-semibold shadow-sm'
                      : today
                        ? 'bg-rose-950/40 text-rose-300 border border-rose-200 font-medium'
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

          {weekOffset !== 0 && (
            <button onClick={goToday} className="flex items-center gap-1.5 text-sm text-rose-600 hover:text-rose-800 px-3 py-2 rounded-lg hover:bg-rose-50 transition-colors">
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

        {/* Calendar grid */}
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
                              onClick={() => cancelBooking(booking)}
                              title="Click to cancel this booking"
                              className="w-full rounded-xl px-2 py-3.5 text-xs font-medium transition-all border bg-rose-500 border-rose-600 text-white hover:bg-rose-600 active:bg-rose-700"
                            >
                              <div className="font-semibold truncate">{booking.studentName.split(' ')[0]}</div>
                              <div className="opacity-75 text-[10px] mt-0.5 truncate">{booking.studentName.split(' ').slice(1).join(' ')}</div>
                            </button>
                          ) : (
                            <div className="w-full rounded-xl px-2 py-3.5 text-xs font-medium bg-emerald-500 border border-emerald-600 text-white">
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
            <span className="w-3 h-3 rounded bg-emerald-500 flex-shrink-0" /> Free
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-rose-500 flex-shrink-0" /> Booked (click to cancel)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-zinc-700 flex-shrink-0" /> Not available
          </span>
        </div>
      </section>

      {/* ── Rooms section ────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-zinc-200">Rooms available for booking</h2>
          <button onClick={() => setRoomModal('add')} className="btn-primary py-2 px-4 text-sm flex items-center gap-2">
            <Plus className="w-4 h-4" /> Add room
          </button>
        </div>

        <div className="bg-zinc-900 rounded-2xl border border-white/10 overflow-hidden">
          {allSortedRooms.length === 0 ? (
            <div className="py-12 text-center">
              <Building2 className="w-10 h-10 text-slate-200 mx-auto mb-3" />
              <p className="text-zinc-400 text-sm">No rooms yet. Add one to enable booking.</p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left text-xs font-medium text-zinc-500 px-5 py-3">Room</th>
                  <th className="text-left text-xs font-medium text-zinc-500 px-4 py-3">Description</th>
                  <th className="text-left text-xs font-medium text-zinc-500 px-4 py-3">Availability</th>
                  <th className="text-center text-xs font-medium text-zinc-500 px-4 py-3">Status</th>
                  <th className="w-20 px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {allSortedRooms.map(room => {
                  const windows = room.availability ?? []
                  return (
                    <tr key={room.id} className="hover:bg-white/5 transition-colors">
                      <td className="px-5 py-3 text-sm font-semibold text-zinc-100">{room.name}</td>
                      <td className="px-4 py-3 text-sm text-zinc-500">{room.description || '—'}</td>
                      <td className="px-4 py-3">
                        {windows.length === 0 ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-zinc-400 bg-zinc-900/50 border border-white/10 rounded-full px-2.5 py-1">
                            Always available
                          </span>
                        ) : (
                          <div className="space-y-2">
                            {windows.map(w => {
                              const sortedDays = [...w.days].sort((a, b) => (a === 0 ? 7 : a) - (b === 0 ? 7 : b))
                              return (
                                <div key={w.id} className="space-y-1.5">
                                  <div className="flex items-center gap-1 flex-wrap">
                                    {DAYS_ORDER.filter(d => sortedDays.includes(d)).map(d => (
                                      <span key={d} className="px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-brand-100 text-brand-700">
                                        {DAY_LABELS[d]}
                                      </span>
                                    ))}
                                    <span className="text-xs font-medium text-zinc-300 ml-1">
                                      {w.startTime}–{w.endTime}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-1 text-[11px] text-zinc-400">
                                    <span className="bg-zinc-800 rounded px-1.5 py-0.5">{format(parseISO(w.startDate), 'd MMM yyyy')}</span>
                                    <span>→</span>
                                    <span className="bg-zinc-800 rounded px-1.5 py-0.5">{format(parseISO(w.endDate), 'd MMM yyyy')}</span>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button onClick={() => toggleActive(room)}
                          className={cn(
                            'inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full transition-colors',
                            room.isActive ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' : 'bg-zinc-800 text-zinc-500 hover:bg-zinc-700',
                          )}>
                          {room.isActive ? <><ToggleRight className="w-3.5 h-3.5" />Active</> : <><ToggleLeft className="w-3.5 h-3.5" />Inactive</>}
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => setRoomModal({ room })} className="p-1.5 text-zinc-400 hover:text-zinc-300 rounded-lg hover:bg-zinc-800 transition-colors">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => setDeleteRoomId(room.id)} className="p-1.5 text-zinc-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition-colors">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* ── Settings section ─────────────────────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-zinc-200">Booking settings</h2>
        </div>
        <div className="bg-zinc-900 rounded-2xl border border-white/10 p-5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-brand-50 flex items-center justify-center flex-shrink-0">
                <Settings2 className="w-4.5 h-4.5 text-brand-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-zinc-200">Max bookings per student per week</p>
                <p className="text-xs text-zinc-400 mt-0.5">Limits how many room slots a student can book in a single calendar week.</p>
              </div>
            </div>
            {settingsEditing ? (
              <div className="flex items-center gap-2 flex-shrink-0">
                <input
                  type="number"
                  min={1}
                  placeholder="Unlimited"
                  value={maxWeeklyInput}
                  onChange={e => setMaxWeeklyInput(e.target.value)}
                  className="input w-28 text-sm py-1.5 text-center"
                />
                <button onClick={saveSettings} disabled={settingsSaving}
                  className="btn-primary py-1.5 px-3 text-sm flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5" />{settingsSaving ? 'Saving…' : 'Save'}
                </button>
                <button onClick={() => setSettingsEditing(false)} className="btn-secondary py-1.5 px-3 text-sm flex items-center gap-1.5">
                  <X className="w-3.5 h-3.5" />Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3 flex-shrink-0">
                <span className={cn(
                  'text-sm font-semibold px-3 py-1 rounded-full',
                  currentMax !== null ? 'bg-brand-50 text-brand-700' : 'bg-zinc-800 text-zinc-500',
                )}>
                  {currentMax !== null ? `${currentMax} / week` : 'Unlimited'}
                </span>
                <button onClick={startEditSettings}
                  className="p-1.5 text-zinc-400 hover:text-zinc-300 rounded-lg hover:bg-zinc-800 transition-colors">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

        </div>
      </section>

      {/* Room modal */}
      {roomModal && <RoomModal modal={roomModal} rooms={rooms} semester={semester} onClose={() => setRoomModal(null)} />}

      {/* Delete room confirm */}
      {deleteRoomId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-zinc-900 rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h2 className="text-lg font-semibold text-zinc-100">Delete room?</h2>
            <p className="text-sm text-zinc-500">Existing bookings will remain in Firestore.</p>
            <div className="flex gap-2 pt-2">
              <button onClick={confirmDeleteRoom} disabled={deletingRoom} className="btn-primary bg-rose-600 hover:bg-rose-700 py-2 px-5">
                {deletingRoom ? 'Deleting…' : 'Delete'}
              </button>
              <button onClick={() => setDeleteRoomId(null)} className="btn-secondary py-2 px-5">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
