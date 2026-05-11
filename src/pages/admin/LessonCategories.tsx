import { useState } from 'react'
import { addDoc, updateDoc, deleteDoc, doc, collection } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useCollection, orderBy } from '@/hooks/useFirestore'
import type { LessonCategoryDoc } from '@/types'
import { Plus, Pencil, Trash2, Check, X } from 'lucide-react'
import LoadingSpinner from '@/components/common/LoadingSpinner'

const PRESET_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#0ea5e9', '#14b8a6',
  '#10b981', '#f59e0b', '#f97316', '#f43f5e', '#64748b',
  '#84cc16', '#06b6d4', '#a855f7', '#ef4444', '#3b82f6',
]

interface EditState { id: string | null; name: string; color: string }
const EMPTY: EditState = { id: null, name: '', color: PRESET_COLORS[0] }

export default function LessonCategories() {
  const { data: categories, loading } = useCollection<LessonCategoryDoc>(
    'lessonCategories',
    [orderBy('order', 'asc')],
  )
  const [edit,    setEdit]    = useState<EditState | null>(null)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')

  function openNew() { setEdit(EMPTY); setError('') }
  function openEdit(c: LessonCategoryDoc) { setEdit({ id: c.id, name: c.name, color: c.color }); setError('') }
  function cancel() { setEdit(null); setError('') }

  async function save() {
    if (!edit) return
    if (!edit.name.trim()) return setError('Name is required')
    setSaving(true)
    setError('')
    try {
      if (edit.id) {
        await updateDoc(doc(db, 'lessonCategories', edit.id), { name: edit.name.trim(), color: edit.color })
      } else {
        await addDoc(collection(db, 'lessonCategories'), {
          name:  edit.name.trim(),
          color: edit.color,
          order: categories.length,
        })
      }
      setEdit(null)
    } catch (e: any) {
      setError(e.message ?? 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this category? Existing lessons will keep their data but lose the category label.')) return
    await deleteDoc(doc(db, 'lessonCategories', id))
  }

  if (loading) return <LoadingSpinner />

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Lesson Categories</h1>
          <p className="text-zinc-500 text-sm mt-1">
            Categories appear when teachers create lessons and as a layer on the annual plan wheel.
          </p>
        </div>
        <button onClick={openNew} className="btn-primary py-2 flex items-center gap-2">
          <Plus className="w-4 h-4" /> Add category
        </button>
      </div>

      {/* Add / Edit form */}
      {edit && (
        <div className="bg-zinc-900 rounded-2xl border border-white/10 shadow-sm p-5 space-y-4">
          <h2 className="text-sm font-semibold text-zinc-200">{edit.id ? 'Edit category' : 'New category'}</h2>

          <div>
            <label className="label">Name</label>
            <input
              autoFocus
              value={edit.name}
              onChange={e => setEdit(v => v && ({ ...v, name: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel() }}
              className="input w-full"
              placeholder="e.g. Theory, Practical, Workshop…"
            />
            {error && <p className="text-xs text-rose-500 mt-1">{error}</p>}
          </div>

          <div>
            <label className="label">Color</label>
            <div className="flex flex-wrap gap-2 mt-1">
              {PRESET_COLORS.map(hex => (
                <button
                  key={hex}
                  type="button"
                  onClick={() => setEdit(v => v && ({ ...v, color: hex }))}
                  className="w-8 h-8 rounded-full transition-transform hover:scale-110 flex items-center justify-center"
                  style={{ background: hex }}
                >
                  {edit.color === hex && <Check className="w-4 h-4 text-white" strokeWidth={3} />}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <button onClick={save} disabled={saving} className="btn-primary py-2 px-5 disabled:opacity-50">
              {saving ? 'Saving…' : edit.id ? 'Save changes' : 'Create'}
            </button>
            <button onClick={cancel} className="btn-secondary py-2 px-4">Cancel</button>
          </div>
        </div>
      )}

      {/* Category list */}
      {categories.length === 0 && !edit ? (
        <div className="bg-zinc-900 rounded-2xl border border-white/10 shadow-sm p-10 text-center">
          <p className="text-zinc-500 text-sm">No categories yet. Add one to get started.</p>
        </div>
      ) : (
        <div className="bg-zinc-900 rounded-2xl border border-white/10 shadow-sm divide-y divide-slate-100">
          {categories.map(c => (
            <div key={c.id} className="flex items-center gap-3 px-5 py-3.5 group">
              <span className="w-4 h-4 rounded-full flex-shrink-0" style={{ background: c.color }} />
              <span className="flex-1 text-sm font-medium text-zinc-200">{c.name}</span>
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => openEdit(c)}
                  className="p-1.5 text-zinc-400 hover:text-zinc-300 rounded-lg hover:bg-zinc-800 transition-colors"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                <button
                  onClick={() => remove(c.id)}
                  className="p-1.5 text-zinc-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
