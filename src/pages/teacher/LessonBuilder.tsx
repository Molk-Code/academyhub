import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  collection, addDoc, updateDoc, doc, getDoc, serverTimestamp, Timestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useCollection, where } from '@/hooks/useFirestore'
import type { SubjectDoc, CohortDoc } from '@/types'
import { Link2, Trash2, Plus, Video, FileText } from 'lucide-react'
import LoadingSpinner from '@/components/common/LoadingSpinner'

const resourceSchema = z.object({
  type:        z.enum(['file', 'video', 'link', 'youtube']),
  label:       z.string().min(1, 'Label required'),
  url:         z.string().url('Enter a valid URL'),
  storagePath: z.string().nullable(),
})

const schema = z.object({
  subjectId:   z.string().min(1, 'Select a subject'),
  cohortId:    z.string().min(1, 'Select a cohort'),
  title:       z.string().min(2, 'Title required'),
  description: z.string().optional(),
  classroom:   z.string().min(1, 'Enter a room or meeting link'),
  startTime:   z.string().min(1, 'Start time required'),
  endTime:     z.string().min(1, 'End time required'),
  isOnline:    z.boolean(),
  resources:   z.array(resourceSchema),
})

type FormData = z.infer<typeof schema>

function toInputDatetime(ts: Timestamp): string {
  const d = ts.toDate()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}

export default function LessonBuilder() {
  const { id } = useParams<{ id?: string }>()
  const isEdit = !!id
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [saving, setSaving] = useState(false)
  const [loadingDoc, setLoadingDoc] = useState(isEdit)

  const { data: subjects } = useCollection<SubjectDoc>('subjects')
  const { data: cohorts  } = useCollection<CohortDoc>(
    'cohorts',
    profile ? [where('teacherIds', 'array-contains', profile.uid)] : [],
    !!profile,
  )

  const { register, handleSubmit, control, setValue, watch, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { resources: [], isOnline: false },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'resources' })
  const isOnline = watch('isOnline')

  // Load existing lesson for editing
  useEffect(() => {
    if (!id) return
    getDoc(doc(db, 'lessons', id)).then(snap => {
      if (!snap.exists()) return
      const d = snap.data() as any
      setValue('subjectId',   d.subjectId)
      setValue('cohortId',    d.cohortId)
      setValue('title',       d.title)
      setValue('description', d.description ?? '')
      setValue('classroom',   d.classroom)
      setValue('isOnline',    d.isOnline)
      setValue('startTime',   toInputDatetime(d.startTime))
      setValue('endTime',     toInputDatetime(d.endTime))
      setValue('resources',   d.resources ?? [])
      setLoadingDoc(false)
    })
  }, [id, setValue])

  async function onSubmit(data: FormData) {
    if (!profile) return
    setSaving(true)
    const payload = {
      ...data,
      teacherId: profile.uid,
      startTime: Timestamp.fromDate(new Date(data.startTime)),
      endTime:   Timestamp.fromDate(new Date(data.endTime)),
      resources: data.resources,
    }
    try {
      if (isEdit) {
        await updateDoc(doc(db, 'lessons', id!), payload)
      } else {
        await addDoc(collection(db, 'lessons'), { ...payload, createdAt: serverTimestamp() })
      }
      navigate('/teacher/lessons')
    } catch (e) {
      console.error(e)
    } finally {
      setSaving(false)
    }
  }

  if (loadingDoc) return <LoadingSpinner />

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="page-title text-white">{isEdit ? 'Edit Lesson' : 'New Lesson'}</h1>
        <p className="text-slate-400 text-sm mt-1">
          {isEdit ? 'Update lesson details below.' : 'Fill in the details to schedule a new lesson.'}
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label text-slate-300">Subject</label>
            <select {...register('subjectId')} className="input bg-slate-800 border-slate-700 text-white">
              <option value="">Select subject…</option>
              {subjects.map(s => <option key={s.id} value={s.id}>{s.iconEmoji} {s.title}</option>)}
            </select>
            {errors.subjectId && <p className="text-xs text-rose-400 mt-1">{errors.subjectId.message}</p>}
          </div>
          <div>
            <label className="label text-slate-300">Cohort</label>
            <select {...register('cohortId')} className="input bg-slate-800 border-slate-700 text-white">
              <option value="">Select cohort…</option>
              {cohorts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {errors.cohortId && <p className="text-xs text-rose-400 mt-1">{errors.cohortId.message}</p>}
          </div>
        </div>

        <div>
          <label className="label text-slate-300">Lesson title</label>
          <input {...register('title')} className="input bg-slate-800 border-slate-700 text-white placeholder:text-slate-500" placeholder="e.g. Introduction to Cinematography" />
          {errors.title && <p className="text-xs text-rose-400 mt-1">{errors.title.message}</p>}
        </div>

        <div>
          <label className="label text-slate-300">Description <span className="text-slate-500">(optional)</span></label>
          <textarea {...register('description')} rows={3} className="input bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 resize-none" placeholder="What will students learn in this session?" />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label text-slate-300">Start</label>
            <input {...register('startTime')} type="datetime-local" className="input bg-slate-800 border-slate-700 text-white" />
            {errors.startTime && <p className="text-xs text-rose-400 mt-1">{errors.startTime.message}</p>}
          </div>
          <div>
            <label className="label text-slate-300">End</label>
            <input {...register('endTime')} type="datetime-local" className="input bg-slate-800 border-slate-700 text-white" />
            {errors.endTime && <p className="text-xs text-rose-400 mt-1">{errors.endTime.message}</p>}
          </div>
        </div>

        <div>
          <label className="flex items-center gap-2 cursor-pointer mb-2">
            <input {...register('isOnline')} type="checkbox" className="rounded border-slate-600 bg-slate-800 text-brand-500" />
            <span className="text-sm text-slate-300">This is an online class</span>
          </label>
          <input
            {...register('classroom')}
            className="input bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
            placeholder={isOnline ? 'Paste meeting link…' : 'Room number or name…'}
          />
          {errors.classroom && <p className="text-xs text-rose-400 mt-1">{errors.classroom.message}</p>}
        </div>

        {/* Resources */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="label text-slate-300 mb-0">Resources</label>
            <div className="flex gap-2">
              <button type="button" onClick={() => append({ type: 'link', label: '', url: '', storagePath: null })} className="btn-ghost text-xs py-1 px-2 text-slate-400">
                <Link2 className="w-3 h-3" /> Link
              </button>
              <button type="button" onClick={() => append({ type: 'youtube', label: '', url: '', storagePath: null })} className="btn-ghost text-xs py-1 px-2 text-slate-400">
                <Video className="w-3 h-3" /> YouTube
              </button>
              <button type="button" onClick={() => append({ type: 'file', label: '', url: '', storagePath: null })} className="btn-ghost text-xs py-1 px-2 text-slate-400">
                <FileText className="w-3 h-3" /> File URL
              </button>
            </div>
          </div>
          <div className="space-y-2">
            {fields.map((field, i) => (
              <div key={field.id} className="flex items-start gap-2">
                <input {...register(`resources.${i}.label`)} placeholder="Label" className="input bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 flex-1" />
                <input {...register(`resources.${i}.url`)}   placeholder="URL"   className="input bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 flex-1" />
                <button type="button" onClick={() => remove(i)} className="p-2.5 text-slate-500 hover:text-rose-400 transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={saving} className="btn-primary py-2.5 px-6">
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create lesson'}
          </button>
          <button type="button" onClick={() => navigate('/teacher/lessons')} className="btn-secondary py-2.5 px-6 bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700">
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
