import { useState, useMemo, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { isPast } from 'date-fns'
import { Eye, BookOpen, CalendarDays, Users, ChevronRight } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useCollection, where } from '@/hooks/useFirestore'
import { shortDate, timeStr, toDate } from '@/lib/utils'
import type { CohortDoc, LessonDoc, AssignmentDoc, SubjectDoc, UserDoc } from '@/types'
import LoadingSpinner from '@/components/common/LoadingSpinner'

export default function StudentPreview() {
  const [selectedId, setSelectedId] = useState<string>('')
  const { setPreviewCohortId } = useAuth()

  const { data: cohorts,  loading: cohortsLoading } = useCollection<CohortDoc>('cohorts')
  const { data: subjects }                           = useCollection<SubjectDoc>('subjects')
  const { data: students }                           = useCollection<UserDoc>('users', [where('role', '==', 'student')])

  // Derive cohortId synchronously — no useEffect delay
  const cohortId = selectedId || cohorts[0]?.id || ''

  // Keep previewCohortId in AuthContext in sync so student routes work when admin navigates into them.
  // No cleanup — the cohortId must persist after unmount so student route pages can read it.
  // AdminLayout clears it when admin returns to admin routes.
  useEffect(() => {
    if (cohortId) setPreviewCohortId(cohortId)
  }, [cohortId])

  const { data: rawLessons } = useCollection<LessonDoc>(
    'lessons',
    cohortId ? [where('cohortId', '==', cohortId)] : [],
    !!cohortId,
    cohortId,
  )

  const { data: rawAssignments } = useCollection<AssignmentDoc>(
    'assignments',
    cohortId ? [where('cohortId', '==', cohortId)] : [],
    !!cohortId,
    cohortId,
  )

  const selectedCohort = cohorts.find(c => c.id === cohortId)

  const subjectMap = useMemo(
    () => Object.fromEntries(subjects.map(s => [s.id, s])),
    [subjects],
  )

  const now      = new Date()
  const lessons  = useMemo(
    () => [...rawLessons].sort((a, b) => (a.startTime?.toMillis?.() ?? 0) - (b.startTime?.toMillis?.() ?? 0)),
    [rawLessons],
  )
  const assignments = useMemo(
    () => [...rawAssignments].sort((a, b) => (a.dueDate?.toMillis?.() ?? 0) - (b.dueDate?.toMillis?.() ?? 0)),
    [rawAssignments],
  )
  const upcoming       = lessons.filter(l => (toDate(l.startTime) ?? now) >= now).slice(0, 6)
  const published      = assignments.filter(a => a.isPublished)
  const overdue        = published.filter(a => isPast(toDate(a.dueDate) ?? now))
  const cohortStudents = students.filter(s => s.cohortId === cohortId)

  const greeting = () => {
    const h = now.getHours()
    if (h < 12) return 'Good morning'
    if (h < 18) return 'Good afternoon'
    return 'Good evening'
  }

  if (cohortsLoading) return <LoadingSpinner />

  if (cohorts.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <Eye className="w-5 h-5 text-rose-400" />
          <h1 className="page-title">Student Preview</h1>
        </div>
        <div className="bg-zinc-900 rounded-2xl border border-white/10 p-8 text-center">
          <p className="text-zinc-400 text-sm">No classes yet. Create one in Class Manager.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header — class switcher inline */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Eye className="w-5 h-5 text-rose-400" />
            <h1 className="page-title">Student Preview</h1>
          </div>
          {cohorts.length > 1 && (
            <select
              value={cohortId}
              onChange={e => setSelectedId(e.target.value)}
              className="input w-auto"
            >
              {cohorts.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
        </div>

        {/* Stats strip */}
        <div className="flex items-center gap-4 text-sm">
          <span className="flex items-center gap-1.5 text-zinc-500">
            <Users className="w-4 h-4" /> {cohortStudents.length} students
          </span>
          <span className="flex items-center gap-1.5 text-zinc-500">
            <CalendarDays className="w-4 h-4" /> {upcoming.length} upcoming
          </span>
          {overdue.length > 0 && (
            <span className="flex items-center gap-1.5 text-rose-500 font-medium">
              <BookOpen className="w-4 h-4" /> {overdue.length} overdue
            </span>
          )}
        </div>
      </div>

      {/* Preview frame */}
      <div className="relative bg-zinc-900 rounded-2xl overflow-hidden ring-2 ring-rose-400/30">
        {/* Preview banner */}
        <div className="bg-rose-600 text-white text-xs font-semibold px-4 py-2 flex items-center gap-2 sticky top-0 z-10">
          <Eye className="w-3.5 h-3.5" />
          ADMIN PREVIEW — {selectedCohort?.name} · Year {selectedCohort?.programYear}
        </div>

        <div className="p-6 space-y-8 bg-zinc-900/50">
          {/* Greeting */}
          <div>
            <h2 className="text-2xl font-bold text-zinc-100">{greeting()}, Student 👋</h2>
            <p className="text-zinc-500 mt-1">Keep up the great work on your filmmaking journey.</p>
          </div>

          {/* Subjects */}
          {subjects.length > 0 && (
            <div>
              <h3 className="text-base font-semibold text-zinc-200 mb-3">Subjects</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {subjects.map(s => (
                  <Link
                    key={s.id}
                    to={`/subjects/${s.id}`}
                    className="group bg-zinc-900 rounded-xl border border-white/10 p-4 flex items-center gap-3 hover:border-brand-300 hover:shadow-sm transition-all"
                  >
                    <span className="text-2xl">{s.iconEmoji}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-zinc-200 truncate">{s.title}</p>
                      <p className="text-xs text-zinc-400">Year {s.programYear}</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-zinc-300 group-hover:text-brand-500 flex-shrink-0 transition-colors" />
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Upcoming lessons */}
          <div>
            <h3 className="text-base font-semibold text-zinc-200 mb-3">Upcoming Lessons</h3>
            {lessons.length === 0
              ? <p className="text-sm text-zinc-400">No lessons scheduled for this class.</p>
              : upcoming.length === 0
                ? <p className="text-sm text-zinc-400">No upcoming lessons — all scheduled lessons are in the past.</p>
                : (
                  <div className="space-y-2">
                    {upcoming.map(lesson => {
                      const subj = subjectMap[lesson.subjectId]
                      return (
                        <div key={lesson.id} className="bg-zinc-900 rounded-xl border border-white/10 p-4 flex items-center gap-4">
                          <div className={`w-1 self-stretch rounded-full ${subj?.color ?? 'bg-brand-500'}`} />
                          <div className="flex-1">
                            <p className="text-sm font-semibold text-zinc-200">{lesson.title}</p>
                            <p className="text-xs text-zinc-500 mt-0.5">
                              {subj?.title} · {shortDate(lesson.startTime)} {timeStr(lesson.startTime)}–{timeStr(lesson.endTime)}
                              {lesson.classroom ? ` · ${lesson.isOnline ? '🌐' : '📍'} ${lesson.classroom}` : ''}
                            </p>
                          </div>
                          {lesson.isOnline && (
                            <span className="text-xs bg-sky-100 text-sky-700 px-2 py-0.5 rounded-full font-medium">Online</span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )
            }
          </div>

          {/* Assignments */}
          <div>
            <h3 className="text-base font-semibold text-zinc-200 mb-3">
              Assignments
              {overdue.length > 0 && (
                <span className="ml-2 text-xs bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full">
                  {overdue.length} overdue
                </span>
              )}
            </h3>
            {published.length === 0
              ? <p className="text-sm text-zinc-400">No published assignments for this class.</p>
              : (
                <div className="space-y-2">
                  {published.map(a => {
                    const subj   = subjectMap[a.subjectId]
                    const due    = toDate(a.dueDate)
                    const isOver = due ? isPast(due) : false
                    return (
                      <div key={a.id} className="bg-zinc-900 rounded-xl border border-white/10 p-4 flex items-center gap-4">
                        <div className={`w-1 self-stretch rounded-full ${subj?.color ?? 'bg-brand-500'}`} />
                        <div className="flex-1">
                          <p className="text-sm font-semibold text-zinc-200">{a.title}</p>
                          <p className="text-xs text-zinc-500 mt-0.5">
                            {subj?.title} · Due {shortDate(a.dueDate)} · {a.pointsValue} pts
                          </p>
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          isOver ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'
                        }`}>
                          {isOver ? 'Overdue' : 'Pending'}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )
            }
          </div>
        </div>
      </div>
    </div>
  )
}
