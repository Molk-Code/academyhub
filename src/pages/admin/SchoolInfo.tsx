import { useState, useEffect } from 'react'
import { addDoc, updateDoc, deleteDoc, doc, setDoc, collection } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useCollection, useDocument, orderBy, where } from '@/hooks/useFirestore'
import type { LessonBlockDoc, ClassroomDoc, UserDoc, SemesterSettingsDoc } from '@/types'
import { Plus, Pencil, Trash2, Check, X, Clock, Sun, DoorOpen, Users, Star, CalendarRange, GraduationCap, Link2 } from 'lucide-react'
import Avatar from '@/components/common/Avatar'

const DAYS = [
  { label: 'Mon', value: 1 },
  { label: 'Tue', value: 2 },
  { label: 'Wed', value: 3 },
  { label: 'Thu', value: 4 },
  { label: 'Fri', value: 5 },
  { label: 'Sat', value: 6 },
  { label: 'Sun', value: 0 },
]
const DEFAULT_DAYS = [1, 2, 3, 4, 5]

interface BlockEditState {
  id: string | null
  name: string
  startTime: string
  endTime: string
  daysOfWeek: number[]
}
interface RoomEditState {
  id: string | null
  name: string
  notes: string
}

interface SchoolDayDoc      { id: string; startTime: string; endTime: string }
interface AttendancePointsDoc { id: string; pointsPerCheckIn: number; absencePenalty?: number }

const EMPTY_BLOCK: BlockEditState = { id: null, name: '', startTime: '', endTime: '', daysOfWeek: DEFAULT_DAYS }
const EMPTY_ROOM: RoomEditState   = { id: null, name: '', notes: '' }

function duration(start: string, end: string) {
  if (!start || !end) return ''
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  const mins = (eh * 60 + em) - (sh * 60 + sm)
  if (mins <= 0) return ''
  const h = Math.floor(mins / 60), m = mins % 60
  return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`
}
function dayLabels(daysOfWeek: number[] | undefined) {
  if (!daysOfWeek || daysOfWeek.length === 0 || daysOfWeek.length === 7) return 'Every day'
  const sorted = [...daysOfWeek].sort((a, b) => (a === 0 ? 7 : a) - (b === 0 ? 7 : b))
  return sorted.map(d => DAYS.find(x => x.value === d)?.label ?? '').join(', ')
}

export default function SchoolInfo() {
  const { data: blocks,    loading } = useCollection<LessonBlockDoc>('lessonBlocks', [orderBy('order', 'asc')])
  const { data: classrooms }         = useCollection<ClassroomDoc>('classrooms', [orderBy('order', 'asc')])
  const { data: schoolDayDoc }       = useDocument<SchoolDayDoc>('settings', 'schoolDay')
  const { data: attendanceDoc }      = useDocument<AttendancePointsDoc>('settings', 'attendance')
  const { data: semesterDoc }        = useDocument<SemesterSettingsDoc>('settings', 'semester')
  const { data: schoolDoc }          = useDocument<{ id: string; name?: string }>('settings', 'school')
  const { data: allUsers }           = useCollection<UserDoc>('users')
  const teachers = allUsers.filter(u => (u.roles?.length ? u.roles : [u.role]).includes('teacher'))

  // School name
  const [schoolName,    setSchoolName]    = useState('')
  const [nameSaving,    setNameSaving]    = useState(false)
  const [nameSaved,     setNameSaved]     = useState(false)

  useEffect(() => {
    if (schoolDoc?.name !== undefined) setSchoolName(schoolDoc.name ?? '')
  }, [schoolDoc])

  async function saveSchoolName() {
    setNameSaving(true)
    await setDoc(doc(db, 'settings', 'school'), { name: schoolName.trim() }, { merge: true })
    setNameSaving(false)
    setNameSaved(true)
    setTimeout(() => setNameSaved(false), 2000)
  }

  // Classroom iPad URL copy state
  const [copiedRoomId, setCopiedRoomId] = useState<string | null>(null)

  // Semester dates
  const [semStart,   setSemStart]   = useState('')
  const [semEnd,     setSemEnd]     = useState('')
  const [sem2Start,  setSem2Start]  = useState('')
  const [sem2End,    setSem2End]    = useState('')
  const [semSaving,  setSemSaving]  = useState(false)
  const [semSaved,   setSemSaved]   = useState(false)

  useEffect(() => {
    if (semesterDoc) {
      setSemStart(semesterDoc.startDate ?? '')
      setSemEnd(semesterDoc.endDate ?? '')
      setSem2Start(semesterDoc.sem2Start ?? '')
      setSem2End(semesterDoc.sem2End ?? '')
    }
  }, [semesterDoc])

  async function saveSemester() {
    if (!semStart || !semEnd) return
    setSemSaving(true)
    await setDoc(doc(db, 'settings', 'semester'), {
      startDate: semStart,
      endDate:   semEnd,
      sem2Start: sem2Start || null,
      sem2End:   sem2End   || null,
    }, { merge: true })
    setSemSaving(false)
    setSemSaved(true)
    setTimeout(() => setSemSaved(false), 2000)
  }

  // School day hours
  const [sdStart,  setSdStart]  = useState('')
  const [sdEnd,    setSdEnd]    = useState('')
  const [sdSaving, setSdSaving] = useState(false)
  const [sdSaved,  setSdSaved]  = useState(false)

  useEffect(() => {
    if (schoolDayDoc) {
      setSdStart(schoolDayDoc.startTime ?? '')
      setSdEnd(schoolDayDoc.endTime ?? '')
    }
  }, [schoolDayDoc])

  // Attendance points
  const [apPoints,  setApPoints]  = useState<string>('0')
  const [apPenalty, setApPenalty] = useState<string>('-5')
  const [apSaving,  setApSaving]  = useState(false)
  const [apSaved,   setApSaved]   = useState(false)

  useEffect(() => {
    if (attendanceDoc) {
      setApPoints(String(attendanceDoc.pointsPerCheckIn ?? 0))
      setApPenalty(String(attendanceDoc.absencePenalty ?? -5))
    }
  }, [attendanceDoc])

  async function saveAttendancePoints() {
    const pts     = parseInt(apPoints, 10) || 0
    const penalty = parseInt(apPenalty, 10) || -5
    setApSaving(true)
    await setDoc(doc(db, 'settings', 'attendance'), { pointsPerCheckIn: pts, absencePenalty: penalty }, { merge: true })
    setApSaving(false)
    setApSaved(true)
    setTimeout(() => setApSaved(false), 2000)
  }

  async function saveSchoolDay() {
    if (!sdStart || !sdEnd) return
    setSdSaving(true)
    await setDoc(doc(db, 'settings', 'schoolDay'), { startTime: sdStart, endTime: sdEnd }, { merge: true })
    setSdSaving(false)
    setSdSaved(true)
    setTimeout(() => setSdSaved(false), 2000)
  }

  // Block form
  const [editBlock, setEditBlock] = useState<BlockEditState | null>(null)
  const [blockSaving, setBlockSaving] = useState(false)
  const [blockError,  setBlockError]  = useState('')

  function toggleDay(day: number) {
    setEditBlock(v => {
      if (!v) return v
      const has = v.daysOfWeek.includes(day)
      return { ...v, daysOfWeek: has ? v.daysOfWeek.filter(d => d !== day) : [...v.daysOfWeek, day] }
    })
  }

  async function saveBlock() {
    if (!editBlock) return
    if (!editBlock.name.trim())                  return setBlockError('Name required')
    if (!editBlock.startTime)                    return setBlockError('Start time required')
    if (!editBlock.endTime)                      return setBlockError('End time required')
    if (editBlock.startTime >= editBlock.endTime) return setBlockError('End must be after start')
    if (editBlock.daysOfWeek.length === 0)        return setBlockError('Select at least one day')
    setBlockSaving(true)
    try {
      const payload = { name: editBlock.name.trim(), startTime: editBlock.startTime, endTime: editBlock.endTime, daysOfWeek: editBlock.daysOfWeek }
      if (editBlock.id) {
        await updateDoc(doc(db, 'lessonBlocks', editBlock.id), payload)
      } else {
        await addDoc(collection(db, 'lessonBlocks'), { ...payload, order: blocks.length })
      }
      setEditBlock(null)
    } catch (e: any) {
      setBlockError(e.message ?? 'Failed to save')
    } finally {
      setBlockSaving(false)
    }
  }

  // Classroom form
  const [editRoom,   setEditRoom]   = useState<RoomEditState | null>(null)
  const [roomSaving, setRoomSaving] = useState(false)
  const [roomError,  setRoomError]  = useState('')

  async function saveRoom() {
    if (!editRoom) return
    if (!editRoom.name.trim()) return setRoomError('Name required')
    setRoomSaving(true)
    try {
      const payload = { name: editRoom.name.trim(), notes: editRoom.notes.trim() }
      if (editRoom.id) {
        await updateDoc(doc(db, 'classrooms', editRoom.id), payload)
      } else {
        await addDoc(collection(db, 'classrooms'), { ...payload, order: classrooms.length })
      }
      setEditRoom(null)
    } catch (e: any) {
      setRoomError(e.message ?? 'Failed to save')
    } finally {
      setRoomSaving(false)
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="page-title">School Info</h1>
        <p className="text-zinc-500 text-sm mt-1">Configure school hours, lesson blocks, and classrooms.</p>
      </div>

      {/* ── School Name ───────────────────────────────────────────────────── */}
      <div className="bg-zinc-900 rounded-2xl border border-white/10 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-1">
          <GraduationCap className="w-4 h-4 text-brand-500" />
          <p className="text-sm font-semibold text-zinc-200">School Name</p>
        </div>
        <p className="text-xs text-zinc-500 mb-4">Displayed below the CineForge logo in the student portal.</p>
        <div className="flex items-end gap-4 flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <label className="label text-xs">School name</label>
            <input
              className="input w-full"
              placeholder="e.g. Film Academy Stockholm"
              value={schoolName}
              onChange={e => { setSchoolName(e.target.value); setNameSaved(false) }}
            />
          </div>
          <button onClick={saveSchoolName} disabled={nameSaving} className="btn-primary py-2 px-4 text-sm flex items-center gap-2">
            <Check className="w-4 h-4" />
            {nameSaved ? 'Saved!' : nameSaving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* ── Semester Dates ────────────────────────────────────────────── */}
      <div className="bg-zinc-900 rounded-2xl border border-white/10 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-1">
          <CalendarRange className="w-4 h-4 text-brand-500" />
          <p className="text-sm font-semibold text-zinc-200">Semester Dates</p>
        </div>
        <p className="text-xs text-zinc-500 mb-4">Used for the annual plan wheel in the calendar, the student dashboard progress banner, and room availability defaults.</p>

        <div className="space-y-4">
          <div>
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2">Semester 1</p>
            <div className="flex items-end gap-4 flex-wrap">
              <div>
                <label className="label text-xs">Start date</label>
                <input type="date" className="input w-44" value={semStart} onChange={e => { setSemStart(e.target.value); setSemSaved(false) }} />
              </div>
              <div>
                <label className="label text-xs">End date</label>
                <input type="date" className="input w-44" value={semEnd} onChange={e => { setSemEnd(e.target.value); setSemSaved(false) }} />
              </div>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2">Semester 2 <span className="font-normal normal-case text-zinc-400">(optional)</span></p>
            <div className="flex items-end gap-4 flex-wrap">
              <div>
                <label className="label text-xs">Start date</label>
                <input type="date" className="input w-44" value={sem2Start} onChange={e => { setSem2Start(e.target.value); setSemSaved(false) }} />
              </div>
              <div>
                <label className="label text-xs">End date</label>
                <input type="date" className="input w-44" value={sem2End} onChange={e => { setSem2End(e.target.value); setSemSaved(false) }} />
              </div>
            </div>
          </div>

          <button onClick={saveSemester} disabled={semSaving || !semStart || !semEnd} className="btn-primary py-2 px-4 text-sm flex items-center gap-2">
            <Check className="w-4 h-4" />
            {semSaved ? 'Saved!' : semSaving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* ── School Day Hours ───────────────────────────────────────────── */}
      <div className="bg-zinc-900 rounded-2xl border border-white/10 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-1">
          <Sun className="w-4 h-4 text-amber-500" />
          <p className="text-sm font-semibold text-zinc-200">School Day Hours</p>
        </div>
        <p className="text-xs text-zinc-500 mb-4">Sets the visible time range and scroll anchor in the calendar.</p>
        <div className="flex items-end gap-4 flex-wrap">
          <div>
            <label className="label text-xs">Start of day</label>
            <input type="time" className="input w-36" value={sdStart} onChange={e => setSdStart(e.target.value)} />
          </div>
          <div>
            <label className="label text-xs">End of day</label>
            <input type="time" className="input w-36" value={sdEnd} onChange={e => setSdEnd(e.target.value)} />
          </div>
          {sdStart && sdEnd && <p className="text-xs text-zinc-400 pb-2.5">{duration(sdStart, sdEnd)}</p>}
          <button onClick={saveSchoolDay} disabled={sdSaving || !sdStart || !sdEnd} className="btn-primary py-2 px-4 text-sm pb-2.5">
            <Check className="w-4 h-4" />
            {sdSaved ? 'Saved!' : sdSaving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* ── Attendance Points ─────────────────────────────────────────── */}
      <div className="bg-zinc-900 rounded-2xl border border-white/10 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-1">
          <Star className="w-4 h-4 text-amber-500" />
          <p className="text-sm font-semibold text-zinc-200">Attendance Points</p>
        </div>
        <p className="text-xs text-zinc-500 mb-4">Points awarded or deducted for attendance events. Negative values are allowed and can push totals below zero.</p>
        <div className="flex items-end gap-4 flex-wrap">
          <div>
            <label className="label text-xs">Points per check-in</label>
            <input
              type="number"
              className="input w-36"
              value={apPoints}
              onChange={e => { setApPoints(e.target.value); setApSaved(false) }}
            />
          </div>
          <div>
            <label className="label text-xs">Absence penalty (teacher logs)</label>
            <input
              type="number"
              className="input w-36"
              value={apPenalty}
              onChange={e => { setApPenalty(e.target.value); setApSaved(false) }}
            />
          </div>
          <button
            onClick={saveAttendancePoints}
            disabled={apSaving}
            className="btn-primary py-2 px-4 text-sm"
          >
            <Check className="w-4 h-4" />
            {apSaved ? 'Saved!' : apSaving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* ── Lesson Blocks ─────────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-brand-500" />
            <p className="text-sm font-semibold text-zinc-200">Lesson Blocks</p>
          </div>
          <button onClick={() => { setEditBlock({ ...EMPTY_BLOCK }); setBlockError('') }} className="btn-primary py-1.5 text-sm">
            <Plus className="w-4 h-4" /> New Block
          </button>
        </div>

        {editBlock && (
          <div className="bg-zinc-900 rounded-2xl border border-white/10 shadow-sm p-5 space-y-4">
            <p className="text-sm font-semibold text-zinc-300">{editBlock.id ? 'Edit block' : 'New block'}</p>
            {blockError && <p className="text-xs text-rose-500">{blockError}</p>}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="label">Name</label>
                <input className="input" placeholder="e.g. Block 1" value={editBlock.name}
                  onChange={e => setEditBlock(v => v && ({ ...v, name: e.target.value }))} />
              </div>
              <div>
                <label className="label">Start</label>
                <input type="time" className="input" value={editBlock.startTime}
                  onChange={e => setEditBlock(v => v && ({ ...v, startTime: e.target.value }))} />
              </div>
              <div>
                <label className="label">End</label>
                <input type="time" className="input" value={editBlock.endTime}
                  onChange={e => setEditBlock(v => v && ({ ...v, endTime: e.target.value }))} />
              </div>
            </div>
            {duration(editBlock.startTime, editBlock.endTime) && (
              <p className="text-xs text-brand-600 font-medium">Duration: {duration(editBlock.startTime, editBlock.endTime)}</p>
            )}
            <div>
              <label className="label">Available on</label>
              <div className="flex gap-2 flex-wrap">
                {DAYS.map(day => {
                  const active = editBlock.daysOfWeek.includes(day.value)
                  return (
                    <button key={day.value} type="button" onClick={() => toggleDay(day.value)}
                      className={`w-12 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                        active ? 'bg-brand-600 border-brand-600 text-white' : 'bg-zinc-900 border-white/10 text-zinc-500 hover:border-brand-400'
                      }`}>
                      {day.label}
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={saveBlock} disabled={blockSaving} className="btn-primary py-1.5 px-4 text-sm">
                <Check className="w-4 h-4" /> {blockSaving ? 'Saving…' : 'Save'}
              </button>
              <button onClick={() => setEditBlock(null)} className="btn-secondary py-1.5 px-4 text-sm">
                <X className="w-4 h-4" /> Cancel
              </button>
            </div>
          </div>
        )}

        {blocks.length === 0 && !editBlock
          ? <p className="text-sm text-zinc-400 py-2">No lesson blocks yet.</p>
          : (
            <div className="space-y-2">
              {blocks.map(b => (
                <div key={b.id} className="bg-zinc-900 rounded-xl border border-white/10 p-4 flex items-center gap-4">
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-zinc-100">{b.name}</p>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      {b.startTime}–{b.endTime}
                      {duration(b.startTime, b.endTime) && ` · ${duration(b.startTime, b.endTime)}`}
                      {' · '}{dayLabels(b.daysOfWeek)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => { setEditBlock({ id: b.id, name: b.name, startTime: b.startTime, endTime: b.endTime, daysOfWeek: b.daysOfWeek ?? DEFAULT_DAYS }); setBlockError('') }}
                      className="p-2 text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800 rounded-lg transition-colors">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => { if (confirm('Delete this block?')) deleteDoc(doc(db, 'lessonBlocks', b.id)) }}
                      className="p-2 text-zinc-400 hover:text-rose-500 hover:bg-zinc-800 rounded-lg transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )
        }
      </div>

      {/* ── Classrooms ────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <DoorOpen className="w-4 h-4 text-brand-500" />
            <p className="text-sm font-semibold text-zinc-200">Classrooms</p>
          </div>
          <button onClick={() => { setEditRoom({ ...EMPTY_ROOM }); setRoomError('') }} className="btn-primary py-1.5 text-sm">
            <Plus className="w-4 h-4" /> Add Room
          </button>
        </div>

        {editRoom && (
          <div className="bg-zinc-900 rounded-2xl border border-white/10 shadow-sm p-5 space-y-4">
            <p className="text-sm font-semibold text-zinc-300">{editRoom.id ? 'Edit room' : 'New room'}</p>
            {roomError && <p className="text-xs text-rose-500">{roomError}</p>}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label">Room name</label>
                <input className="input" placeholder="e.g. Studio A" value={editRoom.name}
                  onChange={e => setEditRoom(v => v && ({ ...v, name: e.target.value }))} />
              </div>
              <div>
                <label className="label">Notes <span className="text-zinc-400 font-normal">(optional)</span></label>
                <input className="input" placeholder="e.g. Ground floor, projector available" value={editRoom.notes}
                  onChange={e => setEditRoom(v => v && ({ ...v, notes: e.target.value }))} />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={saveRoom} disabled={roomSaving} className="btn-primary py-1.5 px-4 text-sm">
                <Check className="w-4 h-4" /> {roomSaving ? 'Saving…' : 'Save'}
              </button>
              <button onClick={() => setEditRoom(null)} className="btn-secondary py-1.5 px-4 text-sm">
                <X className="w-4 h-4" /> Cancel
              </button>
            </div>
          </div>
        )}

        {classrooms.length === 0 && !editRoom
          ? <p className="text-sm text-zinc-400 py-2">No classrooms added yet.</p>
          : (
            <div className="space-y-2">
              {classrooms.map(room => (
                <div key={room.id} className="bg-zinc-900 rounded-xl border border-white/10 p-4 flex items-center gap-4">
                  <DoorOpen className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-zinc-100">{room.name}</p>
                    {room.notes && <p className="text-xs text-zinc-500 mt-0.5">{room.notes}</p>}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(`${window.location.origin}/room-display?room=${encodeURIComponent(room.name)}`)
                        setCopiedRoomId(room.id)
                        setTimeout(() => setCopiedRoomId(null), 2000)
                      }}
                      className="p-2 text-zinc-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors"
                      title="Copy iPad display URL"
                    >
                      {copiedRoomId === room.id ? <Check className="w-4 h-4 text-emerald-500" /> : <Link2 className="w-4 h-4" />}
                    </button>
                    <button onClick={() => { setEditRoom({ id: room.id, name: room.name, notes: room.notes ?? '' }); setRoomError('') }}
                      className="p-2 text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800 rounded-lg transition-colors">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => { if (confirm(`Delete "${room.name}"?`)) deleteDoc(doc(db, 'classrooms', room.id)) }}
                      className="p-2 text-zinc-400 hover:text-rose-500 hover:bg-zinc-800 rounded-lg transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )
        }
      </div>
      {/* ── Teachers ──────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-brand-500" />
          <p className="text-sm font-semibold text-zinc-200">Teachers</p>
        </div>
        <p className="text-xs text-zinc-500 -mt-1">Teachers are assigned to lessons in the lesson builder. Add new teachers via User Manager.</p>
        {teachers.length === 0
          ? <p className="text-sm text-zinc-400 py-2">No teachers found.</p>
          : (
            <div className="space-y-2">
              {[...teachers].sort((a, b) => a.displayName.localeCompare(b.displayName)).map(t => (
                <div key={t.uid} className="bg-zinc-900 rounded-xl border border-white/10 p-4 flex items-center gap-3">
                  <Avatar uid={t.uid} name={t.displayName} avatarUrl={t.avatarUrl} size="sm" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-zinc-100 truncate">{t.displayName}</p>
                    <p className="text-xs text-zinc-500 truncate">{t.email}</p>
                  </div>
                  {!t.isActive && <span className="text-xs text-rose-500 font-medium">Inactive</span>}
                </div>
              ))}
            </div>
          )
        }
      </div>
    </div>
  )
}
