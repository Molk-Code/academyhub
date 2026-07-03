import { useState, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { nanoid } from 'nanoid'
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor,
  useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, sortableKeyboardCoordinates,
  verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  collection, addDoc, updateDoc, doc, getDoc,
  serverTimestamp, Timestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useCollection, where } from '@/hooks/useFirestore'
import type { SubjectDoc, CohortDoc, TestDoc, Question } from '@/types'
import {
  Plus, Trash2, GripVertical, CheckCircle2, Check,
  AlignLeft, ListChecks, ToggleLeft, Square, ArrowUpDown, Star,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useEffect } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

type QType = 'multiple_choice' | 'multiple_select' | 'true_false' | 'short_answer' | 'ordering' | 'rating'

interface QuestionState {
  id: string
  type: QType
  text: string
  options: string[]
  correctAnswer: string    // MC/TF/SA
  correctAnswers: string[] // multiple_select
  correctOrder: string[]   // ordering: option indices in correct order
  ratingScale: number      // rating: max value (default 5)
  ratingLabels: [string, string] // rating: [low, high]
  points: number
}

interface TestFormData {
  subjectId: string
  cohortId: string
  title: string
  description: string
  dueDate: string
  passingScore: number
  pointsValue: number
  shuffleQuestions: boolean
  timeLimitMinutes: string  // empty = none
  maxAttempts: number
  isPublished: boolean
}

const schema = z.object({
  subjectId:        z.string().min(1, 'Select a subject'),
  cohortId:         z.string().min(1, 'Select a class'),
  title:            z.string().min(2, 'Title required'),
  description:      z.string().optional(),
  dueDate:          z.string().min(1, 'Due date required'),
  passingScore:     z.coerce.number().min(0).max(100),
  pointsValue:      z.coerce.number().min(1),
  shuffleQuestions: z.boolean(),
  timeLimitMinutes: z.string(),
  maxAttempts:      z.coerce.number().min(1),
  isPublished:      z.boolean(),
})

// ── Sortable question card ────────────────────────────────────────────────────

function QuestionCard({
  q, index, onChange, onRemove,
}: {
  q: QuestionState
  index: number
  onChange: (id: string, patch: Partial<QuestionState>) => void
  onRemove: (id: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: q.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  const typeLabel = {
    multiple_choice:  'Multiple choice',
    multiple_select:  'Multiple select',
    true_false:       'True / False',
    short_answer:     'Short answer',
    ordering:         'Ordering',
    rating:           'Rating scale',
  }[q.type]

  const typeColor = {
    multiple_choice:  'badge-indigo',
    multiple_select:  'badge-blue',
    true_false:       'bg-emerald-100 text-emerald-700 rounded-full px-2 py-0.5 text-xs font-medium',
    short_answer:     'badge-amber',
    ordering:         'bg-orange-100 text-orange-700 rounded-full px-2 py-0.5 text-xs font-medium',
    rating:           'bg-pink-100 text-pink-700 rounded-full px-2 py-0.5 text-xs font-medium',
  }[q.type]

  function setOption(oi: number, val: string) {
    const next = [...q.options]
    next[oi] = val
    onChange(q.id, { options: next })
  }

  function addOption() {
    onChange(q.id, { options: [...q.options, ''] })
  }

  function removeOption(oi: number) {
    const next = q.options.filter((_, i) => i !== oi)
    // Remove from correctAnswers if it was selected
    const nextCA = q.correctAnswers.filter(ca => ca !== String(oi))
      .map(ca => (Number(ca) > oi ? String(Number(ca) - 1) : ca))
    onChange(q.id, { options: next, correctAnswers: nextCA })
  }

  function toggleCorrectAnswer(val: string) {
    const has = q.correctAnswers.includes(val)
    onChange(q.id, {
      correctAnswers: has ? q.correctAnswers.filter(v => v !== val) : [...q.correctAnswers, val],
    })
  }

  return (
    <div ref={setNodeRef} style={style} className="bg-zinc-900 rounded-2xl border border-white/10 shadow-sm overflow-hidden">
      {/* Card header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-zinc-900/50 border-b border-white/8">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing p-1 text-zinc-300 hover:text-zinc-500 touch-none"
        >
          <GripVertical className="w-4 h-4" />
        </button>
        <span className="text-sm font-semibold text-zinc-500">Q{index + 1}</span>
        <span className={cn('badge', typeColor)}>{typeLabel}</span>
        <div className="flex-1" />
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            min="1"
            value={q.points}
            onChange={e => onChange(q.id, { points: Number(e.target.value) || 1 })}
            className="w-14 text-center text-sm font-medium border border-white/10 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <span className="text-xs text-zinc-400">pts</span>
        </div>
        <button
          type="button"
          onClick={() => onRemove(q.id)}
          className="p-1.5 text-zinc-300 hover:text-rose-500 transition-colors"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* Question text */}
      <div className="px-4 pt-4 pb-2">
        <textarea
          value={q.text}
          onChange={e => onChange(q.id, { text: e.target.value })}
          rows={2}
          placeholder="Type your question here…"
          className="w-full text-base text-zinc-200 placeholder:text-zinc-300 resize-none focus:outline-none"
        />
      </div>

      {/* Options */}
      <div className="px-4 pb-4 space-y-2">
        {/* Multiple choice */}
        {q.type === 'multiple_choice' && (
          <>
            <p className="text-xs text-zinc-400 font-medium mb-2">Click the circle to mark the correct answer</p>
            {q.options.map((opt, oi) => (
              <div key={oi} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onChange(q.id, { correctAnswer: String(oi) })}
                  className={cn(
                    'w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors',
                    q.correctAnswer === String(oi)
                      ? 'border-brand-600 bg-brand-600'
                      : 'border-white/15 hover:border-brand-400',
                  )}
                >
                  {q.correctAnswer === String(oi) && <div className="w-2 h-2 rounded-full bg-zinc-900" />}
                </button>
                <input
                  value={opt}
                  onChange={e => setOption(oi, e.target.value)}
                  placeholder={`Option ${oi + 1}`}
                  className="flex-1 text-sm border-0 border-b border-transparent hover:border-white/10 focus:border-brand-400 focus:outline-none py-1 text-zinc-300 placeholder:text-zinc-300 bg-transparent transition-colors"
                />
                {q.options.length > 2 && (
                  <button type="button" onClick={() => removeOption(oi)} className="p-1 text-zinc-300 hover:text-rose-400">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={addOption}
              className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-brand-600 mt-1 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Add option
            </button>
          </>
        )}

        {/* Multiple select */}
        {q.type === 'multiple_select' && (
          <>
            <p className="text-xs text-zinc-400 font-medium mb-2">Check all correct answers</p>
            {q.options.map((opt, oi) => {
              const val = String(oi)
              const checked = q.correctAnswers.includes(val)
              return (
                <div key={oi} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => toggleCorrectAnswer(val)}
                    className={cn(
                      'w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors',
                      checked
                        ? 'border-brand-600 bg-brand-600'
                        : 'border-white/15 hover:border-brand-400',
                    )}
                  >
                    {checked && <Check className="w-3 h-3 text-white" />}
                  </button>
                  <input
                    value={opt}
                    onChange={e => setOption(oi, e.target.value)}
                    placeholder={`Option ${oi + 1}`}
                    className="flex-1 text-sm border-0 border-b border-transparent hover:border-white/10 focus:border-brand-400 focus:outline-none py-1 text-zinc-300 placeholder:text-zinc-300 bg-transparent transition-colors"
                  />
                  {q.options.length > 2 && (
                    <button type="button" onClick={() => removeOption(oi)} className="p-1 text-zinc-300 hover:text-rose-400">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )
            })}
            <button
              type="button"
              onClick={addOption}
              className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-brand-600 mt-1 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Add option
            </button>
          </>
        )}

        {/* True / False */}
        {q.type === 'true_false' && (
          <>
            <p className="text-xs text-zinc-400 font-medium mb-2">Select the correct answer</p>
            {['True', 'False'].map(val => (
              <div key={val} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onChange(q.id, { correctAnswer: val })}
                  className={cn(
                    'w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors',
                    q.correctAnswer === val
                      ? 'border-brand-600 bg-brand-600'
                      : 'border-white/15 hover:border-brand-400',
                  )}
                >
                  {q.correctAnswer === val && <div className="w-2 h-2 rounded-full bg-zinc-900" />}
                </button>
                <span className={cn('text-sm', q.correctAnswer === val ? 'text-zinc-200 font-medium' : 'text-zinc-400')}>
                  {val}
                </span>
              </div>
            ))}
          </>
        )}

        {/* Short answer */}
        {q.type === 'short_answer' && (
          <div className="space-y-1">
            <p className="text-xs text-zinc-400 font-medium">Model answer (teacher reference only)</p>
            <input
              value={q.correctAnswer}
              onChange={e => onChange(q.id, { correctAnswer: e.target.value })}
              placeholder="Expected answer…"
              className="w-full text-sm border border-white/10 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500 text-zinc-300 placeholder:text-zinc-300"
            />
            <p className="text-xs text-zinc-400">This question requires manual grading.</p>
          </div>
        )}

        {/* Ordering */}
        {q.type === 'ordering' && (
          <div className="space-y-2">
            <p className="text-xs text-zinc-400 font-medium">List items in the correct order (top = first)</p>
            {q.options.map((opt, oi) => (
              <div key={oi} className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-brand-900/60 text-brand-300 text-xs flex items-center justify-center flex-shrink-0 font-bold">{oi + 1}</span>
                <input
                  value={opt}
                  onChange={e => setOption(oi, e.target.value)}
                  placeholder={`Item ${oi + 1}`}
                  className="flex-1 text-sm border-0 border-b border-transparent hover:border-white/10 focus:border-brand-400 focus:outline-none py-1 text-zinc-300 placeholder:text-zinc-300 bg-transparent transition-colors"
                />
                {q.options.length > 2 && (
                  <button type="button" onClick={() => removeOption(oi)} className="p-1 text-zinc-300 hover:text-rose-400">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
            <button type="button" onClick={addOption} className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-brand-600 mt-1 transition-colors">
              <Plus className="w-3.5 h-3.5" /> Add item
            </button>
            <p className="text-xs text-zinc-500">Students will see items in shuffled order and drag them into the correct sequence.</p>
          </div>
        )}

        {/* Rating */}
        {q.type === 'rating' && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div>
                <p className="text-xs text-zinc-400 font-medium mb-1">Scale (1 to…)</p>
                <select
                  value={q.ratingScale}
                  onChange={e => onChange(q.id, { ratingScale: Number(e.target.value) })}
                  className="bg-zinc-800 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  {[3, 4, 5, 6, 7, 10].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div className="flex-1">
                <p className="text-xs text-zinc-400 font-medium mb-1">Low label</p>
                <input
                  value={q.ratingLabels[0]}
                  onChange={e => onChange(q.id, { ratingLabels: [e.target.value, q.ratingLabels[1]] })}
                  placeholder="e.g. Not at all"
                  className="w-full text-sm border border-white/10 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500 text-zinc-300 bg-transparent"
                />
              </div>
              <div className="flex-1">
                <p className="text-xs text-zinc-400 font-medium mb-1">High label</p>
                <input
                  value={q.ratingLabels[1]}
                  onChange={e => onChange(q.id, { ratingLabels: [q.ratingLabels[0], e.target.value] })}
                  placeholder="e.g. Absolutely"
                  className="w-full text-sm border border-white/10 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500 text-zinc-300 bg-transparent"
                />
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1">
              {Array.from({ length: q.ratingScale }, (_, i) => (
                <div key={i} className="flex flex-col items-center gap-1">
                  <div className="w-8 h-8 rounded-lg border border-white/15 flex items-center justify-center text-zinc-400 text-sm">{i + 1}</div>
                </div>
              ))}
            </div>
            <p className="text-xs text-zinc-400">Rating questions are not auto-graded — they collect student responses for review.</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function TestBuilder() {
  const navigate = useNavigate()
  const { id: editId } = useParams<{ id: string }>()
  const isEditing = !!editId
  const { profile } = useAuth()
  const [saving, setSaving] = useState(false)
  const [questions, setQuestions] = useState<QuestionState[]>([])
  const [qError, setQError] = useState('')
  const [assignmentId, setAssignmentId] = useState<string | null>(null)

  const { data: subjects } = useCollection<SubjectDoc>('subjects')
  const { data: cohorts }  = useCollection<CohortDoc>('cohorts')

  const { register, handleSubmit, control, reset, formState: { errors } } = useForm<TestFormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      shuffleQuestions: false,
      timeLimitMinutes: '',
      maxAttempts: 1,
      passingScore: 60,
      pointsValue: 10,
      isPublished: false,
    },
  })

  // Load existing test for edit mode — editId is the TEST doc ID
  useEffect(() => {
    if (!editId) return
    getDoc(doc(db, 'tests', editId)).then(async testSnap => {
      if (!testSnap.exists()) return
      const t = testSnap.data() as any
      const aId: string = t.assignmentId
      setAssignmentId(aId)

      const assignSnap = await getDoc(doc(db, 'assignments', aId))
      if (!assignSnap.exists()) return
      const a = assignSnap.data()
      const dueDate = a.dueDate?.toDate?.()
      const dueDateStr = dueDate
        ? new Date(dueDate.getTime() - dueDate.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
        : ''
      reset({
        subjectId:        a.subjectId ?? '',
        cohortId:         a.cohortId ?? '',
        title:            a.title ?? '',
        description:      a.description ?? '',
        dueDate:          dueDateStr,
        passingScore:     a.passingScore ?? 60,
        pointsValue:      a.pointsValue ?? 10,
        shuffleQuestions: t.shuffleQuestions ?? false,
        timeLimitMinutes: t.timeLimitMinutes ? String(t.timeLimitMinutes) : '',
        maxAttempts:      t.maxAttempts ?? 1,
        isPublished:      a.isPublished ?? false,
      })
      setQuestions((t.questions ?? []).map((q: any): QuestionState => ({
        id: q.id ?? nanoid(8),
        type: q.type,
        text: q.text,
        options: q.options ?? [],
        correctAnswer: q.correctAnswer ?? '',
        correctAnswers: q.correctAnswers ?? [],
        correctOrder: q.correctOrder ?? [],
        ratingScale: q.ratingScale ?? 5,
        ratingLabels: q.ratingLabels ?? ['', ''],
        points: q.points ?? 1,
      })))
    })
  }, [editId, reset])

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setQuestions(prev => {
      const oi = prev.findIndex(q => q.id === active.id)
      const ni = prev.findIndex(q => q.id === over.id)
      return arrayMove(prev, oi, ni)
    })
  }

  function addQuestion(type: QType) {
    setQuestions(prev => [...prev, {
      id: nanoid(8),
      type,
      text: '',
      options: type === 'true_false'
        ? ['True', 'False']
        : type === 'short_answer'
          ? []
          : ['', '', '', ''],
      correctAnswer: '',
      correctAnswers: [],
      correctOrder: [],
      ratingScale: 5,
      ratingLabels: ['', ''],
      points: 1,
    }])
    setQError('')
  }

  const updateQuestion = useCallback((id: string, patch: Partial<QuestionState>) => {
    setQuestions(prev => prev.map(q => q.id === id ? { ...q, ...patch } : q))
  }, [])

  const removeQuestion = useCallback((id: string) => {
    setQuestions(prev => prev.filter(q => q.id !== id))
  }, [])

  const totalPoints = questions.reduce((s, q) => s + (q.points || 0), 0)

  async function onSubmit(data: TestFormData) {
    if (questions.length === 0) { setQError('Add at least one question.'); return }
    if (!profile) return
    setSaving(true)
    try {
      const questionsPayload: Question[] = questions.map(q => ({
        id: q.id,
        text: q.text,
        type: q.type,
        options: q.options,
        correctAnswer: q.correctAnswer,
        ...(q.type === 'multiple_select' ? { correctAnswers: q.correctAnswers } : {}),
        ...(q.type === 'ordering' ? { correctOrder: q.options.map((_, i) => String(i)) } : {}),
        ...(q.type === 'rating' ? { ratingScale: q.ratingScale, ratingLabels: q.ratingLabels } : {}),
        points: q.points,
      }))

      const timeLimitMinutes = data.timeLimitMinutes
        ? Number(data.timeLimitMinutes)
        : null

      const assignPayload = {
        subjectId:    data.subjectId,
        cohortId:     data.cohortId,
        title:        data.title,
        description:  data.description ?? '',
        type:         'test',
        dueDate:      Timestamp.fromDate(new Date(data.dueDate)),
        pointsValue:  data.pointsValue,
        passingScore: data.passingScore,
        resources:    [],
        isPublished:  data.isPublished,
      }

      const testPayload = {
        questions:        questionsPayload,
        shuffleQuestions: data.shuffleQuestions,
        timeLimitMinutes,
        maxAttempts:      data.maxAttempts,
        isPublished:      data.isPublished,
      }

      if (isEditing && editId && assignmentId) {
        await updateDoc(doc(db, 'assignments', assignmentId), assignPayload)
        await updateDoc(doc(db, 'tests', editId), testPayload)
      } else {
        const assignRef = await addDoc(collection(db, 'assignments'), {
          ...assignPayload,
          createdBy: profile.uid,
          createdAt: serverTimestamp(),
        })
        await addDoc(collection(db, 'tests'), {
          ...testPayload,
          assignmentId: assignRef.id,
          createdBy:    profile.uid,
          createdAt:    serverTimestamp(),
        })
      }

      navigate('/teacher/tests')
    } catch (e) {
      console.error(e)
    } finally {
      setSaving(false)
    }
  }

  const addButtons: { type: QType; icon: React.ElementType; label: string }[] = [
    { type: 'multiple_choice',  icon: CheckCircle2,  label: 'Multiple choice'  },
    { type: 'multiple_select',  icon: ListChecks,    label: 'Multiple select'  },
    { type: 'true_false',       icon: ToggleLeft,    label: 'True / False'     },
    { type: 'short_answer',     icon: AlignLeft,     label: 'Short answer'     },
    { type: 'ordering',         icon: ArrowUpDown,   label: 'Ordering'         },
    { type: 'rating',           icon: Star,          label: 'Rating scale'     },
  ]

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="page-title">{isEditing ? 'Edit Test' : 'New Theory Test'}</h1>
        <p className="text-zinc-400 text-sm mt-1">Build a digital test with auto-grading for objective questions.</p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* ── Test details ──────────────────────────────────────────────────── */}
        <div className="bg-zinc-900 rounded-2xl border border-white/10 shadow-sm p-6 space-y-4">
          <h2 className="text-base font-semibold text-zinc-200">Test details</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Subject</label>
              <select {...register('subjectId')} className="input">
                <option value="">Select…</option>
                {subjects.map(s => <option key={s.id} value={s.id}>{s.iconEmoji} {s.title}</option>)}
              </select>
              {errors.subjectId && <p className="text-xs text-rose-500 mt-1">{errors.subjectId.message}</p>}
            </div>
            <div>
              <label className="label">Class</label>
              <select {...register('cohortId')} className="input">
                <option value="">Select…</option>
                {cohorts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {errors.cohortId && <p className="text-xs text-rose-500 mt-1">{errors.cohortId.message}</p>}
            </div>
          </div>

          <div>
            <label className="label">Test title</label>
            <input {...register('title')} className="input" placeholder="e.g. Cinematography Theory — Module 1" />
            {errors.title && <p className="text-xs text-rose-500 mt-1">{errors.title.message}</p>}
          </div>

          <div>
            <label className="label">Description <span className="text-zinc-400 font-normal">(optional)</span></label>
            <textarea {...register('description')} rows={2} className="input resize-none" placeholder="Instructions for students…" />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="label">Due date</label>
              <input {...register('dueDate')} type="datetime-local" className="input" />
              {errors.dueDate && <p className="text-xs text-rose-500 mt-1">{errors.dueDate.message}</p>}
            </div>
            <div>
              <label className="label">Passing score (%)</label>
              <input {...register('passingScore')} type="number" min="0" max="100" className="input" />
            </div>
            <div>
              <label className="label">Points on pass</label>
              <input {...register('pointsValue')} type="number" min="1" className="input" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Time limit <span className="text-zinc-400 font-normal">(minutes, blank = none)</span></label>
              <input {...register('timeLimitMinutes')} type="number" min="1" className="input" placeholder="No limit" />
            </div>
            <div>
              <label className="label">Max attempts</label>
              <input {...register('maxAttempts')} type="number" min="1" className="input" />
            </div>
          </div>

          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <Controller
                control={control}
                name="shuffleQuestions"
                render={({ field }) => (
                  <input type="checkbox" checked={field.value} onChange={field.onChange}
                    className="w-4 h-4 rounded border-white/15 text-brand-600 focus:ring-brand-500" />
                )}
              />
              <span className="text-sm text-zinc-300">Shuffle question order</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <Controller
                control={control}
                name="isPublished"
                render={({ field }) => (
                  <input type="checkbox" checked={field.value} onChange={field.onChange}
                    className="w-4 h-4 rounded border-white/15 text-brand-600 focus:ring-brand-500" />
                )}
              />
              <span className="text-sm text-zinc-300">Publish immediately</span>
            </label>
          </div>
        </div>

        {/* ── Questions ─────────────────────────────────────────────────────── */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-zinc-200">
              Questions
              <span className="text-zinc-400 font-normal text-sm ml-2">
                {questions.length} question{questions.length !== 1 ? 's' : ''} · {totalPoints} pts total
              </span>
            </h2>
          </div>

          {qError && <p className="text-sm text-rose-500">{qError}</p>}

          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={questions.map(q => q.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-3">
                {questions.map((q, i) => (
                  <QuestionCard key={q.id} q={q} index={i} onChange={updateQuestion} onRemove={removeQuestion} />
                ))}
              </div>
            </SortableContext>
          </DndContext>

          {/* Add question buttons */}
          <div className="bg-zinc-900 rounded-2xl border border-dashed border-white/10 p-4">
            <p className="text-xs text-zinc-400 font-medium mb-3 text-center">Add a question</p>
            <div className="flex flex-wrap gap-2 justify-center">
              {addButtons.map(({ type, icon: Icon, label }) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => addQuestion(type)}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-zinc-400 bg-zinc-900/50 hover:bg-brand-50 hover:text-brand-700 border border-white/10 hover:border-brand-200 rounded-xl transition-all"
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={saving} className="btn-primary py-2.5 px-6">
            {saving ? 'Saving…' : isEditing ? 'Save changes' : 'Create test (draft)'}
          </button>
          <button type="button" onClick={() => navigate('/teacher/tests')} className="btn-secondary py-2.5 px-6">
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
