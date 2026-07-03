import { useState, useMemo, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { doc, updateDoc, addDoc, deleteDoc, collection } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { uploadWithQuota, deleteWithTracking } from '@/lib/uploadWithQuota'
import { useDocument, useCollection, orderBy, where } from '@/hooks/useFirestore'
import type { SubjectDoc, CurriculumItem, SubjectResource, SubjectTeacherDoc, UserDoc, LessonDoc, VideoLabDoc, AbsenceReportDoc } from '@/types'
import { thumbnailUrl } from '@/lib/cloudinary'
import {
  ArrowLeft, Plus, Pencil, Trash2, Check, X,
  Link2, FileUp, ExternalLink, FileText, UserRound, CheckCircle2, Play, Clock, Users,
} from 'lucide-react'
import LoadingSpinner from '@/components/common/LoadingSpinner'
import SharePointBrowser from '@/components/sharepoint/SharePointBrowser'
import { nanoid } from 'nanoid'
import { cn, initials, avatarColor } from '@/lib/utils'

const METHOD_SUGGESTIONS = [
  'Lecture', 'Workshop', 'Lecture + Workshop',
  'Theory test', 'Practical', 'Equipment rundown',
  'Field work', 'Critique',
]

const EMPTY_ITEM: Omit<CurriculumItem, 'id' | 'order'> = {
  semester: 1, title: '', content: '', method: 'Lecture',
}

const EMPTY_TEACHER_FORM = { name: '', title: '', description: '', portfolioUrl: '' }

export default function SubjectDetail() {
  const { id } = useParams<{ id: string }>()
  const { data: subject, loading } = useDocument<SubjectDoc>('subjects', id)
  const { data: teachers } = useCollection<SubjectTeacherDoc>(
    `subjects/${id}/teachers`,
    [orderBy('order', 'asc')],
    !!id,
    id ?? '',
  )
  const { data: teacherUsers } = useCollection<UserDoc>(
    'users',
    [where('role', 'in', ['teacher', 'admin'])],
  )
  const { data: lessons } = useCollection<LessonDoc>(
    'lessons',
    [where('subjectId', '==', id ?? '')],
    !!id,
    id ?? '',
  )
  const { data: subjectVideos } = useCollection<VideoLabDoc>(
    'video_lab',
    id ? [where('subjectId', '==', id), orderBy('createdAt', 'desc')] : [],
    !!id,
    `videos-${id}`,
  )
  const { data: absenceReports } = useCollection<AbsenceReportDoc>('absence_reports')

  // Map: lessonId → [studentName, ...]
  const absenceByLesson = useMemo(() => {
    const m: Record<string, string[]> = {}
    for (const r of absenceReports) {
      if (!r.lessonId) continue
      if (!m[r.lessonId]) m[r.lessonId] = []
      m[r.lessonId].push(r.studentName)
    }
    return m
  }, [absenceReports])

  function showAbsentsForItem(item: CurriculumItem) {
    const coveringLessons = lessons.filter(l => l.coveredCurriculumIds?.includes(item.id))
    const names = new Set<string>()
    for (const l of coveringLessons) {
      for (const name of (absenceByLesson[l.id] ?? [])) names.add(name)
    }
    setAbsentModal({ itemTitle: item.title, names: Array.from(names).sort() })
  }

  // ── Curriculum state ────────────────────────────────────────────────────────
  const [editingId, setEditingId] = useState<string | null>(null)
  const [addingSem, setAddingSem] = useState<number | null>(null)
  const [itemForm,  setItemForm]  = useState<Omit<CurriculumItem, 'id' | 'order'>>(EMPTY_ITEM)

  // ── Resource state ──────────────────────────────────────────────────────────
  const [addingRes,    setAddingRes]    = useState<'link' | 'file' | null>(null)
  const [resTitle,     setResTitle]     = useState('')
  const [resUrl,       setResUrl]       = useState('')
  const [resFile,      setResFile]      = useState<File | null>(null)
  const [deletingRes,  setDeletingRes]  = useState<string | null>(null)
  const [resError,     setResError]     = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // ── Teacher state ───────────────────────────────────────────────────────────
  const [teacherPanel,    setTeacherPanel]    = useState<'add' | { id: string } | null>(null)
  const [teacherMode,     setTeacherMode]     = useState<'existing' | 'guest'>('existing')
  const [selectedUserId,  setSelectedUserId]  = useState('')
  const [teacherForm,     setTeacherForm]     = useState(EMPTY_TEACHER_FORM)
  const [teacherImg,      setTeacherImg]      = useState<File | null>(null)
  const [imgPreviewUrl,   setImgPreviewUrl]   = useState<string | null>(null)
  const [teacherSaving,   setTeacherSaving]   = useState(false)
  const [teacherError,    setTeacherError]    = useState<string | null>(null)
  const teacherImgRef = useRef<HTMLInputElement>(null)

  const [saving, setSaving] = useState(false)
  const [absentModal, setAbsentModal] = useState<{ itemTitle: string; names: string[] } | null>(null)

  const curriculum: CurriculumItem[] = useMemo(
    () => [...(subject?.curriculum ?? [])].sort((a, b) => a.order - b.order),
    [subject],
  )
  const resources: SubjectResource[] = subject?.resources ?? []

  const semesters = useMemo(() => {
    const nums = curriculum.map(i => i.semester)
    const set = Array.from(new Set(nums)).sort((a, b) => a - b)
    return set.length ? set : [1]
  }, [curriculum])

  // For each curriculum item: which lessons cover it, split by past/future
  const itemLessonMap = useMemo(() => {
    const now = new Date()
    const map: Record<string, { completed: boolean; plannedDate: Date | null }> = {}
    for (const l of lessons) {
      const d = l.startTime?.toDate?.()
      if (!d) continue
      const isPast = d <= now
      for (const cid of (l.coveredCurriculumIds ?? [])) {
        const existing = map[cid]
        if (!existing) {
          map[cid] = { completed: isPast, plannedDate: isPast ? null : d }
        } else {
          if (isPast) existing.completed = true
          else if (!existing.plannedDate || d < existing.plannedDate) existing.plannedDate = d
        }
      }
    }
    return map
  }, [lessons])

  const coveredIds   = useMemo(() => new Set(Object.keys(itemLessonMap).filter(k => itemLessonMap[k].completed)), [itemLessonMap])
  const currProgress = curriculum.length > 0 ? Math.round((coveredIds.size / curriculum.length) * 100) : 0

  // ── Curriculum helpers ──────────────────────────────────────────────────────

  async function saveCurriculum(next: CurriculumItem[]) {
    if (!id) return
    setSaving(true)
    await updateDoc(doc(db, 'subjects', id), { curriculum: next })
    setSaving(false)
  }

  async function saveResources(next: SubjectResource[]) {
    if (!id) return
    setSaving(true)
    try {
      await updateDoc(doc(db, 'subjects', id), { resources: next })
    } catch (e: any) {
      setResError(e?.message ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  function startAdd(semester: number) {
    setAddingSem(semester); setEditingId(null)
    setItemForm({ ...EMPTY_ITEM, semester })
  }

  async function confirmAdd() {
    if (!itemForm.title.trim()) return
    const forSem = curriculum.filter(i => i.semester === addingSem)
    const newItem: CurriculumItem = {
      id: nanoid(),
      order: forSem.length ? Math.max(...forSem.map(i => i.order)) + 1 : curriculum.length,
      ...itemForm,
    }
    await saveCurriculum([...curriculum, newItem])
    setAddingSem(null)
  }

  function startEdit(item: CurriculumItem) {
    setEditingId(item.id); setAddingSem(null)
    setItemForm({ semester: item.semester, title: item.title, content: item.content, method: item.method })
  }

  async function confirmEdit() {
    if (!editingId || !itemForm.title.trim()) return
    await saveCurriculum(curriculum.map(i => i.id === editingId ? { ...i, ...itemForm } : i))
    setEditingId(null)
  }

  async function deleteItem(itemId: string) {
    if (!confirm('Remove this curriculum item?')) return
    await saveCurriculum(curriculum.filter(i => i.id !== itemId))
  }

  function addSemester() {
    startAdd(semesters.length ? Math.max(...semesters) + 1 : 1)
  }

  // ── Resource helpers ────────────────────────────────────────────────────────

  function openAddLink()   { setAddingRes('link');  setResTitle(''); setResUrl('');  setResError(null) }
  function openAddFile()   { setAddingRes('file');  setResTitle(''); setResFile(null); setResError(null) }
  function cancelAddRes()  { setAddingRes(null); setResError(null) }

  async function confirmAddLink() {
    if (!resTitle.trim() || !resUrl.trim()) return
    const resource: SubjectResource = {
      id: nanoid(), type: 'link', title: resTitle.trim(),
      url: resUrl.trim().startsWith('http') ? resUrl.trim() : `https://${resUrl.trim()}`,
      storagePath: null,
    }
    await saveResources([...resources, resource])
    setAddingRes(null)
  }

  async function confirmAddFile() {
    if (!resTitle.trim() || !resFile) return
    setSaving(true)
    setResError(null)
    const storagePath = `resources/subjects/${id}/${Date.now()}_${resFile.name}`
    try {
      const url = await uploadWithQuota(resFile, storagePath)
      const resource: SubjectResource = { id: nanoid(), type: 'file', title: resTitle.trim(), url, storagePath }
      await saveResources([...resources, resource])
      setAddingRes(null)
    } catch (e: any) {
      setResError(e?.message ?? 'Upload failed')
    } finally {
      setSaving(false)
    }
  }

  async function deleteResource(res: SubjectResource) {
    if (!confirm('Remove this resource?')) return
    setDeletingRes(res.id)
    if (res.storagePath) {
      try { await deleteWithTracking(res.storagePath) } catch {}
    }
    await saveResources(resources.filter(r => r.id !== res.id))
    setDeletingRes(null)
  }

  // ── Teacher helpers ─────────────────────────────────────────────────────────

  function openAddTeacher() {
    setTeacherPanel('add')
    setTeacherMode('existing')
    setSelectedUserId('')
    setTeacherForm(EMPTY_TEACHER_FORM)
    setTeacherImg(null)
    setImgPreviewUrl(null)
    setTeacherError(null)
  }

  function openEditTeacher(t: SubjectTeacherDoc) {
    setTeacherPanel({ id: t.id })
    setTeacherMode(t.isGuest ? 'guest' : 'existing')
    setSelectedUserId(t.userId ?? '')
    setTeacherForm({
      name: t.name,
      title: t.title,
      description: t.description,
      portfolioUrl: t.portfolioUrl ?? '',
    })
    setTeacherImg(null)
    setImgPreviewUrl(t.imageUrl)
    setTeacherError(null)
  }

  function cancelTeacher() {
    setTeacherPanel(null)
    setTeacherError(null)
  }

  function onSelectUser(userId: string) {
    setSelectedUserId(userId)
    if (!userId) {
      setTeacherForm(EMPTY_TEACHER_FORM)
      setImgPreviewUrl(null)
      return
    }
    const user = teacherUsers.find(u => u.id === userId)
    if (user) {
      setTeacherForm(f => ({
        ...f,
        name: user.displayName,
        description: (user as any).bio ?? '',
        portfolioUrl: (user as any).portfolioUrl ?? '',
      }))
      setTeacherImg(null)
      setImgPreviewUrl(user.avatarUrl)
    }
  }

  function onPickImage(file: File) {
    setTeacherImg(file)
    setImgPreviewUrl(URL.createObjectURL(file))
  }

  async function saveTeacher() {
    if (!id) return
    if (teacherMode === 'existing' && !selectedUserId) { setTeacherError('Select a teacher'); return }
    if (!teacherForm.name.trim()) { setTeacherError('Name is required'); return }

    setTeacherSaving(true); setTeacherError(null)
    try {
      let imageUrl: string | null = imgPreviewUrl
      let storagePath: string | null = null

      if (teacherImg) {
        storagePath = `resources/subjects/${id}/teachers/${Date.now()}_${teacherImg.name}`
        imageUrl = await uploadWithQuota(teacherImg, storagePath)
      }

      const isEditing = teacherPanel !== 'add' && teacherPanel !== null

      if (!isEditing) {
        const user = teacherMode === 'existing' ? teacherUsers.find(u => u.id === selectedUserId) : null
        const payload: Omit<SubjectTeacherDoc, 'id'> = {
          userId:       teacherMode === 'existing' ? selectedUserId : null,
          name:         teacherForm.name.trim(),
          title:        teacherForm.title.trim(),
          description:  teacherForm.description.trim(),
          portfolioUrl: teacherForm.portfolioUrl.trim() || null,
          imageUrl:     teacherImg ? imageUrl : (user?.avatarUrl ?? null),
          storagePath:  teacherImg ? storagePath : null,
          isGuest:      teacherMode === 'guest',
          order:        teachers.length,
        }
        await addDoc(collection(db, `subjects/${id}/teachers`), payload)
      } else {
        const existing = teachers.find(t => t.id === (teacherPanel as { id: string }).id)
        if (teacherImg && existing?.storagePath) {
          try { await deleteWithTracking(existing.storagePath) } catch {}
        }
        const user = teacherMode === 'existing' ? teacherUsers.find(u => u.id === selectedUserId) : null
        const update: Partial<SubjectTeacherDoc> = {
          userId:       teacherMode === 'existing' ? selectedUserId : null,
          name:         teacherForm.name.trim(),
          title:        teacherForm.title.trim(),
          description:  teacherForm.description.trim(),
          portfolioUrl: teacherForm.portfolioUrl.trim() || null,
          isGuest:      teacherMode === 'guest',
        }
        if (teacherImg) {
          update.imageUrl     = imageUrl
          update.storagePath  = storagePath
        } else if (!existing?.imageUrl && user?.avatarUrl) {
          update.imageUrl = user.avatarUrl
        }
        await updateDoc(doc(db, `subjects/${id}/teachers`, (teacherPanel as { id: string }).id), update)
      }
      cancelTeacher()
    } catch (e: any) {
      setTeacherError(e?.message ?? 'Save failed')
    } finally {
      setTeacherSaving(false)
    }
  }

  async function deleteTeacher(t: SubjectTeacherDoc) {
    if (!id || !confirm('Remove this teacher?')) return
    if (t.storagePath) {
      try { await deleteWithTracking(t.storagePath) } catch {}
    }
    await deleteDoc(doc(db, `subjects/${id}/teachers`, t.id))
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) return <LoadingSpinner />
  if (!subject) return (
    <div className="text-center py-20 text-zinc-400">
      Subject not found. <Link to="/teacher/subjects" className="text-brand-400 underline">Go back</Link>
    </div>
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Link to="/teacher/subjects" className="mt-1 p-2 text-zinc-500 hover:text-zinc-100 hover:bg-zinc-700 rounded-xl transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <span className="text-3xl">{subject.iconEmoji}</span>
            <div>
              <h1 className="page-title">{subject.title}</h1>
              <p className="text-zinc-500 text-sm mt-0.5">{subject.description}</p>
            </div>
          </div>
        </div>
        <button onClick={addSemester} className="btn-primary py-2.5 flex-shrink-0">
          <Plus className="w-4 h-4" /> Add semester
        </button>
      </div>

      {/* ── Curriculum ─────────────────────────────────────────────────────── */}
      {curriculum.length > 0 && (
        <div className="bg-zinc-900 rounded-2xl border border-white/10 shadow-sm px-5 py-4">
          <div className="flex justify-between text-sm mb-2">
            <span className="font-semibold text-zinc-300">Curriculum progress</span>
            <span className="text-zinc-500">{coveredIds.size} / {curriculum.length} topics covered · <span className="font-medium text-zinc-300">{currProgress}%</span></span>
          </div>
          <div className="h-3 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${subject.color}`}
              style={{ width: `${currProgress}%` }}
            />
          </div>
        </div>
      )}

      {semesters.map(sem => {
        const items = curriculum.filter(i => i.semester === sem).sort((a, b) => a.order - b.order)
        return (
          <div key={sem} className="bg-zinc-900 rounded-2xl overflow-hidden border border-white/10 shadow-sm">
            <div className={`flex items-center justify-between px-5 py-3 ${subject.color}`}>
              <h2 className="text-sm font-bold text-white tracking-wide">Semester {sem}</h2>
              <button onClick={() => startAdd(sem)} className="flex items-center gap-1 text-xs text-white/80 hover:text-white transition-colors">
                <Plus className="w-3.5 h-3.5" /> Add item
              </button>
            </div>
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/8">
                  <th className="w-8 px-4 py-2.5" />
                  <th className="text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider px-4 py-2.5 w-1/4">Course / Topic</th>
                  <th className="text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider px-4 py-2.5">Content</th>
                  <th className="text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider px-4 py-2.5 w-36">How</th>
                  <th className="w-16 px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map(item => {
                  const status = itemLessonMap[item.id]
                  const completed = status?.completed ?? false
                  const plannedDate = (!completed && status?.plannedDate) ? status.plannedDate : null
                  return editingId === item.id ? (
                    <tr key={item.id} className="bg-brand-50">
                      <td className="px-4 py-2" />
                      <td className="px-4 py-2"><input autoFocus className="input py-1.5 text-sm" value={itemForm.title} onChange={e => setItemForm(f => ({ ...f, title: e.target.value }))} placeholder="Topic name" /></td>
                      <td className="px-4 py-2"><input className="input py-1.5 text-sm" value={itemForm.content} onChange={e => setItemForm(f => ({ ...f, content: e.target.value }))} placeholder="What is covered" /></td>
                      <td className="px-4 py-2"><input className="input py-1.5 text-sm" value={itemForm.method} onChange={e => setItemForm(f => ({ ...f, method: e.target.value }))} list="method-options" placeholder="Lecture" /></td>
                      <td className="px-4 py-2"><div className="flex gap-1">
                        <button onClick={confirmEdit} disabled={saving} className="p-1.5 text-emerald-500 hover:text-emerald-600 transition-colors"><Check className="w-4 h-4" /></button>
                        <button onClick={() => setEditingId(null)} className="p-1.5 text-zinc-400 hover:text-zinc-400 transition-colors"><X className="w-4 h-4" /></button>
                      </div></td>
                    </tr>
                  ) : (
                    <tr key={item.id} className={`group hover:bg-white/5 transition-colors ${completed ? 'bg-emerald-50/40' : ''}`}>
                      <td className="px-4 py-3 text-center">
                        {completed
                          ? <CheckCircle2 className="w-4 h-4 text-emerald-500 mx-auto" />
                          : plannedDate
                            ? <span className="inline-block w-2 h-2 rounded-full bg-amber-400 mx-auto" title="Planned" />
                            : null
                        }
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-sm font-medium ${completed ? 'text-emerald-300' : 'text-zinc-100'}`}>{item.title}</span>
                        {plannedDate && (
                          <p className="text-xs text-amber-600 mt-0.5">
                            Planned: {plannedDate.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-zinc-400">{item.content}</td>
                      <td className="px-4 py-3"><span className="text-xs bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded-full">{item.method}</span></td>
                      <td className="px-4 py-3"><div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {completed && (
                          <button
                            onClick={() => showAbsentsForItem(item)}
                            className="p-1.5 text-zinc-400 hover:text-amber-600 transition-colors"
                            title="See who was absent"
                          >
                            <Users className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button onClick={() => startEdit(item)} className="p-1.5 text-zinc-400 hover:text-zinc-300 transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
                        <button onClick={() => deleteItem(item.id)} className="p-1.5 text-zinc-400 hover:text-rose-500 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div></td>
                    </tr>
                  )
                })}

                {addingSem === sem && (
                  <tr className="bg-brand-50">
                    <td className="px-4 py-2"><input autoFocus className="input py-1.5 text-sm" value={itemForm.title} onChange={e => setItemForm(f => ({ ...f, title: e.target.value }))} placeholder="Topic name" onKeyDown={e => e.key === 'Enter' && confirmAdd()} /></td>
                    <td className="px-4 py-2"><input className="input py-1.5 text-sm" value={itemForm.content} onChange={e => setItemForm(f => ({ ...f, content: e.target.value }))} placeholder="What is covered" onKeyDown={e => e.key === 'Enter' && confirmAdd()} /></td>
                    <td className="px-4 py-2"><input className="input py-1.5 text-sm" value={itemForm.method} onChange={e => setItemForm(f => ({ ...f, method: e.target.value }))} list="method-options" placeholder="Lecture" onKeyDown={e => e.key === 'Enter' && confirmAdd()} /></td>
                    <td className="px-4 py-2"><div className="flex gap-1">
                      <button onClick={confirmAdd} disabled={saving || !itemForm.title.trim()} className="p-1.5 text-emerald-500 hover:text-emerald-600 transition-colors"><Check className="w-4 h-4" /></button>
                      <button onClick={() => setAddingSem(null)} className="p-1.5 text-zinc-400 hover:text-zinc-400 transition-colors"><X className="w-4 h-4" /></button>
                    </div></td>
                  </tr>
                )}

                {items.length === 0 && addingSem !== sem && (
                  <tr><td colSpan={4} className="px-5 py-4 text-sm text-zinc-400 text-center">No items yet — click "Add item" to start.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )
      })}

      {semesters.length === 0 && addingSem === null && (
        <div className="text-center py-16 text-zinc-400">
          <p className="text-sm">No curriculum yet.</p>
          <button onClick={() => startAdd(1)} className="mt-3 btn-primary py-2"><Plus className="w-4 h-4" /> Add first semester</button>
        </div>
      )}

      {/* ── Resources ──────────────────────────────────────────────────────── */}
      <div className="bg-zinc-900 rounded-2xl border border-white/10 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/8">
          <h2 className="text-base font-semibold text-zinc-100">Resources</h2>
          <div className="flex gap-2">
            <button onClick={openAddLink} className="btn-secondary py-1.5 text-xs gap-1.5">
              <Link2 className="w-3.5 h-3.5" /> Add link
            </button>
            <button onClick={openAddFile} className="btn-secondary py-1.5 text-xs gap-1.5">
              <FileUp className="w-3.5 h-3.5" /> Upload file
            </button>
          </div>
        </div>

        {resError && (
          <div className="px-5 py-2 bg-rose-950/40 border-b border-rose-800/50 text-xs text-rose-400">{resError}</div>
        )}

        {addingRes === 'link' && (
          <div className="px-5 py-4 bg-zinc-900/50 border-b border-white/8 flex items-end gap-3">
            <div className="flex-1">
              <label className="label text-xs">Title</label>
              <input autoFocus className="input py-2 text-sm" value={resTitle} onChange={e => setResTitle(e.target.value)} placeholder="e.g. Course slides" />
            </div>
            <div className="flex-1">
              <label className="label text-xs">URL</label>
              <input className="input py-2 text-sm" value={resUrl} onChange={e => setResUrl(e.target.value)} placeholder="https://…" />
            </div>
            <button onClick={confirmAddLink} disabled={!resTitle.trim() || !resUrl.trim() || saving} className="btn-primary py-2">Save</button>
            <button onClick={cancelAddRes} className="btn-ghost py-2"><X className="w-4 h-4" /></button>
          </div>
        )}

        {addingRes === 'file' && (
          <div className="px-5 py-4 bg-zinc-900/50 border-b border-white/8 flex items-end gap-3">
            <div className="flex-1">
              <label className="label text-xs">Title</label>
              <input autoFocus className="input py-2 text-sm" value={resTitle} onChange={e => setResTitle(e.target.value)} placeholder="e.g. Week 3 handout" />
            </div>
            <div className="flex-1">
              <label className="label text-xs">File</label>
              <button type="button" onClick={() => fileRef.current?.click()} className="input py-2 text-sm text-left text-zinc-500 cursor-pointer">
                {resFile ? resFile.name : 'Choose file…'}
              </button>
              <input ref={fileRef} type="file" className="hidden" onChange={e => setResFile(e.target.files?.[0] ?? null)} />
            </div>
            <button onClick={confirmAddFile} disabled={!resTitle.trim() || !resFile || saving} className="btn-primary py-2">{saving ? 'Uploading…' : 'Upload'}</button>
            <button onClick={cancelAddRes} className="btn-ghost py-2"><X className="w-4 h-4" /></button>
          </div>
        )}

        {resources.length === 0 && addingRes === null ? (
          <p className="px-5 py-6 text-sm text-zinc-400 text-center">No resources yet. Add a link or upload a file above.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {resources.map(res => (
              <li key={res.id} className="flex items-center gap-3 px-5 py-3 hover:bg-white/5 transition-colors group">
                {res.type === 'link'
                  ? <Link2 className="w-4 h-4 text-brand-500 flex-shrink-0" />
                  : <FileText className="w-4 h-4 text-amber-500 flex-shrink-0" />
                }
                <a href={res.url} target="_blank" rel="noopener noreferrer" className="flex-1 text-sm font-medium text-zinc-200 hover:text-brand-600 transition-colors flex items-center gap-1.5 min-w-0">
                  <span className="truncate">{res.title}</span>
                  <ExternalLink className="w-3.5 h-3.5 flex-shrink-0 opacity-50" />
                </a>
                <button
                  onClick={() => deleteResource(res)}
                  disabled={deletingRes === res.id}
                  className="p-1.5 text-zinc-300 hover:text-rose-500 transition-colors opacity-0 group-hover:opacity-100"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── Teachers ───────────────────────────────────────────────────────── */}
      <div className="bg-zinc-900 rounded-2xl border border-white/10 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/8">
          <h2 className="text-base font-semibold text-zinc-100">Teachers</h2>
          {!teacherPanel && (
            <button onClick={openAddTeacher} className="btn-secondary py-1.5 text-xs gap-1.5">
              <Plus className="w-3.5 h-3.5" /> Add teacher
            </button>
          )}
        </div>

        {/* Add / edit form */}
        {teacherPanel !== null && (
          <div className="px-5 py-5 bg-zinc-900/50 border-b border-white/8 space-y-4">
            {/* Mode toggle */}
            <div className="flex gap-1 bg-zinc-900 border border-white/10 rounded-xl p-1 w-fit">
              <button
                type="button"
                onClick={() => { setTeacherMode('existing'); setSelectedUserId(''); setTeacherForm(EMPTY_TEACHER_FORM); setImgPreviewUrl(null) }}
                className={cn('px-3 py-1.5 rounded-lg text-sm font-medium transition-all', teacherMode === 'existing' ? 'bg-brand-600 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300')}
              >
                Existing teacher
              </button>
              <button
                type="button"
                onClick={() => { setTeacherMode('guest'); setSelectedUserId('') }}
                className={cn('px-3 py-1.5 rounded-lg text-sm font-medium transition-all', teacherMode === 'guest' ? 'bg-brand-600 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300')}
              >
                Guest teacher
              </button>
            </div>

            {/* Existing teacher picker */}
            {teacherMode === 'existing' && (
              <div>
                <label className="label text-xs">Select teacher</label>
                <select
                  value={selectedUserId}
                  onChange={e => onSelectUser(e.target.value)}
                  className="input"
                >
                  <option value="">Choose a teacher…</option>
                  {teacherUsers.map(u => (
                    <option key={u.id} value={u.id}>{u.displayName}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Fields (shown after selecting user, or always for guest) */}
            {(teacherMode === 'guest' || selectedUserId) && (
              <>
                {/* Preview + photo picker */}
                <div className="flex items-center gap-4">
                  <div className="relative group flex-shrink-0">
                    {imgPreviewUrl ? (
                      <img src={imgPreviewUrl} alt="" className="w-16 h-16 rounded-full object-cover" />
                    ) : (
                      <div className={cn('w-16 h-16 rounded-full flex items-center justify-center text-white text-lg font-bold',
                        teacherForm.name ? avatarColor(teacherForm.name) : 'bg-zinc-700',
                      )}>
                        {teacherForm.name ? initials(teacherForm.name) : <UserRound className="w-7 h-7 text-zinc-400" />}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => teacherImgRef.current?.click()}
                      className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <FileUp className="w-4 h-4 text-white" />
                    </button>
                    <input ref={teacherImgRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onPickImage(f) }} />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-zinc-500">Click the photo to upload a custom image.</p>
                    {teacherMode === 'existing' && !teacherImg && <p className="text-xs text-zinc-400 mt-0.5">Using profile photo by default.</p>}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label text-xs">Name</label>
                    <input
                      className="input py-2 text-sm"
                      value={teacherForm.name}
                      onChange={e => setTeacherForm(f => ({ ...f, name: e.target.value }))}
                      placeholder="Full name"
                      readOnly={teacherMode === 'existing'}
                    />
                  </div>
                  <div>
                    <label className="label text-xs">Work title</label>
                    <input
                      className="input py-2 text-sm"
                      value={teacherForm.title}
                      onChange={e => setTeacherForm(f => ({ ...f, title: e.target.value }))}
                      placeholder="e.g. Senior Cinematographer"
                    />
                  </div>
                </div>

                <div>
                  <label className="label text-xs">Description</label>
                  <textarea
                    rows={2}
                    className="input py-2 text-sm resize-none"
                    value={teacherForm.description}
                    onChange={e => setTeacherForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="Short bio…"
                  />
                </div>

                <div>
                  <label className="label text-xs">Portfolio link <span className="text-zinc-400 font-normal">(optional)</span></label>
                  <input
                    className="input py-2 text-sm"
                    value={teacherForm.portfolioUrl}
                    onChange={e => setTeacherForm(f => ({ ...f, portfolioUrl: e.target.value }))}
                    placeholder="https://…"
                  />
                </div>

                {teacherError && <p className="text-xs text-rose-500">{teacherError}</p>}

                <div className="flex gap-2">
                  <button onClick={saveTeacher} disabled={teacherSaving} className="btn-primary py-2">
                    {teacherSaving ? 'Saving…' : 'Save'}
                  </button>
                  <button onClick={cancelTeacher} className="btn-ghost py-2"><X className="w-4 h-4" /></button>
                </div>
              </>
            )}

            {teacherMode === 'existing' && !selectedUserId && (
              <button onClick={cancelTeacher} className="btn-ghost py-2 text-sm"><X className="w-4 h-4" /> Cancel</button>
            )}
          </div>
        )}

        {/* Teacher list */}
        {teachers.length === 0 && !teacherPanel ? (
          <p className="px-5 py-6 text-sm text-zinc-400 text-center">No teachers added yet.</p>
        ) : (
          <div className="p-6 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-6">
            {teachers.map(t => (
              <div key={t.id} className="flex flex-col items-center text-center gap-3 group relative">
                <div className="relative">
                  {t.imageUrl ? (
                    <img src={t.imageUrl} alt={t.name} className="w-32 h-32 rounded-full object-cover ring-4 ring-white shadow-md" />
                  ) : (
                    <div className={cn('w-32 h-32 rounded-full flex items-center justify-center text-white text-2xl font-bold ring-4 ring-white shadow-md', avatarColor(t.name))}>
                      {initials(t.name)}
                    </div>
                  )}
                  <div className="absolute -top-1 -right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => openEditTeacher(t)} className="p-1.5 bg-zinc-900 rounded-full shadow text-zinc-400 hover:text-zinc-300 transition-colors"><Pencil className="w-3 h-3" /></button>
                    <button onClick={() => deleteTeacher(t)} className="p-1.5 bg-zinc-900 rounded-full shadow text-zinc-400 hover:text-rose-500 transition-colors"><Trash2 className="w-3 h-3" /></button>
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-center gap-1.5 flex-wrap">
                    <span className="font-semibold text-sm text-zinc-100">{t.name}</span>
                    {t.isGuest && <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">Guest</span>}
                  </div>
                  {t.title && <p className="text-xs text-brand-600 font-medium mt-0.5">{t.title}</p>}
                  {t.description && <p className="text-xs text-zinc-500 mt-1 leading-relaxed">{t.description}</p>}
                  {t.portfolioUrl && (
                    <a href={t.portfolioUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-brand-500 hover:underline mt-1.5">
                      Portfolio <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Subject Videos */}
      {subjectVideos.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-base font-semibold text-zinc-100">Videos</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {subjectVideos.map(video => (
              <Link
                key={video.id}
                to={`/teacher/video-lab/${video.id}`}
                className="group bg-zinc-900 rounded-2xl border border-white/10 overflow-hidden shadow-sm hover:shadow-card-hover hover:-translate-y-0.5 transition-all"
              >
                <div className="relative aspect-video bg-slate-900 overflow-hidden">
                  <img src={thumbnailUrl(video.cloudinaryPublicId)} alt={video.title} className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity" loading="lazy" />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="w-10 h-10 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
                      <Play className="w-4 h-4 text-zinc-100 ml-0.5" />
                    </div>
                  </div>
                  {video.duration > 0 && (
                    <div className="absolute bottom-2 right-2 bg-black/70 text-white text-[10px] font-mono px-1.5 py-0.5 rounded flex items-center gap-0.5">
                      <Clock className="w-2.5 h-2.5" />{Math.floor(video.duration/60)}:{String(video.duration%60).padStart(2,'0')}
                    </div>
                  )}
                </div>
                <div className="px-3 py-2.5">
                  <p className="text-sm font-medium text-zinc-100 line-clamp-1">{video.title}</p>
                  <p className="text-xs text-zinc-400 mt-0.5">{video.uploaderName}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* SharePoint shared files */}
      <div className="space-y-2">
        <h2 className="text-base font-semibold text-zinc-100">Shared Files (SharePoint)</h2>
        <p className="text-xs text-zinc-400">Files uploaded here are visible to all students in this subject.</p>
        <SharePointBrowser
          subPath={`Resources/${id}`}
          canDelete={true}
          canUpload={true}
          title="Subject Files"
        />
      </div>

      <datalist id="method-options">
        {METHOD_SUGGESTIONS.map(m => <option key={m} value={m} />)}
      </datalist>

      {/* Absent students modal */}
      {absentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          onClick={e => { if (e.target === e.currentTarget) setAbsentModal(null) }}>
          <div className="bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/8">
              <div>
                <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Absent during</p>
                <p className="text-sm font-bold text-zinc-100 mt-0.5">{absentModal.itemTitle}</p>
              </div>
              <button onClick={() => setAbsentModal(null)} className="p-1.5 text-zinc-400 hover:text-zinc-300 rounded-lg hover:bg-zinc-800">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-5 py-4">
              {absentModal.names.length === 0 ? (
                <p className="text-sm text-zinc-400 text-center py-4">No absence reports for this curriculum item.</p>
              ) : (
                <ul className="space-y-2">
                  {absentModal.names.map(name => (
                    <li key={name} className="flex items-center gap-2 text-sm text-zinc-300">
                      <Users className="w-3.5 h-3.5 text-rose-400 flex-shrink-0" />
                      {name}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
