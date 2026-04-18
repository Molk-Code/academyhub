import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useMyProgress } from '@/hooks/useProgress'
import { useCollection, where } from '@/hooks/useFirestore'
import type { SubjectDoc, AssignmentDoc } from '@/types'
import { pct } from '@/lib/utils'
import XPBar from '@/components/dashboard/XPBar'
import LoadingSpinner from '@/components/common/LoadingSpinner'

export default function SubjectList() {
  const { cohortId } = useAuth()
  const { data: progress } = useMyProgress()

  const { data: subjects, loading } = useCollection<SubjectDoc>('subjects')

  const { data: assignments } = useCollection<AssignmentDoc>(
    'assignments',
    cohortId ? [where('cohortId', '==', cohortId)] : [],
    !!cohortId,
  )

  if (loading) return <LoadingSpinner />

  const assignmentsBySubject = assignments.reduce<Record<string, number>>((acc, a) => {
    acc[a.subjectId] = (acc[a.subjectId] ?? 0) + 1
    return acc
  }, {})

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Subjects</h1>
        <p className="text-slate-500 text-sm mt-1">Your filmmaking curriculum.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {subjects.map(subject => {
          const sp  = progress?.subjectProgress?.[subject.id]
          const pct_ = sp ? pct(sp.completed, sp.total) : 0

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
                  <h3 className="font-bold text-slate-900 text-base">{subject.title}</h3>
                  <p className="text-xs text-slate-400 mt-0.5 line-clamp-2">{subject.description}</p>
                </div>
                <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-brand-500 transition-colors mt-1 flex-shrink-0" />
              </div>

              <div className="mt-4 space-y-2">
                <XPBar current={sp?.completed ?? 0} max={sp?.total ?? 1} color={subject.color} />
                <div className="flex justify-between text-xs text-slate-400">
                  <span>{pct_}% complete</span>
                  <span>{assignmentsBySubject[subject.id] ?? 0} assignments</span>
                </div>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
