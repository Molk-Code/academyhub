// Health of an Outlook calendar sync. The Power Automate flow runs under one
// person's account; if it stops (they leave, a licence lapses) nothing errors —
// events just stop arriving. Any sign of life counts: an event from the flow,
// the daily check-up, or a manual .ics import.

export const DEFAULT_WARN_AFTER_DAYS = 3
const DAY = 86_400_000

type Millis = number | null | undefined
type TsLike = { toMillis(): number } | Millis

export interface SyncActivity {
  enabled?: boolean
  warnAfterDays?: number | null
  createdAt?: TsLike
  lastReceivedAt?: TsLike
  lastReconciledAt?: TsLike
  lastImportedAt?: TsLike
}

export type ActivitySource = 'flow' | 'check-up' | 'import'

export interface SyncHealth {
  stale: boolean
  lastActivityAt: number | null
  lastSource: ActivitySource | null
  daysSilent: number | null   // whole days since the last activity (or since creation, if never)
  warnAfterDays: number
}

const ms = (v: TsLike): number | null =>
  v == null ? null : typeof v === 'number' ? v : v.toMillis()

export function syncHealth(sync: SyncActivity, now = Date.now()): SyncHealth {
  const warnAfterDays = sync.warnAfterDays && sync.warnAfterDays > 0 ? sync.warnAfterDays : DEFAULT_WARN_AFTER_DAYS
  const candidates: [ActivitySource, number | null][] = [
    ['flow', ms(sync.lastReceivedAt)],
    ['check-up', ms(sync.lastReconciledAt)],
    ['import', ms(sync.lastImportedAt)],
  ]
  let lastSource: ActivitySource | null = null
  let lastActivityAt: number | null = null
  for (const [source, at] of candidates) {
    if (at != null && (lastActivityAt == null || at > lastActivityAt)) { lastActivityAt = at; lastSource = source }
  }
  const since = lastActivityAt ?? ms(sync.createdAt)
  const daysSilent = since == null ? null : Math.floor((now - since) / DAY)
  const stale = sync.enabled !== false && since != null && now - since > warnAfterDays * DAY
  return { stale, lastActivityAt, lastSource, daysSilent, warnAfterDays }
}

export const SOURCE_LABEL: Record<ActivitySource, string> = {
  'flow': 'event from Power Automate',
  'check-up': 'daily check-up',
  'import': '.ics import',
}
