import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, ChevronRight, Search, LayoutGrid, List, AlertTriangle, CalendarClock, CheckCircle2, FileText, X } from 'lucide-react'
import { collectionGroup, getDocs } from 'firebase/firestore'
import { format, isPast } from 'date-fns'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useCollection, useDocument, where } from '@/hooks/useFirestore'
import { toDate, cn } from '@/lib/utils'
import type { SubjectDoc, AssignmentDoc, LessonDoc, SyncedEventDoc, CohortDoc, SubmissionDoc, SubjectTeacherDoc } from '@/types'
import LoadingSpinner from '@/components/common/LoadingSpinner'
import SubjectCover   from '@/components/subjects/SubjectCover'
import { SubjectThumb } from '@/components/dashboard/UpcomingCard'

type Status = 'in-progress' | 'completed' | 'not-started'
type Filter = 'all' | Status

const STATUS_LABEL: Record<Status, string> = {
  'in-progress': 'In progress',
  'completed':   'Completed',
  'not-started': 'Not started',
}

// Progress colours: ember while in progress, emerald when complete, muted when unstarted.
const STATUS_BAR: Record<Status, string> = {
  'in-progress': 'bg-brand-500',
  'completed':   'bg-emerald-500',
  'not-started': 'bg-zinc-700',
}
// Dark backing so the tag stays legible on bright photos
const STATUS_PILL: Record<Status, string> = {
  'in-progress': 'bg-black/65 text-brand-300 ring-1 ring-brand-500/40',
  'completed':   'bg-black/65 text-emerald-300 ring-1 ring-emerald-500/40',
  'not-started': 'bg-black/55 text-zinc-300',
}

interface Chip { tone: 'rose' | 'ember' | 'blue' | 'green' | 'muted'; icon: typeof FileText; text: string }
const CHIP_TONE: Record<Chip['tone'], string> = {
  rose:  'bg-rose-500/12 text-rose-300',
  ember: 'bg-brand-500/12 text-brand-300',
  blue:  'bg-ember-secondary/12 text-ember-secondary',
  green: 'bg-emerald-500/12 text-emerald-300',
  muted: 'bg-zinc-800 text-zinc-400',
}

export default function SubjectList() {
  const { profile, cohortId, previewCohortId } = useAuth()
  const effectiveCohortId = previewCohortId ?? cohortId

  const { data: cohort } = useDocument<CohortDoc>('cohorts', effectiveCohortId ?? undefined)
  const { data: allSubjects, loading } = useCollection<SubjectDoc>('subjects')
  const subjects = useMemo(() => allSubjects
    .filter(s => !cohort || s.programYear === cohort.programYear)
    .sort((a, b) => a.order - b.order), [allSubjects, cohort])

  const { data: assignments } = useCollection<AssignmentDoc>(
    'assignments',
    effectiveCohortId ? [where('cohortId', '==', effectiveCohortId)] : [],
    !!effectiveCohortId,
  )

  const { data: lessons } = useCollection<LessonDoc>(
    'lessons',
    effectiveCohortId ? [where('cohortId', '==', effectiveCohortId)] : [],
    !!effectiveCohortId,
    effectiveCohortId ?? '',
  )

  // A curriculum topic can also be covered by a synced Outlook event (e.g. a
  // guest teacher's session), not just a native lesson.
  const { data: syncedEvents } = useCollection<SyncedEventDoc>(
    'synced_events',
    effectiveCohortId ? [where('cohortId', 'in', [effectiveCohortId, 'all'])] : [],
    !!effectiveCohortId,
    `synced-${effectiveCohortId ?? ''}`,
  )

  const { data: submissions } = useCollection<SubmissionDoc>(
    'submissions',
    profile ? [where('studentId', '==', profile.uid)] : [],
    !!profile,
    profile?.uid ?? '',
  )

  // Instructors per subject, from every subjects/{id}/teachers doc in one query
  const [teachersBySubject, setTeachersBySubject] = useState<Record<string, string[]>>({})
  useEffect(() => {
    getDocs(collectionGroup(db, 'teachers'))
      .then(snap => {
        const out: Record<string, (SubjectTeacherDoc & { _sid: string })[]> = {}
        for (const d of snap.docs) {
          const sid = d.ref.parent.parent?.id
          if (!sid || d.ref.parent.parent?.parent.id !== 'subjects') continue
          ;(out[sid] ??= []).push({ ...(d.data() as SubjectTeacherDoc), id: d.id, _sid: sid })
        }
        setTeachersBySubject(Object.fromEntries(Object.entries(out).map(([sid, list]) =>
          [sid, list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map(t => t.name).filter(Boolean)])))
      })
      .catch(() => {})  // instructors are a nice-to-have; the page works without them
  }, [])

  const curriculumProgressBySubject = useMemo(() => {
    const now = new Date()
    const result: Record<string, { covered: number; total: number }> = {}
    for (const subject of subjects) {
      const total = subject.curriculum?.length ?? 0
      if (total === 0) continue
      const coveredIds = new Set<string>()
      for (const l of lessons) {
        if (l.subjectId !== subject.id) continue
        const lessonDate = l.startTime?.toDate?.()
        if (!lessonDate || lessonDate > now) continue
        for (const cid of (l.coveredCurriculumIds ?? [])) coveredIds.add(cid)
      }
      for (const e of syncedEvents) {
        if (e.subjectId !== subject.id) continue
        const eventDate = e.startTime?.toDate?.()
        if (!eventDate || eventDate > now) continue
        for (const cid of (e.coveredCurriculumIds ?? [])) coveredIds.add(cid)
      }
      result[subject.id] = { covered: coveredIds.size, total }
    }
    return result
  }, [subjects, lessons, syncedEvents])

  const overallProgress = useMemo(() => {
    const entries = Object.values(curriculumProgressBySubject)
    if (entries.length === 0) return null
    const totalTopics   = entries.reduce((s, e) => s + e.total, 0)
    const coveredTopics = entries.reduce((s, e) => s + e.covered, 0)
    return { totalTopics, coveredTopics, pct: totalTopics > 0 ? Math.round((coveredTopics / totalTopics) * 100) : 0 }
  }, [curriculumProgressBySubject])

  function statusOf(subjectId: string): Status {
    const cp = curriculumProgressBySubject[subjectId]
    if (!cp || cp.covered === 0) return 'not-started'
    return cp.covered >= cp.total ? 'completed' : 'in-progress'
  }

  // What a student should know about each subject right now
  const chipBySubject = useMemo(() => {
    const now = new Date()
    const submitted = new Set(submissions.filter(s => s.status !== 'draft').map(s => s.assignmentId))
    const out: Record<string, Chip> = {}
    for (const subject of subjects) {
      const published = assignments.filter(a => a.subjectId === subject.id && a.isPublished)
      const pending = published
        .filter(a => !submitted.has(a.id))
        .sort((a, b) => (a.dueDate?.toMillis?.() ?? 0) - (b.dueDate?.toMillis?.() ?? 0))
      const overdue = pending.filter(a => { const d = toDate(a.dueDate); return d ? isPast(d) : false })
      const nextLesson = lessons
        .filter(l => l.subjectId === subject.id && (toDate(l.startTime) ?? now) > now)
        .sort((a, b) => (a.startTime?.toMillis?.() ?? 0) - (b.startTime?.toMillis?.() ?? 0))[0]

      if (overdue.length > 0) {
        out[subject.id] = { tone: 'rose', icon: AlertTriangle, text: `${overdue.length} overdue · ${overdue[0].title}` }
      } else if (pending.length > 0) {
        const due = toDate(pending[0].dueDate)
        out[subject.id] = { tone: 'ember', icon: FileText, text: `${pending.length} assignment${pending.length !== 1 ? 's' : ''} due${due ? ` · ${format(due, 'd MMM')}` : ''}` }
      } else if (nextLesson) {
        const at = toDate(nextLesson.startTime)
        out[subject.id] = { tone: 'blue', icon: CalendarClock, text: `Next: ${nextLesson.title}${at ? ` · ${format(at, 'EEE d MMM')}` : ''}` }
      } else if (published.length > 0) {
        out[subject.id] = { tone: 'green', icon: CheckCircle2, text: 'All caught up' }
      } else {
        out[subject.id] = { tone: 'muted', icon: CalendarClock, text: 'Nothing scheduled yet' }
      }
    }
    return out
  }, [subjects, assignments, submissions, lessons])

  // ── Controls ──────────────────────────────────────────────────────────────
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery]   = useState('')
  const [layout, setLayout] = useState<'grid' | 'list'>(() => {
    try { return localStorage.getItem('subjectsLayout') === 'list' ? 'list' : 'grid' } catch { return 'grid' }
  })
  function chooseLayout(l: 'grid' | 'list') {
    setLayout(l)
    try { localStorage.setItem('subjectsLayout', l) } catch {}
  }

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: subjects.length, 'in-progress': 0, completed: 0, 'not-started': 0 }
    for (const s of subjects) c[statusOf(s.id)]++
    return c
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjects, curriculumProgressBySubject])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return subjects.filter(s => {
      if (filter !== 'all' && statusOf(s.id) !== filter) return false
      if (!q) return true
      const haystack = [
        s.title, s.description,
        ...(teachersBySubject[s.id] ?? []),
        ...(s.curriculum ?? []).map(c => c.title),
      ].join(' ').toLowerCase()
      return haystack.includes(q)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjects, filter, query, teachersBySubject, curriculumProgressBySubject])

  if (loading) return <LoadingSpinner />

  const subtitle = [cohort?.name, cohort?.programYear ? `Year ${cohort.programYear}` : null, `${subjects.length} subject${subjects.length !== 1 ? 's' : ''}`]
    .filter(Boolean).join(' · ')

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div>
        <p className="text-[11px] font-semibold text-brand-300 uppercase tracking-widest">Curriculum</p>
        <h1 className="page-title">Subjects</h1>
        <p className="text-zinc-400 text-sm mt-1">{subtitle}</p>
      </div>

      {/* ── Overall progress meter ── */}
      {overallProgress && (
        <div className="rounded-2xl bg-zinc-900 p-5 space-y-3 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-zinc-200">Overall curriculum progress</p>
            <span className="text-sm font-bold text-brand-300">{overallProgress.pct}%</span>
          </div>

          {/* One continuous bar — the per-subject segmented version read as scattered blocks */}
          <div className="h-2.5 rounded-full overflow-hidden bg-zinc-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-brand-600 to-brand-400 shadow-[0_0_10px_rgba(255,107,53,0.6)] transition-all duration-700"
              style={{ width: `${overallProgress.pct}%` }}
            />
          </div>
          <p className="text-xs text-zinc-500">{overallProgress.coveredTopics} of {overallProgress.totalTopics} topics covered</p>

          {/* Subject status breakdown — doubles as quick filters */}
          <div className="grid grid-cols-3 gap-2 pt-1">
            {(['completed', 'in-progress', 'not-started'] as const).map(st => (
              <button
                key={st}
                onClick={() => setFilter(filter === st ? 'all' : st)}
                className={cn(
                  'flex items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors',
                  filter === st ? 'bg-zinc-800 ring-1 ring-white/10' : 'bg-zinc-950/40 hover:bg-zinc-800',
                )}
              >
                <span className={cn('w-2 h-2 rounded-full flex-shrink-0', STATUS_BAR[st])} />
                <span className="min-w-0">
                  <span className="block font-display text-lg font-bold leading-none text-zinc-100">{counts[st]}</span>
                  <span className="block text-[10px] uppercase tracking-wider text-zinc-500 mt-1 truncate">{STATUS_LABEL[st]}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Controls: filters, search, layout ── */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-2 overflow-x-auto pb-0.5 -mx-4 px-4 sm:mx-0 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {(['all', 'in-progress', 'completed', 'not-started'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                'flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-medium transition-all whitespace-nowrap',
                filter === f
                  ? 'bg-brand-500 text-white font-semibold shadow-[0_0_12px_rgba(255,107,53,0.4)]'
                  : 'bg-zinc-900 text-zinc-400 hover:text-zinc-100',
              )}
            >
              {f === 'all' ? 'All' : STATUS_LABEL[f]} ({counts[f]})
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 sm:ml-auto">
          <div className="relative flex-1 sm:w-64 sm:flex-none">
            <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search subjects, topics, teachers…"
              className="input pl-9 pr-8 py-2 rounded-xl"
            />
            {query && (
              <button onClick={() => setQuery('')} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-500 hover:text-zinc-200">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="flex p-1 rounded-xl bg-zinc-900 flex-shrink-0">
            {(['grid', 'list'] as const).map(l => (
              <button
                key={l}
                onClick={() => chooseLayout(l)}
                aria-label={l === 'grid' ? 'Grid view' : 'List view'}
                className={cn('p-1.5 rounded-lg transition-colors', layout === l ? 'bg-zinc-800 text-brand-300' : 'text-zinc-500 hover:text-zinc-200')}
              >
                {l === 'grid' ? <LayoutGrid className="w-4 h-4" /> : <List className="w-4 h-4" />}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Subjects ── */}
      {visible.length === 0 ? (
        <div className="rounded-2xl bg-zinc-900/60 py-14 text-center">
          <p className="text-sm text-zinc-400">No subjects match{query ? ` “${query}”` : ''}.</p>
          {(query || filter !== 'all') && (
            <button onClick={() => { setQuery(''); setFilter('all') }} className="mt-2 text-xs font-semibold text-brand-300 hover:text-brand-200">Clear filters</button>
          )}
        </div>
      ) : layout === 'grid' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {visible.map(subject => {
            const cp       = curriculumProgressBySubject[subject.id]
            const status   = statusOf(subject.id)
            const pct      = cp ? Math.round((cp.covered / cp.total) * 100) : 0
            const chip     = chipBySubject[subject.id]
            const teachers = teachersBySubject[subject.id] ?? []
            const cta      = status === 'completed' ? 'Review' : status === 'in-progress' ? 'Continue' : 'Open'
            return (
              <Link
                key={subject.id}
                to={`/subjects/${subject.id}`}
                className="group flex flex-col h-full rounded-2xl bg-zinc-900 overflow-hidden shadow-sm ring-1 ring-white/5 hover:ring-white/15 hover:-translate-y-0.5 transition-all"
              >
                {/* Zone 1: 16:9 thumbnail with status tag */}
                <div className="relative">
                  <SubjectCover subject={subject} className="aspect-video" />
                  <span className={cn('absolute top-2.5 right-2.5 px-2 py-0.5 rounded-full backdrop-blur-md text-[10px] font-semibold uppercase tracking-wider', STATUS_PILL[status])}>
                    {STATUS_LABEL[status]}
                  </span>
                </div>

                {/* Zone 2: title, sub-label, instructors, status chip */}
                <div className="flex-1 flex flex-col gap-2 px-4 pt-3.5">
                  <div>
                    <h3 className="font-display text-base font-semibold text-zinc-100 leading-snug">{subject.title}</h3>
                    <p className="text-xs text-zinc-400 mt-0.5 line-clamp-1 min-h-[1rem]">
                      {subject.description || `Year ${subject.programYear}`}
                    </p>
                  </div>
                  <p className="text-xs text-zinc-500 truncate">
                    {teachers.length > 0 ? <>with <span className="text-zinc-300">{teachers.join(', ')}</span></> : 'Instructor to be announced'}
                  </p>
                  {chip && (
                    <span className={cn('self-start inline-flex items-center gap-1.5 max-w-full px-2.5 py-1 rounded-lg text-[11px] font-medium', CHIP_TONE[chip.tone])}>
                      <chip.icon className="w-3.5 h-3.5 flex-shrink-0" />
                      <span className="truncate">{chip.text}</span>
                    </span>
                  )}
                </div>

                {/* Zone 3: consistent footer — progress + CTA */}
                <div className="px-4 pt-3 pb-4 mt-3 border-t border-white/5 space-y-2">
                  <div className="h-1.5 rounded-full overflow-hidden bg-zinc-800">
                    {cp && cp.covered > 0
                      ? <div className={cn('h-full rounded-full transition-all', STATUS_BAR[status])} style={{ width: `${pct}%` }} />
                      : <div className="h-full w-full bg-[repeating-linear-gradient(90deg,#353940_0_6px,transparent_6px_10px)]" />}
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-400">
                      {cp ? <>{cp.covered} / {cp.total} topics · <span className={status === 'completed' ? 'text-emerald-300' : status === 'in-progress' ? 'text-brand-300' : ''}>{pct}%</span></> : 'No topics yet'}
                    </span>
                    <span className="flex items-center gap-1 font-semibold text-brand-300 group-hover:text-brand-200 transition-colors">
                      {cta} <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map(subject => {
            const cp       = curriculumProgressBySubject[subject.id]
            const status   = statusOf(subject.id)
            const pct      = cp ? Math.round((cp.covered / cp.total) * 100) : 0
            const chip     = chipBySubject[subject.id]
            const teachers = teachersBySubject[subject.id] ?? []
            return (
              <Link
                key={subject.id}
                to={`/subjects/${subject.id}`}
                className="group flex items-center gap-3 p-3 rounded-xl bg-zinc-900 hover:bg-zinc-800 transition-colors"
              >
                <SubjectThumb subject={subject} className="w-14 h-14 rounded-xl" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <p className="font-display text-sm font-semibold text-zinc-100 truncate">{subject.title}</p>
                    <span className={cn('hidden sm:inline px-2 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-wider flex-shrink-0', STATUS_PILL[status])}>
                      {STATUS_LABEL[status]}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-500 truncate">
                    {teachers.length > 0 ? teachers.join(', ') : 'Instructor to be announced'}
                  </p>
                  {chip && (
                    <p className={cn('mt-1 inline-flex items-center gap-1 max-w-full text-[11px] font-medium', CHIP_TONE[chip.tone].split(' ').filter(c => c.startsWith('text-')).join(' '))}>
                      <chip.icon className="w-3 h-3 flex-shrink-0" />
                      <span className="truncate">{chip.text}</span>
                    </p>
                  )}
                </div>
                <div className="w-24 sm:w-32 flex-shrink-0 space-y-1">
                  <div className="h-1.5 rounded-full overflow-hidden bg-zinc-800">
                    {cp && cp.covered > 0
                      ? <div className={cn('h-full rounded-full', STATUS_BAR[status])} style={{ width: `${pct}%` }} />
                      : <div className="h-full w-full bg-[repeating-linear-gradient(90deg,#353940_0_6px,transparent_6px_10px)]" />}
                  </div>
                  <p className="text-[10px] text-zinc-500 text-right">{cp ? `${cp.covered}/${cp.total} topics` : 'No topics yet'}</p>
                </div>
                <ChevronRight className="w-4 h-4 text-zinc-500 group-hover:text-zinc-200 flex-shrink-0" />
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
