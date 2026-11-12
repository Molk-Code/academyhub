import { useMemo, useState } from 'react'
import { updateDoc, deleteDoc, doc, Timestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useCollection, orderBy } from '@/hooks/useFirestore'
import { Inbox, Scale, Reply, Trash2, Circle, CheckCircle2, Ban, Lock, Building2 } from 'lucide-react'
import { formatDistanceToNow, format } from 'date-fns'
import { LEGAL } from '@/config/legal'
import LoadingSpinner from '@/components/common/LoadingSpinner'
import ErrorState from '@/components/common/ErrorState'
import EmptyState from '@/components/common/EmptyState'

type Status = 'new' | 'answered' | 'spam' | 'legal-hold'
type Category = 'school_enquiry' | 'support' | 'legal'

interface ContactRequestDoc {
  id: string
  name: string
  email: string
  organisation: string | null
  category: Category
  message: string
  status: Status
  createdAt?: Timestamp
  userAgent?: string
}

const CATEGORY_LABEL: Record<Category, string> = {
  school_enquiry: 'School enquiry',
  support:        'Support',
  legal:          'Legal',
}

const STATUS_CONFIG: Record<Status, { label: string; icon: typeof Circle; color: string; bg: string }> = {
  'new':        { label: 'New',        icon: Circle,       color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20' },
  'answered':   { label: 'Answered',   icon: CheckCircle2, color: 'text-green-400', bg: 'bg-green-500/10 border-green-500/20' },
  'spam':       { label: 'Spam',       icon: Ban,          color: 'text-zinc-500',  bg: 'bg-zinc-800 border-white/5'          },
  'legal-hold': { label: 'Legal hold', icon: Lock,         color: 'text-rose-400',  bg: 'bg-rose-500/10 border-rose-500/20'   },
}

function StatusChip({ status }: { status: Status }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.new
  const Icon = cfg.icon
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium ${cfg.bg} ${cfg.color}`}>
      <Icon className="w-3 h-3" /> {cfg.label}
    </span>
  )
}

function RequestDetail({ r, onDeleted }: { r: ContactRequestDoc; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false)
  const subject = `Re: Your message to ${LEGAL.appName} (${CATEGORY_LABEL[r.category]})`

  async function setStatus(status: Status) {
    setBusy(true)
    try { await updateDoc(doc(db, 'contact_requests', r.id), { status }) } finally { setBusy(false) }
  }

  async function handleDelete() {
    if (!confirm('Delete this contact request? This cannot be undone.')) return
    setBusy(true)
    try {
      await deleteDoc(doc(db, 'contact_requests', r.id))
      onDeleted()
    } finally { setBusy(false) }
  }

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-semibold text-zinc-100">{r.name}</h2>
          <p className="text-sm text-zinc-400">
            <a href={`mailto:${r.email}`} className="hover:text-brand-400">{r.email}</a>
            {r.organisation && <> · {r.organisation}</>}
          </p>
          <p className="text-xs text-zinc-500 mt-0.5">
            {CATEGORY_LABEL[r.category]}
            {r.createdAt && <> · {format(r.createdAt.toDate(), 'd MMM yyyy HH:mm')}</>}
          </p>
        </div>
        <StatusChip status={r.status} />
      </div>

      <p className="text-sm text-zinc-200 whitespace-pre-wrap break-words bg-zinc-950/60 rounded-xl p-4 border border-white/5">{r.message}</p>

      <div className="flex flex-wrap items-center gap-2">
        <a
          href={`mailto:${r.email}?subject=${encodeURIComponent(subject)}`}
          className="btn-primary text-sm py-1.5 px-3 inline-flex items-center gap-1.5"
        >
          <Reply className="w-3.5 h-3.5" /> Reply
        </a>
        {(Object.keys(STATUS_CONFIG) as Status[]).map(s => (
          <button
            key={s}
            disabled={busy || r.status === s}
            onClick={() => setStatus(s)}
            className={`text-xs px-2.5 py-1 rounded-lg border transition-colors disabled:cursor-default ${
              r.status === s ? STATUS_CONFIG[s].bg + ' ' + STATUS_CONFIG[s].color : 'border-white/10 text-zinc-400 hover:text-zinc-200 hover:border-white/20'
            }`}
          >
            {STATUS_CONFIG[s].label}
          </button>
        ))}
        <button
          onClick={handleDelete}
          disabled={busy}
          className="ml-auto text-xs px-2.5 py-1 rounded-lg border border-rose-500/20 text-rose-400 hover:bg-rose-500/10 inline-flex items-center gap-1"
        >
          <Trash2 className="w-3 h-3" /> Delete
        </button>
      </div>
      <p className="text-[11px] text-zinc-600">
        Deleted automatically {LEGAL.contactRetentionMonths} months after it arrived, unless on legal hold.
      </p>
    </div>
  )
}

export default function ContactRequests() {
  const { data, loading, error, retry } = useCollection<ContactRequestDoc>('contact_requests', [orderBy('createdAt', 'desc')])
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Legal requests first, then newest first (the query's order)
  const requests = useMemo(
    () => [...data].sort((a, b) => Number(b.category === 'legal') - Number(a.category === 'legal')),
    [data],
  )
  const selected = requests.find(r => r.id === selectedId) ?? null

  if (loading) return <LoadingSpinner />

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Inbox className="w-6 h-6 text-brand-400" />
        <div>
          <h1 className="text-xl font-bold text-zinc-100">Contact Requests</h1>
          <p className="text-sm text-zinc-500">Messages sent from the contact form on the login page.</p>
        </div>
      </div>

      {error ? (
        <ErrorState error={error} what="contact requests" onRetry={retry} />
      ) : requests.length === 0 ? (
        <EmptyState icon={Inbox} title="No contact requests yet" description="Messages sent from the contact form on the login page will appear here." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <ul className="space-y-2">
            {requests.map(r => {
              const isLegal = r.category === 'legal'
              return (
                <li key={r.id}>
                  <button
                    onClick={() => setSelectedId(r.id)}
                    className={`w-full text-left rounded-xl border p-3 transition-colors ${
                      selectedId === r.id ? 'border-brand-500/60 bg-brand-500/10'
                        : isLegal ? 'border-rose-500/40 bg-rose-500/5 hover:bg-rose-500/10'
                        : 'border-white/10 bg-zinc-900 hover:bg-zinc-800/80'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-xs font-semibold inline-flex items-center gap-1 ${isLegal ? 'text-rose-400' : 'text-zinc-400'}`}>
                        {isLegal && <Scale className="w-3.5 h-3.5" />} {CATEGORY_LABEL[r.category]}
                      </span>
                      <StatusChip status={r.status} />
                    </div>
                    <p className="text-sm text-zinc-100 mt-1 truncate">{r.name}</p>
                    <p className="text-xs text-zinc-500 flex items-center gap-1 mt-0.5">
                      {r.organisation && <><Building2 className="w-3 h-3" /> <span className="truncate">{r.organisation}</span> · </>}
                      {r.createdAt ? formatDistanceToNow(r.createdAt.toDate(), { addSuffix: true }) : 'just now'}
                    </p>
                  </button>
                </li>
              )
            })}
          </ul>
          <div className="lg:sticky lg:top-4 self-start">
            {selected
              ? <RequestDetail r={selected} onDeleted={() => setSelectedId(null)} />
              : <p className="text-sm text-zinc-500 card p-6 text-center">Select a request to read it.</p>}
          </div>
        </div>
      )}
    </div>
  )
}
