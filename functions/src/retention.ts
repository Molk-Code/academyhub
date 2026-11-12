import { functions, db, LIMITS, REGION } from './lib'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { eraseUser } from './gdpr'
import { isDryRun, recordRun, TZ } from './jobs'

// ─────────────────────────────────────────────────────────────────────────────
// Automatic deletion of former students. The school decides how long it keeps
// its students' data (it is the controller); settings/retention.
// archivedClassMonths says how many months after a class is archived (end of
// year, see class-admin.ts) the students still in it are erased. Off (null)
// by default. Students who moved on to a next class are not in the archived
// class any more and are never touched; nor is anyone who is also a teacher
// or admin. Erasure is the same as a user deleting their own account
// (eraseUser). With settings/jobs.dryRun.retention the job only reports.
// ─────────────────────────────────────────────────────────────────────────────

const MONTH = 30.44 * 86_400_000
// One run erases at most this many accounts; the rest follow the next night
const MAX_PER_RUN = 100

export interface RetentionCohort { id: string; name: string; archived?: boolean; archivedAtMs: number | null }
export interface RetentionUser { id: string; role?: string; roles?: string[]; cohortId?: string | null; displayName?: string }
export interface RetentionPlanItem { uid: string; displayName: string; cohortId: string; cohortName: string }

// Who is due for erasure: students still in a class archived more than `months` ago
export function planRetention(opts: { cohorts: RetentionCohort[]; users: RetentionUser[]; months: number; now: number }): RetentionPlanItem[] {
  const cutoff = opts.now - opts.months * MONTH
  const due = new Map(opts.cohorts
    .filter(c => c.archived && c.archivedAtMs != null && c.archivedAtMs < cutoff)
    .map(c => [c.id, c]))
  return opts.users
    .filter(u => u.cohortId && due.has(u.cohortId))
    .filter(u => {
      const roles = new Set([u.role, ...(u.roles ?? [])])
      return roles.has('student') && !roles.has('teacher') && !roles.has('admin')
    })
    .map(u => ({ uid: u.id, displayName: u.displayName ?? '', cohortId: u.cohortId!, cohortName: due.get(u.cohortId!)!.name }))
}

export async function retentionMonths(): Promise<number | null> {
  const months = (await db.collection('settings').doc('retention').get()).data()?.archivedClassMonths
  return typeof months === 'number' && months > 0 ? months : null
}

export async function runRetention(opts: { now?: number; dryRun?: boolean } = {}) {
  const now = opts.now ?? Date.now()
  const months = await retentionMonths()
  if (months === null) return { enabled: false, dryRun: !!opts.dryRun, due: [] as RetentionPlanItem[], erased: 0, failed: [] as string[] }

  const cohortSnap = await db.collection('cohorts').where('archived', '==', true).get()
  const cohorts: RetentionCohort[] = cohortSnap.docs.map(d => ({
    id: d.id, name: d.data().name ?? d.id, archived: true,
    archivedAtMs: (d.data().archivedAt as Timestamp | undefined)?.toMillis?.() ?? null,
  }))
  const dueIds = cohorts.filter(c => c.archivedAtMs != null && c.archivedAtMs < now - months * MONTH).map(c => c.id)
  const users: RetentionUser[] = []
  for (let i = 0; i < dueIds.length; i += 30) {
    const snap = await db.collection('users').where('cohortId', 'in', dueIds.slice(i, i + 30)).get()
    users.push(...snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<RetentionUser, 'id'>) })))
  }
  const due = planRetention({ cohorts, users, months, now })
  if (opts.dryRun) return { enabled: true, dryRun: true, months, due, erased: 0, failed: [] as string[] }

  let erased = 0
  const failed: string[] = []
  for (const item of due.slice(0, MAX_PER_RUN)) {
    try {
      await eraseUser(item.uid, { deletedBy: 'system', method: `retention: ${months} months after ${item.cohortName} ended` })
      await db.collection('cohorts').doc(item.cohortId).update({
        studentIds: FieldValue.arrayRemove(item.uid),
        personalDataErasedAt: FieldValue.serverTimestamp(),
      })
      erased++
    } catch (err: any) {
      console.error('retention: erase failed', item.uid, err?.message ?? err)
      failed.push(item.uid)
    }
  }
  return { enabled: true, dryRun: false, months, due, erased, failed }
}

export const applyRetention = functions.region(REGION).runWith({ ...LIMITS, timeoutSeconds: 540 })
  .pubsub.schedule('every day 03:30').timeZone(TZ)
  .onRun(async () => {
    const dryRun = await isDryRun('retention')
    const r = await runRetention({ dryRun })
    if (!r.enabled || r.due.length === 0) return null
    await recordRun('retention', {
      dryRun: r.dryRun,
      months: r.months,
      due: r.due.length,
      erased: r.erased,
      failed: r.failed.length,
      // Names only in a test run, so the admin can check who would go; ids otherwise
      classes: [...new Set(r.due.map(d => d.cohortName))],
      ...(r.dryRun ? { names: r.due.slice(0, 200).map(d => `${d.displayName} (${d.cohortName})`) } : {}),
    })
    return null
  })

// Admin: who the next run would erase, right now
export const previewRetention = functions.region(REGION).runWith(LIMITS).https.onCall(async (_data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.')
  if (context.auth.token.role !== 'admin') throw new functions.https.HttpsError('permission-denied', 'Admin only.')
  const r = await runRetention({ dryRun: true })
  return { enabled: r.enabled, months: r.enabled ? r.months : null, due: r.due.map(d => ({ displayName: d.displayName, cohortName: d.cohortName })) }
})
