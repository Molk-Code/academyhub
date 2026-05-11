import { useParams, Link } from 'react-router-dom'
import { CheckCircle2, XCircle, Clock, Trophy, ChevronRight } from 'lucide-react'
import { useDocument, useCollection } from '@/hooks/useFirestore'
import { cn } from '@/lib/utils'
import type { SubmissionDoc, AssignmentDoc, TestDoc, Question } from '@/types'
import LoadingSpinner from '@/components/common/LoadingSpinner'

export default function TestResults() {
  const { id: submissionId } = useParams<{ id: string }>()

  const { data: submission, loading } = useDocument<SubmissionDoc>('submissions', submissionId)
  const { data: assignments } = useCollection<AssignmentDoc>('assignments')
  const { data: tests }       = useCollection<TestDoc>('tests')

  if (loading) return <LoadingSpinner />
  if (!submission) return (
    <div className="text-center py-16 text-zinc-500">Results not found.</div>
  )

  const assignment = assignments.find(a => a.id === submission.assignmentId)
  const test = tests.find(t => t.assignmentId === submission.assignmentId)

  const hasPending = submission.testAnswers?.some(a => a.isCorrect === null)
  const pct = submission.percentageScore
  const passed = submission.passed

  return (
    <div className="max-w-2xl space-y-6">
      {/* Result banner */}
      <div className={cn(
        'rounded-2xl p-6 text-center',
        passed === true  ? 'bg-emerald-950/40 border border-emerald-800/50' :
        passed === false ? 'bg-rose-950/40 border border-rose-800/50'       :
                           'bg-zinc-900/50 border border-white/10',
      )}>
        {passed === true && (
          <>
            <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-2" />
            <h1 className="text-2xl font-bold text-emerald-700">You passed!</h1>
          </>
        )}
        {passed === false && (
          <>
            <XCircle className="w-12 h-12 text-rose-500 mx-auto mb-2" />
            <h1 className="text-2xl font-bold text-rose-700">Not quite</h1>
          </>
        )}
        {passed === null && (
          <>
            <Clock className="w-12 h-12 text-zinc-400 mx-auto mb-2" />
            <h1 className="text-2xl font-bold text-zinc-300">Pending review</h1>
          </>
        )}

        {assignment && <p className="text-zinc-500 mt-1 text-sm">{assignment.title}</p>}

        <div className="flex items-center justify-center gap-6 mt-4">
          {pct !== null && pct !== undefined ? (
            <div className="text-center">
              <p className="text-4xl font-bold text-zinc-200">{pct}%</p>
              <p className="text-xs text-zinc-400 mt-0.5">Your score</p>
            </div>
          ) : (
            <p className="text-zinc-500 text-sm">Score pending manual grading</p>
          )}
          {assignment?.passingScore !== null && assignment?.passingScore !== undefined && (
            <div className="text-center">
              <p className="text-2xl font-bold text-zinc-500">{assignment.passingScore}%</p>
              <p className="text-xs text-zinc-400 mt-0.5">Passing score</p>
            </div>
          )}
          {passed === true && submission.pointsAwarded !== null && submission.pointsAwarded !== undefined && (
            <div className="text-center">
              <p className="text-2xl font-bold text-amber-600 flex items-center gap-1">
                <Trophy className="w-5 h-5" />+{submission.pointsAwarded}
              </p>
              <p className="text-xs text-zinc-400 mt-0.5">Points earned</p>
            </div>
          )}
        </div>

        {hasPending && (
          <p className="mt-3 text-sm text-zinc-500">
            Short answer questions are pending teacher review. Your final score may change.
          </p>
        )}
      </div>

      {/* Per-question breakdown */}
      {test && submission.testAnswers && submission.testAnswers.length > 0 && (
        <div className="space-y-3">
          <h2 className="section-title">Question breakdown</h2>
          {test.questions.map((q, i) => {
            const ans = submission.testAnswers!.find(a => a.questionId === q.id)
            const isCorrect = ans?.isCorrect
            const isPending = ans?.isCorrect === null

            return (
              <div
                key={q.id}
                className={cn(
                  'rounded-xl border p-4 space-y-2',
                  isPending ? 'border-white/10 bg-zinc-800/50' :
                  isCorrect  ? 'border-emerald-800/50 bg-emerald-950/40' :
                               'border-rose-800/50 bg-rose-950/40',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium text-zinc-200">
                    <span className="text-zinc-400 mr-2">Q{i + 1}.</span>
                    {q.text}
                  </p>
                  <div className="flex-shrink-0">
                    {isPending
                      ? <span className="badge badge-amber">Pending</span>
                      : isCorrect
                        ? <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                        : <XCircle className="w-5 h-5 text-rose-500" />
                    }
                  </div>
                </div>

                {/* Show student's answer */}
                {q.type !== 'short_answer' && (
                  <div className="text-xs space-y-1">
                    {q.type === 'multiple_select' ? (
                      <p className="text-zinc-500">
                        Your answer: {(ans?.answers ?? []).length > 0
                          ? (ans?.answers ?? []).map(i => q.options[Number(i)]).join(', ')
                          : <em>No answer</em>
                        }
                      </p>
                    ) : (
                      <p className="text-zinc-500">
                        Your answer: {ans?.answer
                          ? (q.type === 'multiple_choice' ? q.options[Number(ans.answer)] : ans.answer)
                          : <em>No answer</em>
                        }
                      </p>
                    )}
                    {!isCorrect && !isPending && (
                      <p className="text-emerald-700 font-medium">
                        Correct:{' '}
                        {q.type === 'multiple_select'
                          ? (q.correctAnswers ?? []).map((idx: string) => q.options[Number(idx)]).join(', ')
                          : q.type === 'multiple_choice'
                            ? q.options[Number(q.correctAnswer)]
                            : q.correctAnswer
                        }
                      </p>
                    )}
                  </div>
                )}

                {q.type === 'short_answer' && (
                  <div className="text-xs">
                    <p className="text-zinc-500">Your answer: {ans?.answer || <em>No answer</em>}</p>
                    {isPending && <p className="text-amber-600 mt-0.5">Awaiting teacher review</p>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <Link to="/dashboard" className="btn-secondary py-2.5 px-5 inline-flex items-center gap-1">
        Back to Dashboard <ChevronRight className="w-4 h-4" />
      </Link>
    </div>
  )
}
