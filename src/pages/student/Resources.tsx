import { useMemo, useState } from 'react'
import { useCollection, where } from '@/hooks/useFirestore'
import { useAuth } from '@/contexts/AuthContext'
import type { AssignmentDoc, SubjectDoc, TeamResourceDoc, ProductionTeamDoc } from '@/types'
import {
  Search, FileText, Link2, Video, Youtube, Download, ExternalLink,
  BookOpen, ClipboardList, X, Eye, AlertCircle, Users, FolderOpen,
} from 'lucide-react'

interface FlatResource {
  key: string
  title: string
  url: string
  type: string
  storagePath: string | null
  source: 'assignment' | 'subject' | 'team'
  sourceName: string
  description?: string
}

type PreviewMode = 'youtube' | 'video' | 'image' | 'pdf' | 'office' | 'link' | 'docs'

function detectMode(r: FlatResource): PreviewMode {
  if (r.type === 'youtube') return 'youtube'
  if (r.type === 'video')   return 'video'
  const clean = r.url.toLowerCase().split('?')[0]
  if (/\.(jpg|jpeg|png|gif|webp|svg)$/.test(clean))         return 'image'
  if (/\.pdf$/.test(clean))                                   return 'pdf'
  if (/\.(docx?|xlsx?|pptx?|odt|ods|odp|csv)$/.test(clean)) return 'office'
  if (r.type === 'link')                                      return 'link'
  return 'docs'
}

function youtubeId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/)
  return m ? m[1] : null
}

function typeIcon(type: string) {
  if (type === 'youtube') return <Youtube  className="w-4 h-4 text-rose-500" />
  if (type === 'video')   return <Video    className="w-4 h-4 text-violet-500" />
  if (type === 'link')    return <Link2    className="w-4 h-4 text-sky-500" />
  return                         <FileText className="w-4 h-4 text-zinc-500" />
}

function typeLabel(type: string) {
  if (type === 'youtube') return 'YouTube'
  if (type === 'video')   return 'Video'
  if (type === 'link')    return 'Link'
  return 'File'
}

function sourceIcon(source: string) {
  if (source === 'assignment') return <ClipboardList className="w-3.5 h-3.5 text-brand-400" />
  if (source === 'team')       return <Users         className="w-3.5 h-3.5 text-amber-500" />
  return                              <BookOpen      className="w-3.5 h-3.5 text-emerald-500" />
}

function PreviewModal({ resource, onClose }: { resource: FlatResource; onClose: () => void }) {
  const mode = detectMode(resource)
  const encodedUrl = encodeURIComponent(resource.url)

  function renderContent() {
    switch (mode) {
      case 'youtube': {
        const vid = youtubeId(resource.url)
        if (!vid) return <Unsupported url={resource.url} />
        return (
          <iframe
            className="w-full h-full rounded-xl"
            src={`https://www.youtube.com/embed/${vid}?autoplay=1`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        )
      }
      case 'video':
        return <video src={resource.url} controls autoPlay className="w-full h-full rounded-xl object-contain bg-black" />
      case 'image':
        return (
          <div className="w-full h-full flex items-center justify-center bg-zinc-800 rounded-xl overflow-hidden">
            <img src={resource.url} alt={resource.title} className="max-w-full max-h-full object-contain" />
          </div>
        )
      case 'pdf':
        return <iframe src={resource.url} className="w-full h-full rounded-xl border-0" title={resource.title} />
      case 'office':
        return <iframe src={`https://view.officeapps.live.com/op/embed.aspx?src=${encodedUrl}`} className="w-full h-full rounded-xl border-0" title={resource.title} />
      case 'docs':
        return <iframe src={`https://docs.google.com/viewer?url=${encodedUrl}&embedded=true`} className="w-full h-full rounded-xl border-0" title={resource.title} />
      case 'link':
        return <Unsupported url={resource.url} isLink />
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-zinc-900 rounded-2xl shadow-2xl flex flex-col w-full max-w-5xl h-[90vh]">
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-white/10 flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {typeIcon(resource.type)}
            <div className="min-w-0">
              <p className="text-sm font-semibold text-zinc-100 truncate">{resource.title}</p>
              <p className="text-xs text-zinc-500">{resource.sourceName}</p>
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <a href={resource.url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-zinc-400 hover:bg-zinc-800 transition-colors">
              <ExternalLink className="w-4 h-4" />
              <span className="hidden sm:inline">Open</span>
            </a>
            {resource.type === 'file' && (
              <a href={resource.url} download
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-zinc-400 hover:bg-zinc-800 transition-colors">
                <Download className="w-4 h-4" />
                <span className="hidden sm:inline">Download</span>
              </a>
            )}
            <button onClick={onClose} className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800 transition-colors ml-1">
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
        <p className="text-zinc-500 text-sm mt-1">
          {isLink ? 'Open in a new tab to view.' : 'This file type cannot be previewed directly.'}
        </p>
      </div>
      <a href={url} target="_blank" rel="noopener noreferrer" className="btn-primary py-2 px-5 text-sm">
        <ExternalLink className="w-4 h-4" /> Open in browser
      </a>
    </div>
  )
}

export default function StudentResources() {
  const { cohortId: ctxCohortId, previewCohortId, profile } = useAuth()
  const cohortId = ctxCohortId ?? previewCohortId ?? profile?.cohortId ?? null

  const [search,     setSearch]     = useState('')
  const [filterSrc,  setFilterSrc]  = useState<'all' | 'assignment' | 'subject' | 'team'>('all')
  const [filterType, setFilterType] = useState('all')
  const [preview,    setPreview]    = useState<FlatResource | null>(null)

  const { data: assignments } = useCollection<AssignmentDoc>(
    'assignments',
    cohortId ? [where('cohortId', '==', cohortId), where('isPublished', '==', true)] : [],
    !!cohortId,
    cohortId ?? '',
  )
  const { data: subjects } = useCollection<SubjectDoc>('subjects')

  // Find student's production team
  const { data: allTeams } = useCollection<ProductionTeamDoc>(
    'production_teams',
    cohortId ? [where('cohortId', '==', cohortId)] : [],
    !!cohortId,
    cohortId ?? '',
  )
  const myTeam = useMemo(
    () => allTeams.find(t => profile && t.memberIds.includes(profile.uid)) ?? null,
    [allTeams, profile],
  )

  // Team resources: visible if teamIds is null (all) or includes my team id
  const { data: teamResources } = useCollection<TeamResourceDoc>(
    'team_resources',
    cohortId ? [where('cohortId', '==', cohortId)] : [],
    !!cohortId,
    cohortId ?? '',
  )
  const visibleTeamResources = useMemo(
    () => teamResources.filter(r =>
      r.teamIds === null || (myTeam && r.teamIds.includes(myTeam.id))
    ),
    [teamResources, myTeam],
  )

  const allResources = useMemo<FlatResource[]>(() => {
    const out: FlatResource[] = []

    for (const a of assignments) {
      for (const r of a.resources ?? []) {
        out.push({
          key: `a-${a.id}-${r.url}`,
          title: r.label || r.url,
          url: r.url,
          type: r.type,
          storagePath: r.storagePath,
          source: 'assignment',
          sourceName: a.title,
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
          sourceName: s.iconEmoji ? `${s.iconEmoji} ${s.title}` : s.title,
        })
      }
    }

    for (const r of visibleTeamResources) {
      out.push({
        key: `tr-${r.id}`,
        title: r.title,
        url: r.url,
        type: r.type,
        storagePath: r.storagePath,
        source: 'team',
        sourceName: r.teamIds === null ? 'All Students' : (myTeam?.name ?? 'Team'),
        description: r.description,
      })
    }

    return out
  }, [assignments, subjects, visibleTeamResources, myTeam])

  const availableTypes = useMemo(
    () => [...new Set(allResources.map(r => r.type))].sort(),
    [allResources],
  )

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return allResources.filter(r => {
      if (filterSrc !== 'all' && r.source !== filterSrc) return false
      if (filterType !== 'all' && r.type !== filterType) return false
      if (q && !r.title.toLowerCase().includes(q) && !r.sourceName.toLowerCase().includes(q)) return false
      return true
    })
  }, [allResources, search, filterSrc, filterType])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Resources</h1>
        <p className="text-zinc-500 text-sm mt-1">
          Files and links from your assignments, subjects, and team — {allResources.length} total.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search resources…"
            className="input pl-9 w-full"
          />
        </div>
        <select value={filterSrc} onChange={e => setFilterSrc(e.target.value as any)} className="input max-w-[160px]">
          <option value="all">All sources</option>
          <option value="team">Team</option>
          <option value="assignment">Assignments</option>
          <option value="subject">Subjects</option>
        </select>
        <select value={filterType} onChange={e => setFilterType(e.target.value)} className="input max-w-[140px]">
          <option value="all">All types</option>
          {availableTypes.map(t => (
            <option key={t} value={t}>{typeLabel(t)}</option>
          ))}
        </select>
      </div>

      {/* Resource list */}
      {filtered.length === 0 ? (
        <div className="card py-16 text-center">
          <FolderOpen className="w-10 h-10 text-slate-200 mx-auto mb-3" />
          <p className="text-zinc-400 text-sm">No resources found.</p>
        </div>
      ) : (
        <div className="bg-zinc-900 rounded-2xl border border-white/10 overflow-hidden overflow-x-auto">
          <table className="w-full min-w-[480px]">
            <thead>
              <tr className="border-b border-white/8 bg-zinc-900/50/60">
                <th className="text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider px-5 py-3">Resource</th>
                <th className="text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider px-4 py-3 hidden sm:table-cell">Type</th>
                <th className="text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider px-4 py-3">Source</th>
                <th className="w-24 px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map(r => {
                const canPreview = detectMode(r) !== 'link'
                return (
                  <tr key={r.key} className="hover:bg-white/5 transition-colors cursor-pointer" onClick={() => setPreview(r)}>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        {typeIcon(r.type)}
                        <span className="text-sm font-medium text-zinc-200 truncate max-w-[240px]">{r.title}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-500 font-medium">
                        {typeLabel(r.type)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        {sourceIcon(r.source)}
                        <span className="text-sm text-zinc-300 truncate max-w-[160px]">{r.sourceName}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                        {canPreview && (
                          <button onClick={() => setPreview(r)}
                            className="p-1.5 rounded-lg text-zinc-400 hover:text-brand-600 hover:bg-brand-50 transition-colors"
                            title="Preview">
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

      {preview && <PreviewModal resource={preview} onClose={() => setPreview(null)} />}
    </div>
  )
}
