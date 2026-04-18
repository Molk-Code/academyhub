import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { collection, addDoc, updateDoc, doc, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useCollection, where } from '@/hooks/useFirestore'
import type { UserDoc, CohortDoc } from '@/types'
import { nanoid } from 'nanoid'
import { Copy, Check, UserPlus, UserX, UserCheck, Mail } from 'lucide-react'
import Avatar from '@/components/common/Avatar'
import LoadingSpinner from '@/components/common/LoadingSpinner'

const schema = z.object({
  email:    z.string().email('Valid email required'),
  role:     z.enum(['student', 'teacher']),
  cohortId: z.string().optional(),
})
type FormData = z.infer<typeof schema>

interface Invitation {
  id: string
  email: string
  role: string
  cohortId: string | null
  used: boolean
  createdAt: any
}

export default function UserManager() {
  const [copiedToken, setCopiedToken] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const { data: users,       loading } = useCollection<UserDoc>('users')
  const { data: cohorts }              = useCollection<CohortDoc>('cohorts')
  const { data: invitations }          = useCollection<Invitation>('invitations')

  const { register, handleSubmit, watch, reset, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { role: 'student' },
  })

  const role = watch('role')

  async function onSubmit(data: FormData) {
    setSaving(true)
    const token = nanoid(24)
    await addDoc(collection(db, 'invitations'), {
      token,
      email:     data.email,
      role:      data.role,
      cohortId:  data.cohortId || null,
      used:      false,
      createdAt: serverTimestamp(),
    })
    reset()
    setSaving(false)
  }

  async function toggleActive(user: UserDoc) {
    await updateDoc(doc(db, 'users', user.uid), { isActive: !user.isActive })
  }

  function copyInviteLink(token: string) {
    const url = `${window.location.origin}/accept-invite?token=${token}`
    navigator.clipboard.writeText(url)
    setCopiedToken(token)
    setTimeout(() => setCopiedToken(null), 2000)
  }

  if (loading) return <LoadingSpinner />

  const activeInvites = invitations.filter(i => !i.used)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="page-title text-white">User Manager</h1>
        <p className="text-slate-400 text-sm mt-1">Invite new students and teachers, manage accounts.</p>
      </div>

      {/* Invite form */}
      <div className="bg-slate-800 rounded-2xl p-6 space-y-4">
        <h2 className="text-base font-semibold text-white flex items-center gap-2">
          <UserPlus className="w-5 h-5 text-brand-400" /> Create Invite Link
        </h2>
        <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
          <div>
            <label className="label text-slate-300">Email</label>
            <input {...register('email')} type="email" placeholder="student@school.com"
              className="input bg-slate-700 border-slate-600 text-white placeholder:text-slate-500" />
            {errors.email && <p className="text-xs text-rose-400 mt-1">{errors.email.message}</p>}
          </div>
          <div>
            <label className="label text-slate-300">Role</label>
            <select {...register('role')} className="input bg-slate-700 border-slate-600 text-white">
              <option value="student">Student</option>
              <option value="teacher">Teacher</option>
            </select>
          </div>
          {role === 'student' && (
            <div>
              <label className="label text-slate-300">Cohort</label>
              <select {...register('cohortId')} className="input bg-slate-700 border-slate-600 text-white">
                <option value="">Assign later…</option>
                {cohorts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}
          <button type="submit" disabled={saving} className="btn-primary py-2.5 self-end">
            {saving ? 'Creating…' : 'Generate invite'}
          </button>
        </form>
      </div>

      {/* Pending invites */}
      {activeInvites.length > 0 && (
        <div>
          <h2 className="text-base font-semibold text-white mb-3 flex items-center gap-2">
            <Mail className="w-4 h-4 text-amber-400" /> Pending Invites ({activeInvites.length})
          </h2>
          <div className="space-y-2">
            {activeInvites.map(inv => (
              <div key={inv.id} className="flex items-center gap-3 p-3 bg-slate-800 rounded-xl">
                <div className="flex-1">
                  <p className="text-sm font-medium text-white">{inv.email}</p>
                  <p className="text-xs text-slate-400">{inv.role} {inv.cohortId ? `· ${cohorts.find(c => c.id === inv.cohortId)?.name}` : ''}</p>
                </div>
                <button
                  onClick={() => copyInviteLink(inv.id)}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors"
                >
                  {copiedToken === inv.id
                    ? <><Check className="w-3.5 h-3.5 text-emerald-400" /> Copied!</>
                    : <><Copy className="w-3.5 h-3.5" /> Copy link</>
                  }
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* User list */}
      <div>
        <h2 className="text-base font-semibold text-white mb-3">All Users ({users.length})</h2>
        <div className="bg-slate-800 rounded-2xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-700">
                <th className="text-left text-xs font-medium text-slate-400 px-5 py-3">User</th>
                <th className="text-left text-xs font-medium text-slate-400 px-4 py-3">Role</th>
                <th className="text-right text-xs font-medium text-slate-400 px-4 py-3">Status</th>
                <th className="w-10 px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {users.map(user => (
                <tr key={user.uid} className="hover:bg-slate-700/30 transition-colors">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar uid={user.uid} name={user.displayName} avatarUrl={user.avatarUrl} size="sm" />
                      <div>
                        <p className="text-sm font-medium text-white">{user.displayName}</p>
                        <p className="text-xs text-slate-400">{user.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`badge ${
                      user.role === 'admin' ? 'badge-rose' : user.role === 'teacher' ? 'badge-blue' : 'badge-indigo'
                    }`}>{user.role}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {user.isActive
                      ? <span className="badge badge-green">Active</span>
                      : <span className="badge badge-slate">Inactive</span>
                    }
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toggleActive(user)}
                      className="p-1.5 text-slate-500 hover:text-white transition-colors"
                      title={user.isActive ? 'Deactivate' : 'Activate'}
                    >
                      {user.isActive ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
