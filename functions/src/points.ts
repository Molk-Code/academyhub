import { admin, functions, db, requireTeacherOrAdmin, LIMITS, requireMember, REGION } from './lib'
import { sendPush, saveNotifications, pushToTeachersAndAdmins, tokensFor } from './notifications-core'
import { writePoints, isDryRun, recordRun, stockholmDate } from './jobs'

// ─────────────────────────────────────────────────────────────────────────────
// processRedemption — validate and record a prize claim
// ─────────────────────────────────────────────────────────────────────────────

export const processRedemption = functions.region(REGION).runWith(LIMITS).https.onCall(async (data, context) => {
  await requireMember(context)

  const { prizeId } = data as { prizeId: string }
  const uid = context.auth!.uid

  const prizeRef  = db.collection('prizes').doc(prizeId)
  const userRef   = db.collection('users').doc(uid)

  // Many students redeeming the same prize at once contend on one document;
  // the SDK retries, and if it still loses, say "busy" rather than "internal"
  await db.runTransaction(async (tx) => {
    const prizeSnap = await tx.get(prizeRef)
    const userSnap  = await tx.get(userRef)

    if (!prizeSnap.exists) throw new functions.https.HttpsError('not-found', 'Prize not found.')
    if (!userSnap.exists)  throw new functions.https.HttpsError('not-found', 'User not found.')

    const prize = prizeSnap.data()!
    const user  = userSnap.data()!

    if (!prize.isActive) throw new functions.https.HttpsError('unavailable', 'Prize is not active.')
    if (prize.quantity !== null && prize.quantityClaimed >= prize.quantity) {
      throw new functions.https.HttpsError('resource-exhausted', 'Prize is sold out.')
    }

    const balance = (user.totalPoints as number) - (user.pointsRedeemed as number)
    if (balance < prize.pointsCost) {
      throw new functions.https.HttpsError('failed-precondition', 'Insufficient points.')
    }

    // Record claim
    const claimRef = db.collection('prize_claims').doc()
    tx.set(claimRef, {
      prizeId,
      studentId:   uid,
      pointsSpent: prize.pointsCost,
      status:      'pending',
      claimedAt:   admin.firestore.FieldValue.serverTimestamp(),
      fulfilledAt: null,
      fulfilledBy: null,
      notes:       null,
    })

    // Deduct from user
    tx.update(userRef, {
      pointsRedeemed: admin.firestore.FieldValue.increment(prize.pointsCost),
    })

    // Increment claimed count on prize
    tx.update(prizeRef, {
      quantityClaimed: admin.firestore.FieldValue.increment(1),
    })

    // Points log
    const logRef = db.collection('points_log').doc()
    tx.set(logRef, {
      studentId:   uid,
      points:      -prize.pointsCost,
      reason:      'redemption',
      referenceId: claimRef.id,
      awardedBy:   null,
      createdAt:   admin.firestore.FieldValue.serverTimestamp(),
    })
  }).catch((err: any) => {
    if (err instanceof functions.https.HttpsError) throw err
    // gRPC 10 = ABORTED (too much contention after the SDK's retries)
    if (err?.code === 10 || err?.code === 'aborted') {
      throw new functions.https.HttpsError('unavailable', 'Lots of people are claiming right now — try again in a moment.')
    }
    throw err
  })

  return { success: true }
})

// ─────────────────────────────────────────────────────────────────────────────
// updateProgress — recalculate and write progress/{studentId}
// (internal helper, also exported as a callable for manual triggering)
// ─────────────────────────────────────────────────────────────────────────────

export async function updateProgress(studentId: string, cohortId: string) {
  const [assignmentsSnap, submissionsSnap, subjectsSnap] = await Promise.all([
    db.collection('assignments').where('cohortId', '==', cohortId).get(),
    db.collection('submissions').where('studentId', '==', studentId).get(),
    db.collection('subjects').get(),
  ])

  const assignments = assignmentsSnap.docs.map(d => ({ id: d.id, ...d.data() })) as any[]
  const submissions = submissionsSnap.docs.map(d => ({ id: d.id, ...d.data() })) as any[]
  const subjects    = subjectsSnap.docs.map(d => ({ id: d.id, ...d.data() })) as any[]

  const gradedSubmissionMap: Record<string, any> = {}
  for (const sub of submissions) {
    if (sub.status === 'graded') gradedSubmissionMap[sub.assignmentId] = sub
  }

  const totalAssignments    = assignments.length
  const completedAssignments = Object.keys(gradedSubmissionMap).length
  const tests               = assignments.filter(a => a.type === 'test')
  const passedTests         = tests.filter(t => gradedSubmissionMap[t.id]?.passed === true).length
  const overallPct          = totalAssignments > 0 ? Math.round((completedAssignments / totalAssignments) * 100) : 0

  const subjectProgress: Record<string, { completed: number; total: number; percentage: number }> = {}
  for (const subject of subjects) {
    const subjectAssignments = assignments.filter(a => a.subjectId === subject.id)
    const completed          = subjectAssignments.filter(a => gradedSubmissionMap[a.id]).length
    const total              = subjectAssignments.length
    subjectProgress[subject.id] = {
      completed,
      total,
      percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
    }
  }

  await db.collection('progress').doc(studentId).set({
    studentId,
    cohortId,
    totalAssignments,
    completedAssignments,
    passedTests,
    totalTests: tests.length,
    overallPercentage: overallPct,
    subjectProgress,
    streakDays: 0, // streak logic omitted for brevity — update via activity tracking
    lastActivityAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt:      admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true })
}

export const recalculateProgress = functions.region(REGION).runWith(LIMITS).https.onCall(async (data, context) => {
  requireTeacherOrAdmin(context)
  const { studentId, cohortId } = data as { studentId: string; cohortId: string }
  if (!studentId || typeof studentId !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'studentId is required.')
  }
  await updateProgress(studentId, cohortId)
  return { success: true }
})

// ─────────────────────────────────────────────────────────────────────────────
// checkLevelUp — detect and notify when a student reaches a new experience level
// ─────────────────────────────────────────────────────────────────────────────

export async function checkLevelUp(uid: string, newTotal: number) {
  try {
    const levelsSnap = await db.collection('settings').doc('experience_levels').get()
    const allLevels = (levelsSnap.data()?.levels ?? []) as { id: string; name: string; pointsRequired: number }[]
    // Only levels with pointsRequired > 0 trigger notifications
    const reachable = allLevels
      .filter(l => l.pointsRequired > 0)
      .sort((a, b) => a.pointsRequired - b.pointsRequired)
    if (reachable.length === 0) return

    const levelName = await db.runTransaction(async tx => {
      const userRef  = db.collection('users').doc(uid)
      const userSnap = await tx.get(userRef)
      if (!userSnap.exists) return null

      const notifiedIds: string[] = userSnap.data()?.notifiedLevelIds ?? []
      const newlyReached = reachable.filter(l => newTotal >= l.pointsRequired && !notifiedIds.includes(l.id))
      if (newlyReached.length === 0) return null

      const highest = newlyReached[newlyReached.length - 1]
      tx.update(userRef, {
        notifiedLevelIds: admin.firestore.FieldValue.arrayUnion(...newlyReached.map(l => l.id)),
      })

      const notifRef = db.collection('notifications').doc()
      tx.set(notifRef, {
        uid,
        title:     `🎉 New level: ${highest.name}`,
        body:      `You've reached the "${highest.name}" level with ${newTotal} points. Keep it up!`,
        url:       '/dashboard',
        isRead:    false,
        type:      'level_up',
        levelName: highest.name,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      })

      return highest.name
    })

    if (levelName) {
      const userSnap = await db.collection('users').doc(uid).get()
      const tokens: string[] = await tokensFor([userSnap.id])
      await sendPush(tokens, {
        title: `🎉 New level: ${levelName}`,
        body:  `You've reached the "${levelName}" level with ${newTotal} points!`,
        url:   '/dashboard',
        tag:   'level-up',
      })
    }
  } catch (err: any) {
    console.error('checkLevelUp error', err?.message)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// awardPoints — teacher/admin adjusts a student's points and writes the log entry
// ─────────────────────────────────────────────────────────────────────────────

export const awardPoints = functions.region(REGION).runWith(LIMITS).https.onCall(async (data, context) => {
  requireTeacherOrAdmin(context)

  const { studentId, points, reason, referenceId } = data as {
    studentId: string
    points: number
    reason: string
    referenceId?: string
  }

  if (!studentId || typeof points !== 'number') {
    throw new functions.https.HttpsError('invalid-argument', 'studentId and points are required.')
  }

  await db.runTransaction(async tx => {
    const userRef = db.collection('users').doc(studentId)
    const logRef  = db.collection('points_log').doc()
    tx.update(userRef, { totalPoints: admin.firestore.FieldValue.increment(points) })
    tx.set(logRef, {
      studentId,
      points,
      reason,
      referenceId: referenceId ?? null,
      awardedBy:   context.auth!.uid,
      createdAt:   admin.firestore.FieldValue.serverTimestamp(),
    })
  })

  const newTotal = ((await db.collection('users').doc(studentId).get()).data()?.totalPoints ?? 0) as number
  await checkLevelUp(studentId, newTotal)

  return { success: true }
})

// ─────────────────────────────────────────────────────────────────────────────
// onPrizeClaimed — push teachers/admins when a student claims a prize
// ─────────────────────────────────────────────────────────────────────────────

export const onPrizeClaimed = functions.region(REGION).runWith(LIMITS).firestore
  .document('prize_claims/{claimId}')
  .onCreate(async (snap) => {
    const claim = snap.data()
    if (claim.status !== 'pending') return null

    const [studentSnap, prizeSnap] = await Promise.all([
      db.collection('users').doc(claim.studentId as string).get(),
      db.collection('prizes').doc(claim.prizeId as string).get(),
    ])
    const studentName = studentSnap.data()?.displayName ?? 'A student'
    const prizeTitle  = prizeSnap.data()?.title ?? 'a prize'

    await pushToTeachersAndAdmins(
      '🎁 New prize claim',
      `${studentName} wants to claim "${prizeTitle}"`,
      '/teacher/prizes',
    )
    return null
  })

// ─────────────────────────────────────────────────────────────────────────────
// fulfillClaim — teacher/admin fulfils or rejects a prize claim
// ─────────────────────────────────────────────────────────────────────────────

export const fulfillClaim = functions.region(REGION).runWith(LIMITS).https.onCall(async (data, context) => {
  await requireMember(context)
  const role = (context.auth!.token as any).role
  if (role !== 'teacher' && role !== 'admin') {
    throw new functions.https.HttpsError('permission-denied', 'Teachers and admins only.')
  }

  const { claimId, action } = data as { claimId: string; action: 'fulfilled' | 'rejected' }
  if (!claimId) throw new functions.https.HttpsError('invalid-argument', 'claimId required.')
  if (action !== 'fulfilled' && action !== 'rejected') {
    throw new functions.https.HttpsError('invalid-argument', 'action must be fulfilled or rejected.')
  }

  const claimRef  = db.collection('prize_claims').doc(claimId)
  const claimSnap = await claimRef.get()
  if (!claimSnap.exists) throw new functions.https.HttpsError('not-found', 'Claim not found.')

  const claim = claimSnap.data()!
  if (claim.status !== 'pending') {
    throw new functions.https.HttpsError('failed-precondition', 'Claim is no longer pending.')
  }

  await db.runTransaction(async (tx) => {
    if (action === 'fulfilled') {
      tx.update(claimRef, {
        status:      'fulfilled',
        fulfilledAt: admin.firestore.FieldValue.serverTimestamp(),
        fulfilledBy: context.auth!.uid,
      })
    } else {
      tx.update(claimRef, {
        status:      'rejected',
        fulfilledAt: admin.firestore.FieldValue.serverTimestamp(),
        fulfilledBy: context.auth!.uid,
      })
      // Refund points to student
      tx.update(db.collection('users').doc(claim.studentId), {
        pointsRedeemed: admin.firestore.FieldValue.increment(-(claim.pointsSpent as number)),
      })
      // Decrement claimed count on prize
      tx.update(db.collection('prizes').doc(claim.prizeId), {
        quantityClaimed: admin.firestore.FieldValue.increment(-1),
      })
      // Refund log entry
      const logRef = db.collection('points_log').doc()
      tx.set(logRef, {
        studentId:   claim.studentId,
        points:      claim.pointsSpent,
        reason:      'redemption_refund',
        referenceId: claimId,
        awardedBy:   context.auth!.uid,
        createdAt:   admin.firestore.FieldValue.serverTimestamp(),
      })
    }
  })

  // Notify student — in-app always, push only if they have a registered device
  const studentSnap = await db.collection('users').doc(claim.studentId as string).get()
  const tokens: string[] = await tokensFor([studentSnap.id])
  const prizeSnap = await db.collection('prizes').doc(claim.prizeId as string).get()
  const prizeTitle = prizeSnap.data()?.title ?? 'your prize'
  const opts = action === 'fulfilled'
    ? { title: '🎉 Prize ready!', body: `Your claim for "${prizeTitle}" has been fulfilled. Enjoy!`, url: '/prizes' }
    : { title: '❌ Prize claim rejected', body: `Your claim for "${prizeTitle}" was rejected. Your points have been refunded.`, url: '/prizes' }
  await Promise.all([
    tokens.length > 0 ? sendPush(tokens, { ...opts, tag: 'prize-claim' }) : Promise.resolve(),
    saveNotifications([claim.studentId as string], opts),
  ])

  return { success: true }
})

// ─────────────────────────────────────────────────────────────────────────────
// applyAbsencePenalties — runs every 15 min; deducts points for students who
// missed a lesson without reporting absence.
//
// Safe to run again: each deduction's log id is absence_penalty__{lesson}__{student},
// so a lesson processed twice (overlapping runs, a retry) deducts once.
// Dry run (settings/jobs.dryRun.absencePenalties): calculates and records the
// result in job_runs and deducts nothing. Each lesson is reported once
// (penaltiesDryRunAt); switch dry run off and the next run applies lessons
// from the last 7 days for real.
// ─────────────────────────────────────────────────────────────────────────────

export interface PenaltyInput {
  lessonId: string
  lessonEnd: Date
  lessonDate: string                        // Swedish date of the lesson, YYYY-MM-DD
  students: { id: string; isActive?: boolean; enrolledAt?: Date | null }[]
  checkedInIds: Set<string>
  absences: { studentId: string; type: string; lessonId?: string | null; date: string }[]
  penalty: number
}

// Who gets the penalty for one lesson. No I/O, so it is unit-testable.
export function planAbsencePenalties(p: PenaltyInput): string[] {
  const excused = new Set(
    p.absences
      .filter(a => a.date === p.lessonDate && (a.type === 'full_day' || (a.type === 'lesson' && a.lessonId === p.lessonId)))
      .map(a => a.studentId),
  )
  if (p.penalty === 0) return []
  return p.students
    .filter(s => s.isActive !== false)
    .filter(s => !s.enrolledAt || s.enrolledAt <= p.lessonEnd)   // not yet in the class
    .filter(s => !p.checkedInIds.has(s.id) && !excused.has(s.id))
    .map(s => s.id)
}

export async function runAbsencePenalties(opts: { now?: Date; dryRun?: boolean } = {}) {
  const now    = admin.firestore.Timestamp.fromDate(opts.now ?? new Date())
  const dryRun = !!opts.dryRun
  // Look back up to 7 days to catch any missed windows
  const cutoff = admin.firestore.Timestamp.fromMillis(now.toMillis() - 7 * 24 * 60 * 60 * 1000)

  const lessonsSnap = await db.collection('lessons')
    .where('endTime', '>=', cutoff)
    .where('endTime', '<=', now)
    .get()

  const settings = (await db.collection('settings').doc('attendance').get()).data() ?? {}
  const penalty: number = typeof settings.absencePenalty === 'number' ? settings.absencePenalty : -5

  const summary = { dryRun, lessons: 0, applied: 0, skipped: 0, entries: [] as { lessonId: string; studentId: string; points: number }[] }

  for (const lessonDoc of lessonsSnap.docs) {
    const lesson = lessonDoc.data()
    if (lesson.penaltiesAppliedAt) continue
    if (dryRun && lesson.penaltiesDryRunAt) continue   // already reported; a real run still processes it
    const lessonId = lessonDoc.id
    const cohortId = lesson.cohortId as string | undefined

    let studentIds: string[] = []
    if (lesson.requiresPresence !== false && cohortId) {
      const lessonEnd: Date = (lesson.endTime as admin.firestore.Timestamp).toDate()
      const lessonDate = stockholmDate(((lesson.startTime ?? lesson.endTime) as admin.firestore.Timestamp).toDate())
      const [studentsSnap, attendanceSnap, absenceSnap] = await Promise.all([
        db.collection('users').where('cohortId', '==', cohortId).where('role', '==', 'student').get(),
        db.collection('lessons').doc(lessonId).collection('attendance').get(),
        db.collection('absence_reports').where('cohortId', '==', cohortId).where('date', '==', lessonDate).get(),
      ])
      studentIds = planAbsencePenalties({
        lessonId, lessonEnd, lessonDate, penalty,
        students: studentsSnap.docs.map(d => ({
          id: d.id,
          isActive: d.data().isActive,
          enrolledAt: d.data().enrolledAt?.toDate?.() ?? null,
        })),
        checkedInIds: new Set(attendanceSnap.docs.map(d => d.id)),
        absences: absenceSnap.docs.map(d => d.data() as PenaltyInput['absences'][number]),
      })
    }

    const res = await writePoints(studentIds.map(studentId => ({
      studentId,
      points: penalty,
      reason: 'absence_penalty',
      referenceId: lessonId,
      extra: { lessonTitle: lesson.title ?? null },
    })), { dryRun })

    summary.lessons++
    summary.applied += res.applied.length
    summary.skipped += res.skipped.length
    summary.entries.push(...res.applied.map(e => ({ lessonId, studentId: e.studentId, points: e.points })))
    await lessonDoc.ref.update(dryRun ? { penaltiesDryRunAt: now } : { penaltiesAppliedAt: now })
  }

  if (summary.lessons > 0) {
    // Keep the run log small: the entries list only matters for a dry run
    await recordRun('absencePenalties', dryRun ? summary : { ...summary, entries: summary.entries.slice(0, 50) })
  }
  return summary
}

export const applyAbsencePenalties = functions.region(REGION).runWith(LIMITS).pubsub
  .schedule('every 15 minutes')
  .onRun(async () => {
    const summary = await runAbsencePenalties({ dryRun: await isDryRun('absencePenalties') })
    if (summary.applied > 0) {
      console.log(`applyAbsencePenalties: ${summary.dryRun ? '[dry run] would apply' : 'applied'} ${summary.applied} penalties over ${summary.lessons} lessons`)
    }
  })
