import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { httpsCallable } from 'firebase/functions'
import { functions } from '@/lib/firebase'
import { useCollection, where } from '@/hooks/useFirestore'
import type { SubmissionDoc, UserDoc, AssignmentDoc, TestDoc } from '@/types'
import { CheckCircle2, XCircle, ArrowLeft, Clock, Award, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import LoadingSpinner from '@/components/common/LoadingSpinner'
import Avatar from '@/components/common/Avatar'
import { fullDateTime } from '@/lib/utils'

export default function TestGrader() {
  const { testId } = useParams<{ testId: string }>()
  const [selected, setSelected]  = useState<SubmissionDoc | null>(null)
  const [marks,    setMarks]     = useState<Record<string, boolean | null>>({})
  const [grading,  setGrading]   = useState(false)
  const [message,  setMessage]   = useState('')
  const [showGraded, setShowGraded] = useState(false)

  const { data: tests }       = useCollection<TestDoc>('tests')
  const { data: assignments } = useCollection<AssignmentDoc>('assignments')
  const { data: students }    = useCollection<UserDoc>('users', [where('role', '==', 'student')])

  // Load all submissions for this test (submitted + graded)
  const { data: allSubmissions, loading } = useCollection<SubmissionDoc>(
    'submissions',
    [where('type', '==', 'test')],
  )

  const test = tests.find(t => t.id === testId)
  const assignment = test ? assignments.find(a => a.id === test.assignmentId) : null

  const relevant = allSubmissions.filter(s => s.assignmentId === test?.assignmentId)
  const pending  = relevant.filter(s => s.status === 'submitted')
  const graded   = relevant.filter(s => s.status === 'graded')

  const studentMap = Object.fromEntries(students.map(s => [s.uid, s]))

  function openSubmission(sub: SubmissionDoc) {
    setSelected(sub)
    const initial: Record<string, boolean | null> = {}
    for (const ans of sub.testAnswers ?? []) {
      if (ans.isCorrect === null) initial[ans.questionId] = null
    }
    setMarks(initial)
    setMessage('')
  }

  function setMark(questionId: string, val: boolean) {
    setMarks(prev => ({ ...prev, [questionId]: val }))
  }

  const pendingQuestions = selected
    ? (test?.questions ?? []).filter(q => {
        const ans = selected.testAnswers?.find(a => a.questionId === q.id)
        return q.type === 'short_answer' && ans?.isCorrect === null
      })
    : []

  const allMarked = pendingQuestions.length > 0 &&
    pendingQuestions.every(q => marks[q.id] !== undefined && marks[q.id] !== null)

  async function submitGrades() {
    if (!selected || !allMarked) return
    setGrading(true)
    setMessage('')
    try {
      const fn = httpsCallable<object, { success: boolean }>(functions, 'gradeShortAnswers')
      await fn({
        submissionId: selected.id,
        answers: Object.entries(marks).map(([questionId, isCorrect]) => ({ questionId, isCorrect })),
      })
      setMessage('Graded successfully!')
      setSelected(null)
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : 'Grading failed.')
    } finally {
      setGrading(false)
    }
  }

  if (loading) return <LoadingSpinner />

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/teacher/tests" className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-700 transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="page-title">{assignment?.title ?? 'Test'} — Review</h1>
          <p className="text-zinc-400 text-sm mt-0.5">
            {pending.length} pending · {graded.length} graded
          </p>
        </div>
      </div>

      {message && (
        <div className="flex items-center gap-2 p-4 bg-emerald-900/40 border border-emerald-700 rounded-xl text-emerald-400 text-sm">
          <CheckCircle2 className="w-4 h-4" /> {message}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left: submission lists */}
        <div className="lg:col-span-2 space-y-4">

          {/* Pending review */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider px-1">
              Needs review ({pending.length})
            </p>
            {pending.length === 0 && (
              <p className="text-sm text-zinc-500 text-center py-4 bg-slate-800 rounded-xl">
                No submissions to review.
              </p>
            )}
            {pending.map(sub => {
              const student = studentMap[sub.studentId]
              const pendingCount = sub.testAnswers?.filter(a => a.isCorrect === null).length ?? 0
              return (
                <button
                  key={sub.id}
                  onClick={() => openSubmission(sub)}
                  className={cn(
                    'w-full flex items-center gap-3 p-3 rounded-xl transition-colors text-left',
                    selected?.id === sub.id ? 'bg-brand-600' : 'bg-slate-800 hover:bg-zinc-700',
                  )}
                >
                  {student && <Avatar uid={student.uid} name={student.displayName} size="sm" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{student?.displayName ?? 'Student'}</p>
                    <p className="text-xs text-zinc-400">
                      {pendingCount > 0
                        ? `${pendingCount} short answer${pendingCount !== 1 ? 's' : ''} to review`
                        : 'Awaiting grade'}
                    </p>
                  </div>
                  <Clock className="w-4 h-4 text-amber-400 flex-shrink-0" />
                </button>
              )
            })}
          </div>

          {/* Graded / finished */}
          <div className="space-y-2">
            <button
              onClick={() => setShowGraded(v => !v)}
              className="w-full flex items-center justify-between px-1 text-xs font-semibold text-zinc-400 uppercase tracking-wider hover:text-zinc-300 transition-colors"
            >
              <span>Graded ({graded.length})</span>
              {showGraded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {showGraded && graded.map(sub => {
              const student = studentMap[sub.studentId]
              const pct = sub.percentageScore ?? null
              const passed = sub.passed
              return (
                <button
                  key={sub.id}
                  onClick={() => openSubmission(sub)}
                  className={cn(
                    'w-full flex items-center gap-3 p-3 rounded-xl transition-colors text-left',
                    selected?.id === sub.id ? 'bg-brand-600' : 'bg-slate-800 hover:bg-zinc-700',
                  )}
                >
                  {student && <Avatar uid={student.uid} name={student.displayName} size="sm" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{student?.displayName ?? 'Student'}</p>
                    <p className="text-xs text-zinc-400">
                      {pct !== null ? `${pct}%` : '—'}
                      {' · '}
                      {fullDateTime(sub.gradedAt)}
                    </p>
                  </div>
                  {passed === true  && <Award className="w-4 h-4 text-emerald-400 flex-shrink-0" />}
                  {passed === false && <XCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />}
                </button>
              )
            })}
          </div>
        </div>

        {/* Right: grading / result panel */}
        <div className="lg:col-span-3">
          {!selected ? (
            <div className="bg-slate-800 rounded-2xl p-8 text-center text-zinc-500">
              Select a submission to review
            </div>
          ) : selected.status === 'graded' ? (
            /* ── Read-only result view ── */
            <div className="bg-slate-800 rounded-2xl p-5 space-y-4">
              <div className="flex items-center gap-3">
                {studentMap[selected.studentId] && (
                  <Avatar uid={selected.studentId} name={studentMap[selected.studentId].displayName} size="md" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-white">{studentMap[selected.studentId]?.displayName ?? 'Student'}</p>
                  <p className="text-sm text-zinc-400">{fullDateTime(selected.gradedAt)}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-2xl font-bold text-white">{selected.percentageScore ?? '—'}%</p>
                  <p className={cn('text-xs font-semibold', selected.passed ? 'text-emerald-400' : 'text-rose-400')}>
                    {selected.passed ? 'PASSED' : 'FAILED'}
                  </p>
                </div>
              </div>

              {selected.feedback && (
                <div className="bg-zinc-700/50 rounded-xl p-3">
                  <p className="text-xs font-medium text-zinc-400 mb-1">Feedback</p>
                  <p className="text-sm text-zinc-300">{selected.feedback}</p>
                </div>
              )}

              <div className="space-y-2">
                <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Answers</p>
                {(test?.questions ?? []).map((q, i) => {
                  const ans = selected.testAnswers?.find(a => a.questionId === q.id)
                  const correct = ans?.isCorrect
                  return (
                    <div key={q.id} className="bg-zinc-700/40 rounded-xl p-3 space-y-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm text-white">
                          <span className="text-zinc-400 mr-1">Q{i+1}.</span>{q.text}
                        </p>
                        {correct === true  && <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />}
                        {correct === false && <XCircle      className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />}
                        {correct === null  && <Clock        className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />}
                      </div>
                      <p className="text-xs text-zinc-400">
                        Answer: <span className="text-zinc-300">{ans?.answer ?? '—'}</span>
                      </p>
                      {correct === false && q.correctAnswer && (
                        <p className="text-xs text-zinc-500">
                          Correct: <span className="text-zinc-400">{q.correctAnswer}</span>
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            /* ── Grading view (pending short-answers) ── */
            <div className="bg-slate-800 rounded-2xl p-5 space-y-4">
              <h2 className="text-base font-semibold text-white">
                {studentMap[selected.studentId]?.displayName ?? 'Student'}'s answers
              </h2>

              {pendingQuestions.length === 0 ? (
                <p className="text-sm text-zinc-400 text-center py-4">No short answers to review.</p>
              ) : (
                pendingQuestions.map((q, i) => {
                  const ans = selected.testAnswers?.find(a => a.questionId === q.id)
                  const mark = marks[q.id]
                  return (
                    <div key={q.id} className="bg-zinc-700/50 rounded-xl p-4 space-y-3">
                      <p className="text-sm font-medium text-white">
                        <span className="text-zinc-400 mr-1">Q·SA {i+1}.</span>
                        {q.text}
                      </p>
                      <div className="bg-slate-900/50 rounded-lg p-3">
                        <p className="text-sm text-zinc-300">{ans?.answer || <em className="text-zinc-500">No answer provided</em>}</p>
                      </div>
                      {q.correctAnswer && (
                        <p className="text-xs text-zinc-400">
                          Model answer: <span className="text-zinc-300">{q.correctAnswer}</span>
                        </p>
                      )}
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setMark(q.id, true)}
                          className={cn(
                            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                            mark === true
                              ? 'bg-emerald-600 text-white'
                              : 'bg-zinc-700 text-zinc-300 hover:bg-emerald-700/50',
                          )}
                        >
                          <CheckCircle2 className="w-4 h-4" /> Correct (+{q.points} pts)
                        </button>
                        <button
                          type="button"
                          onClick={() => setMark(q.id, false)}
                          className={cn(
                            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                            mark === false
                              ? 'bg-rose-600 text-white'
                              : 'bg-zinc-700 text-zinc-300 hover:bg-rose-700/50',
                          )}
                        >
                          <XCircle className="w-4 h-4" /> Incorrect (0 pts)
                        </button>
                      </div>
                    </div>
                  )
                })
              )}

              <button
                type="button"
                disabled={!allMarked || grading}
                onClick={submitGrades}
                className="btn bg-brand-600 text-white hover:bg-brand-500 w-full py-2.5 disabled:opacity-50"
              >
                {grading ? 'Saving…' : 'Save grades'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
