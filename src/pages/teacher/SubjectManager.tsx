import { useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { addDoc, collection, deleteDoc, doc, updateDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useCollection } from '@/hooks/useFirestore'
import type { SubjectDoc } from '@/types'
import { Plus, Pencil, Trash2, BookOpen, X, Check, ChevronRight, GripVertical, ImagePlus, Loader2, RotateCcw } from 'lucide-react'
import { uploadFile } from '@/lib/cloudinary'
import { shrinkImageToLimit, MAX_IMAGE_BYTES } from '@/lib/imageCompress'
import SubjectCover   from '@/components/subjects/SubjectCover'
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
  imageUrl: '',
  imageFocus: null as { x: number; y: number } | null,  // null = auto crop
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
  const [uploadPct, setUploadPct] = useState<number | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [optimizing, setOptimizing] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // The form renders above the list, so bring it into view when it opens —
  // otherwise editing a subject far down the page looks like nothing happened.
  const formRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (showForm) formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [showForm, editing])

  // ── Drag-to-reorder state ──────────────────────────────────────────────────
  const [dragId,     setDragId]     = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [armedId,    setArmedId]    = useState<string | null>(null)  // card whose grip is held

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

  // Disarm if the grip is pressed and released without a drag starting
  useEffect(() => {
    const disarm = () => setArmedId(null)
    window.addEventListener('mouseup', disarm)
    return () => window.removeEventListener('mouseup', disarm)
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
    setForm({ title: s.title, description: s.description, iconEmoji: s.iconEmoji, color: s.color, imageUrl: s.imageUrl ?? '', imageFocus: s.imageFocus ?? null, programYear: s.programYear, order: s.order })
    setShowForm(true)
  }

  function cancel() { setShowForm(false); setEditing(null); setUploadPct(null); setUploadError(null) }

  async function handleImagePick(file: File | undefined) {
    if (!file) return
    if (!file.type.startsWith('image/')) { setUploadError('Please choose an image file.'); return }
    setUploadError(null)
    setUploadPct(0)
    try {
      // Images over the 10 MB upload limit are shrunk in the browser first
      if (file.size >= MAX_IMAGE_BYTES) setOptimizing(true)
      const ready = await shrinkImageToLimit(file)
      setOptimizing(false)
      const { secureUrl } = await uploadFile(ready, setUploadPct)
      setForm(f => ({ ...f, imageUrl: secureUrl, imageFocus: null }))
    } catch (e: any) {
      setUploadError(e.message ?? 'Upload failed.')
    } finally {
      setOptimizing(false)
      setUploadPct(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

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
        <div ref={formRef} className="bg-slate-800 rounded-2xl p-6 space-y-4 scroll-mt-24">
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

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">Cover image</label>
            <div className="relative rounded-xl overflow-hidden">
              <SubjectCover
                subject={{ ...form, title: form.title || 'Subject' }}
                className="h-36"
                onReposition={form.imageUrl && uploadPct === null ? focus => setForm(f => ({ ...f, imageFocus: focus })) : undefined}
              >
                <p className="text-white font-semibold text-sm truncate">{form.title || 'Subject title'}</p>
              </SubjectCover>
              {uploadPct !== null && (
                <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-2">
                  <Loader2 className="w-5 h-5 text-white animate-spin" />
                  {optimizing
                    ? <p className="text-xs text-white/80">Optimising image…</p>
                    : <div className="w-1/2 h-1.5 bg-white/20 rounded-full overflow-hidden">
                        <div className="h-full bg-brand-500 transition-all" style={{ width: `${uploadPct}%` }} />
                      </div>}
                </div>
              )}
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={e => handleImagePick(e.target.files?.[0])} />
            <div className="flex flex-wrap gap-2 mt-2">
              <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploadPct !== null} className="btn-ghost py-1.5 text-sm">
                <ImagePlus className="w-4 h-4" /> {form.imageUrl ? 'Replace image' : 'Upload image'}
              </button>
              {form.imageUrl && form.imageFocus && (
                <button type="button" onClick={() => setForm(f => ({ ...f, imageFocus: null }))} disabled={uploadPct !== null} className="btn-ghost py-1.5 text-sm text-zinc-400">
                  <RotateCcw className="w-4 h-4" /> Reset framing
                </button>
              )}
              {form.imageUrl && (
                <button type="button" onClick={() => setForm(f => ({ ...f, imageUrl: '', imageFocus: null }))} disabled={uploadPct !== null} className="btn-ghost py-1.5 text-sm text-zinc-400">
                  <X className="w-4 h-4" /> Remove
                </button>
              )}
            </div>
            {uploadError && <p className="text-xs text-rose-400 mt-1">{uploadError}</p>}
            {!form.imageUrl && <p className="text-xs text-zinc-500 mt-1">Without an image, the cover uses the subject colour.</p>}
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
            <button onClick={handleSave} disabled={saving || uploadPct !== null || !form.title.trim()} className="btn-primary py-2">
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
                    // Only draggable while the grip handle is held — avoids accidental reorders
                    draggable={armedId === s.id}
                    onDragStart={e => {
                      if (armedId !== s.id) { e.preventDefault(); return }
                      e.dataTransfer.effectAllowed = 'move'; setDragId(s.id)
                    }}
                    onDragOver={e => { e.preventDefault(); if (dragOverId !== s.id) setDragOverId(s.id) }}
                    onDrop={e => { e.preventDefault(); handleDrop(s.id) }}
                    onDragEnd={() => { setDragId(null); setDragOverId(null); setArmedId(null) }}
                    className={`group bg-slate-800 rounded-2xl overflow-hidden transition-all ${
                      dragId === s.id ? 'opacity-40' : ''
                    } ${
                      dragOverId === s.id && dragId !== s.id
                        ? 'ring-2 ring-brand-500'
                        : 'hover:ring-2 hover:ring-brand-500/40'
                    }`}
                  >
                    <SubjectCover subject={s} className="h-28">
                      <div className="flex items-end justify-between gap-2">
                        <p className="text-sm font-semibold text-white leading-tight truncate">{s.title}</p>
                        <Link
                          to={`/teacher/subjects/${s.id}`}
                          onClick={e => e.stopPropagation()}
                          className="flex-shrink-0 p-1 rounded-lg bg-black/40 backdrop-blur text-white/80 hover:text-white transition-colors"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </Link>
                      </div>
                    </SubjectCover>
                    <div className="p-4">
                      <div className="flex items-start gap-2">
                        <span
                          title="Drag to reorder"
                          aria-label="Drag to reorder"
                          onMouseDown={() => setArmedId(s.id)}
                          onMouseUp={() => setArmedId(null)}
                          onTouchStart={e => {
                            e.preventDefault()
                            touchActive.current = true
                            dragIdRef.current   = s.id
                            dragOverRef.current = null
                            setDragId(s.id); setDragOverId(null)
                          }}
                          className="-m-1.5 p-1.5 rounded-lg flex-shrink-0 cursor-grab active:cursor-grabbing touch-none select-none text-zinc-600 group-hover:text-zinc-400 hover:bg-zinc-700/60 hover:text-zinc-200 transition-colors"
                        >
                          <GripVertical className="w-4 h-4" />
                        </span>
                        <p className="text-xs text-zinc-400 line-clamp-2 min-w-0">{s.description || '—'}</p>
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
