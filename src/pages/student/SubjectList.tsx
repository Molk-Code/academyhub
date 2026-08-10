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

  if (loading) return <LoadingSpinner />

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Subjects</h1>
        <p className="text-zinc-500 text-sm mt-1">Your filmmaking curriculum.</p>
      </div>

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
