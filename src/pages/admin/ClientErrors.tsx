import { useMemo, useState } from 'react'
import { deleteDoc, doc, limit, Timestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useCollection, orderBy } from '@/hooks/useFirestore'
import { AlertOctagon, ChevronDown, Trash2 } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { cn } from '@/lib/utils'

interface ClientErrorDoc {
  id: string
  message: string
  stack: string | null
  context: string
  uid: string | null
  url: string
  ua: string
  ts: Timestamp
}

interface Group {
  key: string
  message: string
  context: string
  count: number
  lastSeen: Timestamp
  urls: Set<string>
  uids: Set<string>
  sample: ClientErrorDoc
  ids: string[]
}

export default function ClientErrors() {
  const { data: errors, loading } = useCollection<ClientErrorDoc>('_client_errors', [orderBy('ts', 'desc'), limit(500)])
  const [expanded, setExpanded] = useState<string | null>(null)

  const groups = useMemo(() => {
    const m = new Map<string, Group>()
    for (const e of errors) {
      const key = `${e.message}||${e.context}`
      let g = m.get(key)
      if (!g) {
        g = { key, message: e.message, context: e.context, count: 0, lastSeen: e.ts, urls: new Set(), uids: new Set(), sample: e, ids: [] }
        m.set(key, g)
      }
      g.count++
      g.ids.push(e.id)
      g.urls.add(e.url)
      if (e.uid) g.uids.add(e.uid)
      if (e.ts && (!g.lastSeen || e.ts.toMillis() > g.lastSeen.toMillis())) g.lastSeen = e.ts
    }
    return [...m.values()].sort((a, b) => b.count - a.count)
  }, [errors])

  async function dismissGroup(g: Group) {
    if (!confirm(`Delete all ${g.count} record(s) of this error?`)) return
    await Promise.all(g.ids.map(id => deleteDoc(doc(db, '_client_errors', id))))
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title flex items-center gap-2">
          <AlertOctagon className="w-6 h-6 text-rose-500" /> Client Crash Reports
        </h1>
        <p className="text-zinc-500 text-sm mt-1">
          Errors automatically captured by the app's error boundary ("Something went wrong" page), grouped by error + where it happened. Most frequent first.
        </p>
      </div>

      {loading && <p className="text-zinc-500 text-sm">Loading…</p>}
      {!loading && groups.length === 0 && (
        <p className="text-zinc-500 text-sm text-center py-16">No crashes recorded. 🎉</p>
      )}

      <div className="space-y-2">
        {groups.map(g => (
          <div key={g.key} className="bg-zinc-900 border border-white/10 rounded-xl overflow-hidden">
            <button
              onClick={() => setExpanded(expanded === g.key ? null : g.key)}
              className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-white/3 transition-colors"
            >
              <span className="text-xs font-bold text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-full px-2 py-0.5 flex-shrink-0 mt-0.5">
                ×{g.count}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-zinc-200 font-medium truncate">{g.message || 'Unknown error'}</p>
                <p className="text-xs text-zinc-500 truncate mt-0.5">{g.context || '—'}</p>
                <p className="text-[11px] text-zinc-600 mt-1">
                  {g.uids.size} user{g.uids.size !== 1 ? 's' : ''} · last seen {g.lastSeen ? formatDistanceToNow(g.lastSeen.toDate(), { addSuffix: true }) : '—'}
                </p>
              </div>
              <ChevronDown className={cn('w-4 h-4 text-zinc-500 flex-shrink-0 transition-transform mt-1', expanded === g.key && 'rotate-180')} />
            </button>
            {expanded === g.key && (
              <div className="px-4 pb-4 space-y-3 border-t border-white/5 pt-3">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-1">URLs</p>
                  <div className="flex flex-wrap gap-1">
                    {[...g.urls].map(u => (
                      <span key={u} className="text-[11px] text-zinc-400 bg-zinc-800 rounded px-1.5 py-0.5 font-mono truncate max-w-full">{u}</span>
                    ))}
                  </div>
                </div>
                {g.sample.stack && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-1">Stack (sample)</p>
                    <pre className="text-[10px] text-zinc-400 bg-zinc-950 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">{g.sample.stack}</pre>
                  </div>
                )}
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-1">User agent (sample)</p>
                  <p className="text-[11px] text-zinc-500 font-mono break-all">{g.sample.ua}</p>
                </div>
                <button
                  onClick={() => dismissGroup(g)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-rose-900/30 hover:text-rose-400 text-xs text-zinc-300 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Dismiss {g.count} record{g.count !== 1 ? 's' : ''}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
