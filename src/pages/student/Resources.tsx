import { useMemo, useState } from 'react'
import { useCollection, where } from '@/hooks/useFirestore'
import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import type { TeamResourceDoc, ResourceType, ResourceFolderDoc, AssignmentDoc, LessonDoc } from '@/types'
import {
  FileText, Link2, Video, Youtube, Download, ExternalLink,
  X, Eye, AlertCircle, Plus,
  Folder, FolderOpen, ChevronRight, Search, ClipboardList, BookOpen, FolderPlus,
} from 'lucide-react'

// ── Shared helpers ────────────────────────────────────────────────────────────

type PreviewMode = 'youtube' | 'video' | 'image' | 'pdf' | 'office' | 'link' | 'docs'

function detectMode(type: string, url: string): PreviewMode {
  if (type === 'youtube') return 'youtube'
  if (type === 'video')   return 'video'
  const clean = url.toLowerCase().split('?')[0]
  if (/\.(jpg|jpeg|png|gif|webp|svg)$/.test(clean))         return 'image'
  if (/\.pdf$/.test(clean))                                   return 'pdf'
  if (/\.(docx?|xlsx?|pptx?|odt|ods|odp|csv)$/.test(clean)) return 'office'
  return type === 'link' ? 'link' : 'docs'
}

function youtubeId(url: string) {
  return url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/)?.[1] ?? null
}

function typeIcon(type: string) {
  if (type === 'youtube') return <Youtube  className="w-4 h-4 text-rose-500 flex-shrink-0" />
  if (type === 'video')   return <Video    className="w-4 h-4 text-violet-500 flex-shrink-0" />
  if (type === 'link')    return <Link2    className="w-4 h-4 text-sky-500 flex-shrink-0" />
  return                         <FileText className="w-4 h-4 text-zinc-500 flex-shrink-0" />
}

// ── Preview modal ─────────────────────────────────────────────────────────────

function PreviewContent({ type, url, title }: { type: string; url: string; title: string }) {
  const mode = detectMode(type, url)
  const encodedUrl = encodeURIComponent(url)
  if (mode === 'youtube') {
    const vid = youtubeId(url)
    if (vid) return <iframe className="w-full h-full rounded-xl" src={`https://www.youtube.com/embed/${vid}`} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
  }
  if (mode === 'video')  return <video src={url} controls autoPlay className="w-full h-full rounded-xl object-contain bg-black" />
  if (mode === 'image')  return <div className="w-full h-full flex items-center justify-center bg-zinc-800 rounded-xl overflow-hidden"><img src={url} alt={title} className="max-w-full max-h-full object-contain" /></div>
  if (mode === 'pdf')    return <iframe src={url} className="w-full h-full rounded-xl border-0" title={title} />
  if (mode === 'office') return <iframe src={`https://view.officeapps.live.com/op/embed.aspx?src=${encodedUrl}`} className="w-full h-full rounded-xl border-0" title={title} />
  if (mode === 'docs')   return <iframe src={`https://docs.google.com/viewer?url=${encodedUrl}&embedded=true`} className="w-full h-full rounded-xl border-0" title={title} />
  const isLink = mode === 'link'
  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-4 text-center p-8 bg-zinc-900/50 rounded-xl">
      <AlertCircle className="w-12 h-12 text-zinc-300" />
      <div>
        <p className="text-zinc-300 font-medium">{isLink ? 'Link preview not available' : 'Preview not available'}</p>
        <p className="text-zinc-500 text-sm mt-1">{isLink ? 'External links cannot be embedded.' : 'This file type cannot be previewed.'}</p>
      </div>
      <a href={url} target="_blank" rel="noopener noreferrer" className="btn-primary py-2 px-5 text-sm"><ExternalLink className="w-4 h-4" /> Open in browser</a>
    </div>
  )
}

function PreviewModal({ url, type, title, sourceName, onClose }: { url: string; type: string; title: string; sourceName: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-zinc-900 rounded-2xl shadow-2xl flex flex-col w-full max-w-5xl h-[90vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-white/10 flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {typeIcon(type)}
            <div className="min-w-0">
              <p className="text-sm font-semibold text-zinc-100 truncate">{title}</p>
              <p className="text-xs text-zinc-500">{sourceName}</p>
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <a href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-zinc-400 hover:bg-zinc-800">
              <ExternalLink className="w-4 h-4" /><span className="hidden sm:inline">Open</span>
            </a>
            <a href={url} download className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-zinc-400 hover:bg-zinc-800">
              <Download className="w-4 h-4" /><span className="hidden sm:inline">Download</span>
            </a>
            <button onClick={onClose} className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800 ml-1"><X className="w-5 h-5" /></button>
          </div>
        </div>
        <div className="flex-1 overflow-hidden p-3"><PreviewContent type={type} url={url} title={title} /></div>
      </div>
    </div>
  )
}

// ── Add form ──────────────────────────────────────────────────────────────────

interface AddForm { title: string; url: string; type: ResourceType; description: string }
const EMPTY_ADD_FORM: AddForm = { title: '', url: '', type: 'link', description: '' }

// ── Section component ─────────────────────────────────────────────────────────

interface NewFolderForm { name: string; emoji: string }
const EMPTY_FOLDER_FORM: NewFolderForm = { name: '', emoji: '📁' }
const FOLDER_EMOJIS = ['📁', '🎬', '📷', '🎭', '🖊️', '🎵', '🖼️', '📝', '💡', '🔧', '🎯', '📚']

interface SectionProps {
  cohortId: string | null       // null = course resources (read-only for students)
  allResources: TeamResourceDoc[]
  folders: ResourceFolderDoc[]
  profile: { uid: string } | null
  canAdd: boolean
  preview: { url: string; type: string; title: string; sourceName: string } | null
  setPreview: (p: { url: string; type: string; title: string; sourceName: string } | null) => void
}

function ResourceSection({ cohortId, allResources, folders, profile, canAdd, preview, setPreview }: SectionProps) {
  const [activeFolderId,   setActiveFolderId]   = useState<string | null>(null)
  const [addForm,          setAddForm]          = useState<AddForm | null>(null)
  const [saving,           setSaving]           = useState(false)
  const [saveError,        setSaveError]        = useState<string | null>(null)
  const [saveSuccess,      setSaveSuccess]      = useState(false)
  const [newFolderForm,    setNewFolderForm]    = useState<NewFolderForm | null>(null)
  const [folderSaving,     setFolderSaving]     = useState(false)
  const [folderError,      setFolderError]      = useState<string | null>(null)

  const sectionResources = useMemo(
    () => allResources.filter(r => r.cohortId === cohortId),
    [allResources, cohortId],
  )

  const sortedFolders = useMemo(
    () => [...folders].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name)),
    [folders],
  )

  const activeFolder = sortedFolders.find(f => f.id === activeFolderId) ?? null

  const resourceCountByFolder = useMemo(() => {
    const m: Record<string, number> = {}
    for (const r of sectionResources) if (r.folderId) m[r.folderId] = (m[r.folderId] ?? 0) + 1
    return m
  }, [sectionResources])

  const folderResources = useMemo(
    () => activeFolderId ? sectionResources.filter(r => r.folderId === activeFolderId) : [],
    [sectionResources, activeFolderId],
  )

  async function submitFolder() {
    if (!newFolderForm || !newFolderForm.name.trim() || !profile) return
    setFolderSaving(true)
    setFolderError(null)
    try {
      await addDoc(collection(db, 'resource_folders'), {
        name: newFolderForm.name.trim(),
        emoji: newFolderForm.emoji,
        order: folders.length,
        cohortId: cohortId,
        createdBy: profile.uid,
        createdAt: serverTimestamp(),
      })
      setNewFolderForm(null)
    } catch (err: any) {
      setFolderError(err?.message ?? 'Failed to create folder.')
    } finally {
      setFolderSaving(false)
    }
  }

  async function submitResource() {
    if (!addForm || !addForm.title.trim() || !addForm.url.trim() || !activeFolderId || !profile) return
    setSaving(true)
    setSaveError(null)
    try {
      await addDoc(collection(db, 'team_resources'), {
        title: addForm.title.trim(),
        url: addForm.url.trim(),
        type: addForm.type,
        description: addForm.description.trim(),
        storagePath: null,
        cohortId: cohortId,
        teamIds: null,
        folderId: activeFolderId,
        createdBy: profile.uid,
        createdAt: serverTimestamp(),
      })
      setAddForm(null)
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
    } catch (err: any) {
      setSaveError(err?.message ?? 'Failed to save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      {preview && <PreviewModal {...preview} onClose={() => setPreview(null)} />}
      <div className="space-y-4">
        {activeFolderId === null ? (
          <>
            {/* New folder form */}
            {newFolderForm !== null && (
              <div className="bg-zinc-900 border border-white/10 rounded-2xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-zinc-100">New Folder</p>
                  <button onClick={() => { setNewFolderForm(null); setFolderError(null) }} className="p-1.5 text-zinc-400 hover:text-white rounded-lg"><X className="w-4 h-4" /></button>
                </div>
                <div>
                  <label className="label">Icon</label>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {FOLDER_EMOJIS.map(e => (
                      <button
                        key={e}
                        type="button"
                        onClick={() => setNewFolderForm(f => f && ({ ...f, emoji: e }))}
                        className={`text-xl w-9 h-9 rounded-lg flex items-center justify-center transition-all ${newFolderForm.emoji === e ? 'bg-brand-600 ring-2 ring-brand-400' : 'bg-zinc-800 hover:bg-zinc-700'}`}
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="label">Folder name *</label>
                  <input
                    value={newFolderForm.name}
                    onChange={e => setNewFolderForm(f => f && ({ ...f, name: e.target.value }))}
                    className="input w-full"
                    placeholder="e.g. Scripts, References, B-roll…"
                    autoFocus
                    onKeyDown={e => { if (e.key === 'Enter') submitFolder() }}
                  />
                </div>
                {folderError && <p className="text-sm text-rose-400 bg-rose-950/30 border border-rose-800/40 rounded-xl px-3 py-2">{folderError}</p>}
                <div className="flex gap-2">
                  <button onClick={submitFolder} disabled={folderSaving || !newFolderForm.name.trim()} className="btn-primary py-2 px-4 text-sm">
                    {folderSaving ? 'Creating…' : 'Create Folder'}
                  </button>
                  <button onClick={() => { setNewFolderForm(null); setFolderError(null) }} className="btn-secondary py-2 px-4 text-sm">Cancel</button>
                </div>
              </div>
            )}

            {sortedFolders.length === 0 && !newFolderForm ? (
              <div className="bg-zinc-900 border border-white/10 rounded-2xl p-10 text-center">
                <Folder className="w-10 h-10 text-zinc-500 mx-auto mb-3" />
                <p className="text-zinc-400 text-sm">No folders yet.{canAdd ? ' Create one to get started!' : ''}</p>
                {canAdd && (
                  <button
                    onClick={() => setNewFolderForm({ ...EMPTY_FOLDER_FORM })}
                    className="mt-4 inline-flex items-center gap-2 btn bg-brand-600 text-white hover:bg-brand-500 py-2"
                  >
                    <FolderPlus className="w-4 h-4" /> New Folder
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {sortedFolders.map(f => (
                  <button
                    key={f.id}
                    onClick={() => { setActiveFolderId(f.id); setAddForm(null) }}
                    className="bg-zinc-900 border border-white/10 rounded-2xl p-4 text-left hover:border-brand-500/60 hover:bg-zinc-800/80 transition-all"
                  >
                    <span className="text-2xl block mb-2">{f.emoji}</span>
                    <p className="text-sm font-semibold text-zinc-100 truncate">{f.name}</p>
                    <p className="text-xs text-zinc-400 mt-0.5">{resourceCountByFolder[f.id] ?? 0} resources</p>
                  </button>
                ))}
                {canAdd && !newFolderForm && (
                  <button
                    onClick={() => setNewFolderForm({ ...EMPTY_FOLDER_FORM })}
                    className="bg-zinc-900 border border-dashed border-white/20 rounded-2xl p-4 flex flex-col items-center justify-center gap-2 text-zinc-500 hover:text-zinc-300 hover:border-brand-500/60 hover:bg-zinc-800/80 transition-all"
                  >
                    <FolderPlus className="w-7 h-7" />
                    <p className="text-xs font-medium">New Folder</p>
                  </button>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            {/* Breadcrumb */}
            <div className="flex items-center gap-1.5 text-sm">
              <button onClick={() => { setActiveFolderId(null); setAddForm(null) }} className="text-zinc-400 hover:text-white transition-colors">
                {cohortId ? 'Class Resources' : 'Course Resources'}
              </button>
              <ChevronRight className="w-4 h-4 text-zinc-600" />
              <span className="text-white font-medium">{activeFolder?.emoji} {activeFolder?.name}</span>
            </div>

            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-zinc-400 text-sm">{folderResources.length} resource{folderResources.length !== 1 ? 's' : ''}</p>
              <div className="flex items-center gap-3">
                {saveSuccess && <span className="text-sm text-emerald-400 font-medium">✓ Resource added!</span>}
                {canAdd && (
                  <button
                    onClick={() => { setAddForm({ ...EMPTY_ADD_FORM }); setSaveError(null) }}
                    className="btn bg-brand-600 text-white hover:bg-brand-500 py-2"
                  >
                    <Plus className="w-4 h-4" /> Add Resource
                  </button>
                )}
              </div>
            </div>

            {/* Add form */}
            {addForm && (
              <div className="bg-zinc-900 border border-white/10 rounded-2xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-zinc-100">Add to {activeFolder?.name}</p>
                  <button onClick={() => setAddForm(null)} className="p-1.5 text-zinc-400 hover:text-white rounded-lg"><X className="w-4 h-4" /></button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="label">Title *</label>
                    <input value={addForm.title} onChange={e => setAddForm(f => f && ({ ...f, title: e.target.value }))} className="input w-full" placeholder="Resource title" autoFocus />
                  </div>
                  <div>
                    <label className="label">URL *</label>
                    <input value={addForm.url} onChange={e => setAddForm(f => f && ({ ...f, url: e.target.value }))} className="input w-full" placeholder="https://…" />
                  </div>
                  <div>
                    <label className="label">Type</label>
                    <select value={addForm.type} onChange={e => setAddForm(f => f && ({ ...f, type: e.target.value as ResourceType }))} className="input w-full">
                      <option value="link">Link</option>
                      <option value="file">File</option>
                      <option value="video">Video</option>
                      <option value="youtube">YouTube</option>
                    </select>
                  </div>
                  <div>
                    <label className="label">Description (optional)</label>
                    <input value={addForm.description} onChange={e => setAddForm(f => f && ({ ...f, description: e.target.value }))} className="input w-full" placeholder="Brief description…" />
                  </div>
                </div>
                {saveError && <p className="text-sm text-rose-400 bg-rose-950/30 border border-rose-800/40 rounded-xl px-3 py-2">{saveError}</p>}
                <div className="flex gap-2">
                  <button onClick={submitResource} disabled={saving || !addForm.title.trim() || !addForm.url.trim()} className="btn-primary py-2 px-4 text-sm">
                    {saving ? 'Saving…' : 'Add Resource'}
                  </button>
                  <button onClick={() => { setAddForm(null); setSaveError(null) }} className="btn-secondary py-2 px-4 text-sm">Cancel</button>
                </div>
              </div>
            )}

            {/* Resource list */}
            {folderResources.length === 0 && !addForm ? (
              <div className="bg-zinc-900 border border-white/10 rounded-2xl p-10 text-center">
                <FolderOpen className="w-10 h-10 text-zinc-500 mx-auto mb-3" />
                <p className="text-zinc-400 text-sm">No resources in this folder yet.{canAdd ? ' Be the first to add one!' : ''}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {folderResources.map(r => {
                  const canPreview = detectMode(r.type, r.url) !== 'link'
                  return (
                    <div
                      key={r.id}
                      className="bg-zinc-900 border border-white/10 rounded-xl px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-zinc-800/80 transition-colors"
                      onClick={() => setPreview({ url: r.url, type: r.type, title: r.title, sourceName: activeFolder?.name ?? '' })}
                    >
                      {typeIcon(r.type)}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-zinc-100 truncate">{r.title}</p>
                        {r.description && <p className="text-xs text-zinc-500 mt-0.5 truncate">{r.description}</p>}
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
                        {canPreview && (
                          <button
                            onClick={() => setPreview({ url: r.url, type: r.type, title: r.title, sourceName: activeFolder?.name ?? '' })}
                            className="p-1.5 rounded-lg text-zinc-400 hover:text-brand-400 hover:bg-zinc-800 transition-colors"
                            title="Preview"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                        )}
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800 transition-colors inline-flex"
                          title={r.type === 'file' ? 'Download' : 'Open'}
                        >
                          {r.type === 'file' ? <Download className="w-4 h-4" /> : <ExternalLink className="w-4 h-4" />}
                        </a>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}

// ── Flat resource list (lessons + assignments) ────────────────────────────────

interface FlatResource { key: string; title: string; url: string; type: string; sourceName: string; sourceKind: 'assignment' | 'lesson' }

function typeLabel(type: string) {
  if (type === 'youtube') return 'YouTube'
  if (type === 'video')   return 'Video'
  if (type === 'link')    return 'Link'
  return 'File'
}

function LessonAssignmentResources({
  assignments, lessons, preview, setPreview,
}: {
  assignments: AssignmentDoc[]
  lessons: LessonDoc[]
  preview: { url: string; type: string; title: string; sourceName: string } | null
  setPreview: (p: { url: string; type: string; title: string; sourceName: string } | null) => void
}) {
  const [search, setSearch] = useState('')

  const flat = useMemo<FlatResource[]>(() => {
    const out: FlatResource[] = []
    for (const a of assignments) {
      for (const r of a.resources ?? []) {
        out.push({ key: `a-${a.id}-${r.url}`, title: r.label || r.url, url: r.url, type: r.type, sourceName: a.title, sourceKind: 'assignment' })
      }
    }
    for (const l of lessons) {
      for (const r of l.resources ?? []) {
        out.push({ key: `l-${l.id}-${r.url}`, title: r.label || r.url, url: r.url, type: r.type, sourceName: l.title, sourceKind: 'lesson' })
      }
    }
    return out
  }, [assignments, lessons])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    if (!q) return flat
    return flat.filter(r => r.title.toLowerCase().includes(q) || r.sourceName.toLowerCase().includes(q))
  }, [flat, search])

  if (flat.length === 0) return null

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-zinc-300">From Lessons &amp; Assignments</h3>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search…"
            className="input pl-8 py-1.5 text-sm w-44"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-zinc-500 py-4 text-center">No resources match your search.</p>
      ) : (
        <div className="bg-zinc-900 rounded-2xl border border-white/10 overflow-hidden">
          <table className="w-full min-w-[400px]">
            <thead>
              <tr className="border-b border-white/8">
                <th className="text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider px-5 py-3">Resource</th>
                <th className="text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider px-4 py-3 hidden sm:table-cell">Type</th>
                <th className="text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider px-4 py-3">Source</th>
                <th className="w-20 px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {filtered.map(r => {
                const canPreview = detectMode(r.type, r.url) !== 'link'
                return (
                  <tr key={r.key} className="hover:bg-white/5 transition-colors cursor-pointer" onClick={() => setPreview({ url: r.url, type: r.type, title: r.title, sourceName: r.sourceName })}>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        {typeIcon(r.type)}
                        <span className="text-sm font-medium text-zinc-200 truncate max-w-[200px]">{r.title}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-500 font-medium">{typeLabel(r.type)}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        {r.sourceKind === 'assignment'
                          ? <ClipboardList className="w-3.5 h-3.5 text-brand-400 flex-shrink-0" />
                          : <BookOpen      className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />}
                        <span className="text-sm text-zinc-300 truncate max-w-[140px]">{r.sourceName}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        {canPreview && (
                          <button onClick={() => setPreview({ url: r.url, type: r.type, title: r.title, sourceName: r.sourceName })}
                            className="p-1.5 rounded-lg text-zinc-400 hover:text-brand-400 hover:bg-zinc-800 transition-colors" title="Preview">
                            <Eye className="w-4 h-4" />
                          </button>
                        )}
                        <a href={r.url} target="_blank" rel="noopener noreferrer"
                          className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800 transition-colors inline-flex"
                          title={r.type === 'file' ? 'Download' : 'Open'}>
                          {r.type === 'file' ? <Download className="w-4 h-4" /> : <ExternalLink className="w-4 h-4" />}
                        </a>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function StudentResources() {
  const { cohortId: ctxCohortId, previewCohortId, profile } = useAuth()
  const cohortId = ctxCohortId ?? previewCohortId ?? profile?.cohortId ?? null

  const [activeTab, setActiveTab] = useState<'class' | 'course'>('class')
  const [preview,   setPreview]   = useState<{ url: string; type: string; title: string; sourceName: string } | null>(null)

  const { data: allResources } = useCollection<TeamResourceDoc>('team_resources')
  const { data: folders }      = useCollection<ResourceFolderDoc>('resource_folders')

  const { data: assignments } = useCollection<AssignmentDoc>(
    'assignments',
    cohortId ? [where('cohortId', '==', cohortId), where('isPublished', '==', true)] : [],
    !!cohortId,
    cohortId ?? '',
  )
  const { data: lessons } = useCollection<LessonDoc>(
    'lessons',
    cohortId ? [where('cohortId', '==', cohortId)] : [],
    !!cohortId,
    cohortId ?? '',
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Resources</h1>
        <p className="text-zinc-500 text-sm mt-1">Class and course materials.</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-800/60 p-1 rounded-xl w-fit">
        {([
          ['class',  '🏫 Class Resources'],
          ['course', '📚 Course Resources'],
        ] as [string, string][]).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setActiveTab(id as any)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${activeTab === id ? 'bg-brand-600 text-white' : 'text-zinc-400 hover:text-white'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Class Resources — students can add */}
      {activeTab === 'class' && (
        <ResourceSection
          cohortId={cohortId}
          allResources={allResources}
          folders={folders}
          profile={profile}
          canAdd={true}
          preview={preview}
          setPreview={setPreview}
        />
      )}

      {/* Course Resources — teacher uploads + lesson/assignment resources */}
      {activeTab === 'course' && (
        <div className="space-y-6">
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-zinc-300">Teacher Uploads</h3>
            <p className="text-xs text-zinc-500">Shared with all classes by teachers.</p>
            <ResourceSection
              cohortId={null}
              allResources={allResources}
              folders={folders}
              profile={profile}
              canAdd={false}
              preview={preview}
              setPreview={setPreview}
            />
          </div>
          <LessonAssignmentResources
            assignments={assignments}
            lessons={lessons}
            preview={preview}
            setPreview={setPreview}
          />
        </div>
      )}
    </div>
  )
}
