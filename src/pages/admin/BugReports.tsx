import { useState } from 'react'
import { updateDoc, doc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useCollection, orderBy } from '@/hooks/useFirestore'
import { Bug, Copy, Check, ChevronDown, Circle, CheckCircle2, XCircle, Clock } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import type { Timestamp } from 'firebase/firestore'

interface BugReportDoc {
  id: string
  uid: string
  displayName: string
  role: string
  page: string
  elementPath: string
  elementText: string
  elementTag: string
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

function buildClaudePrompt(r: BugReportDoc): string {
  return `## Bug Report

**Reported by:** ${r.displayName} (${r.role})
**Page:** ${r.page}
**Date:** ${r.createdAt?.toDate?.().toISOString?.() ?? 'unknown'}

**Element:** \`${r.elementPath}\`
${r.elementText ? `**Element text:** "${r.elementText}"` : ''}

**Description:**
${r.description}

---
Please investigate this bug and fix it.`
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button
      onClick={copy}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-300 transition-colors"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
      {copied ? 'Copied!' : 'Copy for Claude Code'}
    </button>
  )
}

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

function ReportCard({ report }: { report: BugReportDoc }) {
  const [expanded, setExpanded] = useState(false)
  const [updating, setUpdating] = useState(false)

  async function setStatus(status: BugReportDoc['status']) {
    setUpdating(true)
    try {
      await updateDoc(doc(db, 'bug_reports', report.id), { status })
    } finally {
      setUpdating(false)
    }
  }

  const timeAgo = report.createdAt?.toDate
    ? formatDistanceToNow(report.createdAt.toDate(), { addSuffix: true })
    : ''

  return (
    <div className="bg-zinc-900 border border-white/8 rounded-2xl overflow-hidden">
      {/* Header row */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-start gap-3 px-5 py-4 text-left hover:bg-white/3 transition-colors"
      >
        <Bug className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <StatusBadge status={report.status} />
            <span className="text-xs text-zinc-500">{report.page}</span>
            <span className="text-xs text-zinc-600">·</span>
            <span className="text-xs text-zinc-600">{timeAgo}</span>
          </div>
          <p className="text-sm text-zinc-100 leading-snug line-clamp-2">{report.description}</p>
          <p className="text-xs text-zinc-500 mt-1">
            {report.displayName} <span className="text-zinc-700">·</span> {report.role}
          </p>
        </div>
        <ChevronDown className={`w-4 h-4 text-zinc-500 flex-shrink-0 mt-0.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-white/8 px-5 py-4 space-y-4">
          {/* Element info */}
          {(report.elementPath || report.elementText) && (
            <div className="bg-zinc-800/60 border border-white/5 rounded-xl px-3 py-2.5 space-y-1">
              <p className="text-[10px] uppercase tracking-wider text-zinc-600 font-medium">Element</p>
              {report.elementPath && <p className="text-xs text-amber-300 font-mono">{report.elementPath}</p>}
              {report.elementText && (
                <p className="text-xs text-zinc-500 italic">
                  "{report.elementText.slice(0, 120)}{report.elementText.length > 120 ? '…' : ''}"
                </p>
              )}
            </div>
          )}

          {/* Full description */}
          <div>
            <p className="text-[10px] uppercase tracking-wider text-zinc-600 font-medium mb-1.5">Description</p>
            <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">{report.description}</p>
          </div>

          {/* Claude Code prompt */}
          <div>
            <p className="text-[10px] uppercase tracking-wider text-zinc-600 font-medium mb-1.5">Claude Code prompt</p>
            <pre className="text-xs text-zinc-400 bg-zinc-800/60 border border-white/5 rounded-xl p-3 overflow-x-auto whitespace-pre-wrap leading-relaxed font-mono">
              {buildClaudePrompt(report)}
            </pre>
            <div className="mt-2">
              <CopyButton text={buildClaudePrompt(report)} />
            </div>
          </div>

          {/* Status controls */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-xs text-zinc-500 mr-1">Set status:</span>
            {(Object.keys(STATUS_CONFIG) as BugReportDoc['status'][]).map(s => (
              <button
                key={s}
                disabled={report.status === s || updating}
                onClick={() => setStatus(s)}
                className={`text-xs px-2.5 py-1 rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-default ${
                  report.status === s
                    ? STATUS_CONFIG[s].bg + ' ' + STATUS_CONFIG[s].color
                    : 'border-white/8 text-zinc-400 hover:bg-white/5'
                }`}
              >
                {STATUS_CONFIG[s].label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

type FilterStatus = 'all' | BugReportDoc['status']

export default function BugReports() {
  const { data: reports, loading } = useCollection<BugReportDoc>('bug_reports', [orderBy('createdAt', 'desc')])
  const [filter, setFilter] = useState<FilterStatus>('open')

  const filtered = filter === 'all' ? reports : reports.filter(r => r.status === filter)

  const counts = {
    all:         reports.length,
    open:        reports.filter(r => r.status === 'open').length,
    in_progress: reports.filter(r => r.status === 'in_progress').length,
    resolved:    reports.filter(r => r.status === 'resolved').length,
    wont_fix:    reports.filter(r => r.status === 'wont_fix').length,
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="page-title flex items-center gap-2">
          <Bug className="w-6 h-6 text-amber-400" /> Bug Reports
        </h1>
        <p className="text-zinc-500 text-sm mt-1">
          Reports submitted by users. Copy the prompt to paste directly into Claude Code.
        </p>
      </div>

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-2">
        {([
          ['all', 'All'],
          ['open', 'Open'],
          ['in_progress', 'In Progress'],
          ['resolved', 'Resolved'],
          ['wont_fix', "Won't Fix"],
        ] as [FilterStatus, string][]).map(([val, label]) => (
          <button
            key={val}
            onClick={() => setFilter(val)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium transition-colors border ${
              filter === val
                ? 'bg-brand-600 border-brand-500 text-white'
                : 'border-white/8 text-zinc-400 hover:bg-white/5'
            }`}
          >
            {label}
            <span className={`text-xs px-1.5 py-0.5 rounded-full ${filter === val ? 'bg-white/20' : 'bg-white/8'}`}>
              {counts[val]}
            </span>
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-24 bg-zinc-900 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-zinc-600">
          <Bug className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>No {filter !== 'all' ? filter.replace('_', ' ') + ' ' : ''}bug reports</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(r => <ReportCard key={r.id} report={r} />)}
        </div>
      )}
    </div>
  )
}
