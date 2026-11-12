import { functions, db, LIMITS, REGION, requireTeacherOrAdmin } from './lib'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'

// ─────────────────────────────────────────────────────────────────────────────
// Year-end class admin: rolling a class over to the next one, and copying a
// class's plan (lessons, assignments, subject visibility) from last year.
// ─────────────────────────────────────────────────────────────────────────────

const DAY = 86_400_000
const isoDate = (v: unknown, what: string): Date => {
  const s = String(v ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new functions.https.HttpsError('invalid-argument', `${what} must be a date (YYYY-MM-DD).`)
  return new Date(`${s}T00:00:00Z`)
}
const optionalIso = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)

function requireAdmin(context: functions.https.CallableContext): string {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.')
  if (context.auth.token.role !== 'admin') throw new functions.https.HttpsError('permission-denied', 'Admin only.')
  return context.auth.uid
}

// ── rolloverClass ────────────────────────────────────────────────────────────
// At the end of a school year: archive a class and, unless it's graduating,
// create the class its students continue in and move the chosen students
// there. One transaction: nothing changes unless all of it does, and running
// it twice is refused (the class is already archived).
//
// data: { cohortId, moveStudentIds?: string[], deactivateStudentIds?: string[],
//         next?: { name, startDate, endDate, programYear, copyTeachers?,
//                  semesterStartDate?, semesterEndDate?, semesterSem2StartDate?, semesterSem2EndDate? } }

export const rolloverClass = functions.region(REGION).runWith(LIMITS).https.onCall(async (data, context) =>
  runRollover(requireAdmin(context), data))

export async function runRollover(uid: string, data: any) {
  const cohortId = String(data?.cohortId ?? '')
  if (!cohortId) throw new functions.https.HttpsError('invalid-argument', 'cohortId required.')
  const next = data?.next as Record<string, unknown> | undefined
  const moveIds: string[] = Array.isArray(data?.moveStudentIds) ? data.moveStudentIds.map(String) : []
  const deactivateIds: string[] = Array.isArray(data?.deactivateStudentIds) ? data.deactivateStudentIds.map(String) : []
  if (moveIds.length && !next) throw new functions.https.HttpsError('invalid-argument', 'Students can only move to a next class.')
  if (moveIds.length + deactivateIds.length > 400) throw new functions.https.HttpsError('invalid-argument', 'Too many students for one rollover (max 400).')

  let nextFields: Record<string, unknown> | null = null
  if (next) {
    const name = String(next.name ?? '').trim()
    if (name.length < 2) throw new functions.https.HttpsError('invalid-argument', 'The new class needs a name.')
    const start = isoDate(next.startDate, 'Start date')
    const end = isoDate(next.endDate, 'End date')
    if (end < start) throw new functions.https.HttpsError('invalid-argument', 'The end date must be after the start date.')
    const programYear = Number(next.programYear) === 2 ? 2 : 1
    nextFields = {
      name, programYear,
      startDate: Timestamp.fromDate(start), endDate: Timestamp.fromDate(end),
      ...Object.fromEntries(['semesterStartDate', 'semesterEndDate', 'semesterSem2StartDate', 'semesterSem2EndDate']
        .map(k => [k, optionalIso(next[k])]).filter(([, v]) => v)),
    }
  }

  const cohortRef = db.collection('cohorts').doc(cohortId)
  const nextRef = nextFields ? db.collection('cohorts').doc() : null

  const result = await db.runTransaction(async tx => {
    const snap = await tx.get(cohortRef)
    if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Class not found.')
    const cohort = snap.data()!
    if (cohort.archived) throw new functions.https.HttpsError('failed-precondition', `${cohort.name} has already been archived.`)

    const userRefs = [...new Set([...moveIds, ...deactivateIds])].map(id => db.collection('users').doc(id))
    const users = userRefs.length ? await tx.getAll(...userRefs) : []
    // Only students who are in this class right now
    const inClass = new Set(users.filter(u => u.exists && u.data()!.cohortId === cohortId).map(u => u.id))
    const moving = moveIds.filter(id => inClass.has(id))
    const deactivating = deactivateIds.filter(id => inClass.has(id))
    // People invited to this class who haven't signed up yet, and its QR sign-up codes
    const pendingInvites = await tx.get(db.collection('invitations').where('cohortId', '==', cohortId).where('used', '==', false))
    const qrInvites = await tx.get(db.collection('classInvites').where('cohortId', '==', cohortId).where('active', '==', true))

    if (nextRef && nextFields) {
      tx.create(nextRef, {
        ...nextFields,
        teacherIds: next!.copyTeachers === false ? [] : (cohort.teacherIds ?? []),
        studentIds: moving,
        ...(cohort.color ? { color: cohort.color } : {}),
        previousCohortId: cohortId,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: uid,
      })
      // onUserDocUpdated moves their sign-in claims to the new class
      for (const id of moving) tx.update(db.collection('users').doc(id), { cohortId: nextRef.id })
    }
    for (const id of deactivating) tx.update(db.collection('users').doc(id), { isActive: false })
    // They join the class the others moved to; a finished class takes no one new
    if (nextRef) for (const d of pendingInvites.docs) tx.update(d.ref, { cohortId: nextRef.id })
    for (const d of qrInvites.docs) tx.update(d.ref, { active: false })
    // studentIds stays as it was: the archived class keeps its roster for history
    tx.update(cohortRef, {
      archived: true,
      archivedAt: FieldValue.serverTimestamp(),
      archivedBy: uid,
      ...(nextRef ? { nextCohortId: nextRef.id } : {}),
    })
    return { invitesMoved: nextRef ? pendingInvites.size : 0, qrInvitesClosed: qrInvites.size, moved: moving.length, deactivated: deactivating.length, skipped: moveIds.length + deactivateIds.length - moving.length - deactivating.length }
  })

  return { ok: true, archivedCohortId: cohortId, nextCohortId: nextRef?.id ?? null, ...result }
}

// Undo an archive (e.g. archived by mistake). Students who moved stay moved.
export const restoreClass = functions.region(REGION).runWith(LIMITS).https.onCall(async (data, context) => {
  requireAdmin(context)
  const cohortId = String(data?.cohortId ?? '')
  if (!cohortId) throw new functions.https.HttpsError('invalid-argument', 'cohortId required.')
  await db.collection('cohorts').doc(cohortId).update({
    archived: false, archivedAt: FieldValue.delete(), archivedBy: FieldValue.delete(),
  })
  return { ok: true }
})

// ── copyClassPlan ────────────────────────────────────────────────────────────
// Copy last year's plan into a class: the source class's lessons and
// assignments in [from, to), moved forward by shiftDays (whole weeks, so a
// Monday lesson stays on a Monday), and the subjects the source class could
// see. Assignments arrive unpublished, so teachers review them first. Each
// copy gets a fixed id (copy_<source id>_<target class>): copying again only
// adds what's missing. dryRun reports without writing.

const MAX_ITEMS = 2000
const copyId = (sourceId: string, toCohortId: string) => `copy_${sourceId}_${toCohortId}`

export function shiftTimestamp(ts: Timestamp | null | undefined, shiftDays: number): Timestamp | null {
  if (!ts?.toMillis) return null
  return Timestamp.fromMillis(ts.toMillis() + shiftDays * DAY)
}

export async function planCopy(opts: {
  fromCohortId: string; toCohortId: string; from: Date; to: Date; shiftDays: number
  lessons: boolean; assignments: boolean; subjects: boolean; uid: string; dryRun: boolean
}) {
  const { fromCohortId, toCohortId, from, to, shiftDays, uid, dryRun } = opts
  const fromTs = Timestamp.fromDate(from), toTs = Timestamp.fromDate(to)

  const lessons = opts.lessons
    ? (await db.collection('lessons').where('cohortId', '==', fromCohortId)
        .where('startTime', '>=', fromTs).where('startTime', '<', toTs).get()).docs
    : []
  const assignments = opts.assignments
    ? (await db.collection('assignments').where('cohortId', '==', fromCohortId)
        .where('dueDate', '>=', fromTs).where('dueDate', '<', toTs).get()).docs
    : []
  const subjects = opts.subjects
    ? (await db.collection('subjects').where('cohortIds', 'array-contains', fromCohortId).get()).docs
        .filter(d => !(d.data().cohortIds as string[]).includes(toCohortId))
    : []
  if (lessons.length + assignments.length > MAX_ITEMS) {
    throw new functions.https.HttpsError('invalid-argument', `That's more than ${MAX_ITEMS} lessons and assignments. Copy a shorter period at a time.`)
  }

  // Already copied (an earlier run): skip
  const existing = async (col: string, docs: FirebaseFirestore.QueryDocumentSnapshot[]) => {
    const ids = new Set<string>()
    for (let i = 0; i < docs.length; i += 300) {
      const refs = docs.slice(i, i + 300).map(d => db.collection(col).doc(copyId(d.id, toCohortId)))
      if (refs.length) (await db.getAll(...refs)).forEach(s => { if (s.exists) ids.add(s.id) })
    }
    return ids
  }
  const lessonDone = await existing('lessons', lessons)
  const assignmentDone = await existing('assignments', assignments)
  const newLessons = lessons.filter(d => !lessonDone.has(copyId(d.id, toCohortId)))
  const newAssignments = assignments.filter(d => !assignmentDone.has(copyId(d.id, toCohortId)))

  const summary = {
    lessons: { found: lessons.length, toCopy: newLessons.length, alreadyCopied: lessons.length - newLessons.length },
    assignments: { found: assignments.length, toCopy: newAssignments.length, alreadyCopied: assignments.length - newAssignments.length },
    subjects: subjects.length,
    sample: newLessons.slice(0, 5).map(d => ({
      title: d.data().title as string,
      from: (d.data().startTime as Timestamp).toDate().toISOString(),
      to: shiftTimestamp(d.data().startTime, shiftDays)!.toDate().toISOString(),
    })),
  }
  if (dryRun) return { ok: true, dryRun: true, ...summary }

  const ops: ((b: FirebaseFirestore.WriteBatch) => void)[] = []
  for (const d of newLessons) {
    const l = d.data()
    ops.push(b => b.create(db.collection('lessons').doc(copyId(d.id, toCohortId)), {
      subjectId: l.subjectId ?? '',
      ...(l.categoryId ? { categoryId: l.categoryId } : {}),
      cohortId: toCohortId,
      title: l.title ?? '',
      ...(l.iconEmoji ? { iconEmoji: l.iconEmoji } : {}),
      description: l.description ?? '',
      teacherId: l.teacherId ?? '',
      teacherIds: l.teacherIds ?? [],
      // Guest teacher bookings are for a date, so they don't carry over
      classroom: l.classroom ?? '',
      startTime: shiftTimestamp(l.startTime, shiftDays),
      endTime: shiftTimestamp(l.endTime, shiftDays),
      isOnline: !!l.isOnline,
      resources: l.resources ?? [],
      ...(l.coveredCurriculumIds ? { coveredCurriculumIds: l.coveredCurriculumIds } : {}),
      ...(l.requiresPresence === false ? { requiresPresence: false } : {}),
      copiedFrom: { lessonId: d.id, cohortId: fromCohortId },
      createdAt: FieldValue.serverTimestamp(),
    }))
  }
  for (const d of newAssignments) {
    const a = d.data()
    ops.push(b => b.create(db.collection('assignments').doc(copyId(d.id, toCohortId)), {
      ...a,
      cohortId: toCohortId,
      dueDate: shiftTimestamp(a.dueDate, shiftDays),
      isPublished: false,   // teachers check and publish
      createdBy: uid,
      copiedFrom: { assignmentId: d.id, cohortId: fromCohortId },
      createdAt: FieldValue.serverTimestamp(),
    }))
  }
  for (const d of subjects) {
    ops.push(b => b.update(d.ref, { cohortIds: FieldValue.arrayUnion(toCohortId) }))
  }
  for (let i = 0; i < ops.length; i += 400) {
    const batch = db.batch()
    ops.slice(i, i + 400).forEach(op => op(batch))
    await batch.commit()
  }
  return { ok: true, ...summary }
}

export const copyClassPlan = functions.region(REGION)
  .runWith({ ...LIMITS, timeoutSeconds: 300, memory: '512MB' })
  .https.onCall(async (data, context) => {
    requireTeacherOrAdmin(context)
    const uid = context.auth!.uid
    const fromCohortId = String(data?.fromCohortId ?? '')
    const toCohortId = String(data?.toCohortId ?? '')
    if (!fromCohortId || !toCohortId) throw new functions.https.HttpsError('invalid-argument', 'Choose both classes.')
    if (fromCohortId === toCohortId) throw new functions.https.HttpsError('invalid-argument', 'Choose two different classes.')
    const from = isoDate(data?.from, 'From')
    const to = new Date(isoDate(data?.to, 'To').getTime() + DAY)   // the "to" day is included
    if (to <= from) throw new functions.https.HttpsError('invalid-argument', 'The period must end after it starts.')
    const shiftDays = Number(data?.shiftDays)
    if (!Number.isInteger(shiftDays) || shiftDays % 7 !== 0 || Math.abs(shiftDays) > 3 * 365) {
      throw new functions.https.HttpsError('invalid-argument', 'The shift must be a whole number of weeks.')
    }

    const [fromSnap, toSnap] = await db.getAll(db.collection('cohorts').doc(fromCohortId), db.collection('cohorts').doc(toCohortId))
    if (!fromSnap.exists || !toSnap.exists) throw new functions.https.HttpsError('not-found', 'Class not found.')
    if (toSnap.data()!.archived) throw new functions.https.HttpsError('failed-precondition', 'Copy into a current class, not an archived one.')
    // Teachers fill the classes they teach; admins any class
    if (context.auth!.token.role !== 'admin' && !(toSnap.data()!.teacherIds ?? []).includes(uid)) {
      throw new functions.https.HttpsError('permission-denied', `You don't teach ${toSnap.data()!.name}. Ask an admin to add you to the class first.`)
    }

    return planCopy({
      fromCohortId, toCohortId, from, to, shiftDays, uid,
      lessons: data?.lessons !== false, assignments: data?.assignments !== false, subjects: data?.subjects !== false,
      dryRun: data?.dryRun !== false,
    })
  })
