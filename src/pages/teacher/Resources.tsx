import { useMemo, useState } from 'react'
import { useCollection, where } from '@/hooks/useFirestore'
import { addDoc, collection, deleteDoc, doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import type { CohortDoc, TeamResourceDoc, ResourceType, ResourceFolderDoc } from '@/types'
import {
  FileText, Link2, Video, Youtube, Download, ExternalLink,
  X, Eye, AlertCircle, Plus, Pencil, Trash2,
  Folder, FolderOpen, ChevronRight, Users, GraduationCap,
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

function typeLabel(type: string) {
  if (type === 'youtube') return 'YouTube'
  if (type === 'video')   return 'Video'
  if (type === 'link')    return 'Link'
  return 'File'
}

const FOLDER_EMOJIS = ['📁', '🎬', '📷', '🎞️', '🎨', '📚', '🎙️', '💡', '🎭', '🔊', '📝', '🛠️']

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

// ── Forms ─────────────────────────────────────────────────────────────────────

interface ResourceForm { id: string | null; title: string; url: string; type: ResourceType; description: string; folderId: string }
interface FolderForm   { id: string | null; name: string; emoji: string }

const EMPTY_FORM:        ResourceForm = { id: null, title: '', url: '', type: 'link', description: '', folderId: '' }
const EMPTY_FOLDER_FORM: FolderForm   = { id: null, name: '', emoji: '📁' }

// ── Section component (shared between class and course tabs) ──────────────────

interface SectionProps {
  cohortId: string | null       // null = course resources
  cohortLabel?: string
  allResources: TeamResourceDoc[]
  folders: ResourceFolderDoc[]
  profile: { uid: string } | null
  preview: { url: string; type: string; title: string; sourceName: string } | null
  setPreview: (p: { url: string; type: string; title: string; sourceName: string } | null) => void
}

function ResourceSection({ cohortId, cohortLabel, allResources, folders, profile, preview, setPreview }: SectionProps) {
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null)
  const [editForm,       setEditForm]       = useState<ResourceForm | null>(null)
  const [folderForm,     setFolderForm]     = useState<FolderForm | null>(null)
  const [saving,         setSaving]         = useState(false)

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

  async function saveFolder() {
    if (!folderForm?.name.trim()) return
    setSaving(true)
    try {
      const payload = { name: folderForm.name.trim(), emoji: folderForm.emoji || '📁', cohortId: null, createdBy: profile?.uid ?? '', createdAt: serverTimestamp(), order: sortedFolders.length }
      if (folderForm.id) {
        await updateDoc(doc(db, 'resource_folders', folderForm.id), { name: payload.name, emoji: payload.emoji })
      } else {
        await addDoc(collection(db, 'resource_folders'), payload)
      }
      setFolderForm(null)
    } finally { setSaving(false) }
  }

  async function deleteFolder(id: string) {
    if (!confirm('Delete this folder? Resources inside will become unfiled.')) return
    await deleteDoc(doc(db, 'resource_folders', id))
    if (activeFolderId === id) setActiveFolderId(null)
  }

  async function saveResource() {
    if (!editForm || !editForm.title.trim() || !editForm.url.trim()) return
    setSaving(true)
    try {
      const payload = {
        title: editForm.title.trim(), url: editForm.url.trim(), type: editForm.type,
        description: editForm.description.trim(), storagePath: null,
        cohortId: cohortId,
        teamIds: null,
        folderId: editForm.folderId || null,
        createdBy: profile?.uid ?? '', createdAt: serverTimestamp(),
      }
      if (editForm.id) {
        await updateDoc(doc(db, 'team_resources', editForm.id), payload)
      } else {
        await addDoc(collection(db, 'team_resources'), payload)
      }
      setEditForm(null)
    } finally { setSaving(false) }
  }

  async function deleteResource(id: string) {
    if (!confirm('Delete this resource?')) return
    await deleteDoc(doc(db, 'team_resources', id))
  }

  return (
    <>
      {preview && <PreviewModal {...preview} onClose={() => setPreview(null)} />}
      <div className="space-y-4">
        {activeFolderId === null ? (
          <>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-zinc-400 text-sm">
                {sortedFolders.length} folder{sortedFolders.length !== 1 ? 's' : ''} · {sectionResources.length} total resources
                {cohortLabel && <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-brand-900/40 text-brand-300">{cohortLabel}</span>}
              </p>
              <div className="flex gap-2">
                <button onClick={() => setFolderForm({ ...EMPTY_FOLDER_FORM })} className="btn bg-zinc-700 text-zinc-200 hover:bg-zinc-600 py-2 text-sm">
                  <Folder className="w-4 h-4" /> New Folder
                </button>
                <button onClick={() => setEditForm({ ...EMPTY_FORM })} className="btn bg-brand-600 text-white hover:bg-brand-500 py-2 text-sm">
                  <Plus className="w-4 h-4" /> Add Resource
                </button>
              </div>
            </div>

            {/* Folder form */}
            {folderForm && (
              <div className="bg-slate-800 rounded-2xl p-5 space-y-4 border border-slate-700">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-white">{folderForm.id ? 'Edit Folder' : 'New Folder'}</p>
                  <button onClick={() => setFolderForm(null)} className="p-1.5 text-zinc-400 hover:text-white rounded-lg"><X className="w-4 h-4" /></button>
                </div>
                <div className="flex gap-3 flex-wrap items-end">
                  <div className="flex-1 min-w-[180px]">
                    <label className="label">Folder name *</label>
                    <input value={folderForm.name} onChange={e => setFolderForm(f => f && ({ ...f, name: e.target.value }))} className="input w-full" placeholder="e.g. Cinematography" autoFocus />
                  </div>
                  <div>
                    <label className="label">Icon</label>
                    <div className="flex flex-wrap gap-1.5">
                      {FOLDER_EMOJIS.map(emoji => (
                        <button key={emoji} type="button" onClick={() => setFolderForm(f => f && ({ ...f, emoji }))}
                          className={`w-8 h-8 rounded-lg text-base flex items-center justify-center transition-all ${folderForm.emoji === emoji ? 'bg-brand-600 ring-2 ring-brand-400' : 'bg-zinc-700 hover:bg-zinc-600'}`}>
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={saveFolder} disabled={saving || !folderForm.name.trim()} className="btn-primary py-2 px-4 text-sm">{saving ? 'Saving…' : folderForm.id ? 'Save Changes' : 'Create Folder'}</button>
                  <button onClick={() => setFolderForm(null)} className="btn-secondary py-2 px-4 text-sm">Cancel</button>
                </div>
              </div>
            )}

            {/* Resource form (unfiled) */}
            {editForm && !editForm.folderId && (
              <ResourceFormPanel form={editForm} setForm={setEditForm} saving={saving} onSave={saveResource} folders={sortedFolders} />
            )}

            {/* Folder grid */}
            {sortedFolders.length === 0 && !folderForm ? (
              <div className="bg-slate-800 rounded-2xl p-10 text-center">
                <Folder className="w-10 h-10 text-zinc-400 mx-auto mb-3" />
                <p className="text-zinc-400 text-sm">No folders yet. Create a folder to organize resources.</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {sortedFolders.map(f => (
                  <div key={f.id} className="group bg-slate-800 border border-slate-700 rounded-2xl p-4 cursor-pointer hover:border-brand-500 hover:bg-slate-700/80 transition-all" onClick={() => { setActiveFolderId(f.id); setEditForm(null) }}>
                    <div className="flex items-start justify-between mb-2">
                      <span className="text-2xl">{f.emoji}</span>
                      <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                        <button onClick={() => setFolderForm({ id: f.id, name: f.name, emoji: f.emoji })} className="p-1 text-zinc-400 hover:text-white hover:bg-zinc-600 rounded-md"><Pencil className="w-3.5 h-3.5" /></button>
                        <button onClick={() => deleteFolder(f.id)} className="p-1 text-zinc-400 hover:text-rose-400 hover:bg-zinc-600 rounded-md"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>
                    <p className="text-sm font-semibold text-white truncate">{f.name}</p>
                    <p className="text-xs text-zinc-400 mt-0.5">{resourceCountByFolder[f.id] ?? 0} resources</p>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            {/* Breadcrumb */}
            <div className="flex items-center gap-1.5 text-sm">
              <button onClick={() => { setActiveFolderId(null); setEditForm(null) }} className="text-zinc-400 hover:text-white transition-colors">
                {cohortId ? 'Class Resources' : 'Course Resources'}
              </button>
              <ChevronRight className="w-4 h-4 text-zinc-600" />
              <span className="text-white font-medium">{activeFolder?.emoji} {activeFolder?.name}</span>
            </div>

            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-zinc-400 text-sm">{folderResources.length} resource{folderResources.length !== 1 ? 's' : ''}</p>
              <button onClick={() => setEditForm({ ...EMPTY_FORM, folderId: activeFolderId ?? '' })} className="btn bg-brand-600 text-white hover:bg-brand-500 py-2">
                <Plus className="w-4 h-4" /> Add Resource
              </button>
            </div>

            {/* Resource form (in folder) */}
            {editForm && (
              <ResourceFormPanel form={editForm} setForm={setEditForm} saving={saving} onSave={saveResource} folders={sortedFolders} />
            )}

            {/* Resource list */}
            {folderResources.length === 0 && !editForm ? (
              <div className="bg-slate-800 rounded-2xl p-10 text-center">
                <FolderOpen className="w-10 h-10 text-zinc-400 mx-auto mb-3" />
                <p className="text-zinc-400 text-sm">No resources in this folder yet.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {folderResources.map(r => (
                  <div key={r.id} className="bg-slate-800 rounded-xl border border-slate-700 px-4 py-3 flex items-center gap-3 group">
                    {typeIcon(r.type)}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">{r.title}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-zinc-400">{typeLabel(r.type)}</span>
                        {r.description && <span className="text-xs text-zinc-500 truncate">{r.description}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => setPreview({ url: r.url, type: r.type, title: r.title, sourceName: activeFolder?.name ?? '' })} className="p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-700 rounded-lg"><Eye className="w-4 h-4" /></button>
                      <button onClick={() => setEditForm({ id: r.id, title: r.title, url: r.url, type: r.type, description: r.description ?? '', folderId: r.folderId ?? '' })} className="p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-700 rounded-lg"><Pencil className="w-4 h-4" /></button>
                      <button onClick={() => deleteResource(r.id)} className="p-1.5 text-zinc-400 hover:text-rose-400 hover:bg-zinc-700 rounded-lg"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}

function ResourceFormPanel({ form, setForm, saving, onSave, folders }: {
  form: ResourceForm; setForm: (f: ResourceForm | null) => void; saving: boolean; onSave: () => void; folders: ResourceFolderDoc[]
}) {
  return (
    <div className="bg-slate-800 rounded-2xl p-5 space-y-4 border border-slate-700">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-white">{form.id ? 'Edit Resource' : 'New Resource'}</p>
        <button onClick={() => setForm(null)} className="p-1.5 text-zinc-400 hover:text-white rounded-lg"><X className="w-4 h-4" /></button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="label">Title *</label>
          <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} className="input w-full" placeholder="Resource title" autoFocus />
        </div>
        <div>
          <label className="label">URL *</label>
          <input value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} className="input w-full" placeholder="https://…" />
        </div>
        <div>
          <label className="label">Type</label>
          <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value as ResourceType })} className="input w-full">
            <option value="link">Link</option>
            <option value="file">File</option>
            <option value="video">Video</option>
            <option value="youtube">YouTube</option>
          </select>
        </div>
        <div>
          <label className="label">Folder</label>
          <select value={form.folderId} onChange={e => setForm({ ...form, folderId: e.target.value })} className="input w-full">
            <option value="">— No folder —</option>
            {folders.map(f => <option key={f.id} value={f.id}>{f.emoji} {f.name}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="label">Description (optional)</label>
          <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="input w-full" placeholder="Brief description…" />
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={onSave} disabled={saving || !form.title.trim() || !form.url.trim()} className="btn-primary py-2 px-4 text-sm">{saving ? 'Saving…' : form.id ? 'Save Changes' : 'Add Resource'}</button>
        <button onClick={() => setForm(null)} className="btn-secondary py-2 px-4 text-sm">Cancel</button>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function TeacherResources() {
  const { profile, role, roles } = useAuth()
  const isAdmin = roles.includes('admin') || role === 'admin'
  const [activeTab,        setActiveTab]        = useState<'class' | 'course'>('class')
  const [selectedCohortId, setSelectedCohortId] = useState<string>('')
  const [preview,          setPreview]          = useState<{ url: string; type: string; title: string; sourceName: string } | null>(null)

  const { data: allResources } = useCollection<TeamResourceDoc>('team_resources')
  const { data: folders }      = useCollection<ResourceFolderDoc>('resource_folders')
  // Admins see all cohorts; teachers only see their own via teacherIds
  const { data: allCohorts }   = useCollection<CohortDoc>(
    'cohorts',
    isAdmin || !profile ? [] : [where('teacherIds', 'array-contains', profile.uid)],
    !!profile,
    isAdmin ? 'all' : (profile?.uid ?? ''),
  )

  // Default to first cohort
  const cohortId = selectedCohortId || allCohorts[0]?.id || null
  const cohortLabel = allCohorts.find(c => c.id === cohortId)?.name ?? ''

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Resources</h1>
        <p className="text-zinc-400 text-sm mt-1">Manage class and course-wide resources.</p>
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

      {/* Class Resources */}
      {activeTab === 'class' && (
        <div className="space-y-4">
          {/* Cohort picker */}
          {allCohorts.length > 1 && (
            <div className="flex items-center gap-3">
              <GraduationCap className="w-4 h-4 text-zinc-400 flex-shrink-0" />
              <div className="flex gap-2 flex-wrap">
                {allCohorts.map(c => (
                  <button
                    key={c.id}
                    onClick={() => setSelectedCohortId(c.id)}
                    className={`text-sm px-3 py-1.5 rounded-xl border transition-all ${cohortId === c.id ? 'bg-brand-600 border-brand-600 text-white' : 'bg-zinc-800 border-white/10 text-zinc-300 hover:border-brand-500'}`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          {allCohorts.length === 0 ? (
            <div className="bg-slate-800 rounded-2xl p-10 text-center">
              <Users className="w-10 h-10 text-zinc-400 mx-auto mb-3" />
              <p className="text-zinc-400 text-sm">You are not assigned to any class. Ask an admin to add you.</p>
            </div>
          ) : (
            <ResourceSection
              cohortId={cohortId}
              cohortLabel={cohortLabel}
              allResources={allResources}
              folders={folders}
              profile={profile}
              preview={preview}
              setPreview={setPreview}
            />
          )}
        </div>
      )}

      {/* Course Resources */}
      {activeTab === 'course' && (
        <div className="space-y-2">
          <p className="text-sm text-zinc-400">Visible to all classes. Only teachers can add resources here.</p>
          <ResourceSection
            cohortId={null}
            allResources={allResources}
            folders={folders}
            profile={profile}
            preview={preview}
            setPreview={setPreview}
          />
        </div>
      )}
    </div>
  )
}
