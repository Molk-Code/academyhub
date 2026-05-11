import { useState, useEffect } from 'react'
import { addDoc, updateDoc, deleteDoc, doc, setDoc, collection } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useCollection, useDocument, orderBy } from '@/hooks/useFirestore'
import type { LessonBlockDoc } from '@/types'
import { Plus, Pencil, Trash2, Check, X, Clock, Sun } from 'lucide-react'
import LoadingSpinner from '@/components/common/LoadingSpinner'
import EmptyState     from '@/components/common/EmptyState'

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

interface EditState {
  id: string | null
  name: string
  startTime: string
  endTime: string
  daysOfWeek: number[]
}

interface SchoolDayDoc { id: string; startTime: string; endTime: string }

const EMPTY: EditState = { id: null, name: '', startTime: '', endTime: '', daysOfWeek: DEFAULT_DAYS }

function durationLabel(start: string, end: string) {
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

export default function LessonBlocks() {
  const { data: blocks, loading } = useCollection<LessonBlockDoc>('lessonBlocks', [orderBy('order', 'asc')])
  const { data: schoolDayDoc }    = useDocument<SchoolDayDoc>('settings', 'schoolDay')

  // School day hours form state
  const [sdStart,   setSdStart]   = useState('')
  const [sdEnd,     setSdEnd]     = useState('')
  const [sdSaving,  setSdSaving]  = useState(false)
  const [sdSaved,   setSdSaved]   = useState(false)

  // Sync form with fetched doc
  useEffect(() => {
    if (schoolDayDoc) {
      setSdStart(schoolDayDoc.startTime ?? '')
      setSdEnd(schoolDayDoc.endTime   ?? '')
    }
  }, [schoolDayDoc])

  async function saveSchoolDay() {
    if (!sdStart || !sdEnd) return
    setSdSaving(true)
    await setDoc(doc(db, 'settings', 'schoolDay'), { startTime: sdStart, endTime: sdEnd }, { merge: true })
    setSdSaving(false)
    setSdSaved(true)
    setTimeout(() => setSdSaved(false), 2000)
  }

  // Block form state
  const [editing, setEditing] = useState<EditState | null>(null)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')

  function startNew()         { setEditing({ ...EMPTY }); setError('') }
  function startEdit(b: LessonBlockDoc) {
    setEditing({ id: b.id, name: b.name, startTime: b.startTime, endTime: b.endTime, daysOfWeek: b.daysOfWeek ?? DEFAULT_DAYS })
    setError('')
  }
  function toggleDay(day: number) {
    setEditing(v => {
      if (!v) return v
      const has = v.daysOfWeek.includes(day)
      return { ...v, daysOfWeek: has ? v.daysOfWeek.filter(d => d !== day) : [...v.daysOfWeek, day] }
    })
  }
  function cancel() { setEditing(null); setError('') }

  async function save() {
    if (!editing) return
    if (!editing.name.trim())                return setError('Name is required')
    if (!editing.startTime)                   return setError('Start time is required')
    if (!editing.endTime)                     return setError('End time is required')
    if (editing.startTime >= editing.endTime) return setError('End must be after start')
    if (editing.daysOfWeek.length === 0)      return setError('Select at least one day')
    setSaving(true)
    try {
      const payload = { name: editing.name.trim(), startTime: editing.startTime, endTime: editing.endTime, daysOfWeek: editing.daysOfWeek }
      if (editing.id) {
        await updateDoc(doc(db, 'lessonBlocks', editing.id), payload)
      } else {
        await addDoc(collection(db, 'lessonBlocks'), { ...payload, order: blocks.length })
      }
      setEditing(null)
    } catch (e: any) {
      setError(e.message ?? 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this block?')) return
    await deleteDoc(doc(db, 'lessonBlocks', id))
  }

  if (loading) return <LoadingSpinner />

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="page-title">Lesson Blocks</h1>
          <p className="text-zinc-500 text-sm mt-1">
            Define reusable time blocks and set the school day hours used by the calendar.
          </p>
        </div>
        <button onClick={startNew} className="btn-primary py-2">
          <Plus className="w-4 h-4" /> New Block
        </button>
      </div>

      {/* ── School Day Hours ─────────────────────────────────────────────── */}
      <div className="bg-zinc-900 rounded-2xl border border-white/10 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-4">
          <Sun className="w-4 h-4 text-amber-500" />
          <p className="text-sm font-semibold text-zinc-300">School Day Hours</p>
        </div>
        <p className="text-xs text-zinc-500 mb-4">
          Sets the visible time range and scroll anchor in the calendar.
        </p>
        <div className="flex items-end gap-4 flex-wrap">
          <div>
            <label className="label text-xs">Start of school day</label>
            <input type="time" className="input w-36" value={sdStart} onChange={e => setSdStart(e.target.value)} />
          </div>
          <div>
            <label className="label text-xs">End of school day</label>
            <input type="time" className="input w-36" value={sdEnd} onChange={e => setSdEnd(e.target.value)} />
          </div>
          {sdStart && sdEnd && (
            <p className="text-xs text-zinc-400 pb-2.5">{durationLabel(sdStart, sdEnd)}</p>
          )}
          <button
            onClick={saveSchoolDay}
            disabled={sdSaving || !sdStart || !sdEnd}
            className="btn-primary py-2 px-4 text-sm pb-2.5"
          >
            <Check className="w-4 h-4" />
            {sdSaved ? 'Saved!' : sdSaving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* ── Block form ───────────────────────────────────────────────────── */}
      {editing && (
        <div className="bg-zinc-900 rounded-2xl border border-white/10 shadow-sm p-5 space-y-4">
          <p className="text-sm font-semibold text-zinc-300">{editing.id ? 'Edit block' : 'New block'}</p>
          {error && <p className="text-xs text-rose-500">{error}</p>}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="label">Name</label>
              <input className="input" placeholder="e.g. Block 1" value={editing.name}
                onChange={e => setEditing(v => v && ({ ...v, name: e.target.value }))} />
            </div>
            <div>
              <label className="label">Start time</label>
              <input type="time" className="input" value={editing.startTime}
                onChange={e => setEditing(v => v && ({ ...v, startTime: e.target.value }))} />
            </div>
            <div>
              <label className="label">End time</label>
              <input type="time" className="input" value={editing.endTime}
                onChange={e => setEditing(v => v && ({ ...v, endTime: e.target.value }))} />
            </div>
          </div>
          {durationLabel(editing.startTime, editing.endTime) && (
            <p className="text-xs text-brand-600 font-medium">Duration: {durationLabel(editing.startTime, editing.endTime)}</p>
          )}
          <div>
            <label className="label">Available on</label>
            <div className="flex gap-2 flex-wrap">
              {DAYS.map(day => {
                const active = editing.daysOfWeek.includes(day.value)
                return (
                  <button key={day.value} type="button" onClick={() => toggleDay(day.value)}
                    className={`w-12 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                      active ? 'bg-brand-600 border-brand-600 text-white' : 'bg-zinc-900 border-white/10 text-zinc-500 hover:border-brand-400 hover:text-brand-600'
                    }`}>
                    {day.label}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={save} disabled={saving} className="btn-primary py-1.5 px-4 text-sm">
              <Check className="w-4 h-4" /> {saving ? 'Saving…' : 'Save'}
            </button>
            <button onClick={cancel} className="btn-secondary py-1.5 px-4 text-sm">
              <X className="w-4 h-4" /> Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Block list ───────────────────────────────────────────────────── */}
      {blocks.length === 0 && !editing
        ? <EmptyState icon={Clock} title="No lesson blocks" description="Create blocks like 'Block 1: 08:30–09:50' for teachers to reuse." />
        : (
          <div className="space-y-2">
            {blocks.map(b => (
              <div key={b.id} className="bg-zinc-900 rounded-2xl border border-white/10 shadow-sm p-4 flex items-center gap-4">
                <div className="flex-1">
                  <p className="text-sm font-semibold text-zinc-100">{b.name}</p>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    {b.startTime} – {b.endTime}
                    {durationLabel(b.startTime, b.endTime) && ` · ${durationLabel(b.startTime, b.endTime)}`}
                    {' · '}{dayLabels(b.daysOfWeek)}
                  </p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => startEdit(b)} className="p-2 text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800 rounded-lg transition-colors">
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button onClick={() => handleDelete(b.id)} className="p-2 text-zinc-400 hover:text-rose-500 hover:bg-zinc-800 rounded-lg transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      }
    </div>
  )
}
