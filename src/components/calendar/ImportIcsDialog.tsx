import { useEffect, useRef, useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { functions } from '@/lib/firebase'
import { X, Upload, AlertTriangle, Loader2, Check } from 'lucide-react'
import { syncHealth } from '@/lib/calendarSync'

// Manual "sync now" when the Power Automate flow has stopped: export the
// Outlook calendar as .ics (Outlook → File → Save Calendar, or a shared
// calendar's ICS link saved as a file) and import it here. The server
// previews first; nothing changes until "Import".

export interface CalendarSyncSummary {
  id: string; name: string; cohortId: string; enabled: boolean
  warnAfterDays: number | null; createdAt: number | null
  lastReceivedAt: number | null; lastReconciledAt: number | null; lastImportedAt: number | null
}

interface ImportResult {
  ok: boolean; dryRun?: boolean; refused?: boolean; reason?: string
  outlookEvents: number; matched: number; toAdd: number; toUpdate: number; toDelete: number
  deleting: string[]; window: { start: string; end: string }
}

const listSyncs = httpsCallable<void, CalendarSyncSummary[]>(functions, 'listCalendarSyncs')
const importIcs = httpsCallable<{ syncId: string; ics: string; dryRun: boolean; force?: boolean }, ImportResult>(functions, 'importCalendarIcs')

const day = (iso: string) => new Date(iso).toLocaleDateString('sv-SE')

export default function ImportIcsDialog({ onClose, initialSyncId }: { onClose: () => void; initialSyncId?: string }) {
  const [syncs, setSyncs] = useState<CalendarSyncSummary[] | null>(null)
  const [syncId, setSyncId] = useState(initialSyncId ?? '')
  const [file, setFile] = useState<{ name: string; text: string } | null>(null)
  const [preview, setPreview] = useState<ImportResult | null>(null)
  const [done, setDone] = useState<ImportResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    listSyncs().then(r => {
      setSyncs(r.data)
      if (!initialSyncId && r.data.length === 1) setSyncId(r.data[0].id)
    }).catch(e => setError(e?.message ?? 'Could not load the calendars.'))
  }, [initialSyncId])

  useEffect(() => {
    dialogRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // A new file or calendar needs a new preview
  useEffect(() => { setPreview(null); setDone(null) }, [syncId, file])

  async function run(dryRun: boolean, force = false) {
    if (!file || !syncId) return
    setBusy(true); setError('')
    try {
      const { data } = await importIcs({ syncId, ics: file.text, dryRun, force })
      if (dryRun) setPreview(data)
      else {
        setDone(data)
        listSyncs().then(r => setSyncs(r.data)).catch(() => {})   // clears the "nothing received" warning
      }
    } catch (e: any) {
      setError(e?.message ?? 'Import failed.')
    } finally {
      setBusy(false)
    }
  }

  async function pickFile(f: File | undefined) {
    if (!f) return
    setError('')
    if (f.size > 5_000_000) { setError('The file is too large (max 5 MB). Export a shorter date range.'); return }
    setFile({ name: f.name, text: await f.text() })
  }

  const selected = syncs?.find(s => s.id === syncId)
  const health = selected ? syncHealth(selected) : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="ics-title" tabIndex={-1}
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-white/10 bg-zinc-900 p-5 space-y-4 outline-none"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="ics-title" className="text-base font-semibold text-zinc-100">Sync now from an .ics file</h2>
            <p className="text-xs text-zinc-500 mt-1">
              Use this when the automatic Outlook sync has stopped. In Outlook choose <b>File → Save Calendar</b> (or
              save a shared calendar's ICS link as a file) and pick it below.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-white/10">
            <X className="w-4 h-4" />
          </button>
        </div>

        {syncs === null && !error && <p className="text-sm text-zinc-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading calendars…</p>}
        {syncs?.length === 0 && (
          <p className="text-sm text-zinc-400">No Outlook calendar syncs are set up yet. An admin adds them under Calendar Sync.</p>
        )}

        {syncs && syncs.length > 0 && (
          <>
            <div>
              <label htmlFor="ics-sync" className="label text-xs">Calendar to update</label>
              <select id="ics-sync" className="input text-sm" value={syncId} onChange={e => setSyncId(e.target.value)}>
                <option value="" disabled>Choose a calendar…</option>
                {syncs.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              {health?.stale && (
                <p className="mt-1.5 text-xs text-amber-300 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
                  Nothing received for {health.daysSilent} days — the automatic sync may have stopped.
                </p>
              )}
            </div>

            <div>
              <label htmlFor="ics-file" className="label text-xs">Calendar file (.ics)</label>
              <input
                id="ics-file" type="file" accept=".ics,text/calendar"
                onChange={e => pickFile(e.target.files?.[0])}
                className="block w-full text-sm text-zinc-300 file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-sm file:text-zinc-100 hover:file:bg-white/15"
              />
            </div>

            {!preview && !done && (
              <button onClick={() => run(true)} disabled={!file || !syncId || busy} className="btn-primary py-2 w-full justify-center disabled:opacity-50">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Check the file
              </button>
            )}
          </>
        )}

        {preview && !done && (
          <div className="space-y-3" aria-live="polite">
            <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-zinc-300 space-y-1">
              <p>
                {preview.outlookEvents} events in the file, {day(preview.window.start)} – {day(preview.window.end)}.
                For that period the calendar would get:
              </p>
              <ul className="text-xs text-zinc-400 list-disc list-inside">
                <li>{preview.toAdd} new</li>
                <li>{preview.toUpdate} changed</li>
                <li>{preview.toDelete} removed (no longer in Outlook)</li>
                <li>{preview.matched} already up to date or matched</li>
              </ul>
              {preview.deleting.length > 0 && (
                <details className="text-xs text-zinc-500">
                  <summary className="cursor-pointer">Show what would be removed</summary>
                  <ul className="mt-1 space-y-0.5">{preview.deleting.map(d => <li key={d}>{d.replace('T', ' ').replace(/:00\.000Z/, ' UTC')}</li>)}</ul>
                </details>
              )}
            </div>
            {preview.refused ? (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200 space-y-2">
                <p className="flex items-start gap-1.5"><AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" aria-hidden="true" />
                  This would remove most of the calendar for that period, so it was stopped. Check that the file is the
                  whole calendar, not a single event or a shorter range.</p>
                <button onClick={() => run(false, true)} disabled={busy} className="btn-secondary py-1.5 text-xs">
                  {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Import anyway
                </button>
              </div>
            ) : (
              <button onClick={() => run(false)} disabled={busy} className="btn-primary py-2 w-full justify-center">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Import
              </button>
            )}
          </div>
        )}

        {done && (
          <p className="text-sm text-emerald-300 flex items-center gap-2" aria-live="polite">
            <Check className="w-4 h-4" aria-hidden="true" />
            Calendar updated: {done.toAdd} added, {done.toUpdate} changed, {done.toDelete} removed.
          </p>
        )}

        {error && <p role="alert" className="text-sm text-rose-400">{error}</p>}
      </div>
    </div>
  )
}
