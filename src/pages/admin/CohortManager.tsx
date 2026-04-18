import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { collection, addDoc, updateDoc, doc, Timestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useCollection, where } from '@/hooks/useFirestore'
import type { CohortDoc, UserDoc } from '@/types'
import { shortDate } from '@/lib/utils'
import { Users, Plus, GraduationCap } from 'lucide-react'

const schema = z.object({
  name:        z.string().min(2, 'Name required'),
  startDate:   z.string().min(1),
  endDate:     z.string().min(1),
  programYear: z.coerce.number().min(1).max(2) as z.ZodType<1 | 2>,
})
type FormData = z.infer<typeof schema>

export default function CohortManager() {
  const [showForm, setShowForm] = useState(false)
  const [saving,   setSaving]   = useState(false)

  const { data: cohorts  } = useCollection<CohortDoc>('cohorts')
  const { data: teachers } = useCollection<UserDoc>('users', [where('role', '==', 'teacher')])
  const { data: students } = useCollection<UserDoc>('users', [where('role', '==', 'student')])

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { programYear: 1 },
  })

  async function onSubmit(data: FormData) {
    setSaving(true)
    await addDoc(collection(db, 'cohorts'), {
      name:        data.name,
      startDate:   Timestamp.fromDate(new Date(data.startDate)),
      endDate:     Timestamp.fromDate(new Date(data.endDate)),
      programYear: data.programYear,
      teacherIds:  [],
      studentIds:  [],
    })
    reset()
    setShowForm(false)
    setSaving(false)
  }

  async function assignTeacher(cohortId: string, teacherId: string, currentIds: string[]) {
    const updated = currentIds.includes(teacherId)
      ? currentIds.filter(id => id !== teacherId)
      : [...currentIds, teacherId]
    await updateDoc(doc(db, 'cohorts', cohortId), { teacherIds: updated })
  }

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="page-title text-white">Cohort Manager</h1>
          <p className="text-slate-400 text-sm mt-1">Organise students into year groups and assign teachers.</p>
        </div>
        <button onClick={() => setShowForm(v => !v)} className="btn-primary py-2.5">
          <Plus className="w-4 h-4" /> New Cohort
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit(onSubmit)} className="bg-slate-800 rounded-2xl p-5 space-y-4">
          <h2 className="text-base font-semibold text-white">Create cohort</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="label text-slate-300">Cohort name</label>
              <input {...register('name')} className="input bg-slate-700 border-slate-600 text-white" placeholder="e.g. 2024 Intake A" />
              {errors.name && <p className="text-xs text-rose-400 mt-1">{errors.name.message}</p>}
            </div>
            <div>
              <label className="label text-slate-300">Start date</label>
              <input {...register('startDate')} type="date" className="input bg-slate-700 border-slate-600 text-white" />
            </div>
            <div>
              <label className="label text-slate-300">End date</label>
              <input {...register('endDate')} type="date" className="input bg-slate-700 border-slate-600 text-white" />
            </div>
            <div>
              <label className="label text-slate-300">Program year</label>
              <select {...register('programYear')} className="input bg-slate-700 border-slate-600 text-white">
                <option value={1}>Year 1</option>
                <option value={2}>Year 2</option>
              </select>
            </div>
          </div>
          <div className="flex gap-3">
            <button type="submit" disabled={saving} className="btn-primary py-2">
              {saving ? 'Creating…' : 'Create cohort'}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600 py-2">
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {cohorts.map(cohort => {
          const cohortStudents = students.filter(s => s.cohortId === cohort.id)
          return (
            <div key={cohort.id} className="bg-slate-800 rounded-2xl p-5 space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-bold text-white text-base">{cohort.name}</h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Year {cohort.programYear} · {shortDate(cohort.startDate)} → {shortDate(cohort.endDate)}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 text-sm text-slate-400">
                  <Users className="w-4 h-4" />
                  {cohortStudents.length}
                </div>
              </div>

              {/* Teachers */}
              <div>
                <p className="text-xs font-medium text-slate-400 mb-2">Teachers</p>
                <div className="flex flex-wrap gap-2">
                  {teachers.map(teacher => (
                    <button
                      key={teacher.uid}
                      onClick={() => assignTeacher(cohort.id, teacher.uid, cohort.teacherIds)}
                      className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${
                        cohort.teacherIds.includes(teacher.uid)
                          ? 'bg-brand-600 text-white'
                          : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                      }`}
                    >
                      {teacher.displayName}
                    </button>
                  ))}
                  {teachers.length === 0 && <span className="text-xs text-slate-500">No teachers yet.</span>}
                </div>
              </div>

              {/* Students preview */}
              {cohortStudents.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-slate-400 mb-2 flex items-center gap-1">
                    <GraduationCap className="w-3.5 h-3.5" /> Students
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {cohortStudents.slice(0, 8).map(s => (
                      <span key={s.uid} className="text-xs bg-slate-700 text-slate-300 px-2 py-0.5 rounded-full">
                        {s.displayName}
                      </span>
                    ))}
                    {cohortStudents.length > 8 && (
                      <span className="text-xs text-slate-500">+{cohortStudents.length - 8} more</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
        {cohorts.length === 0 && (
          <div className="col-span-2 text-center py-12 text-slate-500 text-sm">No cohorts yet. Create one above.</div>
        )}
      </div>
    </div>
  )
}
