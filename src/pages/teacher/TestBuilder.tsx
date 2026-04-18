import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm, useFieldArray, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { nanoid } from 'nanoid'
import {
  collection, addDoc, serverTimestamp, Timestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useCollection, where } from '@/hooks/useFirestore'
import type { SubjectDoc, CohortDoc } from '@/types'
import { Plus, Trash2, GripVertical, CheckCircle2 } from 'lucide-react'

// ── Schemas ───────────────────────────────────────────────────────────────────

const questionSchema = z.object({
  id:            z.string(),
  text:          z.string().min(3, 'Question text required'),
  type:          z.enum(['multiple_choice', 'true_false', 'short_answer']),
  options:       z.array(z.string()),
  correctAnswer: z.string().min(1, 'Correct answer required'),
  points:        z.coerce.number().min(1),
})

const schema = z.object({
  subjectId:          z.string().min(1, 'Select subject'),
  cohortId:           z.string().min(1, 'Select cohort'),
  title:              z.string().min(2, 'Title required'),
  description:        z.string().optional(),
  dueDate:            z.string().min(1, 'Due date required'),
  passingScore:       z.coerce.number().min(0).max(100),
  pointsValue:        z.coerce.number().min(1),
  shuffleQuestions:   z.boolean(),
  timeLimitMinutes:   z.coerce.number().nullable(),
  maxAttempts:        z.coerce.number().min(1),
  questions:          z.array(questionSchema).min(1, 'Add at least one question'),
})

type FormData = z.infer<typeof schema>

// ── Component ─────────────────────────────────────────────────────────────────

export default function TestBuilder() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [saving, setSaving] = useState(false)

  const { data: subjects } = useCollection<SubjectDoc>('subjects')
  const { data: cohorts }  = useCollection<CohortDoc>(
    'cohorts',
    profile ? [where('teacherIds', 'array-contains', profile.uid)] : [],
    !!profile,
  )

  const { register, handleSubmit, control, watch, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      shuffleQuestions: false,
      timeLimitMinutes: null,
      maxAttempts: 1,
      passingScore: 60,
      pointsValue: 10,
      questions: [],
    },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'questions' })
  const questions = watch('questions')

  function addQuestion(type: 'multiple_choice' | 'true_false' | 'short_answer') {
    append({
      id:            nanoid(8),
      text:          '',
      type,
      options:       type === 'true_false' ? ['True', 'False'] : ['', '', '', ''],
      correctAnswer: '',
      points:        1,
    })
  }

  async function onSubmit(data: FormData) {
    if (!profile) return
    setSaving(true)
    try {
      // Create the assignment document
      const assignRef = await addDoc(collection(db, 'assignments'), {
        subjectId:    data.subjectId,
        cohortId:     data.cohortId,
        createdBy:    profile.uid,
        title:        data.title,
        description:  data.description ?? '',
        type:         'test',
        dueDate:      Timestamp.fromDate(new Date(data.dueDate)),
        pointsValue:  data.pointsValue,
        passingScore: data.passingScore,
        resources:    [],
        isPublished:  false,
        createdAt:    serverTimestamp(),
      })

      // Create the test document
      await addDoc(collection(db, 'tests'), {
        assignmentId:     assignRef.id,
        questions:        data.questions,
        shuffleQuestions: data.shuffleQuestions,
        timeLimitMinutes: data.timeLimitMinutes,
        maxAttempts:      data.maxAttempts,
      })

      navigate('/teacher/gradebook')
    } catch (e) {
      console.error(e)
    } finally {
      setSaving(false)
    }
  }

  const totalPoints = questions.reduce((s, q) => s + (q.points || 0), 0)

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="page-title text-white">Create Theory Test</h1>
        <p className="text-slate-400 text-sm mt-1">Build a digital test with auto-grading.</p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* ── Details ─────────────────────────────────────────────────────── */}
        <div className="bg-slate-800 rounded-2xl p-5 space-y-4">
          <h2 className="text-base font-semibold text-white">Test details</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label text-slate-300">Subject</label>
              <select {...register('subjectId')} className="input bg-slate-700 border-slate-600 text-white">
                <option value="">Select…</option>
                {subjects.map(s => <option key={s.id} value={s.id}>{s.iconEmoji} {s.title}</option>)}
              </select>
              {errors.subjectId && <p className="text-xs text-rose-400 mt-1">{errors.subjectId.message}</p>}
            </div>
            <div>
              <label className="label text-slate-300">Cohort</label>
              <select {...register('cohortId')} className="input bg-slate-700 border-slate-600 text-white">
                <option value="">Select…</option>
                {cohorts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {errors.cohortId && <p className="text-xs text-rose-400 mt-1">{errors.cohortId.message}</p>}
            </div>
          </div>

          <div>
            <label className="label text-slate-300">Test title</label>
            <input {...register('title')} className="input bg-slate-700 border-slate-600 text-white placeholder:text-slate-500" placeholder="e.g. Cinematography Theory — Module 1" />
            {errors.title && <p className="text-xs text-rose-400 mt-1">{errors.title.message}</p>}
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="label text-slate-300">Due date</label>
              <input {...register('dueDate')} type="datetime-local" className="input bg-slate-700 border-slate-600 text-white" />
            </div>
            <div>
              <label className="label text-slate-300">Passing score (%)</label>
              <input {...register('passingScore')} type="number" min="0" max="100" className="input bg-slate-700 border-slate-600 text-white" />
            </div>
            <div>
              <label className="label text-slate-300">Points on pass</label>
              <input {...register('pointsValue')} type="number" min="1" className="input bg-slate-700 border-slate-600 text-white" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label text-slate-300">Time limit (minutes, blank = none)</label>
              <input {...register('timeLimitMinutes')} type="number" min="1" className="input bg-slate-700 border-slate-600 text-white" placeholder="No limit" />
            </div>
            <div>
              <label className="label text-slate-300">Max attempts</label>
              <input {...register('maxAttempts')} type="number" min="1" className="input bg-slate-700 border-slate-600 text-white" />
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input {...register('shuffleQuestions')} type="checkbox" className="rounded border-slate-600 bg-slate-700 text-brand-500" />
            <span className="text-sm text-slate-300">Shuffle question order for each student</span>
          </label>
        </div>

        {/* ── Questions ───────────────────────────────────────────────────── */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-white">
              Questions <span className="text-slate-500 font-normal text-sm ml-1">({fields.length} · {totalPoints} pts total)</span>
            </h2>
            <div className="flex gap-2">
              {(['multiple_choice', 'true_false', 'short_answer'] as const).map(t => (
                <button key={t} type="button" onClick={() => addQuestion(t)}
                  className="btn text-xs py-1.5 px-3 bg-slate-700 text-slate-300 hover:bg-slate-600 rounded-lg">
                  <Plus className="w-3 h-3" />
                  {t === 'multiple_choice' ? 'MC' : t === 'true_false' ? 'T/F' : 'Short'}
                </button>
              ))}
            </div>
          </div>

          {errors.questions && !Array.isArray(errors.questions) && (
            <p className="text-xs text-rose-400">{(errors.questions as any).message}</p>
          )}

          {fields.map((field, i) => {
            const q = questions[i]
            return (
              <div key={field.id} className="bg-slate-800 rounded-2xl p-5 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <GripVertical className="w-4 h-4 text-slate-600" />
                    <span className="badge badge-slate">Q{i+1}</span>
                    <span className="badge badge-indigo text-xs">
                      {q?.type === 'multiple_choice' ? 'Multiple choice' : q?.type === 'true_false' ? 'True / False' : 'Short answer'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input {...register(`questions.${i}.points`)} type="number" min="1"
                      className="w-16 input bg-slate-700 border-slate-600 text-white text-xs py-1 px-2" />
                    <span className="text-xs text-slate-400">pts</span>
                    <button type="button" onClick={() => remove(i)} className="p-1.5 text-slate-500 hover:text-rose-400">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <textarea {...register(`questions.${i}.text`)} rows={2}
                  placeholder="Enter your question…"
                  className="input bg-slate-700 border-slate-600 text-white placeholder:text-slate-500 resize-none w-full" />
                {errors.questions?.[i]?.text && <p className="text-xs text-rose-400">{errors.questions[i]?.text?.message}</p>}

                {/* Options (MC / T/F) */}
                {(q?.type === 'multiple_choice' || q?.type === 'true_false') && (
                  <div className="space-y-2">
                    <p className="text-xs text-slate-400 font-medium">Options — click radio to mark correct answer</p>
                    {(q?.type === 'true_false' ? ['True', 'False'] : q?.options ?? ['', '', '', '']).map((opt, oi) => (
                      <div key={oi} className="flex items-center gap-2">
                        <Controller
                          control={control}
                          name={`questions.${i}.correctAnswer`}
                          render={({ field: f }) => (
                            <input type="radio" value={q?.type === 'true_false' ? opt : String(oi)}
                              checked={f.value === (q?.type === 'true_false' ? opt : String(oi))}
                              onChange={() => f.onChange(q?.type === 'true_false' ? opt : String(oi))}
                              className="text-brand-500" />
                          )}
                        />
                        {q?.type === 'multiple_choice'
                          ? <input {...register(`questions.${i}.options.${oi}`)} placeholder={`Option ${oi+1}`}
                              className="input bg-slate-700 border-slate-600 text-white placeholder:text-slate-500 flex-1 text-sm py-1.5" />
                          : <span className="text-sm text-slate-300">{opt}</span>
                        }
                      </div>
                    ))}
                    {errors.questions?.[i]?.correctAnswer && <p className="text-xs text-rose-400">{errors.questions[i]?.correctAnswer?.message}</p>}
                  </div>
                )}

                {/* Short answer */}
                {q?.type === 'short_answer' && (
                  <div>
                    <label className="text-xs text-slate-400 font-medium mb-1 block">Model answer (for teacher reference)</label>
                    <input {...register(`questions.${i}.correctAnswer`)}
                      className="input bg-slate-700 border-slate-600 text-white placeholder:text-slate-500 text-sm"
                      placeholder="Expected answer…" />
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={saving} className="btn-primary py-2.5 px-6">
            {saving ? 'Saving…' : 'Create test (draft)'}
          </button>
          <button type="button" onClick={() => navigate(-1)} className="btn-secondary py-2.5 px-6 bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700">
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
