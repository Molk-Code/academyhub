import { useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { addDoc, collection, deleteDoc, doc, updateDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useCollection } from '@/hooks/useFirestore'
import type { SubjectDoc } from '@/types'
import { Plus, Pencil, Trash2, BookOpen, X, Check, ChevronRight, GripVertical } from 'lucide-react'
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

  // ── Drag-to-reorder state ──────────────────────────────────────────────────
  const [dragId,     setDragId]     = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)

  const subjectsRef  = useRef<SubjectDoc[]>([])
  const dragIdRef    = useRef<string | null>(null)
  const dragOverRef  = useRef<string | null>(null)
  const touchActive  = useRef(false)

  const { data: rawSubjects, loading } = useCollection<SubjectDoc>('subjects')
  const subjects = [...rawSubjects].sort((a, b) => a.programYear - b.programYear || a.order - b.order)

  useEffect(() => { subjectsRef.current  = subjects },  [subjects])
  useEffect(() => { dragIdRef.current    = dragId },    [dragId])
  useEffect(() => { dragOverRef.current  = dragOverId }, [dragOverId])

  // ── Reorder helper (within same year group) ────────────────────────────────
  async function doReorder(fromId: string, toId: string) {
    const list = subjectsRef.current
    const from = list.find(s => s.id === fromId)
    const to   = list.find(s => s.id === toId)
    if (!from || !to || from.programYear !== to.programYear) return

    const yearList = list.filter(s => s.programYear === from.programYear)
    const fi = yearList.findIndex(s => s.id === fromId)
    const ti = yearList.findIndex(s => s.id === toId)
    if (fi === -1 || ti === -1) return

    const reordered = [...yearList]
    const [moved] = reordered.splice(fi, 1)
    reordered.splice(ti, 0, moved)
    await Promise.all(
      reordered.map((s, i) =>
        s.order !== i ? updateDoc(doc(db, 'subjects', s.id), { order: i }) : Promise.resolve()
      )
    )
  }

  // ── Document-level touch listeners ────────────────────────────────────────
  useEffect(() => {
    function onTouchMove(e: TouchEvent) {
      if (!touchActive.current) return
      e.preventDefault()
      const touch = e.touches[0]
      const el  = document.elementFromPoint(touch.clientX, touch.clientY)
      const card = el?.closest('[data-subject-id]')
      const over = card?.getAttribute('data-subject-id') ?? null
      if (over !== dragOverRef.current) { dragOverRef.current = over; setDragOverId(over) }
    }
    function onTouchEnd() {
      if (!touchActive.current) return
      touchActive.current = false
      const from = dragIdRef.current
      const to   = dragOverRef.current
      setDragId(null); setDragOverId(null)
      if (from && to && from !== to) doReorder(from, to)
    }
    document.addEventListener('touchmove', onTouchMove, { passive: false })
    document.addEventListener('touchend',  onTouchEnd)
    return () => {
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('touchend',  onTouchEnd)
    }
  }, [])

  async function handleDrop(targetId: string) {
    if (!dragId || dragId === targetId) { setDragId(null); setDragOverId(null); return }
    await doReorder(dragId, targetId)
    setDragId(null); setDragOverId(null)
  }

  // ── Form helpers ───────────────────────────────────────────────────────────
  function openNew() {
    setEditing(null)
    setForm({ ...EMPTY_FORM, order: subjects.length })
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
          <p className="text-zinc-400 text-sm mt-1">Manage subjects and build their curriculum. Drag cards to reorder.</p>
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Programme year</label>
              <select className="input" value={form.programYear} onChange={e => setForm(f => ({ ...f, programYear: Number(e.target.value) as 1 | 2 }))}>
                <option value={1}>Year 1</option>
                <option value={2}>Year 2</option>
              </select>
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
                  <div
                    key={s.id}
                    data-subject-id={s.id}
                    draggable
                    onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; setDragId(s.id) }}
                    onDragOver={e => { e.preventDefault(); if (dragOverId !== s.id) setDragOverId(s.id) }}
                    onDrop={e => { e.preventDefault(); handleDrop(s.id) }}
                    onDragEnd={() => { setDragId(null); setDragOverId(null) }}
                    onTouchStart={e => {
                      e.preventDefault()
                      touchActive.current = true
                      dragIdRef.current   = s.id
                      dragOverRef.current = null
                      setDragId(s.id); setDragOverId(null)
                    }}
                    className={`group bg-slate-800 rounded-2xl overflow-hidden transition-all ${
                      dragId === s.id ? 'opacity-40' : ''
                    } ${
                      dragOverId === s.id && dragId !== s.id
                        ? 'ring-2 ring-brand-500'
                        : 'hover:ring-2 hover:ring-brand-500/40'
                    }`}
                  >
                    <div className={`h-1.5 ${s.color}`} />
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-3 min-w-0">
                          <GripVertical className="w-4 h-4 text-zinc-600 group-hover:text-zinc-400 flex-shrink-0 cursor-grab active:cursor-grabbing touch-none select-none" />
                          <span className="text-2xl flex-shrink-0">{s.iconEmoji}</span>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-white leading-tight truncate">{s.title}</p>
                            <p className="text-xs text-zinc-400 mt-0.5 line-clamp-1">{s.description || '—'}</p>
                          </div>
                        </div>
                        <Link
                          to={`/teacher/subjects/${s.id}`}
                          onClick={e => e.stopPropagation()}
                          className="flex-shrink-0 p-1 text-zinc-400 hover:text-brand-400 transition-colors"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </Link>
                      </div>
                      <div className="flex items-center justify-between mt-3">
                        <span className="text-xs text-zinc-500">
                          {(s.curriculum ?? []).length} items
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
                  </div>
                ))}
              </div>
            </div>
          )
        )
      )}
    </div>
  )
}
