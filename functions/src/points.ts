import { admin, functions, db, requireTeacherOrAdmin } from './lib'
import { sendPush, pushToTeachersAndAdmins } from './notifications'

// ─────────────────────────────────────────────────────────────────────────────
// processRedemption — validate and record a prize claim
// ─────────────────────────────────────────────────────────────────────────────

export const processRedemption = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.')

  const { prizeId } = data as { prizeId: string }
  const uid = context.auth.uid

  const prizeRef  = db.collection('prizes').doc(prizeId)
  const userRef   = db.collection('users').doc(uid)

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

export const recalculateProgress = functions.https.onCall(async (data, context) => {
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
      const tokens: string[] = userSnap.data()?.fcmTokens ?? []
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
// onPrizeClaimed — push teachers/admins when a student claims a prize
// ─────────────────────────────────────────────────────────────────────────────

export const onPrizeClaimed = functions.firestore
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

export const fulfillClaim = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.')
  const role = (context.auth.token as any).role
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

  // Push notification to student
  const studentSnap = await db.collection('users').doc(claim.studentId as string).get()
  const tokens: string[] = studentSnap.data()?.fcmTokens ?? []
  if (tokens.length > 0) {
    const prizeSnap = await db.collection('prizes').doc(claim.prizeId as string).get()
    const prizeTitle = prizeSnap.data()?.title ?? 'your prize'
    if (action === 'fulfilled') {
      await sendPush(tokens, {
        title: '🎉 Prize ready!',
        body:  `Your claim for "${prizeTitle}" has been fulfilled. Enjoy!`,
        url:   '/prizes',
        tag:   'prize-claim',
      })
    } else {
      await sendPush(tokens, {
        title: '❌ Prize claim rejected',
        body:  `Your claim for "${prizeTitle}" was rejected. Your points have been refunded.`,
        url:   '/prizes',
        tag:   'prize-claim',
      })
    }
  }

  return { success: true }
})

// ─────────────────────────────────────────────────────────────────────────────
// applyAbsencePenalties — runs every 15 min; deducts points for students who
// missed a lesson without reporting absence. Skips lessons already processed.
// ─────────────────────────────────────────────────────────────────────────────

export const applyAbsencePenalties = functions.pubsub
  .schedule('every 15 minutes')
  .onRun(async () => {
    const now     = admin.firestore.Timestamp.now()
    // Look back up to 7 days to catch any missed windows
    const cutoff  = admin.firestore.Timestamp.fromMillis(now.toMillis() - 7 * 24 * 60 * 60 * 1000)

    // Lessons that have already ended
    const lessonsSnap = await db.collection('lessons')
      .where('endTime', '>=', cutoff)
      .where('endTime', '<=', now)
      .get()

    if (lessonsSnap.empty) return

    // Fetch attendance settings once
    const settingsSnap = await db.collection('settings').doc('attendance').get()
    const settings = settingsSnap.data() ?? {}
    const penalty: number = typeof settings.absencePenalty === 'number' ? settings.absencePenalty : -5

    for (const lessonDoc of lessonsSnap.docs) {
      const lesson = lessonDoc.data()

      // Skip if already processed or doesn't require presence
      if (lesson.penaltiesAppliedAt) continue
      if (lesson.requiresPresence === false) {
        await lessonDoc.ref.update({ penaltiesAppliedAt: now })
        continue
      }

      const lessonId = lessonDoc.id
      const cohortId = lesson.cohortId as string | undefined
      if (!cohortId) {
        await lessonDoc.ref.update({ penaltiesAppliedAt: now })
        continue
      }

      // All active students in this cohort
      const studentsSnap = await db.collection('users')
        .where('cohortId', '==', cohortId)
        .where('role', '==', 'student')
        .get()

      if (studentsSnap.empty) {
        await lessonDoc.ref.update({ penaltiesAppliedAt: now })
        continue
      }

      // Who checked in?
      const attendanceSnap = await db.collection('lessons').doc(lessonId).collection('attendance').get()
      const checkedInIds = new Set(attendanceSnap.docs.map(d => d.id))

      // Lesson date string for absence matching
      const lessonDate: Date = (lesson.endTime as admin.firestore.Timestamp).toDate()
      const dateStr = lessonDate.toISOString().slice(0, 10)

      // Absence reports for this lesson's date in this cohort
      const absenceSnap = await db.collection('absence_reports')
        .where('cohortId', '==', cohortId)
        .where('date', '==', dateStr)
        .get()

      const absenceByStudent = new Map<string, boolean>()
      for (const aDoc of absenceSnap.docs) {
        const a = aDoc.data()
        const sid: string = a.studentId
        // Full-day absence counts for any lesson that day
        if (a.type === 'full_day') {
          absenceByStudent.set(sid, true)
        } else if (a.type === 'lesson' && a.lessonId === lessonId) {
          absenceByStudent.set(sid, true)
        }
      }

      // Apply penalty to students who didn't check in and have no absence report
      const batch = db.batch()
      let penaltyCount = 0

      for (const studentDoc of studentsSnap.docs) {
        const uid = studentDoc.id
        if (checkedInIds.has(uid)) continue       // checked in — no penalty
        if (absenceByStudent.get(uid)) continue   // reported absence — no penalty

        // Deduct points
        const userData = studentDoc.data()
        const currentPoints: number = userData.totalPoints ?? 0
        batch.update(studentDoc.ref, { totalPoints: currentPoints + penalty })

        // Log the deduction
        const logRef = db.collection('points_log').doc()
        batch.set(logRef, {
          studentId:   uid,
          delta:       penalty,
          reason:      'absence_penalty',
          referenceId: lessonId,
          lessonTitle: lesson.title ?? null,
          awardedAt:   now,
        })

        penaltyCount++
      }

      // Mark lesson as processed
      batch.update(lessonDoc.ref, { penaltiesAppliedAt: now })

      await batch.commit()
      if (penaltyCount > 0) {
        console.log(`applyAbsencePenalties: lesson ${lessonId} — applied penalty to ${penaltyCount} students`)
      }
    }
  })
