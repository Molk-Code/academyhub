import { useState, useRef, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { addDoc, collection, collectionGroup, deleteDoc, doc, getDocs, updateDoc } from 'firebase/firestore'
import { format } from 'date-fns'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useCollection, useDocument } from '@/hooks/useFirestore'
import type { SubjectDoc, LessonDoc, SyncedEventDoc, AssignmentDoc, SubjectTeacherDoc, SemesterSettingsDoc } from '@/types'
import {
  Plus, Pencil, Trash2, BookOpen, X, Check, ChevronRight, GripVertical, ImagePlus, Loader2, RotateCcw,
  ArrowRight, Search, LayoutGrid, List, UserCheck, AlertTriangle, Info,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { SubjectThumb } from '@/components/dashboard/UpcomingCard'
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

type Status = 'in-progress' | 'completed' | 'not-started'
type Filter = 'all' | 'year1' | 'year2' | 'setup'
type Sort = 'order' | 'progress' | 'alpha'

const FILTER_LABEL: Record<Filter, string> = { all: 'All subjects', year1: 'Year 1', year2: 'Year 2', setup: 'Needs setup' }
const STATUS_BADGE: Record<Status, { label: string; cls: string }> = {
  'in-progress': { label: 'Active',    cls: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  'completed':   { label: 'Completed', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
  'not-started': { label: 'Upcoming',  cls: 'bg-zinc-800 text-zinc-400 border-zinc-700' },
}
const STATUS_BAR: Record<Status, string> = {
  'in-progress': 'bg-gradient-to-r from-brand-500 to-brand-400',
  'completed':   'bg-emerald-500',
  'not-started': 'bg-zinc-700',
}
const STATUS_TEXT: Record<Status, string> = {
  'in-progress': 'text-brand-400',
  'completed':   'text-emerald-400',
  'not-started': 'text-zinc-400',
}

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

  // Curriculum taught so far — topics covered by past lessons/synced events in any class
  const { data: lessons }      = useCollection<LessonDoc>('lessons')
  const { data: syncedEvents } = useCollection<SyncedEventDoc>('synced_events')
  const { data: assignments }  = useCollection<AssignmentDoc>('assignments')
  const { data: semester }     = useDocument<SemesterSettingsDoc>('settings', 'semester')

  const coverage = useMemo(() => {
    const now = new Date()
    const covered: Record<string, Set<string>> = {}
    const add = (sid: string | null | undefined, ids: string[] | undefined, at: Date | undefined) => {
      if (!sid || !at || at > now) return
      for (const cid of ids ?? []) (covered[sid] ??= new Set()).add(cid)
    }
    for (const l of lessons) add(l.subjectId, l.coveredCurriculumIds, l.startTime?.toDate?.())
    for (const e of syncedEvents) add(e.subjectId, e.coveredCurriculumIds, e.startTime?.toDate?.())
    const out: Record<string, { covered: number; total: number }> = {}
    for (const subj of rawSubjects) {
      const items = subj.curriculum ?? []
      if (items.length === 0) continue
      const set = covered[subj.id]
      out[subj.id] = { covered: set ? items.filter(i => set.has(i.id)).length : 0, total: items.length }
    }
    return out
  }, [lessons, syncedEvents, rawSubjects])

  const assignmentCount = useMemo(() => assignments.reduce<Record<string, number>>((acc, a) => {
    acc[a.subjectId] = (acc[a.subjectId] ?? 0) + 1
    return acc
  }, {}), [assignments])

  const [teachersBySubject, setTeachersBySubject] = useState<Record<string, string[]>>({})
  useEffect(() => {
    getDocs(collectionGroup(db, 'teachers'))
      .then(snap => {
        const out: Record<string, SubjectTeacherDoc[]> = {}
        for (const d of snap.docs) {
          const parent = d.ref.parent.parent
          if (!parent || parent.parent.id !== 'subjects') continue
          ;(out[parent.id] ??= []).push({ ...(d.data() as SubjectTeacherDoc), id: d.id })
        }
        setTeachersBySubject(Object.fromEntries(Object.entries(out).map(([sid, list]) =>
          [sid, list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map(t => t.name).filter(Boolean)])))
      })
      .catch(() => {})
  }, [])

  const term = useMemo(() => {
    if (!semester) return null
    const today = format(new Date(), 'yyyy-MM-dd')
    const label = (start: string) => {
      const d = new Date(`${start}T12:00:00`)
      return `${d.getMonth() >= 6 ? 'Autumn' : 'Spring'} term ${d.getFullYear()}`
    }
    const terms = [{ start: semester.startDate, end: semester.endDate }, { start: semester.sem2Start, end: semester.sem2End }]
    for (const t of terms) if (t.start && t.end && today >= t.start && today <= t.end) return { label: label(t.start), active: true }
    const next = terms.find(t => t.start && today < t.start)
    return next?.start ? { label: label(next.start), active: false } : null
  }, [semester])

  function statusOf(id: string): Status {
    const cp = coverage[id]
    if (!cp || cp.covered === 0) return 'not-started'
    return cp.covered >= cp.total ? 'completed' : 'in-progress'
  }
  function missingOf(subj: SubjectDoc): string[] {
    const m: string[] = []
    if (!subj.imageUrl) m.push('image')
    if (!(subj.curriculum ?? []).length) m.push('topics')
    if (!subj.description?.trim()) m.push('description')
    if (!(teachersBySubject[subj.id] ?? []).length) m.push('teachers')
    return m
  }

  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery]   = useState('')
  const [sort, setSort]     = useState<Sort>('order')
  const [layout, setLayout] = useState<'grid' | 'list'>(() => {
    try { return localStorage.getItem('teacherSubjectsLayout') === 'list' ? 'list' : 'grid' } catch { return 'grid' }
  })
  function chooseLayout(l: 'grid' | 'list') {
    setLayout(l)
    try { localStorage.setItem('teacherSubjectsLayout', l) } catch {}
  }
  const searchRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); searchRef.current?.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

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

  const counts: Record<Filter, number> = {
    all:   subjects.length,
    year1: subjects.filter(s => s.programYear === 1).length,
    year2: subjects.filter(s => s.programYear === 2).length,
    setup: subjects.filter(s => missingOf(s).length > 0).length,
  }
  const statusCounts: Record<Status, number> = { 'in-progress': 0, completed: 0, 'not-started': 0 }
  for (const s of subjects) statusCounts[statusOf(s.id)]++
  const totalCoverage = (() => {
    const entries = Object.values(coverage)
    if (!entries.length) return null
    const total = entries.reduce((n, e) => n + e.total, 0), covered = entries.reduce((n, e) => n + e.covered, 0)
    return { total, covered, pct: total ? Math.round((covered / total) * 100) : 0 }
  })()

  const q = query.trim().toLowerCase()
  const visible = subjects.filter(s => {
    if (filter === 'year1' && s.programYear !== 1) return false
    if (filter === 'year2' && s.programYear !== 2) return false
    if (filter === 'setup' && missingOf(s).length === 0) return false
    if (!q) return true
    return [s.title, s.description, ...(teachersBySubject[s.id] ?? []), ...(s.curriculum ?? []).map(c => c.title)]
      .join(' ').toLowerCase().includes(q)
  })
  const pctOf = (id: string) => { const cp = coverage[id]; return cp ? cp.covered / cp.total : -1 }
  const sorted = sort === 'alpha' ? [...visible].sort((a, b) => a.title.localeCompare(b.title, 'sv'))
    : sort === 'progress' ? [...visible].sort((a, b) => pctOf(b.id) - pctOf(a.id) || a.order - b.order)
    : visible
  // Drag-to-reorder only makes sense on the full list in course order
  const canReorder = sort === 'order' && filter === 'all' && !q
  const groups = sort === 'order'
    ? [1, 2].map(y => ({ key: `y${y}`, title: `Year ${y}`, list: sorted.filter(s => s.programYear === y) })).filter(g => g.list.length > 0)
    : [{ key: 'all', title: '', list: sorted }]

  function dragProps(s: SubjectDoc) {
    if (!canReorder) return {}
    return {
      'data-subject-id': s.id,
      // Only draggable while the grip handle is held — avoids accidental reorders
      draggable: armedId === s.id,
      onDragStart: (e: React.DragEvent) => {
        if (armedId !== s.id) { e.preventDefault(); return }
        e.dataTransfer.effectAllowed = 'move'; setDragId(s.id)
      },
      onDragOver: (e: React.DragEvent) => { e.preventDefault(); if (dragOverId !== s.id) setDragOverId(s.id) },
      onDrop: (e: React.DragEvent) => { e.preventDefault(); handleDrop(s.id) },
      onDragEnd: () => { setDragId(null); setDragOverId(null); setArmedId(null) },
    }
  }

  function grip(s: SubjectDoc) {
    if (!canReorder) return null
    return (
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
        className="p-1.5 rounded-lg flex-shrink-0 cursor-grab active:cursor-grabbing touch-none select-none text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
      >
        <GripVertical className="w-4 h-4" />
      </span>
    )
  }

  function actions(s: SubjectDoc) {
    return (
      <div className="flex items-center gap-0.5 flex-shrink-0">
        <button onClick={e => openEdit(e, s)} title="Edit" className="p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded-lg transition-colors">
          <Pencil className="w-4 h-4" />
        </button>
        <button onClick={e => handleDelete(e, s.id)} disabled={deleting === s.id} title="Delete" className="p-1.5 text-zinc-400 hover:text-rose-400 hover:bg-zinc-800 rounded-lg transition-colors">
          <Trash2 className="w-4 h-4" />
        </button>
        {grip(s)}
      </div>
    )
  }

  function renderCard(s: SubjectDoc) {
    const cp       = coverage[s.id]
    const status   = statusOf(s.id)
    const pct      = cp ? Math.round((cp.covered / cp.total) * 100) : 0
    const topics   = s.curriculum ?? []
    const teachers = teachersBySubject[s.id] ?? []
    const missing  = missingOf(s)
    const badge    = STATUS_BADGE[status]
    const nAssign  = assignmentCount[s.id] ?? 0
    const dropRing = dragOverId === s.id && dragId !== s.id
    const blurb    = s.description || (topics.length > 0 ? `Covers ${topics.slice(0, 4).map(t => t.title).join(', ')}${topics.length > 4 ? '…' : '.'}` : '')
    const href     = `/teacher/subjects/${s.id}`

    if (layout === 'list') {
      return (
        <div
          key={s.id}
          {...dragProps(s)}
          className={cn(
            'group flex items-center gap-3 p-3 rounded-xl bg-zinc-900 border transition-colors',
            dropRing ? 'border-brand-500' : 'border-white/[0.06] hover:border-brand-500/40',
            dragId === s.id && 'opacity-40',
          )}
        >
          <Link to={href} className="flex items-center gap-3 flex-1 min-w-0">
            <SubjectThumb subject={s} className="w-14 h-14 rounded-xl" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <p className="font-display text-sm font-semibold text-zinc-100 truncate group-hover:text-brand-400 transition-colors">{s.title}</p>
                <span className={cn('hidden sm:inline px-1.5 py-0.5 rounded border text-[9px] font-semibold flex-shrink-0', badge.cls)}>{badge.label}</span>
              </div>
              <p className="text-xs text-zinc-500 truncate">
                Year {s.programYear} • {topics.length} topics • {nAssign} assignment{nAssign !== 1 ? 's' : ''}
                {missing.length > 0 && <span className="text-amber-400"> • missing {missing.join(', ')}</span>}
              </p>
            </div>
            <div className="hidden sm:block w-32 flex-shrink-0 space-y-1">
              <div className="h-1.5 rounded-full overflow-hidden bg-zinc-800">
                {cp && cp.covered > 0
                  ? <div className={cn('h-full rounded-full', STATUS_BAR[status])} style={{ width: `${pct}%` }} />
                  : <div className="h-full w-full bg-[repeating-linear-gradient(90deg,#353940_0_6px,transparent_6px_10px)]" />}
              </div>
              <p className="text-[10px] text-zinc-500 text-right font-mono">{cp ? `${cp.covered}/${cp.total} · ${pct}%` : 'No topics'}</p>
            </div>
          </Link>
          {actions(s)}
        </div>
      )
    }

    return (
      <article
        key={s.id}
        {...dragProps(s)}
        className={cn(
          'group flex flex-col justify-between h-full rounded-2xl bg-zinc-900 border overflow-hidden shadow-xl transition-all duration-200 ease-out',
          dropRing
            ? 'border-brand-500 ring-2 ring-brand-500/40'
            : 'border-white/[0.06] hover:-translate-y-[3px] hover:border-brand-500/45 hover:shadow-[0_16px_32px_-8px_rgba(0,0,0,0.65),0_0_20px_-6px_rgba(255,107,53,0.15)]',
          dragId === s.id && 'opacity-40',
        )}
      >
        <Link to={href} className="block">
          {/* Zone 1: 16:9 media header */}
          <div className="relative overflow-hidden">
            <SubjectCover subject={s} className="aspect-video transition-transform duration-500 group-hover:scale-105" />
          </div>
          {/* Zone 2: content & instructors */}
          <div className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <span className="block text-[11px] font-mono text-zinc-500 font-medium truncate">
                  Year {s.programYear} • {topics.length} topic{topics.length !== 1 ? 's' : ''}
                </span>
                <h2 className="font-display text-base font-bold text-white tracking-tight mt-0.5 group-hover:text-brand-400 transition-colors">{s.title}</h2>
              </div>
              <span className={cn('px-2 py-0.5 text-[10px] font-semibold rounded border flex-shrink-0', badge.cls)}>{badge.label}</span>
            </div>
            <p className="text-xs text-zinc-400 mt-2 line-clamp-2 min-h-[2rem]">{blurb}</p>
            <div className="flex items-center gap-2 mt-4 text-[11px] text-zinc-400 min-w-0">
              <UserCheck className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="truncate">{teachers.length > 0 ? teachers.join(', ') : 'No teachers assigned'}</span>
            </div>
          </div>
        </Link>

        {/* Zone 3: progress & actions */}
        <div className="p-5 pt-0">
          <div className="bg-zinc-950/50 rounded-xl p-3 border border-white/[0.05]">
            <div className="flex items-center justify-between text-xs mb-2">
              <span className="font-medium text-zinc-300">Curriculum taught</span>
              <span className={cn('font-mono font-semibold', STATUS_TEXT[status])}>{cp ? `${pct}%` : '—'}</span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-zinc-800 overflow-hidden mb-2">
              {cp && cp.covered > 0
                ? <div className={cn('h-full rounded-full', STATUS_BAR[status])} style={{ width: `${pct}%` }} />
                : <div className="h-full w-full bg-[repeating-linear-gradient(90deg,#353940_0_6px,transparent_6px_10px)]" />}
            </div>
            <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-400 pt-1">
              <span className="whitespace-nowrap">{cp ? `${cp.covered} / ${cp.total} topics` : 'No topics yet'}</span>
              {missing.length > 0 && (
                <span className="flex items-center gap-1 min-w-0 text-amber-400">
                  <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                  <span className="truncate">Missing {missing.join(', ')}</span>
                </span>
              )}
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <Link to={href} className="text-xs font-semibold text-brand-400 hover:text-brand-300 flex items-center gap-1.5 transition-colors">
              Open subject <ArrowRight className="w-3.5 h-3.5" />
            </Link>
            {actions(s)}
          </div>
        </div>
      </article>
    )
  }

  if (loading) return <LoadingSpinner />

  return (
    <div className="space-y-6">
      {/* ── Control header — pinned on desktop while the grid scrolls ── */}
      <section className="lg:sticky lg:top-0 z-10 -mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 -mt-5 pt-5 lg:-mt-8 lg:pt-8 pb-5 bg-[rgba(16,20,26,0.92)] backdrop-blur-md border-b border-white/5 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="page-title">Subjects &amp; Film Curriculum</h1>
              {term?.active && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Term active</span>
              )}
            </div>
            <p className="text-xs text-zinc-400 mt-1 flex items-center gap-2 flex-wrap">
              {term && <><span>{term.label}</span><span className="text-zinc-600">•</span></>}
              <span className="text-zinc-300 font-medium">{subjects.length} course module{subjects.length !== 1 ? 's' : ''}</span>
              <span className="text-zinc-600">•</span>
              <span>Year 1: {counts.year1} · Year 2: {counts.year2}</span>
            </p>
          </div>
          <button onClick={openNew} className="btn-primary py-2 px-4 text-xs self-start sm:self-auto">
            <Plus className="w-4 h-4" /> Add new subject
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3 min-w-0">
          <div className="relative w-full sm:w-72 xl:w-80 flex-shrink-0">
            <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              ref={searchRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') { setQuery(''); e.currentTarget.blur() } }}
              placeholder="Search subjects, topics, teachers…"
              className="input pl-10 pr-14 py-2 rounded-xl bg-zinc-950/60"
            />
            {query
              ? <button onClick={() => setQuery('')} aria-label="Clear search" className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-zinc-500 hover:text-zinc-200"><X className="w-3.5 h-3.5" /></button>
              : <kbd className="hidden sm:block absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-mono text-zinc-400 bg-zinc-800 px-1.5 py-0.5 rounded border border-zinc-700 pointer-events-none">{isMac ? '⌘K' : 'Ctrl K'}</kbd>}
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 -mx-4 px-4 sm:mx-0 sm:px-0 min-w-0 w-full sm:w-auto sm:flex-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {(['all', 'year1', 'year2', 'setup'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  'flex-shrink-0 px-3.5 py-1.5 rounded-lg text-xs font-medium border whitespace-nowrap transition-colors',
                  filter === f
                    ? 'bg-brand-500/15 text-brand-400 border-brand-500/40 shadow-sm'
                    : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:bg-zinc-800 hover:text-zinc-200',
                )}
              >
                {FILTER_LABEL[f]} ({counts[f]})
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 ml-auto flex-shrink-0">
            <label className="flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 rounded-lg pl-2.5 pr-1 py-1">
              <span className="text-[11px] text-zinc-500">Sort:</span>
              <select
                value={sort}
                onChange={e => setSort(e.target.value as Sort)}
                className="bg-transparent text-xs text-zinc-300 font-medium border-0 py-0.5 pl-0.5 pr-1 focus:outline-none cursor-pointer sm:!text-xs"
              >
                <option value="order">Course order</option>
                <option value="progress">By progress</option>
                <option value="alpha">A–Z</option>
              </select>
            </label>
            <div className="flex items-center bg-zinc-900 border border-zinc-800 rounded-lg p-1">
              {(['grid', 'list'] as const).map(l => (
                <button
                  key={l}
                  onClick={() => chooseLayout(l)}
                  aria-label={l === 'grid' ? 'Grid view' : 'List view'}
                  className={cn('p-1.5 rounded transition-colors', layout === l ? 'bg-zinc-800 text-brand-400 shadow-sm' : 'text-zinc-500 hover:text-zinc-200')}
                >
                  {l === 'grid' ? <LayoutGrid className="w-3.5 h-3.5" /> : <List className="w-3.5 h-3.5" />}
                </button>
              ))}
            </div>
          </div>
        </div>
        {!canReorder && subjects.length > 1 && (
          <p className="text-[11px] text-zinc-500 flex items-center gap-1.5">
            <Info className="w-3.5 h-3.5" /> Reordering is available in course order without filters or search.
          </p>
        )}
      </section>

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
      ) : visible.length === 0 ? (
        <div className="rounded-2xl bg-zinc-900/60 py-14 text-center">
          <p className="text-sm text-zinc-400">No subjects match{query ? ` “${query}”` : ''}.</p>
          <button onClick={() => { setQuery(''); setFilter('all') }} className="mt-2 text-xs font-semibold text-brand-300 hover:text-brand-200">Clear filters</button>
        </div>
      ) : (
        groups.map(({ key, title, list }) => (
          <div key={key} className="space-y-3">
            {title && <h2 className="section-title">{title}</h2>}
            <div className={layout === 'grid' ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6' : 'space-y-2'}>
              {list.map(s => renderCard(s))}
            </div>
          </div>
        ))
      )}

      {/* ── Status strip: curriculum taught across all subjects ── */}
      {subjects.length > 0 && (
        <footer className="rounded-2xl border border-white/[0.06] bg-zinc-900/60 px-5 py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-zinc-400">
          <div className="flex items-center gap-x-4 gap-y-2 flex-wrap">
            <span className="flex items-center gap-2 text-zinc-300 font-medium"><span className="w-2 h-2 rounded-full bg-brand-500" />{statusCounts['in-progress']} being taught</span>
            <span className="flex items-center gap-2 text-zinc-300 font-medium"><span className="w-2 h-2 rounded-full bg-emerald-500" />{statusCounts.completed} fully covered</span>
            <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-zinc-600" />{statusCounts['not-started']} not started</span>
            {counts.setup > 0 && (
              <button onClick={() => setFilter(filter === 'setup' ? 'all' : 'setup')} className="flex items-center gap-1.5 text-amber-400 hover:text-amber-300">
                <AlertTriangle className="w-3.5 h-3.5" /> {counts.setup} need setup
              </button>
            )}
          </div>
          {totalCoverage && (
            <div className="flex items-center gap-3 text-[11px]">
              <span className="text-zinc-400">Curriculum taught:</span>
              <div className="w-28 h-2 rounded-full bg-zinc-800 overflow-hidden">
                <div className="h-full bg-brand-500 rounded-full" style={{ width: `${totalCoverage.pct}%` }} />
              </div>
              <span className="font-mono text-zinc-300 font-bold">{totalCoverage.pct}%</span>
              <span className="text-zinc-500">({totalCoverage.covered}/{totalCoverage.total} topics)</span>
            </div>
          )}
        </footer>
      )}
    </div>
  )
}
