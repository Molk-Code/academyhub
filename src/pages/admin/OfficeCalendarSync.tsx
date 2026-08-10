import { useState } from 'react'
import { addDoc, collection, deleteDoc, doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useCollection } from '@/hooks/useFirestore'
import { useAuth } from '@/contexts/AuthContext'
import type { OfficeCalendarSyncDoc, CohortDoc } from '@/types'
import {
  RefreshCw, Plus, Trash2, Copy, Check, ExternalLink, ChevronDown, ChevronUp,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import LoadingSpinner from '@/components/common/LoadingSpinner'
import { format } from 'date-fns'

const WEBHOOK_BASE = 'https://us-central1-academy-hub-c252f.cloudfunctions.net/receiveOfficeCalendarEvent'

function genSecret(): string {
  // 32 bytes of randomness, URL-safe
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={cn(
        'relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none',
        checked ? 'bg-brand-600' : 'bg-zinc-700',
      )}
    >
      <span
        className={cn(
          'inline-block h-4 w-4 transform rounded-full bg-zinc-900 shadow transition-transform duration-200',
          checked ? 'translate-x-6' : 'translate-x-1',
        )}
      />
    </button>
  )
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div>
      <label className="label text-xs">{label}</label>
      <div className="flex items-center gap-2">
        <code className="flex-1 text-xs font-mono px-3 py-2 rounded-lg bg-zinc-900/60 border border-white/10 text-zinc-300 truncate">
          {value}
        </code>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(value)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
          className="p-2 rounded-lg border border-white/10 text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition-colors flex-shrink-0"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  )
}

function SyncCard({ sync, cohorts }: { sync: OfficeCalendarSyncDoc; cohorts: CohortDoc[] }) {
  const [expanded, setExpanded] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const webhookUrl = `${WEBHOOK_BASE}?syncId=${sync.id}`

  async function toggleEnabled() {
    await updateDoc(doc(db, 'office_calendar_syncs', sync.id), {
      enabled: !sync.enabled,
      updatedAt: serverTimestamp(),
    })
  }

  async function changeCohort(cohortId: string) {
    await updateDoc(doc(db, 'office_calendar_syncs', sync.id), { cohortId, updatedAt: serverTimestamp() })
  }

  async function renameSync(name: string) {
    await updateDoc(doc(db, 'office_calendar_syncs', sync.id), { name, updatedAt: serverTimestamp() })
  }

  async function regenerateSecret() {
    if (!confirm('Regenerate the secret? The existing Power Automate flow will stop working until you update it with the new value.')) return
    setRegenerating(true)
    try {
      await updateDoc(doc(db, 'office_calendar_syncs', sync.id), {
        webhookSecret: genSecret(),
        updatedAt: serverTimestamp(),
      })
    } finally {
      setRegenerating(false)
    }
  }

  async function removeSync() {
    if (!confirm(`Delete "${sync.name}"? This stops the sync and removes the config (previously synced events stay on the calendar).`)) return
    await deleteDoc(doc(db, 'office_calendar_syncs', sync.id))
  }

  const cohortLabel = sync.cohortId === 'all'
    ? 'All cohorts'
    : cohorts.find(c => c.id === sync.cohortId)?.name ?? '— pick a cohort —'

  return (
    <div className="bg-zinc-900 border border-white/10 rounded-2xl overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4">
        <div className={cn(
          'w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0',
          sync.enabled ? 'bg-brand-600/15 text-brand-400' : 'bg-zinc-800 text-zinc-500',
        )}>
          <RefreshCw className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <input
            defaultValue={sync.name}
            onBlur={e => { if (e.target.value.trim() && e.target.value.trim() !== sync.name) renameSync(e.target.value.trim()) }}
            className="text-sm font-semibold text-zinc-100 bg-transparent border-none outline-none w-full focus:underline"
          />
          <p className="text-xs text-zinc-500 mt-0.5">
            → {cohortLabel}
            {sync.lastReceivedAt && (
              <span> · last event received {format((sync.lastReceivedAt as any).toDate(), 'd MMM HH:mm')}</span>
            )}
          </p>
        </div>
        <Toggle checked={sync.enabled} onChange={toggleEnabled} />
        <button
          onClick={() => setExpanded(v => !v)}
          className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-white/10 transition-colors"
        >
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {expanded && (
        <div className="px-5 pb-5 space-y-4 border-t border-white/10 pt-4">
          <div>
            <label className="label text-xs">Target CineForge calendar</label>
            <select
              value={sync.cohortId}
              onChange={e => changeCohort(e.target.value)}
              className="input text-sm"
            >
              <option value="all">All cohorts (visible to everyone)</option>
              {cohorts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          <CopyField label="Webhook URL" value={webhookUrl} />
          <CopyField label="x-webhook-secret header value" value={sync.webhookSecret} />

          <div className="bg-blue-950/30 border border-blue-500/20 rounded-xl p-4 space-y-1.5">
            <p className="text-xs font-semibold text-blue-300">Power Automate setup</p>
            <ol className="text-xs text-blue-200/80 space-y-1 list-decimal list-inside">
              <li>New flow → trigger "When an event is added, updated or cancelled (V3)" (Office 365 Outlook), Calendar id = this Outlook calendar</li>
              <li>Add action "HTTP" → Method <code className="bg-blue-500/10 px-1 rounded">POST</code>, URI = webhook URL above</li>
              <li>Headers: <code className="bg-blue-500/10 px-1 rounded">Content-Type: application/json</code>, <code className="bg-blue-500/10 px-1 rounded">x-webhook-secret: (value above)</code></li>
              <li>Body (map from trigger outputs): <code className="bg-blue-500/10 px-1 rounded">{`{"externalId": Id, "subject": Subject, "start": Start, "end": End, "location": Location, "isAllDay": IsAllDay, "changeType": "created"}`}</code> — set changeType to "deleted" in the flow's delete/cancel branch</li>
              <li>Save. Test by editing an event on the source Outlook calendar.</li>
            </ol>
          </div>

          <div className="flex items-center justify-between pt-1">
            <button
              onClick={regenerateSecret}
              disabled={regenerating}
              className="text-xs text-zinc-400 hover:text-zinc-200 underline disabled:opacity-40"
            >
              {regenerating ? 'Regenerating…' : 'Regenerate secret'}
            </button>
            <button
              onClick={removeSync}
              className="flex items-center gap-1.5 text-xs text-rose-400 hover:text-rose-300"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete sync
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function OfficeCalendarSync() {
  const { profile } = useAuth()
  const { data: syncs, loading } = useCollection<OfficeCalendarSyncDoc>('office_calendar_syncs')
  const { data: cohorts } = useCollection<CohortDoc>('cohorts')
  const [creating, setCreating] = useState(false)

  async function createSync() {
    setCreating(true)
    try {
      await addDoc(collection(db, 'office_calendar_syncs'), {
        name: 'New Outlook calendar sync',
        cohortId: 'all',
        enabled: false,
        webhookSecret: genSecret(),
        eventCount: 0,
        lastReceivedAt: null,
        createdAt: serverTimestamp(),
        createdBy: profile?.uid ?? '',
      })
    } finally {
      setCreating(false)
    }
  }

  if (loading) return <LoadingSpinner />

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <RefreshCw className="w-6 h-6 text-brand-500" /> Office 365 Calendar Sync
          </h1>
          <p className="text-zinc-500 text-sm mt-1">
            Pull events (time, title, location) from an Outlook calendar into a CineForge calendar via Power Automate. No IT app registration required — just share the Outlook calendar with your own account and build a flow.
          </p>
        </div>
        <button
          onClick={createSync}
          disabled={creating}
          className="flex items-center gap-2 btn bg-brand-600 text-white hover:bg-brand-500 py-2 px-4 text-sm disabled:opacity-50 flex-shrink-0"
        >
          <Plus className="w-4 h-4" /> {creating ? 'Adding…' : 'Add calendar sync'}
        </button>
      </div>

      {syncs.length === 0 ? (
        <div className="bg-zinc-900 border border-white/10 rounded-2xl px-5 py-10 text-center text-zinc-500 text-sm">
          No Outlook calendars connected yet. Click "Add calendar sync" to generate a webhook URL and secret for a Power Automate flow.
        </div>
      ) : (
        <div className="space-y-3">
          {syncs.map(sync => <SyncCard key={sync.id} sync={sync} cohorts={cohorts} />)}
        </div>
      )}

      <a
        href="https://make.powerautomate.com"
        target="_blank" rel="noreferrer"
        className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300"
      >
        Open Power Automate <ExternalLink className="w-3 h-3" />
      </a>
    </div>
  )
}
