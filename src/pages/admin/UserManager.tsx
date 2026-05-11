import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { collection, addDoc, updateDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '@/lib/firebase'
import { useCollection, where } from '@/hooks/useFirestore'
import type { UserDoc, CohortDoc } from '@/types'
import { nanoid } from 'nanoid'
import { Copy, Check, UserPlus, UserX, UserCheck, Mail, ShieldCheck, Trash2, KeyRound, Eye, EyeOff, X } from 'lucide-react'
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
  const [copiedToken,       setCopiedToken]       = useState<string | null>(null)
  const [saving,            setSaving]            = useState(false)
  const [resetUser,         setResetUser]         = useState<UserDoc | null>(null)
  const [newPassword,       setNewPassword]       = useState('')
  const [confirmPassword,   setConfirmPassword]   = useState('')
  const [showPassword,      setShowPassword]      = useState(false)
  const [resetting,         setResetting]         = useState(false)
  const [resetError,        setResetError]        = useState('')
  const [resetSuccess,      setResetSuccess]      = useState(false)

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
    await updateDoc(doc(db, 'users', user.id), { isActive: !user.isActive })
  }

  async function deleteUser(user: UserDoc) {
    if (!confirm(`Delete ${user.displayName}? This cannot be undone.`)) return
    await deleteDoc(doc(db, 'users', user.id))
  }

  async function deleteInvite(invId: string) {
    await deleteDoc(doc(db, 'invitations', invId))
  }

  async function toggleSecondaryRole(user: UserDoc, secondaryRole: 'teacher' | 'admin') {
    const currentRoles: string[] = user.roles?.length ? user.roles : [user.role]
    const hasRole = currentRoles.includes(secondaryRole)
    const next = hasRole
      ? currentRoles.filter(r => r !== secondaryRole)
      : [...currentRoles, secondaryRole]
    // Always keep the primary role
    if (!next.includes(user.role)) next.unshift(user.role)
    await updateDoc(doc(db, 'users', user.id), { roles: next })
  }

  function copyInviteLink(token: string) {
    const url = `${window.location.origin}/accept-invite?token=${token}`
    navigator.clipboard.writeText(url)
    setCopiedToken(token)
    setTimeout(() => setCopiedToken(null), 2000)
  }

  async function handleResetPassword() {
    if (!resetUser) return
    setResetError('')
    if (newPassword.length < 6)             { setResetError('Password must be at least 6 characters.'); return }
    if (newPassword !== confirmPassword)     { setResetError('Passwords do not match.'); return }
    setResetting(true)
    try {
      await httpsCallable(functions, 'resetPassword')({ uid: resetUser.uid, newPassword })
      setResetSuccess(true)
      setTimeout(() => {
        setResetUser(null)
        setNewPassword('')
        setConfirmPassword('')
        setResetSuccess(false)
      }, 1500)
    } catch (e: any) {
      setResetError(e?.message ?? 'Failed to reset password.')
    } finally {
      setResetting(false)
    }
  }

  function openResetModal(user: UserDoc) {
    setResetUser(user)
    setNewPassword('')
    setConfirmPassword('')
    setResetError('')
    setResetSuccess(false)
    setShowPassword(false)
  }

  if (loading) return <LoadingSpinner />

  const activeInvites = invitations.filter(i => !i.used)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="page-title">User Manager</h1>
        <p className="text-zinc-500 text-sm mt-1">Invite new students and teachers, manage accounts.</p>
      </div>

      {/* Invite form */}
      <div className="bg-zinc-900 border border-white/10 rounded-2xl p-6 space-y-4 shadow-sm">
        <h2 className="text-base font-semibold text-zinc-200 flex items-center gap-2">
          <UserPlus className="w-5 h-5 text-brand-500" /> Create Invite Link
        </h2>
        <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
          <div>
            <label className="label">Email</label>
            <input {...register('email')} type="email" placeholder="student@school.com" className="input" />
            {errors.email && <p className="text-xs text-rose-500 mt-1">{errors.email.message}</p>}
          </div>
          <div>
            <label className="label">Role</label>
            <select {...register('role')} className="input">
              <option value="student">Student</option>
              <option value="teacher">Teacher</option>
            </select>
          </div>
          {role === 'student' && (
            <div>
              <label className="label">Class</label>
              <select {...register('cohortId')} className="input">
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
          <h2 className="text-base font-semibold text-zinc-100 mb-3 flex items-center gap-2">
            <Mail className="w-4 h-4 text-amber-500" /> Pending Invites ({activeInvites.length})
          </h2>
          <div className="space-y-2">
            {activeInvites.map(inv => (
              <div key={inv.id} className="flex items-center gap-3 p-3 bg-zinc-900 border border-white/10 rounded-xl">
                <div className="flex-1">
                  <p className="text-sm font-medium text-zinc-100">{inv.email}</p>
                  <p className="text-xs text-zinc-500">{inv.role} {inv.cohortId ? `· ${cohorts.find(c => c.id === inv.cohortId)?.name}` : ''}</p>
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

      {/* User list */}
      <div>
        <h2 className="text-base font-semibold text-zinc-100 mb-3">All Users ({users.length})</h2>
        <div className="space-y-2">
          {users.map(user => (
            <div key={user.id} className="bg-zinc-900 border border-white/10 rounded-xl px-4 py-3 flex items-center gap-3">
              <Avatar uid={user.id} name={user.displayName} avatarUrl={user.avatarUrl} size="sm" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium text-zinc-100 truncate">{user.displayName}</p>
                  {user.isActive
                    ? <span className="badge badge-green text-[10px] py-0">Active</span>
                    : <span className="badge badge-slate text-[10px] py-0">Inactive</span>
                  }
                </div>
                <p className="text-xs text-zinc-500 truncate">{user.email}</p>
                <div className="flex items-center gap-1.5 flex-wrap mt-1">
                  {(user.roles?.length ? user.roles : [user.role]).map(r => (
                    <span key={r} className={`badge text-[10px] py-0 ${
                      r === 'admin' ? 'badge-rose' : r === 'teacher' ? 'badge-blue' : 'badge-indigo'
                    }`}>{r}</span>
                  ))}
                  {user.role !== 'student' && (
                    <button
                      onClick={() => toggleSecondaryRole(user, user.role === 'admin' ? 'teacher' : 'admin')}
                      title={(user.roles ?? [user.role]).includes(user.role === 'admin' ? 'teacher' : 'admin')
                        ? `Remove ${user.role === 'admin' ? 'teacher' : 'admin'} role`
                        : `Also ${user.role === 'admin' ? 'teacher' : 'admin'}`}
                      className="p-0.5 text-zinc-400 hover:text-brand-600 transition-colors"
                    >
                      <ShieldCheck className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-0.5 flex-shrink-0">
                <button
                  onClick={() => openResetModal(user)}
                  className="p-2 text-zinc-400 hover:text-brand-600 transition-colors rounded-lg hover:bg-white/5"
                  title="Reset password"
                >
                  <KeyRound className="w-4 h-4" />
                </button>
                <button
                  onClick={() => toggleActive(user)}
                  className="p-2 text-zinc-400 hover:text-zinc-300 transition-colors rounded-lg hover:bg-white/5"
                  title={user.isActive ? 'Deactivate' : 'Activate'}
                >
                  {user.isActive ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                </button>
                <button
                  onClick={() => deleteUser(user)}
                  className="p-2 text-zinc-400 hover:text-rose-600 transition-colors rounded-lg hover:bg-white/5"
                  title="Delete user"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Reset password modal */}
      {resetUser && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-zinc-100">Reset password</h2>
                <p className="text-sm text-zinc-500 mt-0.5">{resetUser.displayName}</p>
              </div>
              <button
                onClick={() => setResetUser(null)}
                className="p-1.5 text-zinc-400 hover:text-zinc-300 rounded-lg hover:bg-zinc-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="label">New password</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    className="input pr-10"
                    placeholder="Min. 6 characters"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-400"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="label">Confirm password</label>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  className="input"
                  placeholder="Repeat password"
                  onKeyDown={e => e.key === 'Enter' && handleResetPassword()}
                />
              </div>
            </div>

            {resetError && (
              <p className="text-sm text-rose-600 bg-rose-950/40 rounded-lg px-3 py-2">{resetError}</p>
            )}
            {resetSuccess && (
              <p className="text-sm text-emerald-600 bg-emerald-950/40 rounded-lg px-3 py-2 flex items-center gap-2">
                <Check className="w-4 h-4" /> Password updated successfully.
              </p>
            )}

            <div className="flex gap-2 pt-1">
              <button
                onClick={handleResetPassword}
                disabled={resetting || resetSuccess || !newPassword || !confirmPassword}
                className="btn-primary py-2 px-5 flex items-center gap-2 disabled:opacity-50"
              >
                <KeyRound className="w-4 h-4" />
                {resetting ? 'Saving…' : 'Set password'}
              </button>
              <button onClick={() => setResetUser(null)} className="btn-secondary py-2 px-4">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
