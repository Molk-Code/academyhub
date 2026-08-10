import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useForm, useFieldArray, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  collection, addDoc, updateDoc, doc, getDoc, serverTimestamp, Timestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useCollection, orderBy, where } from '@/hooks/useFirestore'
import type { SubjectDoc, CohortDoc, LessonBlockDoc, ClassroomDoc, UserDoc, LessonCategoryDoc, CurriculumItem, GuestTeacherDoc } from '@/types'
import { Link2, Trash2, Video, FileText } from 'lucide-react'
import LoadingSpinner from '@/components/common/LoadingSpinner'
import EmojiPicker    from '@/components/common/EmojiPicker'

// ── Title combobox ────────────────────────────────────────────────────────────

function TitlePicker({
  subject,
  curriculum,
  value,
  onChange,
  onSelectItem,
}: {
  subject: SubjectDoc | null
  curriculum: CurriculumItem[]
  value: string
  onChange: (v: string) => void
  onSelectItem: (itemId: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const filtered = curriculum.filter(item =>
    !value || item.title.toLowerCase().includes(value.toLowerCase()),
  )

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        value={value}
        onChange={e => { onChange(e.target.value); onSelectItem(null); setOpen(true) }}
        onFocus={() => setOpen(true)}
        className="input w-full"
        placeholder="Choose from curriculum or type a custom title…"
        autoComplete="off"
      />
      {open && subject && filtered.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-zinc-900 border border-white/10 rounded-xl shadow-lg z-20 overflow-hidden max-h-72 overflow-y-auto">
          <div className="px-3 py-2 bg-zinc-900/50 border-b border-white/8 flex items-center gap-2">
            <span>{subject.iconEmoji}</span>
            <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">{subject.title}</span>
          </div>
          {filtered.map(item => (
            <button
              key={item.id}
              type="button"
              onMouseDown={() => { onChange(item.title); onSelectItem(item.id); setOpen(false) }}
              className="w-full text-left px-4 py-2.5 hover:bg-brand-50 transition-colors border-b border-slate-50 last:border-0"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-zinc-200">{item.title}</span>
                <span className="text-xs text-zinc-400 flex-shrink-0">Sem {item.semester}</span>
              </div>
              {item.content && <p className="text-xs text-zinc-400 mt-0.5 truncate">{item.content}</p>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Classroom combobox ────────────────────────────────────────────────────────

function ClassroomPicker({
  classrooms,
  value,
  onChange,
  isOnline,
}: {
  classrooms: ClassroomDoc[]
  value: string
  onChange: (v: string) => void
  isOnline: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const filtered = classrooms.filter(c =>
    c.name.toLowerCase().includes(value.toLowerCase()),
  )

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  return (
    <div ref={ref} className="relative">
      <input
        type="text"
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        className="input w-full"
        placeholder={isOnline ? 'Paste meeting link…' : 'Select or type a room…'}
        autoComplete="off"
      />
      {open && !isOnline && filtered.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-zinc-900 border border-white/10 rounded-xl shadow-lg z-20 overflow-hidden">
          {filtered.map(c => (
            <button
              key={c.id}
              type="button"
              onMouseDown={() => { onChange(c.name); setOpen(false) }}
              className="w-full text-left px-3 py-2.5 text-sm text-zinc-300 hover:bg-brand-50 hover:text-brand-700 transition-colors flex items-center gap-2"
            >
              <span className="font-medium">{c.name}</span>
              {c.notes && <span className="text-xs text-zinc-400 truncate">{c.notes}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function combineDateAndTime(date: string, time: string): Date {
  return new Date(`${date}T${time}:00`)
}

function toDateStr(ts: Timestamp) {
  const d = ts.toDate()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function toTimeStr(ts: Timestamp) {
  const d = ts.toDate()
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}

function durationLabel(startDate: string, startTime: string, endDate: string, endTime: string): string {
  if (!startDate || !startTime || !endDate || !endTime) return ''
  const start = new Date(`${startDate}T${startTime}:00`)
  const end   = new Date(`${endDate}T${endTime}:00`)
  const mins  = (end.getTime() - start.getTime()) / 60000
  if (mins <= 0) return ''
  const totalH = Math.floor(mins / 60)
  const m      = mins % 60
  if (totalH >= 24) {
    const days = Math.floor(totalH / 24)
    const remH = totalH % 24
    const dayStr = days === 1 ? '1 day' : `${days} days`
    return remH > 0 ? `${dayStr} ${remH}h` : dayStr
  }
  return totalH > 0 ? (m > 0 ? `${totalH}h ${m}m` : `${totalH}h`) : `${m}m`
}

// ── Schema ────────────────────────────────────────────────────────────────────

const resourceSchema = z.object({
  type:        z.enum(['file', 'video', 'link', 'youtube']),
  label:       z.string().min(1, 'Label required'),
  url:         z.string().url('Enter a valid URL'),
  storagePath: z.string().nullable(),
})

const schema = z.object({
  subjectId:   z.string().min(1, 'Select a subject'),
  categoryId:  z.string().optional(),
  cohortId:    z.string().min(1, 'Select a class'),
  title:       z.string().min(2, 'Title required'),
  iconEmoji:   z.string().optional(),
  description: z.string().optional(),
  classroom:   z.string().min(1, 'Enter a room or meeting link'),
  date:        z.string().min(1, 'Date required'),
  endDate:     z.string().min(1, 'End date required'),
  startTime:   z.string().min(1, 'Start time required'),
  endTime:     z.string().min(1, 'End time required'),
  isOnline:    z.boolean(),
  teacherIds:      z.array(z.string()),
  guestTeacherIds: z.array(z.string()),
  resources:   z.array(resourceSchema),
})

type FormData = z.infer<typeof schema>

// ── Component ─────────────────────────────────────────────────────────────────

export default function LessonBuilder() {
  const { id } = useParams<{ id?: string }>()
  const isEdit = !!id
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { profile } = useAuth()
  const [saving, setSaving] = useState(false)
  const [loadingDoc, setLoadingDoc] = useState(isEdit)
  const [coveredCurriculumIds, setCoveredCurriculumIds] = useState<string[]>([])

  const { data: subjects    } = useCollection<SubjectDoc>('subjects')
  const { data: cohorts     } = useCollection<CohortDoc>('cohorts')
  const { data: lcategories } = useCollection<LessonCategoryDoc>('lessonCategories', [orderBy('order', 'asc')])
  const { data: blocks     } = useCollection<LessonBlockDoc>('lessonBlocks', [orderBy('order', 'asc')])
  const { data: classrooms } = useCollection<ClassroomDoc>('classrooms', [orderBy('order', 'asc')])
  const { data: teachers      } = useCollection<UserDoc>('users', [where('role', '==', 'teacher')])
  const { data: guestTeachers } = useCollection<GuestTeacherDoc>('guest_teachers')

  const { register, handleSubmit, control, setValue, watch, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      resources:       [],
      isOnline:        false,
      teacherIds:      profile ? [profile.uid] : [],
      guestTeacherIds: [],
      date:       searchParams.get('date')  ?? '',
      endDate:    searchParams.get('date')  ?? '',
      startTime:  searchParams.get('start') ?? '',
      endTime:    searchParams.get('end')   ?? '',
    },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'resources' })
  const isOnline    = watch('isOnline')
  const date        = watch('date')
  const endDate     = watch('endDate')
  const startTime   = watch('startTime')
  const endTime     = watch('endTime')
  const teacherIds      = watch('teacherIds')
  const guestTeacherIds = watch('guestTeacherIds')
  const selectedSubjectId = watch('subjectId')

  const selectedSubject = useMemo(
    () => subjects.find(s => s.id === selectedSubjectId) ?? null,
    [subjects, selectedSubjectId],
  )
  const curriculumItems: CurriculumItem[] = useMemo(
    () => [...(selectedSubject?.curriculum ?? [])].sort((a, b) => a.order - b.order),
    [selectedSubject],
  )

  function toggleTeacher(uid: string) {
    const current = teacherIds ?? []
    if (current.includes(uid)) {
      setValue('teacherIds', current.filter(id => id !== uid))
    } else {
      setValue('teacherIds', [...current, uid])
    }
  }

  function toggleGuestTeacher(gid: string) {
    const current = guestTeacherIds ?? []
    if (current.includes(gid)) {
      setValue('guestTeacherIds', current.filter(id => id !== gid))
    } else {
      setValue('guestTeacherIds', [...current, gid])
    }
  }

  // Load existing lesson for editing
  useEffect(() => {
    if (!id) return
    getDoc(doc(db, 'lessons', id)).then(snap => {
      if (!snap.exists()) return
      const d = snap.data() as any
      setValue('subjectId',   d.subjectId)
      setValue('categoryId',  d.categoryId ?? '')
      setValue('cohortId',    d.cohortId)
      setValue('title',       d.title)
      setValue('iconEmoji',   d.iconEmoji ?? '')
      setValue('description', d.description ?? '')
      setValue('classroom',   d.classroom)
      setValue('isOnline',    d.isOnline)
      setValue('teacherIds',      d.teacherIds ?? (d.teacherId ? [d.teacherId] : []))
      setValue('guestTeacherIds', d.guestTeacherIds ?? [])
      setValue('date',        toDateStr(d.startTime))
      setValue('endDate',     toDateStr(d.endTime))
      setValue('startTime',   toTimeStr(d.startTime))
      setValue('endTime',     toTimeStr(d.endTime))
      setValue('resources',   d.resources ?? [])
      setCoveredCurriculumIds(d.coveredCurriculumIds ?? [])
      setLoadingDoc(false)
    })
  }, [id, setValue])

  async function onSubmit(data: FormData) {
    if (!profile) return
    setSaving(true)
    const startDate = combineDateAndTime(data.date,    data.startTime)
    const endDate   = combineDateAndTime(data.endDate, data.endTime)
    const tIds = data.teacherIds.length > 0 ? data.teacherIds : [profile.uid]
    const payload = {
      subjectId:   data.subjectId,
      categoryId:  data.categoryId || null,
      cohortId:    data.cohortId,
      title:       data.title,
      iconEmoji:   data.iconEmoji ?? '',
      description: data.description ?? '',
      classroom:   data.classroom,
      isOnline:    data.isOnline,
      resources:   data.resources,
      teacherId:   profile.uid,
      teacherIds:      tIds,
      guestTeacherIds: data.guestTeacherIds,
      startTime:            Timestamp.fromDate(startDate),
      endTime:              Timestamp.fromDate(endDate),
      coveredCurriculumIds: coveredCurriculumIds,
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
        <h1 className="page-title">{isEdit ? 'Edit Lesson' : 'New Lesson'}</h1>
        <p className="text-zinc-500 text-sm mt-1">
          {isEdit ? 'Update lesson details below.' : 'Fill in the details to schedule a new lesson.'}
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">

        {/* Subject + Category + Class */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Subject</label>
            <select {...register('subjectId')} className="input">
              <option value="">Select subject…</option>
              {[...subjects].sort((a,b) => a.order - b.order).map(s =>
                <option key={s.id} value={s.id}>{s.iconEmoji} {s.title}</option>
              )}
            </select>
            {errors.subjectId && <p className="text-xs text-rose-500 mt-1">{errors.subjectId.message}</p>}
          </div>
          {lcategories.length > 0 && (
            <div>
              <label className="label">Category <span className="text-zinc-400 font-normal">(optional)</span></label>
              <select {...register('categoryId')} className="input">
                <option value="">No category</option>
                {lcategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="label">Class</label>
            <select {...register('cohortId')} className="input">
              <option value="">Select class…</option>
              {cohorts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {errors.cohortId && <p className="text-xs text-rose-500 mt-1">{errors.cohortId.message}</p>}
          </div>
        </div>

        {/* Title + Emoji */}
        <div>
          <label className="label">Lesson title</label>
          <div className="flex items-start gap-2">
            <Controller
              control={control}
              name="iconEmoji"
              render={({ field }) => (
                <EmojiPicker value={field.value ?? ''} onChange={field.onChange} />
              )}
            />
            <div className="flex-1">
              <Controller
                control={control}
                name="title"
                render={({ field }) => (
                  <TitlePicker
                    subject={selectedSubject}
                    curriculum={curriculumItems}
                    value={field.value ?? ''}
                    onChange={field.onChange}
                    onSelectItem={itemId => setCoveredCurriculumIds(itemId ? [itemId] : [])}
                  />
                )}
              />
              {errors.title && <p className="text-xs text-rose-500 mt-1">{errors.title.message}</p>}
            </div>
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="label">Description <span className="text-zinc-400 font-normal">(optional)</span></label>
          <textarea {...register('description')} rows={2} className="input resize-none" placeholder="What will students learn in this session?" />
        </div>

        {/* Date & Time */}
        <div className="bg-zinc-900/50 rounded-2xl border border-white/10 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-zinc-300">When</p>
            {date && endDate && date !== endDate && (
              <span className="text-xs font-semibold text-brand-600 bg-brand-50 border border-brand-200 px-2 py-0.5 rounded-full">
                Multi-day event
              </span>
            )}
          </div>

          {/* Start date / End date */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label text-xs">Start date</label>
              <input
                {...register('date')}
                type="date"
                className="input w-full"
                onChange={e => {
                  setValue('date', e.target.value)
                  // Keep end date ≥ start date
                  if (!endDate || endDate < e.target.value) {
                    setValue('endDate', e.target.value)
                  }
                }}
              />
              {errors.date && <p className="text-xs text-rose-500 mt-1">{errors.date.message}</p>}
            </div>
            <div>
              <label className="label text-xs">End date</label>
              <input
                {...register('endDate')}
                type="date"
                min={date || undefined}
                className="input w-full"
              />
              {errors.endDate && <p className="text-xs text-rose-500 mt-1">{errors.endDate.message}</p>}
            </div>
          </div>

          {/* Pre-made blocks (only useful for same-day) */}
          {blocks.length > 0 && (
            <div>
              <label className="label text-xs">Quick pick a time block</label>
              <div className="flex flex-wrap gap-2">
                {blocks.map(b => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => { setValue('startTime', b.startTime); setValue('endTime', b.endTime) }}
                    className="px-3 py-1.5 rounded-lg border border-white/15 text-xs font-medium text-zinc-300 hover:border-brand-400 hover:bg-brand-50 hover:text-brand-700 transition-colors"
                  >
                    {b.name} · {b.startTime}–{b.endTime}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-3 flex-wrap">
            <div>
              <label className="label text-xs">Start time</label>
              <input {...register('startTime')} type="time" className="input w-32" />
            </div>
            <div className="pt-5 text-zinc-400 text-sm">→</div>
            <div>
              <label className="label text-xs">End time</label>
              <input {...register('endTime')} type="time" className="input w-32" />
            </div>
            {durationLabel(date, startTime, endDate, endTime) && (
              <div className="pt-5 text-sm text-brand-600 font-medium">
                {durationLabel(date, startTime, endDate, endTime)}
              </div>
            )}
          </div>
          {(errors.startTime || errors.endTime) && (
            <p className="text-xs text-rose-500">{errors.startTime?.message ?? errors.endTime?.message}</p>
          )}
        </div>

        {/* Location */}
        <div>
          <label className="flex items-center gap-2 cursor-pointer mb-2">
            <input {...register('isOnline')} type="checkbox" className="rounded border-white/15 text-brand-500 focus:ring-brand-500" />
            <span className="text-sm text-zinc-300 font-medium">Online class</span>
          </label>
          <Controller
            control={control}
            name="classroom"
            render={({ field }) => (
              <ClassroomPicker
                classrooms={classrooms}
                value={field.value ?? ''}
                onChange={field.onChange}
                isOnline={isOnline}
              />
            )}
          />
          {errors.classroom && <p className="text-xs text-rose-500 mt-1">{errors.classroom.message}</p>}
        </div>

        {/* Teachers */}
        {teachers.length > 0 && (
          <div>
            <label className="label">Teachers <span className="text-zinc-400 font-normal">(optional)</span></label>
            <div className="flex flex-wrap gap-2">
              {teachers.map(t => {
                const active = (teacherIds ?? []).includes(t.uid)
                return (
                  <button
                    key={t.uid}
                    type="button"
                    onClick={() => toggleTeacher(t.uid)}
                    className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
                      active
                        ? 'bg-brand-600 border-brand-600 text-white'
                        : 'bg-zinc-900 border-white/15 text-zinc-400 hover:border-brand-400 hover:text-brand-700'
                    }`}
                  >
                    {t.displayName}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Guest Teachers */}
        {guestTeachers.length > 0 && (
          <div>
            <label className="label">Guest teachers <span className="text-zinc-400 font-normal">(optional)</span></label>
            <div className="flex flex-wrap gap-2">
              {guestTeachers.map(g => {
                const active = (guestTeacherIds ?? []).includes(g.id)
                return (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => toggleGuestTeacher(g.id)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
                      active
                        ? 'bg-brand-600 border-brand-600 text-white'
                        : 'bg-zinc-900 border-white/15 text-zinc-400 hover:border-brand-400 hover:text-brand-300'
                    }`}
                  >
                    {g.profilePictureUrl ? (
                      <img src={g.profilePictureUrl} alt={g.name} className="w-5 h-5 rounded-full object-cover flex-shrink-0" />
                    ) : (
                      <span className="w-5 h-5 rounded-full bg-zinc-700 flex-shrink-0" />
                    )}
                    {g.name}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Resources */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="label mb-0">Resources <span className="text-zinc-400 font-normal">(optional)</span></label>
            <div className="flex gap-2">
              <button type="button" onClick={() => append({ type: 'link', label: '', url: '', storagePath: null })} className="btn-ghost text-xs py-1 px-2">
                <Link2 className="w-3 h-3" /> Link
              </button>
              <button type="button" onClick={() => append({ type: 'youtube', label: '', url: '', storagePath: null })} className="btn-ghost text-xs py-1 px-2">
                <Video className="w-3 h-3" /> YouTube
              </button>
              <button type="button" onClick={() => append({ type: 'file', label: '', url: '', storagePath: null })} className="btn-ghost text-xs py-1 px-2">
                <FileText className="w-3 h-3" /> File URL
              </button>
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

        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={saving} className="btn-primary py-2.5 px-6">
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create lesson'}
          </button>
          <button type="button" onClick={() => navigate('/teacher/lessons')} className="btn-secondary py-2.5 px-6">
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
