import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { httpsCallable } from 'firebase/functions'
import { functions } from '@/lib/firebase'
import { Clock, ChevronLeft, ChevronRight, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import LoadingSpinner from '@/components/common/LoadingSpinner'
import type { Question } from '@/types'

interface TestQuestion extends Omit<Question, 'correctAnswer' | 'correctAnswers'> {}

interface GetQuestionsResult {
  testId: string
  timeLimitMinutes: number | null
  questions: TestQuestion[]
}

type StudentAnswers = Record<string, string | string[]>

export default function TestTake() {
  const { id: assignmentId } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState('')
  const [questions, setQuestions] = useState<TestQuestion[]>([])
  const [timeLimit, setTimeLimit] = useState<number | null>(null)
  const [secsLeft,  setSecsLeft]  = useState<number | null>(null)
  const [current,   setCurrent]   = useState(0)
  const [answers,   setAnswers]   = useState<StudentAnswers>({})
  const [submitting, setSubmitting] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startedAt = useRef(Date.now())

  // Load questions
  useEffect(() => {
    if (!assignmentId) return
    const fn = httpsCallable<{ assignmentId: string }, GetQuestionsResult>(functions, 'getTestQuestions')
    fn({ assignmentId })
      .then(res => {
        setQuestions(res.data.questions)
        const secs = res.data.timeLimitMinutes ? res.data.timeLimitMinutes * 60 : null
        setTimeLimit(res.data.timeLimitMinutes)
        setSecsLeft(secs)
        setLoading(false)
      })
      .catch(err => {
        setError(err.message && err.message !== 'INTERNAL'
          ? err.message
          : 'Failed to load test. Please try again or contact your teacher.')
        setLoading(false)
      })
  }, [assignmentId])

  // Countdown timer
  const submitTest = useCallback(async (finalAnswers: StudentAnswers) => {
    if (!assignmentId) return
    setSubmitting(true)
    try {
      const fn = httpsCallable<object, { submissionId: string }>(functions, 'submitTestAnswers')
      const payload = {
        assignmentId,
        timeTakenSeconds: Math.round((Date.now() - startedAt.current) / 1000),
        answers: Object.entries(finalAnswers).map(([questionId, val]) =>
          Array.isArray(val)
            ? { questionId, answers: val }
            : { questionId, answer: val }
        ),
      }
      const res = await fn(payload)
      navigate(`/submissions/${res.data.submissionId}/results`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : ''
      setError(msg && msg !== 'INTERNAL' ? msg : 'Submission failed. Please try again.')
      setSubmitting(false)
    }
  }, [assignmentId, navigate])

  useEffect(() => {
    if (secsLeft === null) return
    timerRef.current = setInterval(() => {
      setSecsLeft(prev => {
        if (prev === null || prev <= 1) {
          clearInterval(timerRef.current!)
          submitTest(answers)
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timerRef.current!)
  // Only start once when secsLeft first becomes non-null
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLimit])

  function setAnswer(qId: string, val: string | string[]) {
    setAnswers(prev => ({ ...prev, [qId]: val }))
  }

  function toggleMultiSelect(qId: string, idx: string) {
    const prev = (answers[qId] as string[] | undefined) ?? []
    const next = prev.includes(idx) ? prev.filter(v => v !== idx) : [...prev, idx]
    setAnswer(qId, next)
  }

  if (loading) return <LoadingSpinner />

  if (error) {
    return (
      <div className="max-w-xl mx-auto py-16 text-center space-y-4">
        <p className="text-rose-500 font-medium">{error}</p>
        <button onClick={() => navigate(-1)} className="btn-secondary py-2 px-4">Go back</button>
      </div>
    )
  }

  if (submitting) {
    return (
      <div className="max-w-xl mx-auto py-16 text-center space-y-4">
        <LoadingSpinner />
        <p className="text-zinc-500">Submitting your answers…</p>
      </div>
    )
  }

  const q = questions[current]
  if (!q) return null

  const answered = Object.keys(answers).length
  const mins = secsLeft !== null ? Math.floor(secsLeft / 60) : null
  const secs = secsLeft !== null ? secsLeft % 60 : null
  const isUrgent = secsLeft !== null && secsLeft <= 60

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-zinc-400 font-medium uppercase tracking-wider">
            Question {current + 1} of {questions.length}
          </p>
          <div className="mt-1 h-1.5 w-48 bg-zinc-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-brand-600 rounded-full transition-all"
              style={{ width: `${((current + 1) / questions.length) * 100}%` }}
            />
          </div>
        </div>
        {secsLeft !== null && (
          <div className={cn(
            'flex items-center gap-1.5 font-mono text-sm font-semibold px-3 py-1.5 rounded-xl',
            isUrgent ? 'bg-rose-100 text-rose-600' : 'bg-zinc-800 text-zinc-300',
          )}>
            <Clock className="w-4 h-4" />
            {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
          </div>
        )}
      </div>

      {/* Question card */}
      <div className="bg-zinc-900 rounded-2xl border border-white/10 shadow-sm p-6 space-y-5">
        <div className="flex items-start gap-3">
          <span className={cn('badge flex-shrink-0 mt-0.5', {
            'badge-indigo': q.type === 'multiple_choice',
            'badge-blue':   q.type === 'multiple_select',
            'bg-emerald-100 text-emerald-700 rounded-full px-2 py-0.5 text-xs font-medium': q.type === 'true_false',
            'badge-amber':  q.type === 'short_answer',
          })}>
            {q.type === 'multiple_choice'  ? 'Multiple choice'  :
             q.type === 'multiple_select'  ? 'Multiple select'  :
             q.type === 'true_false'       ? 'True / False'     : 'Short answer'}
          </span>
          <span className="text-xs text-zinc-400">{q.points} pt{q.points !== 1 ? 's' : ''}</span>
        </div>

        <p className="text-lg font-medium text-zinc-200 leading-relaxed">{q.text}</p>

        {/* Multiple choice */}
        {q.type === 'multiple_choice' && (
          <div className="space-y-2">
            {q.options.map((opt, oi) => {
              const val = String(oi)
              const selected = answers[q.id] === val
              return (
                <button
                  key={oi}
                  type="button"
                  onClick={() => setAnswer(q.id, val)}
                  className={cn(
                    'w-full flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-all',
                    selected
                      ? 'border-brand-600 bg-brand-50 text-brand-700'
                      : 'border-white/10 hover:border-white/15 text-zinc-300',
                  )}
                >
                  <div className={cn(
                    'w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0',
                    selected ? 'border-brand-600 bg-brand-600' : 'border-white/15',
                  )}>
                    {selected && <div className="w-2 h-2 rounded-full bg-zinc-900" />}
                  </div>
                  <span className="text-sm">{opt}</span>
                </button>
              )
            })}
          </div>
        )}

        {/* Multiple select */}
        {q.type === 'multiple_select' && (
          <div className="space-y-2">
            <p className="text-xs text-zinc-400">Select all that apply</p>
            {q.options.map((opt, oi) => {
              const val = String(oi)
              const selected = ((answers[q.id] as string[]) ?? []).includes(val)
              return (
                <button
                  key={oi}
                  type="button"
                  onClick={() => toggleMultiSelect(q.id, val)}
                  className={cn(
                    'w-full flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-all',
                    selected
                      ? 'border-brand-600 bg-brand-50 text-brand-700'
                      : 'border-white/10 hover:border-white/15 text-zinc-300',
                  )}
                >
                  <div className={cn(
                    'w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0',
                    selected ? 'border-brand-600 bg-brand-600' : 'border-white/15',
                  )}>
                    {selected && <Check className="w-3 h-3 text-white" />}
                  </div>
                  <span className="text-sm">{opt}</span>
                </button>
              )
            })}
          </div>
        )}

        {/* True / False */}
        {q.type === 'true_false' && (
          <div className="flex gap-3">
            {['True', 'False'].map(val => {
              const selected = answers[q.id] === val
              return (
                <button
                  key={val}
                  type="button"
                  onClick={() => setAnswer(q.id, val)}
                  className={cn(
                    'flex-1 py-3 rounded-xl border-2 font-medium text-sm transition-all',
                    selected
                      ? 'border-brand-600 bg-brand-600 text-white'
                      : 'border-white/10 hover:border-white/15 text-zinc-300',
                  )}
                >
                  {val}
                </button>
              )
            })}
          </div>
        )}

        {/* Short answer */}
        {q.type === 'short_answer' && (
          <textarea
            value={(answers[q.id] as string) ?? ''}
            onChange={e => setAnswer(q.id, e.target.value)}
            rows={4}
            placeholder="Type your answer here…"
            className="w-full border border-white/10 rounded-xl px-4 py-3 text-sm text-zinc-300 placeholder:text-zinc-300 focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
          />
        )}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          disabled={current === 0}
          onClick={() => setCurrent(c => c - 1)}
          className="btn-secondary py-2 px-4 disabled:opacity-40"
        >
          <ChevronLeft className="w-4 h-4" /> Previous
        </button>

        <p className="text-xs text-zinc-400">{answered} of {questions.length} answered</p>

        {current < questions.length - 1 ? (
          <button
            type="button"
            onClick={() => setCurrent(c => c + 1)}
            className="btn-primary py-2 px-4"
          >
            Next <ChevronRight className="w-4 h-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => submitTest(answers)}
            className="btn bg-emerald-600 text-white hover:bg-emerald-500 py-2 px-5"
          >
            Submit test
          </button>
        )}
      </div>

      {/* Question dots */}
      <div className="flex flex-wrap gap-1.5 justify-center">
        {questions.map((qDot, i) => (
          <button
            key={qDot.id}
            type="button"
            onClick={() => setCurrent(i)}
            className={cn(
              'w-7 h-7 rounded-full text-xs font-medium transition-all',
              i === current
                ? 'bg-brand-600 text-white ring-2 ring-brand-300'
                : answers[qDot.id] !== undefined
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-zinc-800 text-zinc-500 hover:bg-zinc-700',
            )}
          >
            {i + 1}
          </button>
        ))}
      </div>
    </div>
  )
}
