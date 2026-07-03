import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { isPast } from 'date-fns'
import { BookOpen, Clock, Trophy, CheckCircle2 } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useCollection, where } from '@/hooks/useFirestore'
import { shortDate, toDate } from '@/lib/utils'
import { cn } from '@/lib/utils'
import type { AssignmentDoc, SubjectDoc, SubmissionDoc } from '@/types'
import LoadingSpinner from '@/components/common/LoadingSpinner'
import EmptyState from '@/components/common/EmptyState'

export default function StudentAssignments() {
  const { profile, cohortId: ctxCohortId, previewCohortId } = useAuth()
  const cohortId = ctxCohortId ?? previewCohortId ?? profile?.cohortId ?? null

  const { data: rawAssignments, loading } = useCollection<AssignmentDoc>(
    'assignments',
    cohortId ? [where('cohortId', '==', cohortId), where('isPublished', '==', true)] : [],
    !!cohortId,
    cohortId ?? '',
  )

  const { data: submissions } = useCollection<SubmissionDoc>(
    'submissions',
    profile ? [where('studentId', '==', profile.uid)] : [],
    !!profile,
  )

  const { data: subjects } = useCollection<SubjectDoc>('subjects')

  const subjectMap = useMemo(() => Object.fromEntries(subjects.map(s => [s.id, s])), [subjects])

  const submissionMap = useMemo(() => {
    const map: Record<string, SubmissionDoc> = {}
    for (const s of submissions) {
      if (!map[s.assignmentId] || s.status === 'graded') {
        map[s.assignmentId] = s
      }
    }
    return map
  }, [submissions])

  const assignments = useMemo(
    () => [...rawAssignments].sort((a, b) => (a.dueDate?.toMillis?.() ?? 0) - (b.dueDate?.toMillis?.() ?? 0)),
    [rawAssignments],
  )

  const pending   = assignments.filter(a => !submissionMap[a.id])
  const submitted = assignments.filter(a => !!submissionMap[a.id])

  if (loading) return <LoadingSpinner />

  function AssignmentCard({ a }: { a: AssignmentDoc }) {
    const subject   = subjectMap[a.subjectId]
    const sub       = submissionMap[a.id]
    const dueDate   = toDate(a.dueDate)
    const isOverdue = !sub && dueDate ? isPast(dueDate) : false

    return (
      <Link
        to={`/assignments/${a.id}`}
        className={cn(
          'flex items-start gap-3 p-4 rounded-xl border transition-all',
          isOverdue
            ? 'bg-rose-950/40 border-rose-800/50 hover:border-rose-300'
            : sub
              ? 'bg-zinc-900/50 border-white/10 hover:border-white/15'
              : 'bg-zinc-900 border-white/8 hover:border-brand-200 hover:shadow-sm',
        )}
      >
        <div className={cn('w-1 self-stretch rounded-full flex-shrink-0', subject?.color ?? 'bg-brand-500')} />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className={cn('text-sm font-semibold truncate', sub ? 'text-zinc-500' : 'text-zinc-200')}>
              {a.title}
            </p>
            {sub ? (
              sub.status === 'graded' ? (
                <span className={cn(
                  'badge flex-shrink-0',
                  sub.passed === true  ? 'badge-green'  :
                  sub.passed === false ? 'badge-rose'   :
                                         'badge-slate',
                )}>
                  {sub.percentageScore !== null ? `${sub.percentageScore}%` : 'Graded'}
                </span>
              ) : (
                <span className="badge badge-indigo flex-shrink-0">Awaiting review</span>
              )
            ) : isOverdue ? (
              <span className="badge badge-rose flex-shrink-0">Overdue</span>
            ) : null}
          </div>

          {subject && <p className="text-xs text-zinc-400 mt-0.5">{subject.iconEmoji} {subject.title}</p>}

          <div className="flex items-center gap-3 text-xs text-zinc-500 mt-1.5">
            <span className={cn('flex items-center gap-1', isOverdue && 'text-rose-500 font-medium')}>
              <Clock className="w-3 h-3" />
              Due {shortDate(a.dueDate)}
            </span>
            <span className="badge badge-indigo">{a.type}</span>
            {!sub && <span className="text-amber-600 font-medium flex items-center gap-0.5"><Trophy className="w-3 h-3" />+{a.pointsValue} pts</span>}
            {sub?.passed === true && (
              <span className="text-emerald-600 font-medium flex items-center gap-0.5">
                <CheckCircle2 className="w-3 h-3" />+{sub.pointsAwarded ?? a.pointsValue} pts earned
              </span>
            )}
          </div>
        </div>
      </Link>
    )
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="page-title">Assignments</h1>
        <p className="text-zinc-500 text-sm mt-1">
          {pending.length} pending · {submitted.length} completed
        </p>
      </div>

      {/* Pending */}
      <section className="space-y-3">
        <h2 className="section-title">Pending</h2>
        {pending.length === 0
          ? <EmptyState icon={BookOpen} title="All caught up!" description="No pending assignments." />
          : pending.map(a => <AssignmentCard key={a.id} a={a} />)
        }
      </section>

      {/* Completed */}
      {submitted.length > 0 && (
        <section className="space-y-3">
          <h2 className="section-title">Completed</h2>
          {submitted.map(a => <AssignmentCard key={a.id} a={a} />)}
        </section>
      )}
    </div>
  )
}
