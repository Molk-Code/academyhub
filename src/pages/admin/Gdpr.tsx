import { useState } from 'react'
import { collection, query, orderBy, getDocs, doc, updateDoc, addDoc, serverTimestamp } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '@/lib/firebase'
import { useCollection } from '@/hooks/useFirestore'
import { useAuth } from '@/contexts/AuthContext'
import type { UserDoc } from '@/types'
import { Shield, Trash2, Download, AlertTriangle } from 'lucide-react'
import { format } from 'date-fns'
import { toDate } from '@/lib/utils'

interface DeletionLogDoc {
  id: string
  userId: string
  userEmail: string
  userName: string
  requestedBy: string
  requestedByName: string
  requestedAt: any
  reason: string
}

function ConfirmDeleteDialog({
  user,
  onConfirm,
  onCancel,
  loading,
}: {
  user: UserDoc
  onConfirm: (reason: string) => void
  onCancel: () => void
  loading: boolean
}) {
  const [reason, setReason] = useState('')
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-zinc-900 border border-white/10 rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl">
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-6 h-6 text-rose-400 flex-shrink-0" />
          <h3 className="text-lg font-bold text-white">Delete account</h3>
        </div>
        <p className="text-sm text-zinc-300">
          This will permanently delete <strong>{user.displayName}</strong>'s account and all associated data.
          Attendance records will be anonymised. <strong>This cannot be undone.</strong>
        </p>
        <div>
          <label className="label">Reason for deletion <span className="text-zinc-500">(required)</span></label>
          <input
            value={reason}
            onChange={e => setReason(e.target.value)}
            className="input text-sm"
            placeholder="e.g. Student request per GDPR Art. 17"
          />
        </div>
        <div className="flex gap-3 pt-1">
          <button onClick={onCancel} className="btn-secondary flex-1 py-2 text-sm" disabled={loading}>Cancel</button>
          <button
            onClick={() => onConfirm(reason)}
            disabled={!reason.trim() || loading}
            className="flex-1 py-2 text-sm font-semibold bg-rose-600 hover:bg-rose-500 text-white rounded-xl disabled:opacity-40 transition-colors"
          >
            {loading ? 'Deleting…' : 'Delete permanently'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function GdprDashboard() {
  const { profile } = useAuth()
  const { data: users, loading: usersLoading } = useCollection<UserDoc>('users')
  const { data: deletionLog, loading: logLoading } = useCollection<DeletionLogDoc>(
    'deletion_log',
    [orderBy('requestedAt', 'desc')],
  )

  const [confirmUser, setConfirmUser] = useState<UserDoc | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [exportingId, setExportingId] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const filtered = users
    .filter(u => u.role === 'student')
    .filter(u =>
      !search ||
      u.displayName?.toLowerCase().includes(search.toLowerCase()) ||
      u.email?.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) => (a.displayName ?? '').localeCompare(b.displayName ?? ''))

  async function handleDelete(user: UserDoc, reason: string) {
    if (!profile) return
    setDeletingId(user.id)
    try {
      const deleteUserData = httpsCallable(functions, 'deleteUserData')
      await deleteUserData({ userId: user.id })
      await addDoc(collection(db, 'deletion_log'), {
        userId: user.id,
        userEmail: user.email,
        userName: user.displayName,
        requestedBy: profile.uid,
        requestedByName: profile.displayName,
        requestedAt: serverTimestamp(),
        reason,
      })
      setConfirmUser(null)
    } catch (err: any) {
      alert('Deletion failed: ' + (err?.message ?? 'Unknown error'))
    } finally {
      setDeletingId(null)
    }
  }

  async function handleExport(user: UserDoc) {
    setExportingId(user.id)
    try {
      const exportUserData = httpsCallable(functions, 'exportUserData')
      const result = await exportUserData({ userId: user.id })
      const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `cineforge-data-${user.displayName?.replace(/\s+/g, '-')}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err: any) {
      alert('Export failed: ' + (err?.message ?? 'Unknown error'))
    } finally {
      setExportingId(null)
    }
  }

  return (
    <div className="space-y-8 max-w-4xl">
      {confirmUser && (
        <ConfirmDeleteDialog
          user={confirmUser}
          loading={deletingId === confirmUser.id}
          onConfirm={(reason) => handleDelete(confirmUser, reason)}
          onCancel={() => setConfirmUser(null)}
        />
      )}

      <div>
        <h1 className="page-title flex items-center gap-2">
          <Shield className="w-6 h-6 text-brand-400" /> GDPR Dashboard
        </h1>
        <p className="text-zinc-400 text-sm mt-1">
          Manage student data access requests, exports, and deletions. All deletions are logged.
        </p>
      </div>

      {/* ── Student list ── */}
      <section className="card space-y-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h2 className="text-base font-semibold text-zinc-200">Student accounts</h2>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or email…"
            className="input text-sm w-64"
          />
        </div>
        {usersLoading ? (
          <p className="text-zinc-500 text-sm">Loading…</p>
        ) : (
          <div className="space-y-2">
            {filtered.map(user => {
              const accepted = (user as any).privacyAcceptedAt
              const acceptedDate = accepted ? toDate(accepted) : null
              const createdDate  = toDate((user as any).enrolledAt ?? (user as any).createdAt)
              return (
                <div key={user.id} className="flex items-center gap-4 py-2.5 border-b border-white/5 last:border-0">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-zinc-200 truncate">{user.displayName}</p>
                    <p className="text-xs text-zinc-500 truncate">{user.email}</p>
                    <div className="flex items-center gap-3 mt-0.5">
                      {createdDate && (
                        <span className="text-xs text-zinc-600">Enrolled {format(createdDate, 'd MMM yyyy')}</span>
                      )}
                      {acceptedDate ? (
                        <span className="text-xs text-emerald-600">Privacy accepted {format(acceptedDate, 'd MMM yyyy')}</span>
                      ) : (
                        <span className="text-xs text-amber-600">No privacy consent on record</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => handleExport(user)}
                      disabled={exportingId === user.id}
                      className="flex items-center gap-1.5 btn-secondary py-1.5 px-3 text-xs disabled:opacity-40"
                      title="Export data"
                    >
                      <Download className="w-3.5 h-3.5" />
                      {exportingId === user.id ? 'Exporting…' : 'Export'}
                    </button>
                    <button
                      onClick={() => setConfirmUser(user)}
                      disabled={!!deletingId}
                      className="flex items-center gap-1.5 py-1.5 px-3 text-xs font-medium rounded-xl bg-rose-900/30 border border-rose-800/40 text-rose-400 hover:bg-rose-900/50 transition-colors disabled:opacity-40"
                      title="Delete account"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Delete
                    </button>
                  </div>
                </div>
              )
            })}
            {filtered.length === 0 && (
              <p className="text-zinc-500 text-sm">No students found.</p>
            )}
          </div>
        )}
      </section>

      {/* ── Deletion log ── */}
      <section className="card space-y-4">
        <h2 className="text-base font-semibold text-zinc-200">Deletion log</h2>
        <p className="text-xs text-zinc-500">All account deletions are permanently recorded here for compliance purposes.</p>
        {logLoading ? (
          <p className="text-zinc-500 text-sm">Loading…</p>
        ) : deletionLog.length === 0 ? (
          <p className="text-zinc-500 text-sm">No deletions recorded yet.</p>
        ) : (
          <div className="space-y-2">
            {deletionLog.map(entry => {
              const date = toDate(entry.requestedAt)
              return (
                <div key={entry.id} className="py-2.5 border-b border-white/5 last:border-0 text-sm">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-zinc-200">{entry.userName} <span className="text-zinc-500 font-normal">({entry.userEmail})</span></p>
                      <p className="text-xs text-zinc-400 mt-0.5">Reason: {entry.reason}</p>
                      <p className="text-xs text-zinc-500">Requested by {entry.requestedByName}</p>
                    </div>
                    {date && (
                      <span className="text-xs text-zinc-500 flex-shrink-0">{format(date, 'd MMM yyyy HH:mm')}</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
