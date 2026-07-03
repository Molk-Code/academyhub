import { useState, useMemo, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { collection, addDoc, serverTimestamp, setDoc, doc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { formatDistanceToNow } from 'date-fns'
import { ArrowLeft, MessageSquare, ChevronRight, Send, Pencil, TrendingUp, Lightbulb } from 'lucide-react'
import Avatar from '@/components/common/Avatar'
import LoadingSpinner from '@/components/common/LoadingSpinner'
import { useDocument, useCollection, where, orderBy } from '@/hooks/useFirestore'
import type { UserDoc, DevelopmentPlan, PlanComment, NopraStepKey, TeacherAssessment } from '@/types'

interface StepDef {
  key: NopraStepKey
  abbrev: string
  label: string
  colors: { bg: string; light: string; text: string; border: string }
}

const STEPS: StepDef[] = [
  { key: 'situation',  abbrev: 'N', label: 'Now',        colors: { bg: 'bg-blue-500',    light: 'bg-blue-50',    text: 'text-blue-700',    border: 'border-blue-200'    } },
  { key: 'goal',       abbrev: 'O', label: 'Objective',  colors: { bg: 'bg-indigo-500',  light: 'bg-indigo-50',  text: 'text-indigo-700',  border: 'border-indigo-200'  } },
  { key: 'obstacles',  abbrev: 'P', label: 'Problems',   colors: { bg: 'bg-amber-500',   light: 'bg-amber-950/40',   text: 'text-amber-300',   border: 'border-amber-800/50'   } },
  { key: 'resources',  abbrev: 'R', label: 'Resources',  colors: { bg: 'bg-emerald-500', light: 'bg-emerald-950/40', text: 'text-emerald-300', border: 'border-emerald-800/50' } },
  { key: 'action',     abbrev: 'A', label: 'Actions',    colors: { bg: 'bg-brand-500',   light: 'bg-brand-50',   text: 'text-brand-700',   border: 'border-brand-200'   } },
  { key: 'evaluation', abbrev: 'E', label: 'Evaluation', colors: { bg: 'bg-rose-500',    light: 'bg-rose-950/40',    text: 'text-rose-300',    border: 'border-rose-800/50'    } },
]

export default function StudentPlan() {
  const { uid } = useParams<{ uid: string }>()
  const { profile } = useAuth()
  const [activeStep, setActiveStep] = useState<NopraStepKey>('situation')
  const [commentText, setCommentText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [editingAssessment, setEditingAssessment] = useState(false)
  const [strengthsDraft, setStrengthsDraft] = useState('')
  const [developmentsDraft, setDevelopmentsDraft] = useState('')
  const [assessmentSaving, setAssessmentSaving] = useState(false)

  const { data: student, loading: studentLoading } = useDocument<UserDoc>('users', uid)
  const { data: plan, loading: planLoading } = useDocument<DevelopmentPlan>('development_plans', uid)
  const { data: assessment } = useDocument<TeacherAssessment>('teacher_assessments', uid)
  const { data: comments } = useCollection<PlanComment>(
    'plan_comments',
    uid ? [where('studentId', '==', uid), orderBy('createdAt', 'asc')] : [],
    !!uid,
  )

  const stepComments = useMemo(
    () => comments.filter(c => c.step === activeStep),
    [comments, activeStep],
  )

  const commentsByStep = useMemo(() => {
    const map: Partial<Record<NopraStepKey, number>> = {}
    for (const c of comments) {
      map[c.step] = (map[c.step] ?? 0) + 1
    }
    return map
  }, [comments])

  useEffect(() => {
    if (assessment && !editingAssessment) {
      setStrengthsDraft(assessment.strengths ?? '')
      setDevelopmentsDraft(assessment.developments ?? '')
    }
  }, [assessment?.strengths, assessment?.developments]) // eslint-disable-line react-hooks/exhaustive-deps

  async function saveAssessment() {
    if (!profile || !uid) return
    setAssessmentSaving(true)
    try {
      await setDoc(doc(db, 'teacher_assessments', uid), {
        studentId: uid,
        strengths: strengthsDraft.trim(),
        developments: developmentsDraft.trim(),
        updatedBy: profile.uid,
        updatedByName: profile.displayName,
        updatedAt: serverTimestamp(),
      }, { merge: true })
      setEditingAssessment(false)
    } finally {
      setAssessmentSaving(false)
    }
  }

  async function submitComment(e: React.FormEvent) {
    e.preventDefault()
    if (!profile || !uid || !commentText.trim()) return
    setSubmitting(true)
    try {
      await addDoc(collection(db, 'plan_comments'), {
        studentId:        uid,
        teacherId:        profile.uid,
        teacherName:      profile.displayName,
        teacherAvatarUrl: profile.avatarUrl ?? null,
        step:             activeStep,
        text:             commentText.trim(),
        createdAt:        serverTimestamp(),
      })
      setCommentText('')
    } finally {
      setSubmitting(false)
    }
  }

  if (studentLoading || planLoading) return <LoadingSpinner />

  const stepDef = STEPS.find(s => s.key === activeStep)!
  const stepContent = plan?.[activeStep]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <Link
          to={`/teacher/students/${uid}`}
          className="p-2 rounded-xl text-zinc-500 hover:bg-zinc-800 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        {student && (
          <div className="flex items-center gap-3">
            <Avatar uid={student.id} name={student.displayName} avatarUrl={student.avatarUrl} size="sm" />
            <div>
              <h1 className="text-xl font-bold text-zinc-100">{student.displayName}</h1>
              <p className="text-sm text-zinc-500">Individual Development Plan</p>
            </div>
          </div>
        )}
      </div>

      {/* Flow diagram */}
      <div className="bg-zinc-900 border border-white/10 rounded-2xl p-4 overflow-x-auto">
        <div className="flex items-center gap-1 min-w-max mx-auto w-fit">
          {STEPS.map((step, i) => {
            const isActive = step.key === activeStep
            const commentCount = commentsByStep[step.key] ?? 0
            const hasContent = !!plan?.[step.key]?.trim()
            return (
              <div key={step.key} className="flex items-center">
                <button
                  onClick={() => setActiveStep(step.key)}
                  className={`relative flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-all ${
                    isActive
                      ? `${step.colors.light} ${step.colors.border} border-2 shadow-sm`
                      : 'hover:bg-white/5 border-2 border-transparent'
                  }`}
                >
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white ${
                    hasContent ? step.colors.bg : isActive ? step.colors.bg : 'bg-slate-300'
                  }`}>
                    {step.abbrev}
                  </div>
                  <span className={`text-[11px] font-medium whitespace-nowrap ${isActive ? step.colors.text : 'text-zinc-500'}`}>
                    {step.label}
                  </span>
                  {commentCount > 0 && (
                    <span className={`absolute -top-1 -right-1 min-w-[16px] h-4 flex items-center justify-center rounded-full text-white text-[9px] font-bold px-1 ${step.colors.bg}`}>
                      {commentCount}
                    </span>
                  )}
                </button>
                {i < STEPS.length - 1 && (
                  <ChevronRight className="w-4 h-4 text-zinc-300 flex-shrink-0 mx-0.5" />
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Step content */}
      <div className={`bg-zinc-900 border-2 rounded-2xl p-5 space-y-3 ${stepDef.colors.border}`}>
        <div className="flex items-center gap-2">
          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white ${stepDef.colors.bg}`}>
            {stepDef.abbrev}
          </div>
          <h2 className="text-base font-semibold text-zinc-100">{stepDef.label}</h2>
        </div>
        {stepContent ? (
          <p className="text-sm text-zinc-300 whitespace-pre-wrap bg-zinc-900/50 rounded-xl p-4 leading-relaxed">
            {stepContent}
          </p>
        ) : (
          <p className="text-sm text-zinc-400 italic py-4 text-center">
            The student hasn't written anything for this step yet.
          </p>
        )}
      </div>

      {/* Strengths & Areas for Development */}
      <div className="bg-zinc-900 border border-white/10 rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="text-sm font-semibold text-zinc-100">Strengths &amp; Areas for Development</h3>
          {!editingAssessment ? (
            <button
              onClick={() => {
                setStrengthsDraft(assessment?.strengths ?? '')
                setDevelopmentsDraft(assessment?.developments ?? '')
                setEditingAssessment(true)
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" /> Edit
            </button>
          ) : (
            <div className="flex gap-2">
              <button onClick={saveAssessment} disabled={assessmentSaving} className="btn-primary py-1.5 px-3 text-sm disabled:opacity-50">
                {assessmentSaving ? 'Saving…' : 'Save'}
              </button>
              <button onClick={() => setEditingAssessment(false)} className="btn-secondary py-1.5 px-3 text-sm">Cancel</button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5" /> Strengths
            </p>
            {editingAssessment ? (
              <textarea
                value={strengthsDraft}
                onChange={e => setStrengthsDraft(e.target.value)}
                rows={5}
                className="input w-full resize-none text-sm"
                placeholder="What does this student do well?"
                autoFocus
              />
            ) : assessment?.strengths ? (
              <p className="text-sm text-zinc-300 whitespace-pre-wrap bg-zinc-800/50 rounded-xl p-4 leading-relaxed min-h-[80px]">
                {assessment.strengths}
              </p>
            ) : (
              <p className="text-sm text-zinc-500 italic text-center bg-zinc-800/30 rounded-xl py-6">Not yet filled in.</p>
            )}
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
              <Lightbulb className="w-3.5 h-3.5" /> Areas for Development
            </p>
            {editingAssessment ? (
              <textarea
                value={developmentsDraft}
                onChange={e => setDevelopmentsDraft(e.target.value)}
                rows={5}
                className="input w-full resize-none text-sm"
                placeholder="What should this student focus on improving?"
              />
            ) : assessment?.developments ? (
              <p className="text-sm text-zinc-300 whitespace-pre-wrap bg-zinc-800/50 rounded-xl p-4 leading-relaxed min-h-[80px]">
                {assessment.developments}
              </p>
            ) : (
              <p className="text-sm text-zinc-500 italic text-center bg-zinc-800/30 rounded-xl py-6">Not yet filled in.</p>
            )}
          </div>
        </div>

        {assessment?.updatedAt && !editingAssessment && (
          <p className="text-xs text-zinc-500">
            Last updated by {assessment.updatedByName} · {formatDistanceToNow(assessment.updatedAt.toDate(), { addSuffix: true })}
          </p>
        )}
      </div>

      {/* Comments */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-zinc-300 flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-zinc-400" />
          Feedback for {stepDef.label}
          {stepComments.length > 0 && <span className="text-zinc-400">({stepComments.length})</span>}
        </h3>

        {stepComments.map(c => (
          <div key={c.id} className="bg-zinc-900 border border-white/10 rounded-xl p-4 flex gap-3">
            <Avatar uid={c.teacherId} name={c.teacherName} avatarUrl={c.teacherAvatarUrl} size="sm" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-zinc-100">{c.teacherName}</span>
                <span className="text-xs text-zinc-400">
                  {c.createdAt ? formatDistanceToNow(c.createdAt.toDate(), { addSuffix: true }) : ''}
                </span>
              </div>
              <p className="text-sm text-zinc-300 mt-1 whitespace-pre-wrap">{c.text}</p>
            </div>
          </div>
        ))}

        {/* Add comment */}
        <form onSubmit={submitComment} className="bg-zinc-900 border border-white/10 rounded-xl p-4 space-y-3">
          <textarea
            value={commentText}
            onChange={e => setCommentText(e.target.value)}
            rows={3}
            className="input w-full resize-none text-sm"
            placeholder={`Leave feedback on ${stepDef.label}…`}
          />
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={submitting || !commentText.trim()}
              className="btn-primary py-2 px-4 flex items-center gap-2 disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
              {submitting ? 'Sending…' : 'Send feedback'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
