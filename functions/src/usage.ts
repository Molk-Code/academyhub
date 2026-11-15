import { FieldValue } from 'firebase-admin/firestore'
import { functions, db, LIMITS, REGION, SCHOOL_ID } from './lib'
import {
  BLOCK_PCT, LIMIT_FIELD, MODULE_NAMES, LIMIT_MODULE, canAddOne, upgradeFor,
  type LimitKind, type PlanSelection,
} from './pricing'

// Plan limits: assets (Rental & Inventory) and students (Academy), counted
// in this project and written to schools/{SCHOOL_ID}.usage, which the admin
// dashboard and firestore.rules read (equipment, invitations and student
// sign-ups are blocked from BLOCK_PCT of the limit). Only schools with a
// stored plan (planSelection, set at setup) are counted or limited.
// Counting rules: docs/claude-code-modules.md, "Counting rules".

type Data = Record<string, any>

export const countsAsAsset = (e: Data) => e.isActive !== false

export const isStudent = (u: Data) => u.role === 'student' || (Array.isArray(u.roles) && u.roles.includes('student'))

/** Active students in a class that isn't archived (or in no class yet) */
export const countsAsStudent = (u: Data, archived: Set<string>) =>
  isStudent(u) && u.isActive !== false && u.disabled !== true && !(u.cohortId && archived.has(u.cohortId))

export async function countAssets(): Promise<number> {
  const [all, inactive] = await Promise.all([
    db.collection('equipment').count().get(),
    db.collection('equipment').where('isActive', '==', false).count().get(),
  ])
  return all.data().count - inactive.data().count
}

export async function countStudents(): Promise<number> {
  const [users, cohorts] = await Promise.all([
    db.collection('users').select('role', 'roles', 'isActive', 'disabled', 'cohortId').get(),
    db.collection('cohorts').where('archived', '==', true).select().get(),
  ])
  const archived = new Set(cohorts.docs.map(d => d.id))
  return users.docs.filter(d => countsAsStudent(d.data(), archived)).length
}

const COUNT: Record<LimitKind, () => Promise<number>> = { assets: countAssets, students: countStudents }

const schoolRef = () => db.collection('schools').doc(SCHOOL_ID)

/** Counts again and stores the result; returns the school's usage (null: no plan, nothing counted) */
export async function refreshUsage(kinds: LimitKind[] = ['assets', 'students']): Promise<Record<string, number> | null> {
  const school = (await schoolRef().get()).data()
  if (!school?.planSelection) return null
  const counts = Object.fromEntries(await Promise.all(kinds.map(async k => [k, await COUNT[k]()] as const)))
  await schoolRef().set({ usage: { ...counts, countedAt: FieldValue.serverTimestamp() } }, { merge: true })
  return { ...(school.usage ?? {}), ...counts }
}

/** The message shown when the limit blocks a new item */
export function limitMessage(kind: LimitKind, used: number, limit: number, selection: PlanSelection): string {
  const noun = kind === 'assets' ? 'assets' : 'students'
  const next = upgradeFor(kind, selection[LIMIT_MODULE[kind]])
  const upgrade = next
    ? `Upgrade to ${MODULE_NAMES[LIMIT_MODULE[kind]]} ${next.name} (${next.limits.split(',')[0].toLowerCase()})`
    : 'Ask CineForge about a larger limit'
  return `Your plan's limit is reached: ${used} of ${limit} ${noun} (new ${noun} are blocked from ${BLOCK_PCT}%). `
    + `Nothing is removed. ${upgrade}: contact CineForge at cineforge.se/contact.`
}

/** Throws resource-exhausted when the plan's limit blocks one more item (counted live, not from the stored usage) */
export async function assertCanAdd(kind: LimitKind): Promise<void> {
  const school = (await schoolRef().get()).data()
  const limit = school?.[LIMIT_FIELD[kind]]
  if (!school?.planSelection || limit == null) return
  const used = await COUNT[kind]()
  if (!canAddOne(used, limit)) throw new functions.https.HttpsError('resource-exhausted', limitMessage(kind, used, limit, school.planSelection))
}

// ── Keeping usage current ────────────────────────────────────────────────────

const changed = (before: Data | undefined, after: Data | undefined, keys: string[]) =>
  !before || !after || keys.some(k => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null))

export const onEquipmentWrittenUsage = functions.region(REGION).runWith(LIMITS).firestore
  .document('equipment/{itemId}')
  .onWrite(async change => {
    if (changed(change.before.data(), change.after.data(), ['isActive'])) await refreshUsage(['assets'])
  })

export const onUserWrittenUsage = functions.region(REGION).runWith(LIMITS).firestore
  .document('users/{uid}')
  .onWrite(async change => {
    const before = change.before.data(), after = change.after.data()
    if (!(before && isStudent(before)) && !(after && isStudent(after))) return
    if (changed(before, after, ['role', 'roles', 'isActive', 'disabled', 'cohortId'])) await refreshUsage(['students'])
  })

export const onCohortWrittenUsage = functions.region(REGION).runWith(LIMITS).firestore
  .document('cohorts/{cohortId}')
  .onUpdate(async change => {
    if (changed(change.before.data(), change.after.data(), ['archived'])) await refreshUsage(['students'])
  })
