import { Bug, Circle, Clock, CheckCircle2, XCircle } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import type { Timestamp } from 'firebase/firestore'
import { useAuth } from '@/contexts/AuthContext'
import { useCollection, where, orderBy } from '@/hooks/useFirestore'

interface BugReportDoc {
  id: string
  page: string
  description: string
  status: 'open' | 'in_progress' | 'resolved' | 'wont_fix'
  createdAt: Timestamp
}

const STATUS_CONFIG = {
  open:        { label: 'Open',        icon: Circle,        color: 'text-amber-400',  bg: 'bg-amber-500/10 border-amber-500/20' },
  in_progress: { label: 'In Progress', icon: Clock,         color: 'text-blue-400',   bg: 'bg-blue-500/10 border-blue-500/20'   },
  resolved:    { label: 'Resolved',    icon: CheckCircle2,  color: 'text-green-400',  bg: 'bg-green-500/10 border-green-500/20' },
  wont_fix:    { label: "Won't Fix",   icon: XCircle,       color: 'text-zinc-500',   bg: 'bg-zinc-800 border-white/5'          },
} as const

function StatusBadge({ status }: { status: BugReportDoc['status'] }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.open
  const Icon = cfg.icon
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.color}`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  )
}

export default function MyBugReports() {
  const { profile } = useAuth()
  const { data: reports, loading } = useCollection<BugReportDoc>(
    'bug_reports',
    profile ? [where('uid', '==', profile.uid), orderBy('createdAt', 'desc')] : [],
    !!profile,
  )

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="page-title flex items-center gap-2">
          <Bug className="w-6 h-6 text-amber-400" /> My Bug Reports
        </h1>
        <p className="text-zinc-500 text-sm mt-1">
          Bugs you've reported, and their current status. You'll get a notification when something changes.
        </p>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-20 bg-zinc-900 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : reports.length === 0 ? (
        <div className="text-center py-16 text-zinc-600">
          <Bug className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>You haven't reported any bugs yet.</p>
          <p className="text-xs mt-1">Use the bug icon in the top bar to report one.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {reports.map(r => {
            const timeAgo = r.createdAt?.toDate
              ? formatDistanceToNow(r.createdAt.toDate(), { addSuffix: true })
              : ''
            return (
              <div key={r.id} className="bg-zinc-900 border border-white/8 rounded-2xl px-5 py-4">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <StatusBadge status={r.status} />
                  <span className="text-xs text-zinc-500">{r.page}</span>
                  <span className="text-xs text-zinc-600">·</span>
                  <span className="text-xs text-zinc-600">{timeAgo}</span>
                </div>
                <p className="text-sm text-zinc-200 leading-relaxed whitespace-pre-wrap">{r.description}</p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
