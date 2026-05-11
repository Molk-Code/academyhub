import { useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  collection, addDoc, updateDoc, doc,
  serverTimestamp, Timestamp, getDoc,
} from 'firebase/firestore'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { db, storage } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useCollection } from '@/hooks/useFirestore'
import type { SubjectDoc, CohortDoc, AssignmentDoc } from '@/types'
import { Plus, Trash2, Link2, Video, FileText, Upload, Loader2 } from 'lucide-react'
import { useEffect } from 'react'

const resourceSchema = z.object({
  type:        z.enum(['file', 'video', 'link', 'youtube']),
  label:       z.string().min(1, 'Label required'),
  url:         z.string().url('Enter a valid URL'),
  storagePath: z.string().nullable(),
})

const schema = z.object({
  subjectId:   z.string().min(1, 'Select a subject'),
  cohortId:    z.string().min(1, 'Select a class'),
  title:       z.string().min(2, 'Title required'),
  description: z.string().optional(),
  dueDate:     z.string().min(1, 'Due date required'),
  pointsValue: z.coerce.number().min(1, 'Must be at least 1 point'),
  isPublished: z.boolean(),
  resources:   z.array(resourceSchema),
})

type FormData = z.infer<typeof schema>

export default function AssignmentBuilder() {
  const navigate = useNavigate()
  const { id: editId } = useParams<{ id: string }>()
  const isEditing = !!editId
  const { profile } = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const { data: subjects } = useCollection<SubjectDoc>('subjects')
  const { data: cohorts  } = useCollection<CohortDoc>('cohorts')

  const { register, handleSubmit, control, reset, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      pointsValue: 10,
      isPublished: false,
      resources:   [],
    },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'resources' })

  // Load existing assignment for edit mode
  useEffect(() => {
    if (!editId) return
    getDoc(doc(db, 'assignments', editId)).then(snap => {
      if (!snap.exists()) return
      const d = snap.data() as AssignmentDoc
      const dueDate = d.dueDate?.toDate?.()
      const dueDateStr = dueDate
        ? new Date(dueDate.getTime() - dueDate.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
        : ''
      reset({
        subjectId:   d.subjectId,
        cohortId:    d.cohortId,
        title:       d.title,
        description: d.description,
        dueDate:     dueDateStr,
        pointsValue: d.pointsValue,
        isPublished: d.isPublished,
        resources:   d.resources ?? [],
      })
    })
  }, [editId, reset])

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const path = `resources/${Date.now()}_${file.name}`
      const fileRef = storageRef(storage, path)
      await uploadBytes(fileRef, file)
      const url = await getDownloadURL(fileRef)
      append({ type: 'file', label: file.name, url, storagePath: path })
    } catch (err) {
      console.error('Upload failed', err)
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function onSubmit(data: FormData) {
    if (!profile) return
    try {
      const payload = {
        subjectId:   data.subjectId,
        cohortId:    data.cohortId,
        title:       data.title,
        description: data.description ?? '',
        type:        'practical',
        dueDate:     Timestamp.fromDate(new Date(data.dueDate)),
        pointsValue: data.pointsValue,
        passingScore: null,
        resources:   data.resources,
        isPublished: data.isPublished,
      }

      if (isEditing) {
        await updateDoc(doc(db, 'assignments', editId), payload)
      } else {
        await addDoc(collection(db, 'assignments'), {
          ...payload,
          createdBy: profile.uid,
          createdAt: serverTimestamp(),
        })
      }
      navigate('/teacher/assignments')
    } catch (e) {
      console.error(e)
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="page-title">{isEditing ? 'Edit Assignment' : 'New Assignment'}</h1>
        <p className="text-zinc-400 text-sm mt-1">
          {isEditing ? 'Update assignment details.' : 'Create a practical assignment for your students.'}
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        {/* Subject + Class */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Subject</label>
            <select {...register('subjectId')} className="input">
              <option value="">Select subject…</option>
              {[...subjects].sort((a, b) => a.order - b.order).map(s =>
                <option key={s.id} value={s.id}>{s.iconEmoji} {s.title}</option>
              )}
            </select>
            {errors.subjectId && <p className="text-xs text-rose-500 mt-1">{errors.subjectId.message}</p>}
          </div>
          <div>
            <label className="label">Class</label>
            <select {...register('cohortId')} className="input">
              <option value="">Select class…</option>
              {cohorts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {errors.cohortId && <p className="text-xs text-rose-500 mt-1">{errors.cohortId.message}</p>}
          </div>
        </div>

        {/* Title */}
        <div>
          <label className="label">Title</label>
          <input {...register('title')} className="input" placeholder="e.g. Short Film Project — Scene 1" />
          {errors.title && <p className="text-xs text-rose-500 mt-1">{errors.title.message}</p>}
        </div>

        {/* Description */}
        <div>
          <label className="label">Description <span className="text-zinc-400 font-normal">(optional)</span></label>
          <textarea {...register('description')} rows={4} className="input resize-none" placeholder="What should students submit? What will be assessed?" />
        </div>

        {/* Due date + Points */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Due date</label>
            <input {...register('dueDate')} type="datetime-local" className="input" />
            {errors.dueDate && <p className="text-xs text-rose-500 mt-1">{errors.dueDate.message}</p>}
          </div>
          <div>
            <label className="label">Points value</label>
            <input {...register('pointsValue')} type="number" min="1" className="input" />
            {errors.pointsValue && <p className="text-xs text-rose-500 mt-1">{errors.pointsValue.message}</p>}
          </div>
        </div>

        {/* Resources */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="label mb-0">Resources <span className="text-zinc-400 font-normal">(optional)</span></label>
            <div className="flex gap-2 flex-wrap">
              <button type="button" onClick={() => append({ type: 'link',    label: '', url: '', storagePath: null })} className="btn-ghost text-xs py-1 px-2">
                <Link2 className="w-3 h-3" /> Link
              </button>
              <button type="button" onClick={() => append({ type: 'youtube', label: '', url: '', storagePath: null })} className="btn-ghost text-xs py-1 px-2">
                <Video className="w-3 h-3" /> YouTube
              </button>
              <button type="button" onClick={() => append({ type: 'file',    label: '', url: '', storagePath: null })} className="btn-ghost text-xs py-1 px-2">
                <FileText className="w-3 h-3" /> File URL
              </button>
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
                className="btn-ghost text-xs py-1 px-2"
              >
                {uploading
                  ? <><Loader2 className="w-3 h-3 animate-spin" /> Uploading…</>
                  : <><Upload className="w-3 h-3" /> Upload File</>
                }
              </button>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={handleFileUpload}
              />
            </div>
          </div>
          <div className="space-y-2">
            {fields.map((field, i) => (
              <div key={field.id} className="flex items-start gap-2">
                <input {...register(`resources.${i}.label`)} placeholder="Label" className="input flex-1" />
                <input {...register(`resources.${i}.url`)}   placeholder="URL"   className="input flex-1" />
                <button type="button" onClick={() => remove(i)} className="p-2.5 text-zinc-400 hover:text-rose-500 transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Publish toggle */}
        <label className="flex items-center gap-2.5 cursor-pointer select-none">
          <input {...register('isPublished')} type="checkbox" className="w-4 h-4 rounded border-white/15 text-brand-600 focus:ring-brand-500" />
          <span className="text-sm text-zinc-300 font-medium">Publish immediately</span>
          <span className="text-xs text-zinc-400">(students can see it right away)</span>
        </label>

        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={isSubmitting || uploading} className="btn-primary py-2.5 px-6">
            {isSubmitting ? 'Saving…' : isEditing ? 'Save changes' : 'Create assignment'}
          </button>
          <button type="button" onClick={() => navigate('/teacher/assignments')} className="btn-secondary py-2.5 px-6">
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
