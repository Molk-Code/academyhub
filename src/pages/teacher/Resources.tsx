import { useMemo, useState } from 'react'
import { useCollection } from '@/hooks/useFirestore'
import { addDoc, collection, deleteDoc, doc, serverTimestamp, updateDoc, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import type { AssignmentDoc, SubjectDoc, CohortDoc, TeamResourceDoc, ProductionTeamDoc, ResourceType } from '@/types'
import {
  Search, FileText, Link2, Video, Youtube, Download, ExternalLink,
  BookOpen, ClipboardList, X, Eye, AlertCircle, Plus, Pencil, Trash2, Users,
} from 'lucide-react'

interface FlatResource {
  key: string
  title: string
  url: string
  type: string
  storagePath: string | null
  source: 'assignment' | 'subject'
  sourceName: string
  context: string
}

type PreviewMode = 'youtube' | 'video' | 'image' | 'pdf' | 'office' | 'link' | 'docs'

function detectMode(type: string, url: string): PreviewMode {
  if (type === 'youtube') return 'youtube'
  if (type === 'video')   return 'video'
  const clean = url.toLowerCase().split('?')[0]
  if (/\.(jpg|jpeg|png|gif|webp|svg)$/.test(clean))         return 'image'
  if (/\.pdf$/.test(clean))                                   return 'pdf'
  if (/\.(docx?|xlsx?|pptx?|odt|ods|odp|csv)$/.test(clean)) return 'office'
  if (type === 'link')                                        return 'link'
  return 'docs'
}

function youtubeId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/)
  return m ? m[1] : null
}

function typeIcon(type: string, small = false) {
  const s = small ? 'w-3.5 h-3.5' : 'w-4 h-4'
  if (type === 'youtube') return <Youtube  className={`${s} text-rose-500`} />
  if (type === 'video')   return <Video    className={`${s} text-violet-500`} />
  if (type === 'link')    return <Link2    className={`${s} text-sky-500`} />
  return                         <FileText className={`${s} text-zinc-500`} />
}

function typeLabel(type: string) {
  if (type === 'youtube') return 'YouTube'
  if (type === 'video')   return 'Video'
  if (type === 'link')    return 'Link'
  return 'File'
}

function PreviewModal({ url, type, title, sourceName, onClose }: {
  url: string; type: string; title: string; sourceName: string; onClose: () => void
}) {
  const mode = detectMode(type, url)
  const encodedUrl = encodeURIComponent(url)

  function renderContent() {
    switch (mode) {
      case 'youtube': {
        const vid = youtubeId(url)
        if (!vid) return <Unsupported url={url} />
        return (
          <iframe className="w-full h-full rounded-xl"
            src={`https://www.youtube.com/embed/${vid}?autoplay=1`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen />
        )
      }
      case 'video':
        return <video src={url} controls autoPlay className="w-full h-full rounded-xl object-contain bg-black" />
      case 'image':
        return (
          <div className="w-full h-full flex items-center justify-center bg-zinc-800 rounded-xl overflow-hidden">
            <img src={url} alt={title} className="max-w-full max-h-full object-contain" />
          </div>
        )
      case 'pdf':
        return <iframe src={url} className="w-full h-full rounded-xl border-0" title={title} />
      case 'office':
        return <iframe src={`https://view.officeapps.live.com/op/embed.aspx?src=${encodedUrl}`} className="w-full h-full rounded-xl border-0" title={title} />
      case 'docs':
        return <iframe src={`https://docs.google.com/viewer?url=${encodedUrl}&embedded=true`} className="w-full h-full rounded-xl border-0" title={title} />
      case 'link':
        return <Unsupported url={url} isLink />
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-zinc-900 rounded-2xl shadow-2xl flex flex-col w-full max-w-5xl h-[90vh]">
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-white/10 flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {typeIcon(type)}
            <div className="min-w-0">
              <p className="text-sm font-semibold text-zinc-100 truncate">{title}</p>
              <p className="text-xs text-zinc-500">{sourceName}</p>
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <a href={url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-zinc-400 hover:bg-zinc-800">
              <ExternalLink className="w-4 h-4" /><span className="hidden sm:inline">Open</span>
            </a>
            {type === 'file' && (
              <a href={url} download className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-zinc-400 hover:bg-zinc-800">
                <Download className="w-4 h-4" /><span className="hidden sm:inline">Download</span>
              </a>
            )}
            <button onClick={onClose} className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800 ml-1">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-hidden p-3">{renderContent()}</div>
      </div>
    </div>
  )
}

function Unsupported({ url, isLink }: { url: string; isLink?: boolean }) {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-4 text-center p-8 bg-zinc-900/50 rounded-xl">
      <AlertCircle className="w-12 h-12 text-zinc-300" />
      <div>
        <p className="text-zinc-300 font-medium">{isLink ? 'Link preview not available' : 'Preview not available'}</p>
        <p className="text-zinc-500 text-sm mt-1">{isLink ? 'External links cannot be embedded.' : 'This file type cannot be previewed.'}</p>
      </div>
      <a href={url} target="_blank" rel="noopener noreferrer" className="btn-primary py-2 px-5 text-sm">
        <ExternalLink className="w-4 h-4" /> Open in browser
      </a>
    </div>
  )
}

interface ResourceForm {
  id: string | null
  title: string
  url: string
  type: ResourceType
  description: string
  cohortId: string
  teamIds: string[]  // empty = all
}

const EMPTY_FORM: ResourceForm = { id: null, title: '', url: '', type: 'link', description: '', cohortId: '', teamIds: [] }

export default function TeacherResources() {
  const { profile } = useAuth()
  const [search,     setSearch]     = useState('')
  const [filterSrc,  setFilterSrc]  = useState<'all' | 'assignment' | 'subject'>('all')
  const [filterType, setFilterType] = useState('all')
  const [preview,    setPreview]    = useState<{ url: string; type: string; title: string; sourceName: string } | null>(null)
  const [activeTab,  setActiveTab]  = useState<'library' | 'team'>('team')
  const [editForm,   setEditForm]   = useState<ResourceForm | null>(null)
  const [saving,     setSaving]     = useState(false)

  const { data: assignments } = useCollection<AssignmentDoc>('assignments')
  const { data: subjects }    = useCollection<SubjectDoc>('subjects')
  const { data: cohorts }     = useCollection<CohortDoc>('cohorts')
  const { data: allTeamResources } = useCollection<TeamResourceDoc>('team_resources')
  const { data: allTeams }    = useCollection<ProductionTeamDoc>('production_teams')

  const subjectMap = useMemo(() => Object.fromEntries(subjects.map(s => [s.id, s])), [subjects])
  const cohortMap  = useMemo(() => Object.fromEntries(cohorts.map(c => [c.id, c])), [cohorts])

  // Teams by cohort
  const teamsByCohort = useMemo(() => {
    const m: Record<string, ProductionTeamDoc[]> = {}
    for (const t of allTeams) {
      if (!m[t.cohortId]) m[t.cohortId] = []
      m[t.cohortId].push(t)
    }
    return m
  }, [allTeams])

  // ── Library (assignment + subject resources) ──────────────────────────────
  const allLibraryResources = useMemo<FlatResource[]>(() => {
    const out: FlatResource[] = []
    for (const a of assignments) {
      const subjectName = subjectMap[a.subjectId]?.title ?? '—'
      const cohortName  = cohortMap[a.cohortId]?.name ?? '—'
      for (const r of a.resources ?? []) {
        out.push({
          key: `a-${a.id}-${r.url}`,
          title: r.label || r.url,
          url: r.url,
          type: r.type,
          storagePath: r.storagePath,
          source: 'assignment',
          sourceName: a.title,
          context: `${subjectName} · ${cohortName}`,
        })
      }
    }
    for (const s of subjects) {
      for (const r of s.resources ?? []) {
        out.push({
          key: `s-${s.id}-${r.id}`,
          title: r.title || r.url,
          url: r.url,
          type: r.type,
          storagePath: r.storagePath,
          source: 'subject',
          sourceName: s.title,
          context: s.iconEmoji ? `${s.iconEmoji} ${s.title}` : s.title,
        })
      }
    }
    return out
  }, [assignments, subjects, subjectMap, cohortMap])

  const availableTypes = useMemo(
    () => [...new Set(allLibraryResources.map(r => r.type))].sort(),
    [allLibraryResources],
  )

  const filteredLibrary = useMemo(() => {
    const q = search.toLowerCase()
    return allLibraryResources.filter(r => {
      if (filterSrc !== 'all' && r.source !== filterSrc) return false
      if (filterType !== 'all' && r.type !== filterType) return false
      if (q && !r.title.toLowerCase().includes(q) && !r.sourceName.toLowerCase().includes(q) && !r.context.toLowerCase().includes(q)) return false
      return true
    })
  }, [allLibraryResources, search, filterSrc, filterType])

  // ── Team resources CRUD ───────────────────────────────────────────────────
  async function saveResource() {
    if (!editForm || !editForm.title.trim() || !editForm.url.trim()) return
    setSaving(true)
    try {
      const payload = {
        title: editForm.title.trim(),
        url: editForm.url.trim(),
        type: editForm.type,
        description: editForm.description.trim(),
        storagePath: null,
        cohortId: editForm.cohortId || null,
        teamIds: editForm.teamIds.length > 0 ? editForm.teamIds : null,
        createdBy: profile?.uid ?? '',
        createdAt: serverTimestamp(),
      }
      if (editForm.id) {
        await updateDoc(doc(db, 'team_resources', editForm.id), payload)
      } else {
        await addDoc(collection(db, 'team_resources'), payload)
      }
      setEditForm(null)
    } finally {
      setSaving(false)
    }
  }

  async function deleteResource(id: string) {
    if (!confirm('Delete this resource?')) return
    await deleteDoc(doc(db, 'team_resources', id))
  }

  function getTeamLabel(r: TeamResourceDoc) {
    if (!r.teamIds) return 'All students'
    return r.teamIds.map(tid => allTeams.find(t => t.id === tid)?.name ?? tid).join(', ')
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Resources</h1>
        <p className="text-zinc-400 text-sm mt-1">Manage team resources and browse all course materials.</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-800/60 p-1 rounded-xl w-fit">
        {([['team', 'Team Resources'], ['library', 'Course Library']] as [string, string][]).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setActiveTab(id as any)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === id ? 'bg-brand-600 text-white' : 'text-zinc-400 hover:text-white'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Team Resources tab ───────────────────────────────────────────────── */}
      {activeTab === 'team' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-zinc-400 text-sm">{allTeamResources.length} resources · assign to specific teams or all students</p>
            <button
              onClick={() => setEditForm({ ...EMPTY_FORM })}
              className="btn bg-brand-600 text-white hover:bg-brand-500 py-2"
            >
              <Plus className="w-4 h-4" /> Add Resource
            </button>
          </div>

          {/* Add/Edit form */}
          {editForm && (
            <div className="bg-slate-800 rounded-2xl p-5 space-y-4 border border-slate-700">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-white">{editForm.id ? 'Edit Resource' : 'New Resource'}</p>
                <button onClick={() => setEditForm(null)} className="p-1.5 text-zinc-400 hover:text-white rounded-lg">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Title *</label>
                  <input value={editForm.title} onChange={e => setEditForm(f => f && ({ ...f, title: e.target.value }))} className="input w-full" placeholder="Resource title" />
                </div>
                <div>
                  <label className="label">URL *</label>
                  <input value={editForm.url} onChange={e => setEditForm(f => f && ({ ...f, url: e.target.value }))} className="input w-full" placeholder="https://…" />
                </div>
                <div>
                  <label className="label">Type</label>
                  <select value={editForm.type} onChange={e => setEditForm(f => f && ({ ...f, type: e.target.value as ResourceType }))} className="input w-full">
                    <option value="link">Link</option>
                    <option value="file">File</option>
                    <option value="video">Video</option>
                    <option value="youtube">YouTube</option>
                  </select>
                </div>
                <div>
                  <label className="label">Cohort (optional)</label>
                  <select value={editForm.cohortId} onChange={e => setEditForm(f => f && ({ ...f, cohortId: e.target.value, teamIds: [] }))} className="input w-full">
                    <option value="">All cohorts</option>
                    {cohorts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              </div>

              {/* Team assignment */}
              <div>
                <label className="label">Visible to</label>
                {editForm.cohortId && teamsByCohort[editForm.cohortId] ? (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setEditForm(f => f && ({ ...f, teamIds: [] }))}
                      className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all ${
                        editForm.teamIds.length === 0
                          ? 'bg-brand-600 border-brand-600 text-white'
                          : 'bg-zinc-700 border-slate-600 text-zinc-300 hover:border-brand-500'
                      }`}
                    >
                      All students
                    </button>
                    {teamsByCohort[editForm.cohortId].map(t => {
                      const selected = editForm.teamIds.includes(t.id)
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setEditForm(f => {
                            if (!f) return f
                            const ids = selected ? f.teamIds.filter(id => id !== t.id) : [...f.teamIds, t.id]
                            return { ...f, teamIds: ids }
                          })}
                          className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all ${
                            selected
                              ? 'bg-amber-500 border-amber-500 text-white'
                              : 'bg-zinc-700 border-slate-600 text-zinc-300 hover:border-amber-500'
                          }`}
                          style={selected ? { backgroundColor: t.color, borderColor: t.color } : undefined}
                        >
                          {t.emoji} {t.name}
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-zinc-400">Select a cohort above to assign to specific teams, or leave blank for all students.</p>
                )}
              </div>

              <div>
                <label className="label">Description (optional)</label>
                <input value={editForm.description} onChange={e => setEditForm(f => f && ({ ...f, description: e.target.value }))} className="input w-full" placeholder="Brief description…" />
              </div>

              <div className="flex gap-2">
                <button onClick={saveResource} disabled={saving || !editForm.title.trim() || !editForm.url.trim()} className="btn-primary py-2 px-4 text-sm">
                  {saving ? 'Saving…' : editForm.id ? 'Save Changes' : 'Add Resource'}
                </button>
                <button onClick={() => setEditForm(null)} className="btn-secondary py-2 px-4 text-sm">Cancel</button>
              </div>
            </div>
          )}

          {/* Team resources list */}
          {allTeamResources.length === 0 && !editForm ? (
            <div className="bg-slate-800 rounded-2xl p-10 text-center">
              <Users className="w-10 h-10 text-zinc-400 mx-auto mb-3" />
              <p className="text-zinc-400 text-sm">No team resources yet. Add one to share files with specific teams.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {allTeamResources.map(r => (
                <div key={r.id} className="bg-slate-800 rounded-xl border border-slate-700 px-4 py-3 flex items-center gap-3 group">
                  {typeIcon(r.type)}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{r.title}</p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-xs text-zinc-400">{typeLabel(r.type)}</span>
                      {r.cohortId && (
                        <span className="text-xs text-zinc-500">{cohortMap[r.cohortId]?.name}</span>
                      )}
                      <span className="text-xs text-amber-500 flex items-center gap-1">
                        <Users className="w-3 h-3" />
                        {getTeamLabel(r)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => setPreview({ url: r.url, type: r.type, title: r.title, sourceName: getTeamLabel(r) })}
                      className="p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-700 rounded-lg"
                      title="Preview"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setEditForm({
                        id: r.id, title: r.title, url: r.url, type: r.type,
                        description: r.description ?? '', cohortId: r.cohortId ?? '', teamIds: r.teamIds ?? [],
                      })}
                      className="p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-700 rounded-lg"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => deleteResource(r.id)}
                      className="p-1.5 text-zinc-400 hover:text-rose-400 hover:bg-zinc-700 rounded-lg"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Library tab ──────────────────────────────────────────────────────── */}
      {activeTab === 'library' && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-slate-800 rounded-xl p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-brand-600/20 flex items-center justify-center">
                <ClipboardList className="w-4 h-4 text-brand-400" />
              </div>
              <div>
                <p className="text-lg font-bold text-white">{allLibraryResources.filter(r => r.source === 'assignment').length}</p>
                <p className="text-xs text-zinc-400">From assignments</p>
              </div>
            </div>
            <div className="bg-slate-800 rounded-xl p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-emerald-600/20 flex items-center justify-center">
                <BookOpen className="w-4 h-4 text-emerald-400" />
              </div>
              <div>
                <p className="text-lg font-bold text-white">{allLibraryResources.filter(r => r.source === 'subject').length}</p>
                <p className="text-xs text-zinc-400">From subjects</p>
              </div>
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[180px] max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search resources…" className="input pl-9 w-full" />
            </div>
            <select value={filterSrc} onChange={e => setFilterSrc(e.target.value as any)} className="input max-w-[160px]">
              <option value="all">All sources</option>
              <option value="assignment">Assignments</option>
              <option value="subject">Subjects</option>
            </select>
            <select value={filterType} onChange={e => setFilterType(e.target.value)} className="input max-w-[140px]">
              <option value="all">All types</option>
              {availableTypes.map(t => <option key={t} value={t}>{typeLabel(t)}</option>)}
            </select>
          </div>

          {filteredLibrary.length === 0 ? (
            <div className="bg-slate-800 rounded-2xl p-12 text-center">
              <p className="text-zinc-400 text-sm">No resources found.</p>
            </div>
          ) : (
            <div className="bg-slate-800 rounded-2xl overflow-hidden overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-slate-700">
                    <th className="text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider px-5 py-3">Resource</th>
                    <th className="text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider px-4 py-3 hidden sm:table-cell">Type</th>
                    <th className="text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider px-4 py-3">Source</th>
                    <th className="text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider px-4 py-3 hidden md:table-cell">Context</th>
                    <th className="w-20 px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/50">
                  {filteredLibrary.map(r => (
                    <tr key={r.key} className="hover:bg-zinc-700/40 transition-colors cursor-pointer" onClick={() => setPreview({ url: r.url, type: r.type, title: r.title, sourceName: r.sourceName })}>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2.5">
                          {typeIcon(r.type)}
                          <span className="font-medium text-white truncate max-w-[220px]">{r.title}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-700 text-zinc-300">{typeLabel(r.type)}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          {r.source === 'assignment'
                            ? <ClipboardList className="w-3.5 h-3.5 text-brand-400" />
                            : <BookOpen className="w-3.5 h-3.5 text-emerald-400" />
                          }
                          <span className="text-zinc-300 truncate max-w-[160px]">{r.sourceName}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <span className="text-xs text-zinc-500">{r.context}</span>
                      </td>
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          <button onClick={() => setPreview({ url: r.url, type: r.type, title: r.title, sourceName: r.sourceName })}
                            className="p-1.5 text-zinc-400 hover:text-white hover:bg-slate-600 rounded-lg">
                            <Eye className="w-4 h-4" />
                          </button>
                          <a href={r.url} target="_blank" rel="noopener noreferrer"
                            className="p-1.5 text-zinc-400 hover:text-white hover:bg-slate-600 rounded-lg inline-flex">
                            {r.type === 'file' ? <Download className="w-4 h-4" /> : <ExternalLink className="w-4 h-4" />}
                          </a>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Preview modal */}
      {preview && (
        <PreviewModal
          url={preview.url}
          type={preview.type}
          title={preview.title}
          sourceName={preview.sourceName}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  )
}
