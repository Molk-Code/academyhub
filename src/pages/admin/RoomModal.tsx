import { useState } from 'react'
import { collection, addDoc, doc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { nanoid } from 'nanoid'
import { db } from '@/lib/firebase'
import type { RoomDoc, RoomAvailabilityWindow } from '@/types'
import { Plus, Check, X, ChevronDown, ChevronUp } from 'lucide-react'
import { WindowRow } from './RoomWindowRow'

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

interface RoomForm { name: string; description: string; availability: RoomAvailabilityWindow[] }

export function RoomModal({ modal, rooms, semester, onClose }: {
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
