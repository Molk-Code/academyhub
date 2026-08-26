import { useState, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { httpsCallable } from 'firebase/functions'
import { functions } from '@/lib/firebase'
import { useCollection, where, orderBy } from '@/hooks/useFirestore'
import { useAuth } from '@/contexts/AuthContext'
import { fullDateTime } from '@/lib/utils'
import type { SubmissionDoc, UserDoc, AssignmentDoc, CohortDoc } from '@/types'
import Avatar from '@/components/common/Avatar'
import LoadingSpinner from '@/components/common/LoadingSpinner'
import EmptyState from '@/components/common/EmptyState'
import { ClipboardCheck, CheckCircle2 } from 'lucide-react'

interface GradePayload {
  submissionId: string
  score: number
  feedback: string
}

export default function GradeBook() {
  const [searchParams] = useSearchParams()
  const highlightId = searchParams.get('submission')

  const [selected, setSelected] = useState<SubmissionDoc | null>(null)
  const [score,    setScore]    = useState('')
  const [feedback, setFeedback] = useState('')
  const [grading,  setGrading]  = useState(false)
  const [message,  setMessage]  = useState('')

  const { profile } = useAuth()

  const { data: allSubmissions, loading } = useCollection<SubmissionDoc>(
    'submissions',
    [where('status', '==', 'submitted'), orderBy('submittedAt', 'asc')],
  )
  const { data: cohorts } = useCollection<CohortDoc>('cohorts')
  const { data: students } = useCollection<UserDoc>('users', [where('role', '==', 'student')])
  const { data: assignments } = useCollection<AssignmentDoc>('assignments')

  // Filter to only submissions from this teacher's cohorts
  const myCohortIds = useMemo(() => {
    if (!profile?.uid) return null
    const ids = cohorts.filter(c => c.teacherIds?.includes(profile.uid)).map(c => c.id)
    return ids.length > 0 ? new Set(ids) : null
  }, [cohorts, profile?.uid])

  const submissions = useMemo(() =>
    myCohortIds ? allSubmissions.filter(s => myCohortIds.has(s.cohortId)) : allSubmissions,
  [allSubmissions, myCohortIds])

  const studentMap    = Object.fromEntries(students.map(s => [s.uid, s]))
  const assignmentMap = Object.fromEntries(assignments.map(a => [a.id, a]))

  async function submitGrade() {
    if (!selected || !score) return
    setGrading(true)
    setMessage('')
    try {
      const fn = httpsCallable<GradePayload, { success: boolean }>(functions, 'gradeSubmission')
      await fn({ submissionId: selected.id, score: Number(score), feedback })
      setMessage('Graded successfully!')
      setSelected(null)
      setScore('')
      setFeedback('')
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : 'Grading failed.')
    } finally {
      setGrading(false)
    }
  }

  if (loading) return <LoadingSpinner />

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Grade Book</h1>
        <p className="text-zinc-400 text-sm mt-1">
          {submissions.length} submission{submissions.length !== 1 ? 's' : ''} awaiting grading.
        </p>
      </div>

      {message && (
        <div className="flex items-center gap-2 p-4 bg-emerald-900/40 border border-emerald-700 rounded-xl text-emerald-400 text-sm">
          <CheckCircle2 className="w-4 h-4" />
          {message}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Submission list */}
        <div className="space-y-2">
          {submissions.length === 0
            ? <EmptyState icon={ClipboardCheck} title="All graded!" description="No submissions waiting." />
            : submissions.map(sub => {
                const student    = studentMap[sub.studentId]
                const assignment = assignmentMap[sub.assignmentId]
                const isSelected = selected?.id === sub.id
                const isHighlight = sub.id === highlightId

                return (
                  <button
                    key={sub.id}
                    onClick={() => { setSelected(sub); setScore(''); setFeedback('') }}
                    className={`w-full flex items-start gap-3 p-4 rounded-xl text-left transition-all ${
                      isSelected
                        ? 'bg-brand-700 border border-brand-500'
                        : isHighlight
                        ? 'bg-amber-900/40 border border-amber-600'
                        : 'bg-slate-800 hover:bg-zinc-700'
                    }`}
                  >
                    {student && <Avatar uid={student.uid} name={student.displayName} size="sm" />}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white">{student?.displayName ?? 'Unknown'}</p>
                      <p className="text-xs text-zinc-400 truncate">{assignment?.title ?? 'Assignment'}</p>
                      <p className="text-xs text-zinc-500 mt-0.5">{fullDateTime(sub.submittedAt)}</p>
                    </div>
                    <span className="badge badge-amber flex-shrink-0">Grade</span>
                  </button>
                )
              })
          }
        </div>

        {/* Grading panel */}
        {selected && (() => {
          const assignment = assignmentMap[selected.assignmentId]
          const student    = studentMap[selected.studentId]
          return (
            <div className="bg-slate-800 rounded-2xl p-5 space-y-4 self-start sticky top-6">
              <div className="flex items-center gap-3">
                {student && <Avatar uid={student.uid} name={student.displayName} size="md" />}
                <div>
                  <p className="font-semibold text-white">{student?.displayName}</p>
                  <p className="text-sm text-zinc-400">{assignment?.title}</p>
                </div>
              </div>

              {/* Assignment description */}
              {assignment?.description && (
                <div className="bg-zinc-700/50 rounded-xl p-3">
                  <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-1">Assignment</p>
                  <p className="text-sm text-zinc-300 whitespace-pre-wrap">{assignment.description}</p>
                </div>
              )}

              {/* Student notes */}
              {selected.feedback && (
                <div className="bg-zinc-700/50 rounded-xl p-3">
                  <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-1">Student's note</p>
                  <p className="text-sm text-zinc-200 whitespace-pre-wrap">{selected.feedback}</p>
                </div>
              )}

              {/* Student uploads */}
              {selected.resources.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-1">Submitted files</p>
                  <div className="space-y-1">
                    {selected.resources.map((r, i) => (
                      <a key={i} href={r.url} target="_blank" rel="noreferrer"
                        className="flex items-center gap-2 text-sm text-brand-400 hover:text-brand-300 hover:underline">
                        📎 {r.label}
                      </a>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className="label text-zinc-300">
                  Score (out of {assignment?.pointsValue ?? 100})
                </label>
                <input
                  type="number"
                  min="0"
                  max={assignment?.pointsValue ?? 100}
                  value={score}
                  onChange={e => setScore(e.target.value)}
                  className="input bg-zinc-700 border-slate-600 text-white"
                  placeholder="0"
                />
              </div>

              <div>
                <label className="label text-zinc-300">Feedback <span className="text-zinc-500">(optional)</span></label>
                <textarea
                  value={feedback}
                  onChange={e => setFeedback(e.target.value)}
                  rows={4}
                  className="input bg-zinc-700 border-slate-600 text-white placeholder:text-zinc-500 resize-none"
                  placeholder="Write feedback for the student…"
                />
              </div>

              <button
                onClick={submitGrade}
                disabled={grading || !score}
                className="btn-primary w-full py-2.5"
              >
                {grading ? 'Submitting…' : 'Submit grade'}
              </button>
            </div>
          )
        })()}
      </div>
    </div>
  )
}
