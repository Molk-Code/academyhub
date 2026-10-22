import { useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { format, isPast } from 'date-fns'
import { useDocument, useCollection, orderBy, where } from '@/hooks/useFirestore'
import { useAuth } from '@/contexts/AuthContext'
import type { SubjectDoc, SubjectTeacherDoc, LessonDoc, SyncedEventDoc, VideoLabDoc, AbsenceReportDoc, AssignmentDoc, SubmissionDoc } from '@/types'
import { thumbnailUrl } from '@/lib/cloudinary'
import { toDate, cn } from '@/lib/utils'
import {
  Link2, FileText, ExternalLink, UserRound, Check, X, Globe, Play, Clock, CalendarClock, ClipboardList,
  BookOpen, MapPin, Video, AlertTriangle, CheckCircle2,
} from 'lucide-react'
import LoadingSpinner from '@/components/common/LoadingSpinner'
import SharePointBrowser from '@/components/sharepoint/SharePointBrowser'
import { useMicrosoftAuth } from '@/contexts/MicrosoftAuthContext'
import Breadcrumb from '@/components/common/Breadcrumb'
import SubjectCover from '@/components/subjects/SubjectCover'

type Status = 'in-progress' | 'completed' | 'not-started'
const STATUS_BADGE: Record<Status, { label: string; cls: string }> = {
  'in-progress': { label: 'Active',    cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  'completed':   { label: 'Completed', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  'not-started': { label: 'Upcoming',  cls: 'bg-black/50 text-zinc-300 border-white/15' },
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

// Shared surface for tiles and panels, matching the subject overview cards
const PANEL = 'rounded-2xl bg-zinc-900 border border-white/[0.06] shadow-xl'

export default function StudentSubjectDetail() {
  const { isConfigured: sharePointConfigured } = useMicrosoftAuth()
  const { id } = useParams<{ id: string }>()
  const { cohortId, previewCohortId, profile } = useAuth()
  const effectiveCohortId = previewCohortId ?? cohortId
  const { data: subject, loading } = useDocument<SubjectDoc>('subjects', id)
  const { data: teachers } = useCollection<SubjectTeacherDoc>(
    `subjects/${id}/teachers`,
    [orderBy('order', 'asc')],
    !!id,
    id ?? '',
  )
  const { data: lessons } = useCollection<LessonDoc>(
    'lessons',
    effectiveCohortId && id ? [where('cohortId', '==', effectiveCohortId), where('subjectId', '==', id)] : [],
    !!(effectiveCohortId && id),
    `${effectiveCohortId}-${id}`,
  )
  // A curriculum topic can also be covered by a synced Outlook event (e.g. a
  // guest teacher's session), not just a native lesson — scoped to this
  // student's own class (or "all") so a shared subject's other-cohort
  // sessions never mark a topic complete here.
  const { data: syncedEvents } = useCollection<SyncedEventDoc>(
    'synced_events',
    id && effectiveCohortId ? [where('subjectId', '==', id), where('cohortId', 'in', [effectiveCohortId, 'all'])] : [],
    !!(id && effectiveCohortId),
    `synced-${id}-${effectiveCohortId}`,
  )
  const { data: subjectVideos } = useCollection<VideoLabDoc>(
    'video_lab',
    id ? [where('subjectId', '==', id), orderBy('createdAt', 'desc')] : [],
    !!id,
    `videos-${id}`,
  )

  const { data: subjectAssignments } = useCollection<AssignmentDoc>(
    'assignments',
    effectiveCohortId && id
      ? [where('subjectId', '==', id), where('cohortId', '==', effectiveCohortId), where('isPublished', '==', true)]
      : [],
    !!(effectiveCohortId && id),
    `assignments-${id}-${effectiveCohortId}`,
  )
  const assignmentMap = useMemo(
    () => Object.fromEntries(subjectAssignments.map(a => [a.id, a])),
    [subjectAssignments],
  )

  const { data: mySubmissions } = useCollection<SubmissionDoc>(
    'submissions',
    profile ? [where('studentId', '==', profile.uid)] : [],
    !!profile,
    profile?.uid ?? '',
  )

  // Student's absence reports for lessons in this subject
  const { data: myAbsences } = useCollection<AbsenceReportDoc>(
    'absence_reports',
    profile ? [where('studentId', '==', profile.uid)] : [],
    !!profile,
    profile?.uid ?? '',
  )
  const absentLessonIds = useMemo(() => new Set(myAbsences.map(r => r.lessonId).filter(Boolean) as string[]), [myAbsences])

  const curriculum = useMemo(
    () => [...(subject?.curriculum ?? [])].sort((a, b) => a.order - b.order),
    [subject],
  )
  const resources = subject?.resources ?? []

  const semesters = useMemo(() => {
    const nums = curriculum.map(i => i.semester)
    const set = Array.from(new Set(nums)).sort((a, b) => a - b)
    return set
  }, [curriculum])

  // coveredIds: curriculum IDs where ALL covering lessons are in the past
  // absentCoveredIds: completed items where student missed at least one covering lesson
  const { coveredIds, absentCoveredIds } = useMemo(() => {
    const now = new Date()
    const grouped: Record<string, { id: string; isPast: boolean }[]> = {}
    for (const l of lessons) {
      const lessonDate = l.startTime?.toDate?.()
      if (!lessonDate) continue
      const isPast = lessonDate <= now
      for (const cid of (l.coveredCurriculumIds ?? [])) {
        if (!grouped[cid]) grouped[cid] = []
        grouped[cid].push({ id: l.id, isPast })
      }
    }
    // Synced Outlook events (e.g. a guest teacher's session) also count, but
    // have no attendance tracking, so they only ever affect "covered".
    for (const e of syncedEvents) {
      const eventDate = e.startTime?.toDate?.()
      if (!eventDate) continue
      const isPast = eventDate <= now
      for (const cid of (e.coveredCurriculumIds ?? [])) {
        if (!grouped[cid]) grouped[cid] = []
        grouped[cid].push({ id: e.id, isPast })
      }
    }
    const covered = new Set<string>()
    const absentCovered = new Set<string>()
    for (const [cid, ls] of Object.entries(grouped)) {
      if (ls.every(l => l.isPast)) {
        covered.add(cid)
        if (ls.some(l => absentLessonIds.has(l.id))) absentCovered.add(cid)
      }
    }
    return { coveredIds: covered, absentCoveredIds: absentCovered }
  }, [lessons, syncedEvents, absentLessonIds])

  const curriculumProgress = curriculum.length > 0
    ? Math.round((coveredIds.size / curriculum.length) * 100)
    : 0
  const status: Status = coveredIds.size === 0 ? 'not-started'
    : coveredIds.size >= curriculum.length ? 'completed' : 'in-progress'

  const nextLesson = useMemo(() => {
    const now = new Date()
    return [...lessons]
      .filter(l => (toDate(l.startTime) ?? now) > now)
      .sort((a, b) => (a.startTime?.toMillis?.() ?? 0) - (b.startTime?.toMillis?.() ?? 0))[0] ?? null
  }, [lessons])

  const pendingAssignments = useMemo(() => {
    const submitted = new Set(mySubmissions.filter(s => s.status !== 'draft').map(s => s.assignmentId))
    return subjectAssignments
      .filter(a => !submitted.has(a.id))
      .sort((a, b) => (a.dueDate?.toMillis?.() ?? 0) - (b.dueDate?.toMillis?.() ?? 0))
  }, [subjectAssignments, mySubmissions])
  const overdueCount = pendingAssignments.filter(a => { const d = toDate(a.dueDate); return d ? isPast(d) : false }).length

  if (loading) return <LoadingSpinner />
  if (!subject) return (
    <div className="text-center py-20 text-zinc-400">
      Subject not found. <Link to="/subjects" className="text-brand-500 underline">Go back</Link>
    </div>
  )

  const badge = STATUS_BADGE[status]
  const hasSidebar = teachers.length > 0 || resources.length > 0
  const nextAt = nextLesson ? toDate(nextLesson.startTime) : null
  const nextDue = pendingAssignments[0] ? toDate(pendingAssignments[0].dueDate) : null

  return (
    <div className="space-y-6">
      <Breadcrumb items={[
        { label: 'Home', href: '/dashboard' },
        { label: 'Subjects', href: '/subjects' },
        { label: subject.title },
      ]} />

      {/* ── Hero ── */}
      <div className={cn(PANEL, 'overflow-hidden')}>
        <SubjectCover subject={subject} size="hero" className="h-44 sm:h-60">
          <div className="sm:p-2 space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-mono text-white/70 font-medium">
                Year {subject.programYear} • {curriculum.length} topic{curriculum.length !== 1 ? 's' : ''} • {subjectAssignments.length} assignment{subjectAssignments.length !== 1 ? 's' : ''}
              </span>
              <span className={cn('px-2 py-0.5 text-[10px] font-semibold rounded border backdrop-blur-md', badge.cls)}>{badge.label}</span>
            </div>
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-white tracking-tight">{subject.title}</h1>
            {subject.description && <p className="text-white/75 text-sm line-clamp-2 max-w-2xl">{subject.description}</p>}
          </div>
        </SubjectCover>
      </div>

      {/* ── Stat tiles ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className={cn(PANEL, 'p-4')}>
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="font-medium text-zinc-300 flex items-center gap-1.5"><BookOpen className="w-3.5 h-3.5 text-zinc-500" /> Curriculum progress</span>
            <span className={cn('font-mono font-semibold', STATUS_TEXT[status])}>{curriculum.length ? `${curriculumProgress}%` : '—'}</span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-zinc-800 overflow-hidden mb-2">
            {coveredIds.size > 0
              ? <div className={cn('h-full rounded-full transition-all duration-500', STATUS_BAR[status])} style={{ width: `${curriculumProgress}%` }} />
              : <div className="h-full w-full bg-[repeating-linear-gradient(90deg,#353940_0_6px,transparent_6px_10px)]" />}
          </div>
          <p className="text-[11px] text-zinc-400">
            {curriculum.length ? `${coveredIds.size} / ${curriculum.length} topics covered` : 'No topics yet'}
            {absentCoveredIds.size > 0 && <span className="text-rose-300"> · missed {absentCoveredIds.size}</span>}
          </p>
        </div>

        <div className={cn(PANEL, 'p-4 min-w-0')}>
          <p className="text-xs font-medium text-zinc-300 flex items-center gap-1.5 mb-2"><CalendarClock className="w-3.5 h-3.5 text-ember-secondary" /> Next lesson</p>
          {nextLesson && nextAt ? (
            <>
              <p className="font-display text-sm font-semibold text-zinc-100 truncate">{nextLesson.title}</p>
              <p className="text-[11px] text-zinc-400 mt-1 flex items-center gap-1.5 min-w-0">
                <span className="font-mono text-ember-secondary whitespace-nowrap">{format(nextAt, 'EEE d MMM · HH:mm')}</span>
                <span className="text-zinc-600">•</span>
                {nextLesson.isOnline ? <Video className="w-3 h-3 flex-shrink-0" /> : <MapPin className="w-3 h-3 flex-shrink-0" />}
                <span className="truncate">{nextLesson.isOnline ? 'Online' : nextLesson.classroom}</span>
              </p>
            </>
          ) : <p className="text-[11px] text-zinc-500">Nothing scheduled yet</p>}
        </div>

        <div className={cn(PANEL, 'p-4 min-w-0')}>
          <p className="text-xs font-medium text-zinc-300 flex items-center gap-1.5 mb-2"><ClipboardList className="w-3.5 h-3.5 text-brand-400" /> Assignments</p>
          {subjectAssignments.length === 0 ? (
            <p className="text-[11px] text-zinc-500">No assignments yet</p>
          ) : pendingAssignments.length === 0 ? (
            <p className="text-sm font-semibold text-emerald-300 flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" /> All caught up</p>
          ) : (
            <Link to={`/assignments/${pendingAssignments[0].id}`} className="block group">
              <p className="font-display text-sm font-semibold text-zinc-100 group-hover:text-brand-400 transition-colors">
                {pendingAssignments.length} to hand in
                {overdueCount > 0 && <span className="ml-2 text-[10px] font-sans font-semibold uppercase tracking-wider text-rose-300 bg-rose-500/15 px-1.5 py-0.5 rounded"><AlertTriangle className="inline w-3 h-3 -mt-0.5" /> {overdueCount} overdue</span>}
              </p>
              <p className="text-[11px] text-zinc-400 mt-1 truncate">
                Next: {pendingAssignments[0].title}{nextDue && <span className="font-mono text-brand-300"> · {format(nextDue, 'd MMM')}</span>}
              </p>
            </Link>
          )}
        </div>
      </div>

      <div className={cn(hasSidebar && 'lg:grid lg:grid-cols-[1fr_320px] lg:gap-6 lg:items-start', 'space-y-6 lg:space-y-0')}>
        {/* ── Main column ── */}
        <div className="space-y-6 min-w-0">
          {/* Curriculum timeline per semester */}
          {semesters.map(sem => {
            const items = curriculum.filter(i => i.semester === sem).sort((a, b) => a.order - b.order)
            const done = items.filter(i => coveredIds.has(i.id)).length
            return (
              <section key={sem} className={cn(PANEL, 'p-5')}>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="section-title flex items-center gap-2"><BookOpen /> Semester {sem}</h2>
                  <span className="text-[11px] font-mono text-zinc-400">{done}/{items.length} covered</span>
                </div>
                {items.length === 0 ? (
                  <p className="text-sm text-zinc-500">No topics yet.</p>
                ) : (
                  <ol className="relative space-y-3 pl-7">
                    <span className="absolute left-[9px] top-2 bottom-2 w-0.5 bg-zinc-800" aria-hidden />
                    {items.map(item => {
                      const covered = coveredIds.has(item.id)
                      const wasAbsent = absentCoveredIds.has(item.id)
                      const assignment = item.method === 'Assignment' && item.assignmentId ? assignmentMap[item.assignmentId] : undefined
                      return (
                        <li key={item.id} className="relative">
                          {/* Timeline marker */}
                          <span className={cn(
                            'absolute -left-7 top-3 w-5 h-5 rounded-full flex items-center justify-center ring-4 ring-zinc-900',
                            wasAbsent ? 'bg-rose-500/20 text-rose-300'
                              : covered ? 'bg-emerald-500 text-white shadow-[0_0_8px_rgba(16,185,129,0.6)]'
                              : 'bg-zinc-800 text-zinc-500',
                          )} title={wasAbsent ? 'You were absent during this lesson' : covered ? 'Covered' : 'Upcoming'}>
                            {wasAbsent ? <X className="w-3 h-3" /> : covered ? <Check className="w-3 h-3" /> : <span className="w-1.5 h-1.5 rounded-full bg-zinc-500" />}
                          </span>
                          <div className={cn(
                            'rounded-xl p-3.5 border transition-colors',
                            wasAbsent ? 'bg-rose-950/25 border-rose-800/40'
                              : covered ? 'bg-zinc-950/40 border-emerald-500/15'
                              : 'bg-zinc-950/40 border-white/[0.05]',
                          )}>
                            <div className="flex items-start justify-between gap-3">
                              <p className={cn('text-sm font-semibold', wasAbsent ? 'text-rose-200' : covered ? 'text-emerald-200' : 'text-zinc-100')}>{item.title}</p>
                              {assignment ? (
                                <Link
                                  to={`/assignments/${item.assignmentId}`}
                                  className="flex-shrink-0 max-w-[55%] inline-flex items-center gap-1 text-[11px] font-medium bg-brand-500/15 text-brand-300 border border-brand-500/30 px-2 py-0.5 rounded-md hover:bg-brand-500/25 transition-colors"
                                >
                                  <FileText className="w-3 h-3 flex-shrink-0" /> <span className="truncate">{assignment.title}</span>
                                </Link>
                              ) : item.method ? (
                                <span className="flex-shrink-0 text-[11px] bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded-md">{item.method}</span>
                              ) : null}
                            </div>
                            {item.content && <p className="text-xs text-zinc-400 mt-1.5 leading-relaxed">{item.content}</p>}
                            {wasAbsent && <p className="text-[11px] text-rose-300 mt-1.5">You were absent when this was covered</p>}
                          </div>
                        </li>
                      )
                    })}
                  </ol>
                )}
              </section>
            )
          })}

          {/* Subject videos */}
          {subjectVideos.length > 0 && (
            <section className="space-y-3">
              <h2 className="section-title flex items-center gap-2"><Play /> Videos</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {subjectVideos.map(video => (
                  <Link
                    key={video.id}
                    to={`/video-lab/${video.id}`}
                    className="group rounded-2xl bg-zinc-900 border border-white/[0.06] overflow-hidden shadow-xl transition-all duration-200 hover:-translate-y-[3px] hover:border-brand-500/45"
                  >
                    <div className="relative aspect-video bg-zinc-950 overflow-hidden">
                      <img src={thumbnailUrl(video.cloudinaryPublicId)} alt={video.title} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" loading="lazy" />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity">
                        <div className="w-10 h-10 rounded-full bg-brand-500 flex items-center justify-center shadow-ember">
                          <Play className="w-4 h-4 text-white ml-0.5" />
                        </div>
                      </div>
                      {video.duration > 0 && (
                        <div className="absolute bottom-2 right-2 bg-black/70 text-white text-[10px] font-mono px-1.5 py-0.5 rounded flex items-center gap-0.5">
                          <Clock className="w-2.5 h-2.5" />{Math.floor(video.duration / 60)}:{String(video.duration % 60).padStart(2, '0')}
                        </div>
                      )}
                    </div>
                    <div className="px-4 py-3">
                      <p className="text-sm font-semibold text-zinc-100 line-clamp-1 group-hover:text-brand-400 transition-colors">{video.title}</p>
                      <p className="text-[11px] text-zinc-500 mt-0.5">{video.uploaderName}</p>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* SharePoint Resources — hidden until a SharePoint connection is configured */}
          {sharePointConfigured && (
            <section className="space-y-2">
              <h2 className="section-title">Shared files</h2>
              <SharePointBrowser
                subPath={`Resources/${id}`}
                canDelete={false}
                canUpload={false}
                title="Subject Files"
              />
            </section>
          )}

          {semesters.length === 0 && resources.length === 0 && teachers.length === 0 && subjectVideos.length === 0 && (
            <div className={cn(PANEL, 'text-center py-14 text-zinc-400')}>
              <p className="text-sm">No content has been added to this subject yet.</p>
            </div>
          )}
        </div>

        {/* ── Sidebar ── */}
        {hasSidebar && (
          <aside className="space-y-6 lg:sticky lg:top-6">
            {teachers.length > 0 && (
              <section className={cn(PANEL, 'p-5')}>
                <h2 className="section-title flex items-center gap-2 mb-4"><UserRound /> Teachers</h2>
                <div className="space-y-4">
                  {teachers.map(t => (
                    <div key={t.id} className="flex items-start gap-3">
                      {t.imageUrl ? (
                        <img src={t.imageUrl} alt={t.name} className="w-12 h-12 rounded-full object-cover ring-2 ring-white/10 flex-shrink-0" />
                      ) : (
                        <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center ring-2 ring-white/10 flex-shrink-0">
                          <UserRound className="w-6 h-6 text-zinc-500" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-semibold text-sm text-zinc-100">{t.name}</span>
                          {t.isGuest && <span className="text-[10px] font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/25 px-1.5 py-0.5 rounded">Guest</span>}
                        </div>
                        {t.title && <p className="text-xs text-brand-300 font-medium mt-0.5">{t.title}</p>}
                        {t.description && <p className="text-xs text-zinc-500 mt-1 leading-relaxed line-clamp-3">{t.description}</p>}
                        {t.portfolioUrl && (
                          <a href={t.portfolioUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-400 hover:text-brand-300 mt-1.5">
                            <Globe className="w-3 h-3" /> Portfolio
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {resources.length > 0 && (
              <section className={cn(PANEL, 'p-5')}>
                <h2 className="section-title flex items-center gap-2 mb-3"><Link2 /> Resources</h2>
                <ul className="space-y-1.5">
                  {resources.map(res => (
                    <li key={res.id}>
                      <a
                        href={res.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 bg-zinc-950/40 border border-white/[0.05] hover:border-brand-500/40 transition-colors group"
                      >
                        {res.type === 'link'
                          ? <Link2 className="w-4 h-4 text-ember-secondary flex-shrink-0" />
                          : <FileText className="w-4 h-4 text-amber-400 flex-shrink-0" />}
                        <span className="flex-1 min-w-0 text-sm text-zinc-200 truncate group-hover:text-brand-300 transition-colors">{res.title}</span>
                        <ExternalLink className="w-3.5 h-3.5 flex-shrink-0 text-zinc-500" />
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </aside>
        )}
      </div>
    </div>
  )
}
