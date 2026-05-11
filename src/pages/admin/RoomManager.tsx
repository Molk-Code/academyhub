import { useState } from 'react'
import { collection, addDoc, updateDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore'
import { Plus, Pencil, Trash2, Check, X, ToggleLeft, ToggleRight, Building2, ChevronDown, ChevronUp } from 'lucide-react'
import { nanoid } from 'nanoid'
import { db } from '@/lib/firebase'
import { useCollection } from '@/hooks/useFirestore'
import type { RoomDoc, RoomAvailabilityWindow } from '@/types'
import { cn } from '@/lib/utils'
import LoadingSpinner from '@/components/common/LoadingSpinner'

const DAY_LABELS: Record<number, string> = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 0: 'Sun' }
const DAYS_ORDER = [1, 2, 3, 4, 5, 6, 0]

function blankWindow(): RoomAvailabilityWindow {
  const today = new Date().toISOString().slice(0, 10)
  const nextYear = `${new Date().getFullYear() + 1}-12-31`
  return {
    id:        nanoid(8),
    days:      [1, 2, 3, 4, 5],
    startTime: '08:00',
    endTime:   '17:00',
    startDate: today,
    endDate:   nextYear,
  }
}

interface RoomForm {
  name:         string
  description:  string
  availability: RoomAvailabilityWindow[]
}

const BLANK_FORM: RoomForm = { name: '', description: '', availability: [] }

// ── Availability window row ───────────────────────────────────────────────────

function WindowRow({
  w,
  onChange,
  onRemove,
}: {
  w: RoomAvailabilityWindow
  onChange: (patch: Partial<RoomAvailabilityWindow>) => void
  onRemove: () => void
}) {
  function toggleDay(d: number) {
    const next = w.days.includes(d) ? w.days.filter(x => x !== d) : [...w.days, d]
    onChange({ days: next })
  }

  return (
    <div className="border border-white/10 rounded-xl p-3 space-y-3 bg-zinc-900/50">
      {/* Days */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1 flex-wrap">
          {DAYS_ORDER.map(d => (
            <button
              key={d}
              type="button"
              onClick={() => toggleDay(d)}
              className={cn(
                'px-2 py-1 rounded-lg text-xs font-medium border transition-colors',
                w.days.includes(d)
                  ? 'bg-brand-600 border-brand-600 text-white'
                  : 'bg-zinc-900 border-white/10 text-zinc-500 hover:border-white/15',
              )}
            >
              {DAY_LABELS[d]}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="p-1.5 text-zinc-300 hover:text-rose-500 transition-colors flex-shrink-0"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Time range */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-zinc-500 font-medium block mb-1">From time</label>
          <input
            type="time"
            value={w.startTime}
            onChange={e => onChange({ startTime: e.target.value })}
            className="input text-sm py-1.5"
          />
        </div>
        <div>
          <label className="text-xs text-zinc-500 font-medium block mb-1">Until time</label>
          <input
            type="time"
            value={w.endTime}
            onChange={e => onChange({ endTime: e.target.value })}
            className="input text-sm py-1.5"
          />
        </div>
      </div>

      {/* Date range */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-zinc-500 font-medium block mb-1">Period start</label>
          <input
            type="date"
            value={w.startDate}
            onChange={e => onChange({ startDate: e.target.value })}
            className="input text-sm py-1.5"
          />
        </div>
        <div>
          <label className="text-xs text-zinc-500 font-medium block mb-1">Period end</label>
          <input
            type="date"
            value={w.endDate}
            onChange={e => onChange({ endDate: e.target.value })}
            className="input text-sm py-1.5"
          />
        </div>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function RoomManager() {
  const { data: rooms, loading } = useCollection<RoomDoc>('rooms')
  const sorted = [...rooms].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name))

  const [modal, setModal]       = useState<'add' | { room: RoomDoc } | null>(null)
  const [form, setForm]         = useState<RoomForm>(BLANK_FORM)
  const [saving, setSaving]     = useState(false)
  const [saveError, setSaveError] = useState('')
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [availOpen, setAvailOpen] = useState(false)

  function openAdd() {
    setForm(BLANK_FORM)
    setSaveError('')
    setAvailOpen(false)
    setModal('add')
  }

  function openEdit(room: RoomDoc) {
    setForm({
      name:         room.name,
      description:  room.description,
      availability: room.availability ?? [],
    })
    setSaveError('')
    setAvailOpen((room.availability ?? []).length > 0)
    setModal({ room })
  }

  function close() { setModal(null); setSaveError('') }

  function addWindow() {
    setForm(f => ({ ...f, availability: [...f.availability, blankWindow()] }))
    setAvailOpen(true)
  }

  function updateWindow(id: string, patch: Partial<RoomAvailabilityWindow>) {
    setForm(f => ({
      ...f,
      availability: f.availability.map(w => w.id === id ? { ...w, ...patch } : w),
    }))
  }

  function removeWindow(id: string) {
    setForm(f => ({ ...f, availability: f.availability.filter(w => w.id !== id) }))
  }

  async function save() {
    if (!form.name.trim()) return
    setSaving(true)
    setSaveError('')
    try {
      const payload = {
        name:         form.name.trim(),
        description:  form.description.trim(),
        availability: form.availability,
      }
      if (modal === 'add') {
        await addDoc(collection(db, 'rooms'), {
          ...payload,
          isActive: true,
          order:    rooms.length,
          createdAt: serverTimestamp(),
        })
      } else if (modal && typeof modal === 'object') {
        await updateDoc(doc(db, 'rooms', modal.room.id), payload)
      }
      close()
    } catch (e: any) {
      console.error('Room save error:', e?.code, e?.message, e)
      setSaveError(`${e?.code ?? 'unknown'}: ${e?.message ?? 'Save failed.'}`)
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(room: RoomDoc) {
    await updateDoc(doc(db, 'rooms', room.id), { isActive: !room.isActive })
  }

  async function confirmDelete() {
    if (!deleteId) return
    setSaving(true)
    try {
      await deleteDoc(doc(db, 'rooms', deleteId))
      setDeleteId(null)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <LoadingSpinner />

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="page-title">Rooms</h1>
          <p className="text-zinc-400 text-sm mt-1">{sorted.length} editing rooms configured.</p>
        </div>
        <button onClick={openAdd} className="btn-primary py-2 px-4 text-sm flex items-center gap-2">
          <Plus className="w-4 h-4" /> Add room
        </button>
      </div>

      <div className="bg-zinc-900 rounded-2xl border border-white/10 overflow-hidden">
        {sorted.length === 0 ? (
          <div className="py-16 text-center">
            <Building2 className="w-10 h-10 text-slate-200 mx-auto mb-3" />
            <p className="text-zinc-400 text-sm">No rooms yet. Add one to get started.</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10">
                <th className="text-left text-xs font-medium text-zinc-500 px-5 py-3">Room</th>
                <th className="text-left text-xs font-medium text-zinc-500 px-4 py-3">Description</th>
                <th className="text-left text-xs font-medium text-zinc-500 px-4 py-3">Availability</th>
                <th className="text-center text-xs font-medium text-zinc-500 px-4 py-3">Status</th>
                <th className="w-24 px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sorted.map(room => {
                const windows = room.availability ?? []
                return (
                  <tr key={room.id} className="hover:bg-white/5 transition-colors">
                    <td className="px-5 py-3">
                      <p className="text-sm font-semibold text-zinc-100">{room.name}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm text-zinc-500">{room.description || '—'}</p>
                    </td>
                    <td className="px-4 py-3">
                      {windows.length === 0 ? (
                        <span className="text-xs text-zinc-400">Always available</span>
                      ) : (
                        <div className="space-y-0.5">
                          {windows.map(w => (
                            <p key={w.id} className="text-xs text-zinc-400">
                              {w.days.sort().map(d => DAY_LABELS[d]).join(', ')}
                              {' · '}{w.startTime}–{w.endTime}
                              {' · '}{w.startDate} → {w.endDate}
                            </p>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => toggleActive(room)}
                        className={cn(
                          'inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full transition-colors',
                          room.isActive
                            ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                            : 'bg-zinc-800 text-zinc-500 hover:bg-zinc-700',
                        )}
                      >
                        {room.isActive
                          ? <><ToggleRight className="w-3.5 h-3.5" /> Active</>
                          : <><ToggleLeft className="w-3.5 h-3.5" /> Inactive</>}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openEdit(room)}
                          className="p-1.5 text-zinc-400 hover:text-zinc-300 rounded-lg hover:bg-zinc-800 transition-colors"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setDeleteId(room.id)}
                          className="p-1.5 text-zinc-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition-colors"
                        >
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

      {/* Add / Edit modal */}
      {modal !== null && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-zinc-900 rounded-2xl shadow-xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-zinc-100">
              {modal === 'add' ? 'Add room' : 'Edit room'}
            </h2>

            {/* Basic fields */}
            <div className="space-y-3">
              <div>
                <label className="label">Room name</label>
                <input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Room A"
                  className="input"
                  autoFocus
                />
              </div>
              <div>
                <label className="label">Description <span className="text-zinc-400 font-normal">(optional)</span></label>
                <input
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="e.g. Editing room with 2 workstations"
                  className="input"
                />
              </div>
            </div>

            {/* Availability windows */}
            <div className="border border-white/10 rounded-xl overflow-hidden">
              <button
                type="button"
                onClick={() => setAvailOpen(o => !o)}
                className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-zinc-300 hover:bg-white/5 transition-colors"
              >
                <span>
                  Availability windows
                  {form.availability.length > 0 && (
                    <span className="ml-2 text-xs font-normal text-zinc-400">
                      {form.availability.length} window{form.availability.length !== 1 ? 's' : ''}
                    </span>
                  )}
                </span>
                {availOpen ? <ChevronUp className="w-4 h-4 text-zinc-400" /> : <ChevronDown className="w-4 h-4 text-zinc-400" />}
              </button>

              {availOpen && (
                <div className="px-4 pb-4 space-y-3 border-t border-white/8">
                  <p className="text-xs text-zinc-400 pt-3">
                    Define when this room can be booked. Leave empty to allow booking at any time.
                  </p>
                  {form.availability.map(w => (
                    <WindowRow
                      key={w.id}
                      w={w}
                      onChange={patch => updateWindow(w.id, patch)}
                      onRemove={() => removeWindow(w.id)}
                    />
                  ))}
                  <button
                    type="button"
                    onClick={addWindow}
                    className="flex items-center gap-1.5 text-sm text-brand-600 hover:text-brand-800 transition-colors"
                  >
                    <Plus className="w-4 h-4" /> Add window
                  </button>
                </div>
              )}
            </div>

            {saveError && (
              <p className="text-xs text-rose-400 bg-rose-950/40 rounded-lg px-3 py-2">{saveError}</p>
            )}

            <div className="flex gap-2 pt-2">
              <button onClick={save} disabled={!form.name.trim() || saving} className="btn-primary py-2 px-5 flex items-center gap-2">
                <Check className="w-4 h-4" /> {saving ? 'Saving…' : 'Save'}
              </button>
              <button onClick={close} className="btn-secondary py-2 px-5 flex items-center gap-2">
                <X className="w-4 h-4" /> Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {deleteId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-zinc-900 rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h2 className="text-lg font-semibold text-zinc-100">Delete room?</h2>
            <p className="text-sm text-zinc-500">Existing bookings for this room will remain in Firestore.</p>
            <div className="flex gap-2 pt-2">
              <button onClick={confirmDelete} disabled={saving} className="btn-primary bg-rose-600 hover:bg-rose-700 py-2 px-5">
                {saving ? 'Deleting…' : 'Delete'}
              </button>
              <button onClick={() => setDeleteId(null)} className="btn-secondary py-2 px-5">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
