import * as admin from 'firebase-admin'
import * as functions from 'firebase-functions'

admin.initializeApp()
const db = admin.firestore()

// ─────────────────────────────────────────────────────────────────────────────
// onUserCreate — set custom claims from invitation
// ─────────────────────────────────────────────────────────────────────────────

export const onUserCreate = functions.auth.user().onCreate(async (user) => {
  // Find an unused invitation matching this email
  const snap = await db.collection('invitations')
    .where('email', '==', user.email)
    .where('used', '==', false)
    .limit(1)
    .get()

  if (snap.empty) {
    // No invite — set default inactive student role
    await admin.auth().setCustomUserClaims(user.uid, { role: 'student', cohortId: null })
    return
  }

  const inviteDoc = snap.docs[0]
  const invite    = inviteDoc.data()

  // Set custom claims so Firestore rules work immediately
  await admin.auth().setCustomUserClaims(user.uid, {
    role:     invite.role     ?? 'student',
    cohortId: invite.cohortId ?? null,
  })

  // Mark invite as used
  await inviteDoc.ref.update({ used: true, usedBy: user.uid, usedAt: admin.firestore.FieldValue.serverTimestamp() })
})

// ─────────────────────────────────────────────────────────────────────────────
// getTestQuestions — strips correct answers before sending to students
// ─────────────────────────────────────────────────────────────────────────────

export const getTestQuestions = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.')

  const { assignmentId } = data as { assignmentId: string }
  if (!assignmentId) throw new functions.https.HttpsError('invalid-argument', 'assignmentId required.')

  // Load test
  const testSnap = await db.collection('tests')
    .where('assignmentId', '==', assignmentId)
    .limit(1)
    .get()

  if (testSnap.empty) throw new functions.https.HttpsError('not-found', 'Test not found.')

  const test = testSnap.docs[0].data()

  // Check attempt limit
  const uid = context.auth.uid
  const attemptsSnap = await db.collection('submissions')
    .where('assignmentId', '==', assignmentId)
    .where('studentId',    '==', uid)
    .get()

  if (attemptsSnap.size >= (test.maxAttempts ?? 1)) {
    throw new functions.https.HttpsError('resource-exhausted', 'Maximum attempts reached.')
  }

  // Strip correct answers
  let questions = (test.questions as any[]).map(q => ({
    id:      q.id,
    text:    q.text,
    type:    q.type,
    options: q.options,
    points:  q.points,
    // correctAnswer intentionally omitted
  }))

  // Shuffle if requested
  if (test.shuffleQuestions) {
    questions = questions.sort(() => Math.random() - 0.5)
  }

  return {
    testId:           testSnap.docs[0].id,
    timeLimitMinutes: test.timeLimitMinutes ?? null,
    questions,
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// gradeSubmission — auto-grade a test or record manual grade; award points
// ─────────────────────────────────────────────────────────────────────────────

export const gradeSubmission = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.')

  const { submissionId, score, feedback } = data as {
    submissionId: string; score: number; feedback?: string
  }

  const subRef  = db.collection('submissions').doc(submissionId)
  const subSnap = await subRef.get()
  if (!subSnap.exists) throw new functions.https.HttpsError('not-found', 'Submission not found.')

  const sub        = subSnap.data()!
  const assignment = (await db.collection('assignments').doc(sub.assignmentId).get()).data()!

  const maxScore       = assignment.pointsValue as number
  const passingScore   = assignment.passingScore as number | null
  const percentScore   = Math.round((score / maxScore) * 100)
  const passed         = passingScore !== null ? percentScore >= passingScore : null
  const pointsAwarded  = passed !== false ? assignment.pointsValue : 0

  await db.runTransaction(async (tx) => {
    // Update submission
    tx.update(subRef, {
      status:         'graded',
      score,
      maxScore,
      percentageScore: percentScore,
      passed,
      feedback:        feedback ?? null,
      gradedBy:        context.auth!.uid,
      gradedAt:        admin.firestore.FieldValue.serverTimestamp(),
      pointsAwarded,
    })

    // Log points
    if (pointsAwarded > 0) {
      const logRef = db.collection('points_log').doc()
      tx.set(logRef, {
        studentId:   sub.studentId,
        points:      pointsAwarded,
        reason:      sub.type === 'test' ? 'test_pass' : 'assignment_graded',
        referenceId: submissionId,
        awardedBy:   context.auth!.uid,
        createdAt:   admin.firestore.FieldValue.serverTimestamp(),
      })

      // Update denormalized total on user doc
      const userRef = db.collection('users').doc(sub.studentId)
      tx.update(userRef, {
        totalPoints: admin.firestore.FieldValue.increment(pointsAwarded),
      })
    }
  })

  // Update progress document (outside transaction for simplicity)
  await updateProgress(sub.studentId, sub.cohortId)

  return { success: true, pointsAwarded }
})

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

async function updateProgress(studentId: string, cohortId: string) {
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
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.')
  const { studentId, cohortId } = data as { studentId: string; cohortId: string }
  await updateProgress(studentId, cohortId)
  return { success: true }
})
