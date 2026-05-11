import { useState } from 'react'
import { collection, addDoc, updateDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore'
import { Plus, Pencil, Trash2, Check, X, Timer } from 'lucide-react'
import { db } from '@/lib/firebase'
import { useCollection } from '@/hooks/useFirestore'
import type { TimeBlockDoc } from '@/types'
import { cn } from '@/lib/utils'
import LoadingSpinner from '@/components/common/LoadingSpinner'

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WEEKDAYS = [1, 2, 3, 4, 5] // Mon–Fri
const DAY_NAMES: Record<number, string> = { 0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat' }

interface BlockForm {
  label: string
  startTime: string
  endTime: string
  days: number[]
}

const BLANK: BlockForm = { label: '', startTime: '09:00', endTime: '11:00', days: [1, 2, 3, 4, 5] }

function autoLabel(start: string, end: string) {
  return start && end ? `${start}–${end}` : ''
}

export default function TimeBlockManager() {
  const { data: blocks, loading } = useCollection<TimeBlockDoc>('time_blocks')
  const sorted = [...blocks].sort((a, b) => a.startTime.localeCompare(b.startTime))

  const [modal, setModal] = useState<'add' | { block: TimeBlockDoc } | null>(null)
  const [form, setForm] = useState<BlockForm>(BLANK)
  const [saving, setSaving] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [autoLabel_, setAutoLabel] = useState(true)

  function openAdd() {
    setForm(BLANK)
    setAutoLabel(true)
    setModal('add')
  }

  function openEdit(block: TimeBlockDoc) {
    setForm({
      label: block.label,
      startTime: block.startTime,
      endTime: block.endTime,
      days: block.days,
    })
    setAutoLabel(false)
    setModal({ block })
  }

  function close() { setModal(null) }

  function setTime(field: 'startTime' | 'endTime', val: string) {
    setForm(f => {
      const next = { ...f, [field]: val }
      if (autoLabel_) next.label = autoLabel(next.startTime, next.endTime)
      return next
    })
  }

  function toggleDay(d: number) {
    setForm(f => ({
      ...f,
      days: f.days.includes(d) ? f.days.filter(x => x !== d) : [...f.days, d].sort(),
    }))
  }

  async function save() {
    if (!form.label.trim() || !form.startTime || !form.endTime) return
    setSaving(true)
    try {
      const payload = {
        label: form.label.trim(),
        startTime: form.startTime,
        endTime: form.endTime,
        days: form.days,
        order: blocks.length,
      }
      if (modal === 'add') {
        await addDoc(collection(db, 'time_blocks'), { ...payload, createdAt: serverTimestamp() })
      } else if (modal && typeof modal === 'object') {
        await updateDoc(doc(db, 'time_blocks', modal.block.id), payload)
      }
      close()
    } finally {
      setSaving(false)
    }
  }

  async function confirmDelete() {
    if (!deleteId) return
    setSaving(true)
    try {
      await deleteDoc(doc(db, 'time_blocks', deleteId))
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
          <h1 className="page-title">Time Blocks</h1>
          <p className="text-zinc-400 text-sm mt-1">{sorted.length} time blocks configured.</p>
        </div>
        <button onClick={openAdd} className="btn-primary py-2 px-4 text-sm flex items-center gap-2">
          <Plus className="w-4 h-4" /> Add block
        </button>
      </div>

      <div className="bg-zinc-900 rounded-2xl border border-white/10 overflow-hidden">
        {sorted.length === 0 ? (
          <div className="py-16 text-center">
            <Timer className="w-10 h-10 text-slate-200 mx-auto mb-3" />
            <p className="text-zinc-400 text-sm">No time blocks yet. Add one to enable room booking.</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10">
                <th className="text-left text-xs font-medium text-zinc-500 px-5 py-3">Label</th>
                <th className="text-left text-xs font-medium text-zinc-500 px-4 py-3">Start</th>
                <th className="text-left text-xs font-medium text-zinc-500 px-4 py-3">End</th>
                <th className="text-left text-xs font-medium text-zinc-500 px-4 py-3">Weekdays</th>
                <th className="w-20 px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sorted.map(block => (
                <tr key={block.id} className="hover:bg-white/5 transition-colors">
                  <td className="px-5 py-3">
                    <p className="text-sm font-semibold text-zinc-100">{block.label}</p>
                  </td>
                  <td className="px-4 py-3 text-sm text-zinc-400">{block.startTime}</td>
                  <td className="px-4 py-3 text-sm text-zinc-400">{block.endTime}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      {WEEKDAYS.map(d => (
                        <span
                          key={d}
                          className={cn(
                            'text-xs font-medium px-1.5 py-0.5 rounded',
                            block.days.includes(d)
                              ? 'bg-brand-100 text-brand-700'
                              : 'bg-zinc-800 text-zinc-300',
                          )}
                        >
                          {DAY_NAMES[d]}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => openEdit(block)}
                        className="p-1.5 text-zinc-400 hover:text-zinc-300 rounded-lg hover:bg-zinc-800 transition-colors"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setDeleteId(block.id)}
                        className="p-1.5 text-zinc-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add / Edit modal */}
      {modal !== null && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-zinc-900 rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h2 className="text-lg font-semibold text-zinc-100">
              {modal === 'add' ? 'Add time block' : 'Edit time block'}
            </h2>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Start time</label>
                  <input
                    type="time"
                    value={form.startTime}
                    onChange={e => setTime('startTime', e.target.value)}
                    className="input"
                  />
                </div>
                <div>
                  <label className="label">End time</label>
                  <input
                    type="time"
                    value={form.endTime}
                    onChange={e => setTime('endTime', e.target.value)}
                    className="input"
                  />
                </div>
              </div>
              <div>
                <label className="label">Label</label>
                <input
                  value={form.label}
                  onChange={e => { setAutoLabel(false); setForm(f => ({ ...f, label: e.target.value })) }}
                  placeholder="e.g. 09:00–11:00"
                  className="input"
                />
                <p className="text-xs text-zinc-400 mt-1">Auto-generated from times if left untouched.</p>
              </div>
              <div>
                <label className="label">Applies on</label>
                <div className="flex gap-2 mt-1">
                  {[1, 2, 3, 4, 5, 6, 0].map(d => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => toggleDay(d)}
                      className={cn(
                        'px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                        form.days.includes(d)
                          ? 'bg-brand-600 border-brand-600 text-white'
                          : 'bg-zinc-900 border-white/10 text-zinc-500 hover:border-white/15',
                      )}
                    >
                      {DAY_LABELS[d]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={save}
                disabled={!form.label.trim() || !form.startTime || !form.endTime || saving}
                className="btn-primary py-2 px-5 flex items-center gap-2"
              >
                <Check className="w-4 h-4" /> {saving ? 'Saving…' : 'Save'}
              </button>
              <button onClick={close} className="btn-secondary py-2 px-5">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {deleteId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-zinc-900 rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h2 className="text-lg font-semibold text-zinc-100">Delete time block?</h2>
            <p className="text-sm text-zinc-500">Existing bookings for this time block will remain in Firestore.</p>
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
