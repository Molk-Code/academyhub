import { useState } from 'react'
import { Link } from 'react-router-dom'
import { addDoc, collection, deleteDoc, doc, updateDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useCollection } from '@/hooks/useFirestore'
import type { SubjectDoc } from '@/types'
import { Plus, Pencil, Trash2, BookOpen, X, Check, ChevronRight } from 'lucide-react'
import LoadingSpinner from '@/components/common/LoadingSpinner'
import EmptyState     from '@/components/common/EmptyState'
import EmojiPicker    from '@/components/common/EmojiPicker'

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
  const [showForm, setShowForm] = useState(false)
  const [editing,  setEditing]  = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [form,     setForm]     = useState<FormState>(EMPTY_FORM)
  const [saving,   setSaving]   = useState(false)

  const { data: rawSubjects, loading } = useCollection<SubjectDoc>('subjects')
  const subjects = [...rawSubjects].sort((a, b) => a.programYear - b.programYear || a.order - b.order)

  function openNew() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setShowForm(true)
  }

  function openEdit(e: React.MouseEvent, s: SubjectDoc) {
    e.preventDefault()
    setEditing(s.id)
    setForm({ title: s.title, description: s.description, iconEmoji: s.iconEmoji, color: s.color, programYear: s.programYear, order: s.order })
    setShowForm(true)
  }

  function cancel() { setShowForm(false); setEditing(null) }

  async function handleSave() {
    if (!form.title.trim()) return
    setSaving(true)
    try {
      if (editing) {
        await updateDoc(doc(db, 'subjects', editing), { ...form })
      } else {
        await addDoc(collection(db, 'subjects'), { ...form, createdBy: profile?.id ?? '', curriculum: [] })
      }
      cancel()
    } finally { setSaving(false) }
  }

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.preventDefault()
    if (!confirm('Delete this subject?')) return
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
          <p className="text-zinc-400 text-sm mt-1">Manage subjects and build their curriculum.</p>
        </div>
        <button onClick={openNew} className="btn-primary py-2.5">
          <Plus className="w-4 h-4" /> New Subject
        </button>
      </div>

      {/* Create / edit form */}
      {showForm && (
        <div className="bg-slate-800 rounded-2xl p-6 space-y-4">
          <h2 className="text-base font-semibold text-white">{editing ? 'Edit Subject' : 'New Subject'}</h2>

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">Title &amp; Icon</label>
            <div className="flex items-center gap-2">
              <EmojiPicker value={form.iconEmoji} onChange={emoji => setForm(f => ({ ...f, iconEmoji: emoji }))} />
              <input
                className="input flex-1"
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="e.g. Cinematography A"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">Description</label>
            <textarea className="input resize-none" rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Short description shown to students" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Programme year</label>
              <select className="input" value={form.programYear} onChange={e => setForm(f => ({ ...f, programYear: Number(e.target.value) as 1 | 2 }))}>
                <option value={1}>Year 1</option>
                <option value={2}>Year 2</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Display order</label>
              <input type="number" className="input" value={form.order} onChange={e => setForm(f => ({ ...f, order: Number(e.target.value) }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Colour</label>
              <div className="flex gap-2 flex-wrap mt-1">
                {COLOR_OPTIONS.map(c => (
                  <button key={c.value} type="button" title={c.label} onClick={() => setForm(f => ({ ...f, color: c.value }))}
                    className={`w-6 h-6 rounded-full ${c.value} ring-2 ring-offset-2 ring-offset-slate-800 ${form.color === c.value ? 'ring-white' : 'ring-transparent'}`}
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
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {list.map(s => (
                  <Link
                    key={s.id}
                    to={`/teacher/subjects/${s.id}`}
                    className="group bg-slate-800 rounded-2xl overflow-hidden hover:bg-slate-750 hover:ring-2 hover:ring-brand-500/40 transition-all"
                  >
                    <div className={`h-1.5 ${s.color}`} />
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-3">
                          <span className="text-2xl">{s.iconEmoji}</span>
                          <div>
                            <p className="text-sm font-semibold text-white leading-tight">{s.title}</p>
                            <p className="text-xs text-zinc-400 mt-0.5 line-clamp-1">{s.description || '—'}</p>
                          </div>
                        </div>
                        <ChevronRight className="w-4 h-4 text-zinc-400 group-hover:text-brand-400 flex-shrink-0 mt-0.5 transition-colors" />
                      </div>
                      <div className="flex items-center justify-between mt-3">
                        <span className="text-xs text-zinc-500">
                          {(s.curriculum ?? []).length} curriculum items
                        </span>
                        <div className="flex gap-1">
                          <button onClick={e => openEdit(e, s)} className="p-1.5 text-zinc-500 hover:text-white hover:bg-zinc-700 rounded-lg transition-colors">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={e => handleDelete(e, s.id)} disabled={deleting === s.id} className="p-1.5 text-zinc-500 hover:text-rose-400 hover:bg-zinc-700 rounded-lg transition-colors">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )
        )
      )}
    </div>
  )
}
