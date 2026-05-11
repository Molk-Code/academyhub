import { useState, useRef, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { collection, addDoc, serverTimestamp, deleteDoc, updateDoc, doc } from 'firebase/firestore'
import { nanoid } from 'nanoid'
import { db } from '@/lib/firebase'
import { useDocument, useCollection, where } from '@/hooks/useFirestore'
import type { CohortDoc, UserDoc, SemesterSettingsDoc } from '@/types'
import { shortDate } from '@/lib/utils'
import { cn, initials, avatarColor } from '@/lib/utils'
import {
  ArrowLeft, UserPlus, Copy, Check, Mail, GraduationCap,
  Trash2, UserX, Search, Plus, CalendarRange, X, Users, Palette,
} from 'lucide-react'

const COHORT_COLORS = [
  '#f26419','#f6ae2d','#10b981','#33658a','#86bbd8',
  '#8b5cf6','#f43f5e','#0ea5e9','#14b8a6','#2f4858',
  '#e879f9','#84cc16',
]
import Avatar from '@/components/common/Avatar'
import LoadingSpinner from '@/components/common/LoadingSpinner'

const schema = z.object({
  name:  z.string().min(2, 'Name required'),
  email: z.string().email('Valid email required'),
})
type FormData = z.infer<typeof schema>

interface Invitation {
  id: string
  email: string
  role: string
  cohortId: string | null
  displayName: string | null
  used: boolean
  createdAt: any
}

// ── User picker combobox ──────────────────────────────────────────────────────

function UserPicker({
  candidates,
  onAdd,
}: {
  candidates: UserDoc[]
  onAdd: (user: UserDoc) => void
}) {
  const [query, setQuery]   = useState('')
  const [open,  setOpen]    = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const filtered = candidates.filter(u => {
    if (!query) return true
    const q = query.toLowerCase()
    return u.displayName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
  })

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
        <input
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder="Search by name or email…"
          className="input pl-9"
        />
      </div>

      {open && (
        <div className="absolute z-20 mt-1 w-full bg-zinc-900 border border-white/10 rounded-xl shadow-lg max-h-56 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="px-4 py-3 text-sm text-zinc-400">
              {query ? 'No matching users found.' : 'All students are already enrolled.'}
            </p>
          ) : (
            filtered.map(u => (
              <button
                key={u.id}
                type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => { onAdd(u); setQuery(''); setOpen(false) }}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-brand-50 transition-colors text-left"
              >
                <div className={cn(
                  'w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0',
                  avatarColor(u.uid),
                )}>
                  {initials(u.displayName)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-zinc-200 truncate">{u.displayName}</p>
                  <p className="text-xs text-zinc-400 truncate">{u.email}</p>
                </div>
                {u.cohortId && u.cohortId !== '' && (
                  <span className="text-xs text-amber-600 bg-amber-950/40 px-2 py-0.5 rounded-full flex-shrink-0">
                    In another class
                  </span>
                )}
                <Plus className="w-4 h-4 text-brand-500 flex-shrink-0" />
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CohortDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [saving,       setSaving]       = useState(false)
  const [copiedToken,  setCopiedToken]  = useState<string | null>(null)
  const [showInvite,   setShowInvite]   = useState(false)

  const { data: cohort, loading: cohortLoading } = useDocument<CohortDoc>('cohorts', id!)
  const { data: globalSemester } = useDocument<SemesterSettingsDoc>('settings', 'semester')
  const { data: students } = useCollection<UserDoc>(
    'users',
    id ? [where('cohortId', '==', id), where('role', '==', 'student')] : [],
    !!id,
  )
  const { data: allStudents } = useCollection<UserDoc>(
    'users',
    [where('role', '==', 'student')],
  )
  const { data: teachers } = useCollection<UserDoc>(
    'users',
    id ? [where('cohortId', '==', id), where('roles', 'array-contains', 'teacher')] : [],
    !!id,
  )
  const { data: allTeachers } = useCollection<UserDoc>(
    'users',
    [where('roles', 'array-contains', 'teacher')],
  )
  const { data: allInvitations } = useCollection<Invitation>('invitations')

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  const pendingInvites = allInvitations.filter(i => !i.used && i.cohortId === id)

  // Semester dates
  const [semEditing,    setSemEditing]    = useState(false)
  const [sem1Start,     setSem1Start]     = useState('')
  const [sem1End,       setSem1End]       = useState('')
  const [sem2Start,     setSem2Start]     = useState('')
  const [sem2End,       setSem2End]       = useState('')
  const [semSaving,     setSemSaving]     = useState(false)
  const [semSaved,      setSemSaved]      = useState(false)

  useEffect(() => {
    if (cohort) {
      setSem1Start(cohort.semesterStartDate      ?? '')
      setSem1End(cohort.semesterEndDate          ?? '')
      setSem2Start(cohort.semesterSem2StartDate  ?? '')
      setSem2End(cohort.semesterSem2EndDate      ?? '')
    }
  }, [cohort])

  async function saveSemester() {
    if (!id) return
    setSemSaving(true)
    await updateDoc(doc(db, 'cohorts', id), {
      semesterStartDate:     sem1Start || null,
      semesterEndDate:       sem1End   || null,
      semesterSem2StartDate: sem2Start || null,
      semesterSem2EndDate:   sem2End   || null,
    })
    setSemSaving(false)
    setSemSaved(true)
    setSemEditing(false)
    setTimeout(() => setSemSaved(false), 2000)
  }

  async function clearSemester() {
    if (!id) return
    await updateDoc(doc(db, 'cohorts', id), {
      semesterStartDate:     null,
      semesterEndDate:       null,
      semesterSem2StartDate: null,
      semesterSem2EndDate:   null,
    })
    setSem1Start(''); setSem1End(''); setSem2Start(''); setSem2End('')
  }

  // Students NOT already in this cohort — available to add
  const enrolledIds = new Set(students.map(s => s.id))
  const candidates  = allStudents.filter(s => !enrolledIds.has(s.id))

  async function addStudent(user: UserDoc) {
    await updateDoc(doc(db, 'users', user.id), { cohortId: id })
  }

  async function removeStudent(student: UserDoc) {
    if (!confirm(`Remove ${student.displayName} from this class?`)) return
    await updateDoc(doc(db, 'users', student.id), { cohortId: null })
  }

  const enrolledTeacherIds = new Set(teachers.map(t => t.id))
  const teacherCandidates  = allTeachers.filter(t => !enrolledTeacherIds.has(t.id))

  async function addTeacher(user: UserDoc) {
    await updateDoc(doc(db, 'users', user.id), { cohortId: id })
  }

  async function removeTeacher(teacher: UserDoc) {
    if (!confirm(`Remove ${teacher.displayName} from this class?`)) return
    await updateDoc(doc(db, 'users', teacher.id), { cohortId: null })
  }

  async function deleteInvite(invId: string) {
    if (!confirm('Delete this invite?')) return
    await deleteDoc(doc(db, 'invitations', invId))
  }

  async function onSubmit(data: FormData) {
    if (!id) return
    setSaving(true)
    const token = nanoid(24)
    await addDoc(collection(db, 'invitations'), {
      token,
      email:       data.email,
      role:        'student',
      cohortId:    id,
      displayName: data.name,
      used:        false,
      createdAt:   serverTimestamp(),
    })
    reset()
    setSaving(false)
  }

  function copyInviteLink(invId: string) {
    const url = `${window.location.origin}/accept-invite?token=${invId}`
    navigator.clipboard.writeText(url)
    setCopiedToken(invId)
    setTimeout(() => setCopiedToken(null), 2000)
  }

  if (cohortLoading) return <LoadingSpinner />
  if (!cohort) return <p className="text-zinc-400 text-sm p-8">Class not found.</p>

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <button
          onClick={() => navigate('/admin/cohorts')}
          className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white mb-4 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Classes
        </button>
        <h1 className="page-title">{cohort.name}</h1>
        <p className="text-zinc-400 text-sm mt-1">
          Year {cohort.programYear} · {shortDate(cohort.startDate)} → {shortDate(cohort.endDate)}
        </p>
      </div>

      {/* ── Semester Dates ─────────────────────────────────────────────── */}
      <div className="bg-zinc-900 rounded-2xl border border-white/10 p-5">
        <div className="flex items-center justify-between gap-4 mb-1">
          <div className="flex items-center gap-2">
            <CalendarRange className="w-4 h-4 text-brand-500 flex-shrink-0" />
            <p className="text-sm font-semibold text-zinc-200">Semester Dates</p>
            {!cohort.semesterStartDate && (
              <span className="text-[11px] font-medium text-zinc-400 bg-zinc-800 rounded-full px-2 py-0.5">
                Using global default{globalSemester?.startDate ? ` (${globalSemester.startDate})` : ' (not set)'}
              </span>
            )}
          </div>
          {cohort.semesterStartDate && !semEditing && (
            <button onClick={clearSemester} className="text-xs text-zinc-400 hover:text-rose-500 transition-colors flex items-center gap-1">
              <X className="w-3 h-3" /> Clear override
            </button>
          )}
        </div>
        <p className="text-xs text-zinc-400 mb-4">Override the global semester dates for this class only. Students in this class will see these dates on their dashboard.</p>

        {semEditing ? (
          <div className="space-y-4">
            <div>
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Semester 1</p>
              <div className="flex items-end gap-3 flex-wrap">
                <div>
                  <label className="label text-xs">Start date</label>
                  <input type="date" className="input w-44" value={sem1Start} onChange={e => setSem1Start(e.target.value)} />
                </div>
                <div>
                  <label className="label text-xs">End date</label>
                  <input type="date" className="input w-44" value={sem1End} min={sem1Start} onChange={e => setSem1End(e.target.value)} />
                </div>
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Semester 2 <span className="text-zinc-400 normal-case font-normal">(optional)</span></p>
              <div className="flex items-end gap-3 flex-wrap">
                <div>
                  <label className="label text-xs">Start date</label>
                  <input type="date" className="input w-44" value={sem2Start} min={sem1End} onChange={e => setSem2Start(e.target.value)} />
                </div>
                <div>
                  <label className="label text-xs">End date</label>
                  <input type="date" className="input w-44" value={sem2End} min={sem2Start} onChange={e => setSem2End(e.target.value)} />
                </div>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={saveSemester} disabled={semSaving || !sem1Start || !sem1End}
                className="btn-primary py-2 px-4 text-sm flex items-center gap-2">
                <Check className="w-4 h-4" />{semSaving ? 'Saving…' : semSaved ? 'Saved!' : 'Save'}
              </button>
              <button onClick={() => {
                setSemEditing(false)
                setSem1Start(cohort.semesterStartDate ?? '')
                setSem1End(cohort.semesterEndDate ?? '')
                setSem2Start(cohort.semesterSem2StartDate ?? '')
                setSem2End(cohort.semesterSem2EndDate ?? '')
              }} className="btn-secondary py-2 px-4 text-sm">Cancel</button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <p className="text-xs font-medium text-zinc-500 w-20">Semester 1</p>
              {cohort.semesterStartDate ? (
                <div className="flex items-center gap-2 text-sm font-medium text-zinc-300">
                  <span className="bg-brand-50 text-brand-700 border border-brand-100 rounded-lg px-3 py-1.5">{cohort.semesterStartDate}</span>
                  <span className="text-zinc-400">→</span>
                  <span className="bg-brand-50 text-brand-700 border border-brand-100 rounded-lg px-3 py-1.5">{cohort.semesterEndDate}</span>
                </div>
              ) : (
                <span className="text-sm text-zinc-400">No override set</span>
              )}
            </div>
            {(cohort.semesterSem2StartDate || cohort.semesterStartDate) && (
              <div className="flex items-center gap-3">
                <p className="text-xs font-medium text-zinc-500 w-20">Semester 2</p>
                {cohort.semesterSem2StartDate ? (
                  <div className="flex items-center gap-2 text-sm font-medium text-zinc-300">
                    <span className="bg-brand-50 text-brand-700 border border-brand-100 rounded-lg px-3 py-1.5">{cohort.semesterSem2StartDate}</span>
                    <span className="text-zinc-400">→</span>
                    <span className="bg-brand-50 text-brand-700 border border-brand-100 rounded-lg px-3 py-1.5">{cohort.semesterSem2EndDate}</span>
                  </div>
                ) : (
                  <span className="text-sm text-zinc-400">Not set</span>
                )}
              </div>
            )}
            <button onClick={() => setSemEditing(true)}
              className="text-sm text-brand-600 hover:text-brand-800 font-medium transition-colors">
              {cohort.semesterStartDate ? 'Edit' : 'Set dates'}
            </button>
          </div>
        )}
      </div>

      {/* ── Class colour ──────────────────────────────────────────────────── */}
      <div className="bg-zinc-900 rounded-2xl border border-white/10 p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Palette className="w-4 h-4 text-brand-500 flex-shrink-0" />
          <p className="text-sm font-semibold text-zinc-200">Class Colour</p>
          <p className="text-xs text-zinc-500">Used to identify this class in the teacher calendar</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {COHORT_COLORS.map(hex => (
            <button
              key={hex}
              type="button"
              onClick={async () => {
                await updateDoc(doc(db, 'cohorts', id!), { color: hex })
              }}
              className="w-8 h-8 rounded-full transition-transform hover:scale-110 flex items-center justify-center"
              style={{ backgroundColor: hex }}
              title={hex}
            >
              {cohort.color === hex && (
                <svg className="w-4 h-4 text-white drop-shadow" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          ))}
          {cohort.color && (
            <button
              type="button"
              onClick={async () => { await updateDoc(doc(db, 'cohorts', id!), { color: null }) }}
              className="w-8 h-8 rounded-full border border-white/20 text-zinc-400 hover:text-zinc-200 flex items-center justify-center text-xs transition-colors"
              title="Remove colour"
            >✕</button>
          )}
        </div>
        {cohort.color && (
          <p className="text-xs text-zinc-500">
            Current colour: <span className="font-mono">{cohort.color}</span>
          </p>
        )}
      </div>

      {/* Add existing student */}
      <div className="bg-slate-800 rounded-2xl p-6 space-y-4">
        <h2 className="text-base font-semibold text-white flex items-center gap-2">
          <UserPlus className="w-5 h-5 text-brand-400" /> Add Student
        </h2>
        <UserPicker candidates={candidates} onAdd={addStudent} />
        <div className="pt-1 border-t border-slate-700">
          <button
            type="button"
            onClick={() => setShowInvite(v => !v)}
            className="text-xs text-zinc-400 hover:text-slate-200 transition-colors flex items-center gap-1"
          >
            <Mail className="w-3.5 h-3.5" />
            {showInvite ? 'Hide invite form' : 'Invite a new student by email instead'}
          </button>
        </div>

        {showInvite && (
          <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end pt-1">
            <div>
              <label className="label text-zinc-300">Student name</label>
              <input
                {...register('name')}
                placeholder="e.g. Anna Johansson"
                className="input bg-zinc-700 border-slate-600 text-white placeholder:text-zinc-500"
              />
              {errors.name && <p className="text-xs text-rose-400 mt-1">{errors.name.message}</p>}
            </div>
            <div>
              <label className="label text-zinc-300">Email</label>
              <input
                {...register('email')}
                type="email"
                placeholder="student@school.com"
                className="input bg-zinc-700 border-slate-600 text-white placeholder:text-zinc-500"
              />
              {errors.email && <p className="text-xs text-rose-400 mt-1">{errors.email.message}</p>}
            </div>
            <button type="submit" disabled={saving} className="btn-primary py-2.5 self-end">
              {saving ? 'Creating…' : 'Generate invite'}
            </button>
          </form>
        )}
      </div>

      {/* Pending invites */}
      {pendingInvites.length > 0 && (
        <div>
          <h2 className="text-base font-semibold text-zinc-100 mb-3 flex items-center gap-2">
            <Mail className="w-4 h-4 text-amber-400" /> Pending Invites ({pendingInvites.length})
          </h2>
          <div className="space-y-2">
            {pendingInvites.map(inv => (
              <div key={inv.id} className="flex items-center gap-3 p-3 bg-zinc-900 border border-white/10 rounded-xl">
                <div className="flex-1">
                  <p className="text-sm font-medium text-zinc-100">{inv.displayName ?? inv.email}</p>
                  {inv.displayName && <p className="text-xs text-zinc-500">{inv.email}</p>}
                </div>
                <button
                  onClick={() => copyInviteLink(inv.id)}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors"
                >
                  {copiedToken === inv.id
                    ? <><Check className="w-3.5 h-3.5 text-emerald-600" /> Copied!</>
                    : <><Copy className="w-3.5 h-3.5" /> Copy link</>
                  }
                </button>
                <button
                  onClick={() => deleteInvite(inv.id)}
                  className="p-1.5 text-zinc-400 hover:text-rose-600 transition-colors"
                  title="Delete invite"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Enrolled students */}
      <div>
        <h2 className="text-base font-semibold text-zinc-100 mb-3 flex items-center gap-2">
          <GraduationCap className="w-4 h-4 text-brand-400" />
          Enrolled Students ({students.length})
        </h2>
        {students.length === 0 ? (
          <p className="text-sm text-zinc-500">No students enrolled yet. Add one above.</p>
        ) : (
          <div className="bg-zinc-900 border border-white/10 rounded-2xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left text-xs font-medium text-zinc-500 px-5 py-3">Student</th>
                  <th className="text-left text-xs font-medium text-zinc-500 px-4 py-3">Email</th>
                  <th className="text-right text-xs font-medium text-zinc-500 px-4 py-3">Status</th>
                  <th className="w-10 px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {students.map(student => (
                  <tr key={student.id} className="hover:bg-white/5 transition-colors group">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar uid={student.id} name={student.displayName} avatarUrl={student.avatarUrl} size="sm" />
                        <p className="text-sm font-medium text-zinc-100">{student.displayName}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm text-zinc-400">{student.email}</p>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {student.isActive
                        ? <span className="badge badge-green">Active</span>
                        : <span className="badge badge-slate">Inactive</span>
                      }
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => removeStudent(student)}
                        className="p-1.5 text-zinc-300 hover:text-rose-600 transition-colors opacity-0 group-hover:opacity-100"
                        title="Remove from class"
                      >
                        <UserX className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Enrolled teachers */}
      <div>
        <h2 className="text-base font-semibold text-zinc-100 mb-3 flex items-center gap-2">
          <Users className="w-4 h-4 text-brand-400" />
          Teachers ({teachers.length})
        </h2>
        <div className="bg-slate-800 rounded-2xl p-4 space-y-3 mb-3">
          <UserPicker candidates={teacherCandidates} onAdd={addTeacher} />
        </div>
        {teachers.length === 0 ? (
          <p className="text-sm text-zinc-500">No teachers assigned to this class.</p>
        ) : (
          <div className="bg-zinc-900 border border-white/10 rounded-2xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left text-xs font-medium text-zinc-500 px-5 py-3">Teacher</th>
                  <th className="text-left text-xs font-medium text-zinc-500 px-4 py-3">Email</th>
                  <th className="w-10 px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {teachers.map(teacher => (
                  <tr key={teacher.id} className="hover:bg-white/5 transition-colors group">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar uid={teacher.id} name={teacher.displayName} avatarUrl={teacher.avatarUrl} size="sm" />
                        <p className="text-sm font-medium text-zinc-100">{teacher.displayName}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm text-zinc-400">{teacher.email}</p>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => removeTeacher(teacher)}
                        className="p-1.5 text-zinc-300 hover:text-rose-600 transition-colors opacity-0 group-hover:opacity-100"
                        title="Remove from class"
                      >
                        <UserX className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
