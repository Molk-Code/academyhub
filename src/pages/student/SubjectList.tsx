import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useCollection, useDocument, where } from '@/hooks/useFirestore'
import type { SubjectDoc, AssignmentDoc, LessonDoc, CohortDoc } from '@/types'
import LoadingSpinner from '@/components/common/LoadingSpinner'

export default function SubjectList() {
  const { cohortId, previewCohortId } = useAuth()
  const effectiveCohortId = previewCohortId ?? cohortId

  const { data: cohort } = useDocument<CohortDoc>('cohorts', effectiveCohortId ?? undefined)
  const { data: allSubjects, loading } = useCollection<SubjectDoc>('subjects')
  const subjects = allSubjects
    .filter(s => !cohort || s.programYear === cohort.programYear)
    .sort((a, b) => a.order - b.order)

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

  const assignmentsBySubject = useMemo(() => assignments.reduce<Record<string, number>>((acc, a) => {
    acc[a.subjectId] = (acc[a.subjectId] ?? 0) + 1
    return acc
  }, {}), [assignments])

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
      result[subject.id] = { covered: coveredIds.size, total }
    }
    return result
  }, [subjects, lessons])

  const overallProgress = useMemo(() => {
    const entries = Object.values(curriculumProgressBySubject)
    if (entries.length === 0) return null
    const totalTopics   = entries.reduce((s, e) => s + e.total, 0)
    const coveredTopics = entries.reduce((s, e) => s + e.covered, 0)
    return { totalTopics, coveredTopics, pct: totalTopics > 0 ? Math.round((coveredTopics / totalTopics) * 100) : 0 }
  }, [curriculumProgressBySubject])

  if (loading) return <LoadingSpinner />

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Subjects</h1>
        <p className="text-zinc-500 text-sm mt-1">Your filmmaking curriculum.</p>
      </div>

      {/* ── Overall progress meter ── */}
      {overallProgress && (
        <div className="card p-5 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-zinc-200">Overall curriculum progress</p>
            <span className="text-sm font-bold text-brand-400">{overallProgress.pct}%</span>
          </div>

          {/* Segmented bar — one segment per subject, coloured by subject.color */}
          <div className="h-3 rounded-full overflow-hidden flex gap-px bg-zinc-800">
            {subjects.filter(s => curriculumProgressBySubject[s.id]).map(subject => {
              const cp = curriculumProgressBySubject[subject.id]
              const totalTopics = overallProgress.totalTopics
              const widthPct = totalTopics > 0 ? (cp.total / totalTopics) * 100 : 0
              const fillPct  = cp.total > 0 ? (cp.covered / cp.total) * 100 : 0
              return (
                <div key={subject.id} style={{ width: `${widthPct}%` }} className="relative h-full bg-zinc-800 overflow-hidden rounded-sm flex-shrink-0">
                  <div className={`absolute left-0 top-0 h-full ${subject.color} transition-all`} style={{ width: `${fillPct}%` }} />
                </div>
              )
            })}
          </div>

          <div className="flex items-center justify-between text-xs text-zinc-500">
            <span>{overallProgress.coveredTopics} of {overallProgress.totalTopics} topics covered</span>
            <span>{subjects.length} subject{subjects.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {subjects.map(subject => {
          const cp = curriculumProgressBySubject[subject.id]
          const currPct = cp ? Math.round((cp.covered / cp.total) * 100) : null

          return (
            <Link
              key={subject.id}
              to={`/subjects/${subject.id}`}
              className="card-hover group block"
            >
              {/* Header stripe */}
              <div className={`h-2 -mx-6 -mt-6 rounded-t-2xl mb-5 ${subject.color}`} />

              <div className="flex items-start justify-between mb-3">
                <div>
                  <span className="text-3xl mb-2 block">{subject.iconEmoji}</span>
                  <h3 className="font-bold text-zinc-100 text-base">{subject.title}</h3>
                  <p className="text-xs text-zinc-400 mt-0.5 line-clamp-2">{subject.description}</p>
                </div>
                <ChevronRight className="w-5 h-5 text-zinc-300 group-hover:text-brand-500 transition-colors mt-1 flex-shrink-0" />
              </div>

              <div className="mt-4 space-y-3">
                {cp && (
                  <div>
                    <div className="flex justify-between text-xs text-zinc-400 mb-1">
                      <span>Curriculum</span>
                      <span>{currPct}%</span>
                    </div>
                    <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${subject.color}`}
                        style={{ width: `${currPct}%` }}
                      />
                    </div>
                  </div>
                )}
                <div className="flex justify-between text-xs text-zinc-400">
                  <span>{assignmentsBySubject[subject.id] ?? 0} assignments</span>
                  {cp && <span>{cp.covered} / {cp.total} topics covered</span>}
                </div>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
