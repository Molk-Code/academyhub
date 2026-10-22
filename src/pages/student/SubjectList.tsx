import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight, ChevronRight, Search, LayoutGrid, List, AlertTriangle, CalendarClock, CheckCircle2,
  FileText, X, UserCheck, Check,
} from 'lucide-react'
import { collectionGroup, getDocs } from 'firebase/firestore'
import { format, isPast } from 'date-fns'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useCollection, useDocument, where } from '@/hooks/useFirestore'
import { toDate, cn } from '@/lib/utils'
import type { SubjectDoc, AssignmentDoc, LessonDoc, SyncedEventDoc, CohortDoc, SubmissionDoc, SubjectTeacherDoc, SemesterSettingsDoc } from '@/types'
import LoadingSpinner from '@/components/common/LoadingSpinner'
import SubjectCover   from '@/components/subjects/SubjectCover'
import { SubjectThumb } from '@/components/dashboard/UpcomingCard'

type Status = 'in-progress' | 'completed' | 'not-started'
type Filter = 'all' | Status
type Sort = 'order' | 'progress' | 'alpha'

const FILTER_LABEL: Record<Filter, string> = {
  'all':         'All subjects',
  'in-progress': 'In progress',
  'completed':   'Completed',
  'not-started': 'Not started',
}
// Badge in the card content zone
const STATUS_BADGE: Record<Status, { label: string; cls: string }> = {
  'in-progress': { label: 'Active',    cls: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  'completed':   { label: 'Completed', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
  'not-started': { label: 'Upcoming',  cls: 'bg-zinc-800 text-zinc-400 border-zinc-700' },
}
// Progress colours: ember while in progress, emerald when complete, muted when unstarted.
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

interface Chip { tone: 'rose' | 'ember' | 'blue' | 'green' | 'muted'; icon: typeof FileText; text: string }
const CHIP_TEXT: Record<Chip['tone'], string> = {
  rose:  'text-rose-300',
  ember: 'text-brand-300',
  blue:  'text-ember-secondary',
  green: 'text-emerald-300',
  muted: 'text-zinc-500',
}

export default function SubjectList() {
  const { profile, cohortId, previewCohortId } = useAuth()
  const effectiveCohortId = previewCohortId ?? cohortId

  const { data: cohort } = useDocument<CohortDoc>('cohorts', effectiveCohortId ?? undefined)
  const { data: semester } = useDocument<SemesterSettingsDoc>('settings', 'semester')
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
        const out: Record<string, SubjectTeacherDoc[]> = {}
        for (const d of snap.docs) {
          const parent = d.ref.parent.parent
          if (!parent || parent.parent.id !== 'subjects') continue
          ;(out[parent.id] ??= []).push({ ...(d.data() as SubjectTeacherDoc), id: d.id })
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
        out[subject.id] = { tone: 'rose', icon: AlertTriangle, text: `${overdue.length} overdue` }
      } else if (pending.length > 0) {
        const due = toDate(pending[0].dueDate)
        out[subject.id] = { tone: 'ember', icon: FileText, text: `${pending.length} due${due ? ` ${format(due, 'd MMM')}` : ''}` }
      } else if (nextLesson) {
        const at = toDate(nextLesson.startTime)
        out[subject.id] = { tone: 'blue', icon: CalendarClock, text: `Next ${at ? format(at, 'EEE d MMM') : 'lesson'}` }
      } else if (published.length > 0) {
        out[subject.id] = { tone: 'green', icon: CheckCircle2, text: 'All caught up' }
      } else {
        out[subject.id] = { tone: 'muted', icon: CalendarClock, text: 'Nothing scheduled' }
      }
    }
    return out
  }, [subjects, assignments, submissions, lessons])

  // Current term from the class's own semester dates, falling back to the school's
  const term = useMemo(() => {
    const today = format(new Date(), 'yyyy-MM-dd')
    const s1 = { start: cohort?.semesterStartDate ?? semester?.startDate, end: cohort?.semesterEndDate ?? semester?.endDate }
    const s2 = { start: cohort?.semesterSem2StartDate ?? semester?.sem2Start, end: cohort?.semesterSem2EndDate ?? semester?.sem2End }
    const label = (start: string) => {
      const d = new Date(`${start}T12:00:00`)
      return `${d.getMonth() >= 6 ? 'Autumn' : 'Spring'} term ${d.getFullYear()}`
    }
    for (const t of [s1, s2]) {
      if (t.start && t.end && today >= t.start && today <= t.end) return { label: label(t.start), active: true }
    }
    const next = [s1, s2].find(t => t.start && today < t.start)
    return next?.start ? { label: label(next.start), active: false } : null
  }, [cohort, semester])

  // ── Controls ──────────────────────────────────────────────────────────────
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery]   = useState('')
  const [sort, setSort]     = useState<Sort>('order')
  const [layout, setLayout] = useState<'grid' | 'list'>(() => {
    try { return localStorage.getItem('subjectsLayout') === 'list' ? 'list' : 'grid' } catch { return 'grid' }
  })
  function chooseLayout(l: 'grid' | 'list') {
    setLayout(l)
    try { localStorage.setItem('subjectsLayout', l) } catch {}
  }

  // ⌘K / Ctrl+K focuses search
  const searchRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); searchRef.current?.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: subjects.length, 'in-progress': 0, completed: 0, 'not-started': 0 }
    for (const s of subjects) c[statusOf(s.id)]++
    return c
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjects, curriculumProgressBySubject])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const pctOf = (id: string) => { const cp = curriculumProgressBySubject[id]; return cp ? cp.covered / cp.total : -1 }
    const list = subjects.filter(s => {
      if (filter !== 'all' && statusOf(s.id) !== filter) return false
      if (!q) return true
      const haystack = [
        s.title, s.description,
        ...(teachersBySubject[s.id] ?? []),
        ...(s.curriculum ?? []).map(c => c.title),
      ].join(' ').toLowerCase()
      return haystack.includes(q)
    })
    if (sort === 'alpha') return [...list].sort((a, b) => a.title.localeCompare(b.title, 'sv'))
    if (sort === 'progress') return [...list].sort((a, b) => pctOf(b.id) - pctOf(a.id) || a.order - b.order)
    return list
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjects, filter, query, sort, teachersBySubject, curriculumProgressBySubject])

  if (loading) return <LoadingSpinner />

  return (
    <div className="space-y-6">
      {/* ── Control header — pinned on desktop while the grid scrolls ── */}
      <section className="lg:sticky lg:top-0 z-10 -mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 -mt-5 pt-5 lg:-mt-8 lg:pt-8 pb-5 bg-[rgba(16,20,26,0.92)] backdrop-blur-md border-b border-white/5 space-y-5">
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
            {cohort?.name && <><span className="text-zinc-600">•</span><span>{cohort.name}{cohort.programYear ? ` · Year ${cohort.programYear}` : ''}</span></>}
          </p>
        </div>

        {/* Wraps instead of overflowing: one line on wide screens, stacks when narrower */}
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
            {(['all', 'in-progress', 'completed', 'not-started'] as const).map(f => (
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
      </section>

      {/* ── Subjects ── */}
      {visible.length === 0 ? (
        <div className="rounded-2xl bg-zinc-900/60 py-14 text-center">
          <p className="text-sm text-zinc-400">No subjects match{query ? ` “${query}”` : ''}.</p>
          {(query || filter !== 'all') && (
            <button onClick={() => { setQuery(''); setFilter('all') }} className="mt-2 text-xs font-semibold text-brand-300 hover:text-brand-200">Clear filters</button>
          )}
        </div>
      ) : layout === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {visible.map(subject => {
            const cp       = curriculumProgressBySubject[subject.id]
            const status   = statusOf(subject.id)
            const pct      = cp ? Math.round((cp.covered / cp.total) * 100) : 0
            const chip     = chipBySubject[subject.id]
            const teachers = teachersBySubject[subject.id] ?? []
            const topics   = subject.curriculum ?? []
            const blurb    = subject.description || (topics.length > 0 ? `Covers ${topics.slice(0, 4).map(t => t.title).join(', ')}${topics.length > 4 ? '…' : '.'}` : '')
            const badge    = STATUS_BADGE[status]
            const cta      = status === 'completed'
              ? { label: 'Review module', cls: 'text-emerald-400 group-hover:text-emerald-300', Icon: ArrowRight }
              : status === 'in-progress'
                ? { label: 'Continue module', cls: 'text-brand-400 group-hover:text-brand-300', Icon: ArrowRight }
                : { label: 'Explore syllabus', cls: 'text-zinc-400 group-hover:text-zinc-200', Icon: ChevronRight }
            return (
              <Link
                key={subject.id}
                to={`/subjects/${subject.id}`}
                className="group flex flex-col justify-between h-full rounded-2xl bg-zinc-900 border border-white/[0.06] overflow-hidden shadow-xl transition-all duration-200 ease-out hover:-translate-y-[3px] hover:border-brand-500/45 hover:shadow-[0_16px_32px_-8px_rgba(0,0,0,0.65),0_0_20px_-6px_rgba(255,107,53,0.15)]"
              >
                <div>
                  {/* Zone 1: 16:9 media header */}
                  <div className="relative overflow-hidden">
                    <SubjectCover subject={subject} className="aspect-video transition-transform duration-500 group-hover:scale-105" />
                  </div>

                  {/* Zone 2: content & instructors */}
                  <div className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <span className="text-[11px] font-mono text-zinc-500 font-medium">
                          Year {subject.programYear} • {topics.length} topic{topics.length !== 1 ? 's' : ''}
                        </span>
                        <h2 className="font-display text-base font-bold text-white tracking-tight mt-0.5 group-hover:text-brand-400 transition-colors">
                          {subject.title}
                        </h2>
                      </div>
                      <span className={cn('px-2 py-0.5 text-[10px] font-semibold rounded border flex-shrink-0', badge.cls)}>{badge.label}</span>
                    </div>
                    <p className="text-xs text-zinc-400 mt-2 line-clamp-2 min-h-[2rem]">{blurb}</p>
                    <div className="flex items-center gap-2 mt-4 text-[11px] text-zinc-400 min-w-0">
                      <UserCheck className="w-3.5 h-3.5 flex-shrink-0" />
                      <span className="truncate">{teachers.length > 0 ? teachers.join(', ') : 'Instructor to be announced'}</span>
                    </div>
                  </div>
                </div>

                {/* Zone 3: standardized progress & action footer */}
                <div className="p-5 pt-0">
                  <div className="bg-zinc-950/50 rounded-xl p-3 border border-white/[0.05]">
                    <div className="flex items-center justify-between text-xs mb-2">
                      <span className="font-medium text-zinc-300">Curriculum progress</span>
                      <span className={cn('font-mono font-semibold', STATUS_TEXT[status])}>{cp ? `${pct}%` : '—'}</span>
                    </div>
                    <div className="w-full h-1.5 rounded-full bg-zinc-800 overflow-hidden mb-2">
                      {cp && cp.covered > 0
                        ? <div className={cn('h-full rounded-full', STATUS_BAR[status])} style={{ width: `${pct}%` }} />
                        : <div className="h-full w-full bg-[repeating-linear-gradient(90deg,#353940_0_6px,transparent_6px_10px)]" />}
                    </div>
                    <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-400 pt-1">
                      {status === 'completed'
                        ? <span className="text-emerald-400 font-medium flex items-center gap-1 whitespace-nowrap"><Check className="w-3 h-3" /> {cp!.covered} / {cp!.total} topics</span>
                        : <span className="whitespace-nowrap">{cp ? `${cp.covered} / ${cp.total} topics` : 'No topics yet'}</span>}
                      {/* Only actionable chips here — "Nothing scheduled" just crowds the footer */}
                      {chip && chip.tone !== 'muted' && (
                        <span className={cn('flex items-center gap-1 min-w-0', CHIP_TEXT[chip.tone])}>
                          <chip.icon className="w-3 h-3 flex-shrink-0" />
                          <span className="truncate">{chip.text}</span>
                        </span>
                      )}
                    </div>
                  </div>
                  <div className={cn('mt-4 text-xs font-semibold flex items-center gap-1.5 transition-colors', cta.cls)}>
                    <span>{cta.label}</span>
                    <cta.Icon className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
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
            const badge    = STATUS_BADGE[status]
            return (
              <Link
                key={subject.id}
                to={`/subjects/${subject.id}`}
                className="group flex items-center gap-3 p-3 rounded-xl bg-zinc-900 border border-white/[0.06] hover:border-brand-500/40 transition-colors"
              >
                <SubjectThumb subject={subject} className="w-14 h-14 rounded-xl" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <p className="font-display text-sm font-semibold text-zinc-100 truncate group-hover:text-brand-400 transition-colors">{subject.title}</p>
                    <span className={cn('hidden sm:inline px-1.5 py-0.5 rounded border text-[9px] font-semibold flex-shrink-0', badge.cls)}>{badge.label}</span>
                  </div>
                  <p className="text-xs text-zinc-500 truncate flex items-center gap-1.5">
                    <UserCheck className="w-3 h-3 flex-shrink-0" />
                    {teachers.length > 0 ? teachers.join(', ') : 'Instructor to be announced'}
                  </p>
                  {chip && (
                    <p className={cn('mt-1 inline-flex items-center gap-1 max-w-full text-[11px] font-medium', CHIP_TEXT[chip.tone])}>
                      <chip.icon className="w-3 h-3 flex-shrink-0" />
                      <span className="truncate">{chip.text}</span>
                    </p>
                  )}
                </div>
                <div className="w-24 sm:w-36 flex-shrink-0 space-y-1">
                  <div className="h-1.5 rounded-full overflow-hidden bg-zinc-800">
                    {cp && cp.covered > 0
                      ? <div className={cn('h-full rounded-full', STATUS_BAR[status])} style={{ width: `${pct}%` }} />
                      : <div className="h-full w-full bg-[repeating-linear-gradient(90deg,#353940_0_6px,transparent_6px_10px)]" />}
                  </div>
                  <p className="text-[10px] text-zinc-500 text-right font-mono">{cp ? `${cp.covered}/${cp.total} · ${pct}%` : 'No topics'}</p>
                </div>
                <ChevronRight className="w-4 h-4 text-zinc-500 group-hover:text-zinc-200 flex-shrink-0" />
              </Link>
            )
          })}
        </div>
      )}

      {/* ── Status strip: course states + total term completion ── */}
      <footer className="rounded-2xl border border-white/[0.06] bg-zinc-900/60 px-5 py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-zinc-400">
        <div className="flex items-center gap-x-4 gap-y-2 flex-wrap">
          {([
            ['in-progress', 'bg-brand-500',  `${counts['in-progress']} active`],
            ['completed',   'bg-emerald-500', `${counts.completed} completed`],
            ['not-started', 'bg-zinc-600',   `${counts['not-started']} unstarted`],
          ] as const).map(([f, dot, label]) => (
            <button
              key={f}
              onClick={() => setFilter(filter === f ? 'all' : f)}
              className={cn('flex items-center gap-2 transition-colors hover:text-zinc-100', filter === f ? 'text-zinc-100 font-semibold' : f === 'not-started' ? '' : 'text-zinc-300 font-medium')}
            >
              <span className={cn('w-2 h-2 rounded-full', dot)} />
              {label}
            </button>
          ))}
        </div>
        {overallProgress && (
          <div className="flex items-center gap-3 text-[11px]">
            <span className="text-zinc-400">Total term completion:</span>
            <div className="w-28 h-2 rounded-full bg-zinc-800 overflow-hidden">
              <div className="h-full bg-brand-500 rounded-full" style={{ width: `${overallProgress.pct}%` }} />
            </div>
            <span className="font-mono text-zinc-300 font-bold">{overallProgress.pct}%</span>
            <span className="text-zinc-500">({overallProgress.coveredTopics}/{overallProgress.totalTopics} topics)</span>
          </div>
        )}
      </footer>
    </div>
  )
}
