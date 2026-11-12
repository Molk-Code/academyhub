import { admin, db } from './lib'

// Building blocks for scheduled jobs. A schedule can fire twice, a run can be
// retried, and two runs can overlap, so every job must be safe to run again:
//   - points go through writePoints, whose log ids are derived from what the
//     points are for, so the same award is never written twice;
//   - one-off sends (a reminder, a summary) claim a marker with claimOnce first;
//   - writePoints takes dryRun, which reports what it would do and writes nothing.
// Each run that did something is recorded in job_runs (Cloud Functions only).

export const TZ = 'Europe/Stockholm'

// 'YYYY-MM-DD' of an instant, in Swedish time (absence reports use this format)
export function stockholmDate(d: Date): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

// 'HH:mm' of an instant, in Swedish time (functions run in UTC)
export function stockholmTime(d: Date): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(d)
}

// Start of the Swedish calendar day containing d, and of the next day
export function stockholmDayBounds(d: Date): { start: Date; end: Date } {
  const midnight = (dateStr: string) => {
    const [y, m, day] = dateStr.split('-').map(Number)
    const guess = Date.UTC(y, m - 1, day)
    // Offset of Swedish time from UTC at that moment (1 or 2 hours)
    const asLocal = new Date(new Date(guess).toLocaleString('en-US', { timeZone: TZ }))
    const asUtc   = new Date(new Date(guess).toLocaleString('en-US', { timeZone: 'UTC' }))
    return new Date(guess - (asLocal.getTime() - asUtc.getTime()))
  }
  const today = stockholmDate(d)
  const start = midnight(today)
  const end = midnight(stockholmDate(new Date(start.getTime() + 36 * 3600_000)))
  return { start, end }
}

// Firestore ids can't contain '/'
const safeId = (s: string) => s.replace(/\//g, '_')

// Claim a one-off action. True the first time for a key, false ever after.
export async function claimOnce(key: string, data: Record<string, unknown> = {}): Promise<boolean> {
  try {
    await db.collection('job_marks').doc(safeId(key)).create({
      ...data,
      at: admin.firestore.FieldValue.serverTimestamp(),
    })
    return true
  } catch (err: any) {
    if (err?.code === 6 || err?.code === 'already-exists') return false  // gRPC 6 = ALREADY_EXISTS
    throw err
  }
}

export interface PointsEntry {
  studentId: string
  points: number
  reason: string
  referenceId: string
  awardedBy?: string | null
  extra?: Record<string, unknown>
}

// The log id is the identity of an award: the same reason, reference and
// student always give the same id, so writing it again is a no-op
export const pointsLogId = (e: Pick<PointsEntry, 'reason' | 'referenceId' | 'studentId'>) =>
  safeId(`${e.reason}__${e.referenceId}__${e.studentId}`)

export interface PointsResult {
  dryRun: boolean
  applied: PointsEntry[]   // written (or, in a dry run, would be written)
  skipped: PointsEntry[]   // already in the log
}

export async function writePoints(entries: PointsEntry[], opts: { dryRun?: boolean } = {}): Promise<PointsResult> {
  const dryRun = !!opts.dryRun
  const result: PointsResult = { dryRun, applied: [], skipped: [] }
  for (const e of entries) {
    const logRef = db.collection('points_log').doc(pointsLogId(e))
    if (dryRun) {
      ;((await logRef.get()).exists ? result.skipped : result.applied).push(e)
      continue
    }
    const wrote = await db.runTransaction(async tx => {
      if ((await tx.get(logRef)).exists) return false
      tx.set(logRef, {
        studentId:   e.studentId,
        points:      e.points,
        reason:      e.reason,
        referenceId: e.referenceId,
        awardedBy:   e.awardedBy ?? null,
        createdAt:   admin.firestore.FieldValue.serverTimestamp(),
        ...e.extra,
      })
      tx.update(db.collection('users').doc(e.studentId), {
        totalPoints: admin.firestore.FieldValue.increment(e.points),
      })
      return true
    })
    ;(wrote ? result.applied : result.skipped).push(e)
  }
  return result
}

// settings/jobs.dryRun.<job> = true: the job calculates and logs, writes nothing
export async function isDryRun(job: string): Promise<boolean> {
  const snap = await db.collection('settings').doc('jobs').get()
  return snap.data()?.dryRun?.[job] === true
}

export async function recordRun(job: string, summary: Record<string, unknown>): Promise<void> {
  await db.collection('job_runs').add({
    job,
    ...summary,
    at: admin.firestore.FieldValue.serverTimestamp(),
  })
}
