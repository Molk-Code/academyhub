import { useState, useEffect, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { collection, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, Timestamp } from 'firebase/firestore'
import { sendPasswordResetEmail, sendSignInLinkToEmail } from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '@/lib/firebase'
import { useCollection, where } from '@/hooks/useFirestore'
import type { UserDoc, CohortDoc } from '@/types'
import { Copy, Check, UserPlus, UserX, UserCheck, Mail, ShieldCheck, Trash2, KeyRound, X, Users, ClipboardCopy, ChevronDown, ChevronUp, RotateCcw, Link } from 'lucide-react'
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
  const [resetEmailSent,    setResetEmailSent]    = useState<string | null>(null)
  const [copiedResetLink,   setCopiedResetLink]   = useState<string | null>(null)
  const [toastMsg,          setToastMsg]          = useState<string | null>(null)
  const [lastInviteUrl,     setLastInviteUrl]     = useState<string | null>(null)
  const [copiedLastInvite,  setCopiedLastInvite]  = useState(false)
  const [bulkOpen,          setBulkOpen]          = useState(false)
  const [bulkEmails,        setBulkEmails]        = useState('')
  const [bulkRole,          setBulkRole]          = useState<'student' | 'teacher'>('student')
  const [bulkCohortId,      setBulkCohortId]      = useState('')
  const [bulkSaving,        setBulkSaving]        = useState(false)
  const [bulkResults,       setBulkResults]       = useState<{ email: string; inviteId: string }[]>([])
  const [copiedBulkAll,     setCopiedBulkAll]     = useState(false)
  const [selectedIds,       setSelectedIds]       = useState<Set<string>>(new Set())
  const [assignCohort,      setAssignCohort]      = useState('')
  const [assigning,         setAssigning]         = useState(false)
  const [assignedMsg,       setAssignedMsg]       = useState('')

  const { data: users,       loading } = useCollection<UserDoc>('users')
  const { data: cohorts }              = useCollection<CohortDoc>('cohorts')
  const { data: invitations }          = useCollection<Invitation>('invitations')

  // Self-heal: strip 'student' from any teacher/admin's roles array on first load
  const healedRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!users.length) return
    const isStaff = (r: string) => r === 'teacher' || r === 'admin'
    users.forEach(u => {
      if (!isStaff(u.role) || healedRef.current.has(u.id)) return
      const hasBadRole = (u.roles ?? []).some(r => !isStaff(r))
      if (!hasBadRole) return
      healedRef.current.add(u.id)
      const cleanRoles = (u.roles ?? [u.role]).filter(isStaff)
      if (!cleanRoles.includes(u.role)) cleanRoles.unshift(u.role)
      httpsCallable(functions, 'setUserRole')({ uid: u.id, role: u.role, roles: cleanRoles }).catch(() => {})
    })
  }, [users])


  const { register, handleSubmit, watch, reset, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { role: 'student' },
  })

  const role = watch('role')

  function showToast(msg: string) {
    setToastMsg(msg)
    setTimeout(() => setToastMsg(null), 3000)
  }

  async function onSubmit(data: FormData) {
    setSaving(true)
    try {
      const normalizedEmail = data.email.trim().toLowerCase()
      const ref = await addDoc(collection(db, 'invitations'), {
        email:     normalizedEmail,
        role:      data.role,
        cohortId:  data.cohortId || null,
        used:      false,
        createdAt: serverTimestamp(),
        expiresAt: Timestamp.fromDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)),
      })
      const url = `${window.location.origin}/accept-invite?token=${ref.id}`
      setLastInviteUrl(url)

      let emailSent = false
      try {
        await sendSignInLinkToEmail(auth, normalizedEmail, {
          url,
          handleCodeInApp: true,
        })
        emailSent = true
      } catch {
        // Email sending failed (e.g. domain not authorized) — link still works
      }

      try { await navigator.clipboard.writeText(url) } catch { /* ignore */ }
      showToast(emailSent ? 'Invite email sent & link copied!' : 'Invite link copied!')
      reset()
    } catch (err: any) {
      alert(`Failed to create invite: ${err?.message ?? 'Unknown error'}`)
    } finally {
      setSaving(false)
    }
  }

  async function onBulkSubmit() {
    const emails = bulkEmails
      .split('\n')
      .map(e => e.trim().toLowerCase())
      .filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
    if (emails.length === 0) return
    setBulkSaving(true)
    setBulkResults([])
    try {
      const results: { email: string; inviteId: string }[] = []
      for (const email of emails) {
        const ref = await addDoc(collection(db, 'invitations'), {
          email,
          role:      bulkRole,
          cohortId:  bulkCohortId || null,
          used:      false,
          createdAt: serverTimestamp(),
          expiresAt: Timestamp.fromDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)),
        })
        results.push({ email, inviteId: ref.id })
      }
      setBulkResults(results)
      setBulkEmails('')
    } finally {
      setBulkSaving(false)
    }
  }

  function copyAllBulkLinks() {
    const text = bulkResults
      .map(r => `${r.email}: ${window.location.origin}/accept-invite?token=${r.inviteId}`)
      .join('\n')
    navigator.clipboard.writeText(text)
    setCopiedBulkAll(true)
    setTimeout(() => setCopiedBulkAll(false), 2000)
  }

  async function toggleActive(user: UserDoc) {
    await updateDoc(doc(db, 'users', user.id), { isActive: !user.isActive })
  }

  async function disableUser(user: UserDoc) {
    if (!confirm(`Disable ${user.displayName}? They won't be able to log in until restored.`)) return
    try {
      await httpsCallable(functions, 'disableUser')({ uid: user.uid })
    } catch {
      await updateDoc(doc(db, 'users', user.id), { disabled: true, isActive: false })
    }
  }

  async function permanentlyDeleteUser(user: UserDoc) {
    const confirmed = confirm(
      `Permanently delete ${user.displayName}?\n\nThis will remove their account, assignments, attendance records, messages, bookings, and all other personal data. This cannot be undone.`
    )
    if (!confirmed) return
    try {
      await httpsCallable(functions, 'deleteUserData')({ userId: user.uid })
      setToastMsg(`${user.displayName} deleted.`)
    } catch (err: any) {
      alert(`Delete failed: ${err?.message ?? 'Unknown error'}`)
    }
  }

  async function restoreUser(user: UserDoc) {
    try {
      await httpsCallable(functions, 'restoreUser')({ uid: user.uid })
    } catch {
      await updateDoc(doc(db, 'users', user.id), { disabled: false, isActive: true })
    }
  }

  async function deleteInvite(invId: string) {
    await deleteDoc(doc(db, 'invitations', invId))
  }

  async function toggleSecondaryRole(user: UserDoc, secondaryRole: 'teacher' | 'admin') {
    // Only teacher↔admin combinations are valid; students can't have secondary roles
    if (user.role === 'student') return
    const isStaff = (r: string) => r === 'teacher' || r === 'admin'
    const currentRoles: string[] = (user.roles?.length ? user.roles : [user.role]).filter(isStaff)
    const hasRole = currentRoles.includes(secondaryRole)
    const next = hasRole
      ? currentRoles.filter(r => r !== secondaryRole)
      : [...currentRoles, secondaryRole]
    if (!next.includes(user.role)) next.unshift(user.role)
    try {
      await httpsCallable(functions, 'setUserRole')({ uid: user.id, role: user.role, roles: next })
    } catch (err: any) {
      alert(`Failed to update role: ${err?.message ?? err}`)
    }
  }

  async function switchPrimaryRole(user: UserDoc, newRole: 'student' | 'teacher' | 'admin') {
    if (!confirm(`Switch ${user.displayName}'s primary role to ${newRole}? They will need to sign out and back in for the change to take full effect.`)) return
    const isStaff = (r: string) => r === 'teacher' || r === 'admin'
    let next: string[]
    if (newRole === 'student') {
      next = ['student']
    } else {
      // Keep only staff roles, ensuring new primary is first
      const staffRoles = (user.roles?.length ? user.roles : [user.role]).filter(isStaff)
      next = staffRoles.includes(newRole) ? staffRoles : [newRole, ...staffRoles.filter(r => r !== newRole)]
    }
    try {
      await httpsCallable(functions, 'setUserRole')({ uid: user.id, role: newRole, roles: next })
    } catch (err: any) {
      alert(`Failed to update role: ${err?.message ?? err}`)
    }
  }

  function copyInviteLink(token: string) {
    const url = `${window.location.origin}/accept-invite?token=${token}`
    navigator.clipboard.writeText(url)
    setCopiedToken(token)
    setTimeout(() => setCopiedToken(null), 2000)
  }

  async function sendResetEmail(user: UserDoc) {
    try {
      await sendPasswordResetEmail(auth, user.email, {
        url: `${window.location.origin}/login`,
      })
      setResetEmailSent(user.id)
      setTimeout(() => setResetEmailSent(null), 3000)
    } catch (err: any) {
      alert(`Failed to send reset email: ${err?.code ?? err?.message ?? 'unknown error'}`)
    }
  }

  async function copyResetLink(user: UserDoc) {
    try {
      const result = await httpsCallable<{ email: string }, { link: string }>(
        functions, 'generatePasswordResetLink'
      )({ email: user.email })
      await navigator.clipboard.writeText(result.data.link)
      setCopiedResetLink(user.id)
      setTimeout(() => setCopiedResetLink(null), 3000)
    } catch (err: any) {
      alert(`Failed to generate reset link: ${err?.message ?? 'unknown error'}`)
    }
  }

  const toggleSelect = (uid: string) =>
    setSelectedIds(prev => { const n = new Set(prev); n.has(uid) ? n.delete(uid) : n.add(uid); return n })
  const selectAll = () => setSelectedIds(new Set(users.map(u => u.id)))
  const clearAll  = () => setSelectedIds(new Set())

  async function handleBulkAssignCohort() {
    if (!assignCohort || selectedIds.size === 0) return
    setAssigning(true)
    await Promise.all([...selectedIds].map(uid =>
      updateDoc(doc(db, 'users', uid), { cohortId: assignCohort }),
    ))
    const cohortName = cohorts.find(c => c.id === assignCohort)?.name ?? 'class'
    setAssignedMsg(`${selectedIds.size} user${selectedIds.size !== 1 ? 's' : ''} assigned to ${cohortName}`)
    setTimeout(() => setAssignedMsg(''), 3000)
    clearAll()
    setAssignCohort('')
    setAssigning(false)
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

        {lastInviteUrl && (
          <div className="mt-4 bg-white/5 rounded-xl p-3 flex items-center gap-3">
            <code className="text-xs text-orange-400 flex-1 min-w-0 truncate">{lastInviteUrl}</code>
            <button
              onClick={() => {
                navigator.clipboard.writeText(lastInviteUrl)
                setCopiedLastInvite(true)
                setTimeout(() => setCopiedLastInvite(false), 2000)
                showToast('Copied!')
              }}
              className="text-xs bg-orange-500 text-white px-3 py-1.5 rounded-lg font-semibold flex-shrink-0 hover:bg-orange-600 transition-colors"
            >
              {copiedLastInvite ? '✓ Copied!' : 'Copy'}
            </button>
          </div>
        )}
      </div>

      {/* Bulk invite */}
      <div className="bg-zinc-900 border border-white/10 rounded-2xl shadow-sm overflow-hidden">
        <button
          onClick={() => { setBulkOpen(v => !v); setBulkResults([]) }}
          className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-white/5 transition-colors"
        >
          <h2 className="text-base font-semibold text-zinc-200 flex items-center gap-2">
            <Users className="w-5 h-5 text-brand-500" /> Bulk Invite
            <span className="text-xs font-normal text-zinc-500">— paste multiple emails at once</span>
          </h2>
          {bulkOpen ? <ChevronUp className="w-4 h-4 text-zinc-400" /> : <ChevronDown className="w-4 h-4 text-zinc-400" />}
        </button>

        {bulkOpen && (
          <div className="px-6 pb-6 space-y-4 border-t border-white/10 pt-5">
            <div>
              <label className="label">Emails — one per line</label>
              <textarea
                value={bulkEmails}
                onChange={e => setBulkEmails(e.target.value)}
                rows={6}
                className="input w-full font-mono text-sm resize-y"
                placeholder={"student1@school.com\nstudent2@school.com\nstudent3@school.com"}
              />
              <p className="text-xs text-zinc-500 mt-1">
                {bulkEmails.split('\n').map(e => e.trim()).filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)).length} valid email(s) detected
              </p>
            </div>

            <div className="flex flex-wrap gap-4">
              <div className="flex-1 min-w-[140px]">
                <label className="label">Role</label>
                <select value={bulkRole} onChange={e => setBulkRole(e.target.value as any)} className="input w-full">
                  <option value="student">Student</option>
                  <option value="teacher">Teacher</option>
                </select>
              </div>
              {bulkRole === 'student' && (
                <div className="flex-1 min-w-[140px]">
                  <label className="label">Class</label>
                  <select value={bulkCohortId} onChange={e => setBulkCohortId(e.target.value)} className="input w-full">
                    <option value="">Assign later…</option>
                    {cohorts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              )}
            </div>

            <button
              onClick={onBulkSubmit}
              disabled={bulkSaving || !bulkEmails.trim()}
              className="btn-primary py-2 px-5"
            >
              {bulkSaving ? 'Generating…' : 'Generate invite links'}
            </button>

            {/* Results */}
            {bulkResults.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-zinc-200">{bulkResults.length} invite link{bulkResults.length !== 1 ? 's' : ''} generated</p>
                  <button
                    onClick={copyAllBulkLinks}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors"
                  >
                    {copiedBulkAll
                      ? <><Check className="w-3.5 h-3.5 text-emerald-500" /> Copied all!</>
                      : <><ClipboardCopy className="w-3.5 h-3.5" /> Copy all</>
                    }
                  </button>
                </div>
                <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                  {bulkResults.map(r => (
                    <div key={r.inviteId} className="flex items-center gap-2 bg-zinc-800/60 rounded-xl px-3 py-2">
                      <p className="text-sm text-zinc-300 flex-1 min-w-0 truncate">{r.email}</p>
                      <button
                        onClick={() => copyInviteLink(r.inviteId)}
                        className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg bg-zinc-700 text-zinc-300 hover:bg-zinc-600 transition-colors flex-shrink-0"
                      >
                        {copiedToken === r.inviteId
                          ? <><Check className="w-3 h-3 text-emerald-500" /> Copied</>
                          : <><Copy className="w-3 h-3" /> Copy</>
                        }
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
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
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-zinc-100">All Users ({users.length})</h2>
          <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={selectedIds.size === users.length && users.length > 0}
              onChange={e => e.target.checked ? selectAll() : clearAll()}
              className="w-4 h-4 rounded accent-orange-500"
            />
            Select all
          </label>
        </div>

        {/* Bulk action bar */}
        {selectedIds.size > 0 && (
          <div className="sticky top-2 z-20 bg-zinc-900 border border-orange-500/30 rounded-2xl p-4 mb-4 flex items-center gap-4 flex-wrap shadow-lg">
            <span className="text-sm font-semibold text-orange-400">{selectedIds.size} selected</span>
            <div className="flex items-center gap-2 flex-1 min-w-[220px]">
              <select
                value={assignCohort}
                onChange={e => setAssignCohort(e.target.value)}
                className="flex-1 bg-white/10 border border-white/10 rounded-xl px-3 py-2 text-sm text-white outline-none"
              >
                <option value="">Assign to class…</option>
                {cohorts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button
                onClick={handleBulkAssignCohort}
                disabled={!assignCohort || assigning}
                className="bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors whitespace-nowrap"
              >
                {assigning ? 'Assigning…' : 'Assign'}
              </button>
            </div>
            {assignedMsg && <span className="text-xs text-emerald-400 font-medium">{assignedMsg}</span>}
            <button onClick={clearAll} className="text-xs text-zinc-400 hover:text-white transition-colors">
              Clear
            </button>
          </div>
        )}

        <div className="space-y-2">
          {users.map(user => (
            <div key={user.id} className={`bg-zinc-900 border rounded-xl px-4 py-3 flex items-center gap-3 ${selectedIds.has(user.id) ? 'border-orange-500/40 bg-orange-500/5' : user.disabled ? 'border-rose-900/50 opacity-60' : 'border-white/10'}`}>
              <input
                type="checkbox"
                checked={selectedIds.has(user.id)}
                onChange={() => toggleSelect(user.id)}
                className="w-4 h-4 rounded accent-orange-500 flex-shrink-0 cursor-pointer"
              />
              <Avatar uid={user.id} name={user.displayName} avatarUrl={user.avatarUrl} size="sm" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium text-zinc-100 truncate">{user.displayName}</p>
                  {user.disabled
                    ? <span className="badge badge-rose text-[10px] py-0">Disabled</span>
                    : user.isActive
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
                  <button
                    onClick={() => switchPrimaryRole(user, user.role === 'student' ? 'teacher' : 'student')}
                    title={`Switch to ${user.role === 'student' ? 'teacher' : 'student'}`}
                    className="text-[10px] px-1.5 py-0.5 rounded border border-white/10 text-zinc-500 hover:text-zinc-300 hover:border-white/20 transition-colors"
                  >
                    → {user.role === 'student' ? 'teacher' : 'student'}
                  </button>
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
                {user.disabled ? (
                  <>
                    <button
                      onClick={() => restoreUser(user)}
                      className="p-2 text-zinc-400 hover:text-emerald-500 transition-colors rounded-lg hover:bg-white/5"
                      title="Restore account"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => permanentlyDeleteUser(user)}
                      className="p-2 text-zinc-400 hover:text-rose-600 transition-colors rounded-lg hover:bg-white/5"
                      title="Permanently delete account and all data"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => sendResetEmail(user)}
                      className="p-2 transition-colors rounded-lg hover:bg-white/5"
                      title="Send password reset email"
                    >
                      {resetEmailSent === user.id
                        ? <Check className="w-4 h-4 text-emerald-500" />
                        : <KeyRound className="w-4 h-4 text-zinc-400 hover:text-brand-400" />
                      }
                    </button>
                    <button
                      onClick={() => copyResetLink(user)}
                      className="p-2 transition-colors rounded-lg hover:bg-white/5"
                      title="Copy reset link (send manually)"
                    >
                      {copiedResetLink === user.id
                        ? <Check className="w-4 h-4 text-emerald-500" />
                        : <Link className="w-4 h-4 text-zinc-400 hover:text-brand-400" />
                      }
                    </button>
                    <button
                      onClick={() => disableUser(user)}
                      className="p-2 text-zinc-400 hover:text-amber-500 transition-colors rounded-lg hover:bg-white/5"
                      title="Deactivate account (reversible)"
                    >
                      <UserX className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => permanentlyDeleteUser(user)}
                      className="p-2 text-zinc-400 hover:text-rose-600 transition-colors rounded-lg hover:bg-white/5"
                      title="Permanently delete account and all data"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Toast */}
      {toastMsg && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-zinc-800 border border-white/10 rounded-2xl px-5 py-3 shadow-2xl flex items-center gap-2 text-sm font-semibold text-emerald-400 pointer-events-none">
          <Check className="w-4 h-4 flex-shrink-0" />
          {toastMsg}
        </div>
      )}
    </div>
  )
}
