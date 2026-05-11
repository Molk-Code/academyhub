import { useState } from 'react'
import { addDoc, collection, deleteDoc, doc, updateDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useCollection, orderBy } from '@/hooks/useFirestore'
import type { SubjectDoc } from '@/types'
import { Plus, Pencil, Trash2, BookOpen, X, Check } from 'lucide-react'
import LoadingSpinner from '@/components/common/LoadingSpinner'
import EmptyState     from '@/components/common/EmptyState'

const COLOR_OPTIONS = [
  { label: 'Indigo',  value: 'bg-indigo-500'  },
  { label: 'Sky',     value: 'bg-sky-500'      },
  { label: 'Emerald', value: 'bg-emerald-500'  },
  { label: 'Amber',   value: 'bg-amber-500'    },
  { label: 'Rose',    value: 'bg-rose-500'     },
  { label: 'Violet',  value: 'bg-violet-500'   },
  { label: 'Orange',  value: 'bg-orange-500'   },
  { label: 'Teal',    value: 'bg-teal-500'     },
]

const EMPTY_FORM = {
  title: '',
  description: '',
  iconEmoji: '🎬',
  color: 'bg-indigo-500',
  programYear: 1 as 1 | 2,
  order: 0,
}

type FormState = typeof EMPTY_FORM

export default function SubjectManager() {
  const { profile } = useAuth()
  const [showForm, setShowForm]   = useState(false)
  const [editing, setEditing]     = useState<string | null>(null)
  const [deleting, setDeleting]   = useState<string | null>(null)
  const [form, setForm]           = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving]       = useState(false)

  const { data: subjects, loading } = useCollection<SubjectDoc>(
    'subjects',
    [orderBy('programYear', 'asc'), orderBy('order', 'asc')],
  )

  function openNew() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setShowForm(true)
  }

  function openEdit(s: SubjectDoc) {
    setEditing(s.id)
    setForm({
      title: s.title,
      description: s.description,
      iconEmoji: s.iconEmoji,
      color: s.color,
      programYear: s.programYear,
      order: s.order,
    })
    setShowForm(true)
  }

  function cancel() {
    setShowForm(false)
    setEditing(null)
  }

  async function handleSave() {
    if (!form.title.trim()) return
    setSaving(true)
    try {
      if (editing) {
        await updateDoc(doc(db, 'subjects', editing), { ...form })
      } else {
        await addDoc(collection(db, 'subjects'), {
          ...form,
          createdBy: profile?.id ?? '',
        })
      }
      cancel()
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this subject? Lessons and assignments referencing it will not be removed.')) return
    setDeleting(id)
    await deleteDoc(doc(db, 'subjects', id))
    setDeleting(null)
  }

  const year1 = subjects.filter(s => s.programYear === 1)
  const year2 = subjects.filter(s => s.programYear === 2)

  if (loading) return <LoadingSpinner />

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="page-title">Subjects</h1>
          <p className="text-zinc-400 text-sm mt-1">Manage the curriculum subjects for each programme year.</p>
        </div>
        <button onClick={openNew} className="btn-primary py-2.5">
          <Plus className="w-4 h-4" /> New Subject
        </button>
      </div>

      {/* Form panel */}
      {showForm && (
        <div className="bg-slate-800 rounded-2xl p-6 space-y-4">
          <h2 className="text-base font-semibold text-white">{editing ? 'Edit Subject' : 'New Subject'}</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Title</label>
              <input
                className="input"
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="e.g. Cinematography"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Emoji icon</label>
              <input
                className="input"
                value={form.iconEmoji}
                onChange={e => setForm(f => ({ ...f, iconEmoji: e.target.value }))}
                placeholder="🎬"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">Description</label>
            <textarea
              className="input resize-none"
              rows={2}
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Short description shown to students"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Programme year</label>
              <select
                className="input"
                value={form.programYear}
                onChange={e => setForm(f => ({ ...f, programYear: Number(e.target.value) as 1 | 2 }))}
              >
                <option value={1}>Year 1</option>
                <option value={2}>Year 2</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Display order</label>
              <input
                type="number"
                className="input"
                value={form.order}
                onChange={e => setForm(f => ({ ...f, order: Number(e.target.value) }))}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Colour</label>
              <div className="flex gap-2 flex-wrap mt-1">
                {COLOR_OPTIONS.map(c => (
                  <button
                    key={c.value}
                    type="button"
                    title={c.label}
                    onClick={() => setForm(f => ({ ...f, color: c.value }))}
                    className={`w-6 h-6 rounded-full ${c.value} ring-2 ring-offset-2 ring-offset-slate-800 ${
                      form.color === c.value ? 'ring-white' : 'ring-transparent'
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button onClick={handleSave} disabled={saving || !form.title.trim()} className="btn-primary py-2">
              <Check className="w-4 h-4" /> {saving ? 'Saving…' : 'Save'}
            </button>
            <button onClick={cancel} className="btn-ghost py-2">
              <X className="w-4 h-4" /> Cancel
            </button>
          </div>
        </div>
      )}

      {subjects.length === 0 && !showForm ? (
        <EmptyState icon={BookOpen} title="No subjects yet" description="Add your first subject to get started." />
      ) : (
        [{ year: 1, list: year1 }, { year: 2, list: year2 }].map(({ year, list }) =>
          list.length === 0 ? null : (
            <div key={year} className="space-y-3">
              <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Year {year}</h2>
              {list.map(s => (
                <div key={s.id} className="bg-slate-800 rounded-2xl p-4 flex items-center gap-4">
                  <div className={`w-1 self-stretch rounded-full flex-shrink-0 ${s.color}`} />
                  <span className="text-2xl">{s.iconEmoji}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white">{s.title}</p>
                    <p className="text-xs text-zinc-400 mt-0.5 truncate">{s.description || '—'}</p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => openEdit(s)}
                      className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-700 rounded-lg transition-colors"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(s.id)}
                      disabled={deleting === s.id}
                      className="p-2 text-zinc-400 hover:text-rose-400 hover:bg-zinc-700 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )
        )
      )}
    </div>
  )
}
