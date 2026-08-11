import * as admin from 'firebase-admin'
import * as functions from 'firebase-functions/v1'
import { Resend } from 'resend'
import * as PDFDocumentLib from 'pdfkit'
import * as path from 'path'
const PDFDocument = PDFDocumentLib as unknown as typeof import('pdfkit')

admin.initializeApp()
const db = admin.firestore()

function getResend() {
  return new Resend(process.env.RESEND_API_KEY)
}

// Escape user-supplied content before inserting into HTML strings
function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function requireTeacherOrAdmin(context: functions.https.CallableContext): void {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.')
  const r = context.auth.token.role
  if (r !== 'teacher' && r !== 'admin') {
    throw new functions.https.HttpsError('permission-denied', 'Only teachers and admins can perform this action.')
  }
}

async function getEmailConfig() {
  const snap = await db.collection('email_config').doc('global').get()
  return snap.exists
    ? snap.data() as { foodBoxEmail: string; minivanEmail: string; fromName: string; fromEmail: string }
    : null
}

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

  // Reject expired invitations
  if (invite.expiresAt && invite.expiresAt.toDate() < new Date()) {
    await admin.auth().setCustomUserClaims(user.uid, { role: 'student', cohortId: null })
    return
  }

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
// checkInAttendance — validate rotating QR token and record student presence
// ─────────────────────────────────────────────────────────────────────────────

export const checkInAttendance = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.')

  const { token } = data as { token: string }
  if (!token || typeof token !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'token is required.')
  }

  const uid = context.auth.uid

  try {
    const sessionSnap = await db.collection('attendance_sessions')
      .where('token', '==', token)
      .limit(1)
      .get()

    if (sessionSnap.empty) {
      throw new functions.https.HttpsError('not-found', 'Invalid QR code. Ask your teacher to refresh it.')
    }

    const sessionDoc = sessionSnap.docs[0]
    const session    = sessionDoc.data()

    if (!session.isActive) {
      throw new functions.https.HttpsError('failed-precondition', 'This attendance session is no longer active.')
    }

    const now     = admin.firestore.Timestamp.now()
    const expired = session.expiresAt.toMillis() < now.toMillis()

    if (expired) {
      throw new functions.https.HttpsError('deadline-exceeded', 'QR code expired. Ask your teacher to refresh it.')
    }

    const lessonId      = session.lessonId as string
    const attendanceRef = db.collection('lessons').doc(lessonId).collection('attendance').doc(uid)

    const existing = await attendanceRef.get()

    if (existing.exists) {
      throw new functions.https.HttpsError('already-exists', 'You have already checked in to this lesson.')
    }

    const [userSnap, settingsSnap] = await Promise.all([
      db.collection('users').doc(uid).get(),
      db.collection('settings').doc('attendance').get(),
    ])

    const displayName     = userSnap.exists ? (userSnap.data()?.displayName ?? 'Student') : 'Student'
    const pointsPerCheckIn: number = settingsSnap.exists ? (settingsSnap.data()?.pointsPerCheckIn ?? 0) : 0

    await attendanceRef.set({
      studentId:     uid,
      displayName,
      checkedInAt:   admin.firestore.FieldValue.serverTimestamp(),
      sessionId:     sessionDoc.id,
      pointsAwarded: pointsPerCheckIn,
    })

    if (pointsPerCheckIn > 0) {
      await db.runTransaction(async (tx) => {
        const logRef = db.collection('points_log').doc()
        tx.set(logRef, {
          studentId:   uid,
          points:      pointsPerCheckIn,
          reason:      'attendance',
          referenceId: attendanceRef.id,
          awardedBy:   null,
          createdAt:   admin.firestore.FieldValue.serverTimestamp(),
        })
        tx.update(db.collection('users').doc(uid), {
          totalPoints: admin.firestore.FieldValue.increment(pointsPerCheckIn),
        })
      })
      const newTotal = ((await db.collection('users').doc(uid).get()).data()?.totalPoints ?? 0) as number
      await checkLevelUp(uid, newTotal)
    }

    return { success: true, lessonId, pointsAwarded: pointsPerCheckIn }

  } catch (err: any) {
    console.error('checkInAttendance error:', err?.code, err?.message)
    if (err instanceof functions.https.HttpsError) throw err
    throw new functions.https.HttpsError('internal', err?.message ?? 'Unknown error')
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// gradeSubmission — auto-grade a test or record manual grade; award points
// ─────────────────────────────────────────────────────────────────────────────

export const gradeSubmission = functions.https.onCall(async (data, context) => {
  requireTeacherOrAdmin(context)

  const { submissionId, score, feedback } = data as {
    submissionId: string; score: number; feedback?: string
  }
  if (!submissionId || typeof submissionId !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'submissionId is required.')
  }
  if (typeof score !== 'number' || score < 0 || !isFinite(score)) {
    throw new functions.https.HttpsError('invalid-argument', 'score must be a non-negative number.')
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

  if (pointsAwarded > 0) {
    const newTotal = ((await db.collection('users').doc(sub.studentId).get()).data()?.totalPoints ?? 0) as number
    await checkLevelUp(sub.studentId as string, newTotal)
  }

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
  requireTeacherOrAdmin(context)
  const { studentId, cohortId } = data as { studentId: string; cohortId: string }
  if (!studentId || typeof studentId !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'studentId is required.')
  }
  await updateProgress(studentId, cohortId)
  return { success: true }
})

// ─────────────────────────────────────────────────────────────────────────────
// submitTestAnswers — auto-grade objective questions, queue short answers
// ─────────────────────────────────────────────────────────────────────────────

export const submitTestAnswers = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.')

  const { assignmentId, answers, timeTakenSeconds } = data as {
    assignmentId: string
    answers: Array<{ questionId: string; answer?: string; answers?: string[] }>
    timeTakenSeconds?: number
  }

  const uid = context.auth.uid

  // Load assignment
  const assignSnap = await db.collection('assignments').doc(assignmentId).get()
  if (!assignSnap.exists) throw new functions.https.HttpsError('not-found', 'Assignment not found.')
  const assignment = assignSnap.data()!

  // Load test (has correct answers)
  const testSnap = await db.collection('tests')
    .where('assignmentId', '==', assignmentId)
    .limit(1)
    .get()
  if (testSnap.empty) throw new functions.https.HttpsError('not-found', 'Test not found.')
  const test = testSnap.docs[0].data()

  // Check attempt limit
  const attemptsSnap = await db.collection('submissions')
    .where('assignmentId', '==', assignmentId)
    .where('studentId', '==', uid)
    .get()
  if (attemptsSnap.size >= (test.maxAttempts ?? 1)) {
    throw new functions.https.HttpsError('resource-exhausted', 'Maximum attempts reached.')
  }

  // Grade each question
  const gradedAnswers: any[] = []
  let autoScore = 0
  let totalPoints = 0
  let hasPendingReview = false

  for (const q of test.questions as any[]) {
    const studentAns = answers.find((a: any) => a.questionId === q.id)
    totalPoints += q.points

    if (q.type === 'short_answer') {
      hasPendingReview = true
      gradedAnswers.push({
        questionId:    q.id,
        answer:        studentAns?.answer ?? '',
        isCorrect:     null,
        pointsAwarded: null,
      })
    } else if (q.type === 'multiple_select') {
      const correct  = new Set<string>(q.correctAnswers ?? [])
      const given    = new Set<string>(studentAns?.answers ?? [])
      const isCorrect = correct.size === given.size && [...correct].every(c => given.has(c))
      const pts = isCorrect ? q.points : 0
      autoScore += pts
      gradedAnswers.push({
        questionId:    q.id,
        answers:       studentAns?.answers ?? [],
        isCorrect,
        pointsAwarded: pts,
      })
    } else {
      // multiple_choice or true_false
      const isCorrect = (studentAns?.answer ?? '') === q.correctAnswer
      const pts = isCorrect ? q.points : 0
      autoScore += pts
      gradedAnswers.push({
        questionId:    q.id,
        answer:        studentAns?.answer ?? '',
        isCorrect,
        pointsAwarded: pts,
      })
    }
  }

  const passingScore   = assignment.passingScore as number | null
  const status         = hasPendingReview ? 'submitted' : 'graded'
  const percentageScore = hasPendingReview
    ? null
    : totalPoints > 0 ? Math.round((autoScore / totalPoints) * 100) : 0
  const passed = (passingScore !== null && percentageScore !== null)
    ? percentageScore >= passingScore
    : null

  const subRef = db.collection('submissions').doc()
  const batch  = db.batch()

  batch.set(subRef, {
    assignmentId,
    studentId:      uid,
    cohortId:       assignment.cohortId,
    type:           'test',
    status,
    testAnswers:    gradedAnswers,
    submittedAt:    admin.firestore.FieldValue.serverTimestamp(),
    gradedAt:       hasPendingReview ? null : admin.firestore.FieldValue.serverTimestamp(),
    gradedBy:       hasPendingReview ? null : 'auto',
    score:          hasPendingReview ? null : autoScore,
    maxScore:       totalPoints,
    percentageScore,
    passed,
    feedback:       null,
    resources:      [],
    attemptNumber:  attemptsSnap.size + 1,
    pointsAwarded:  null,
    timeTakenSeconds: timeTakenSeconds ?? null,
  })

  await batch.commit()

  // If fully auto-graded and passed, award points
  if (!hasPendingReview && passed === true) {
    const pointsToAward = assignment.pointsValue as number
    await db.runTransaction(async (tx) => {
      const logRef = db.collection('points_log').doc()
      tx.set(logRef, {
        studentId:   uid,
        points:      pointsToAward,
        reason:      'test_pass',
        referenceId: subRef.id,
        awardedBy:   'auto',
        createdAt:   admin.firestore.FieldValue.serverTimestamp(),
      })
      tx.update(db.collection('users').doc(uid), {
        totalPoints: admin.firestore.FieldValue.increment(pointsToAward),
      })
      tx.update(subRef, { pointsAwarded: pointsToAward })
    })
    await updateProgress(uid, assignment.cohortId as string)
    const newTotal = ((await db.collection('users').doc(uid).get()).data()?.totalPoints ?? 0) as number
    await checkLevelUp(uid, newTotal)
  }

  return { submissionId: subRef.id, percentageScore, passed }
})

// ─────────────────────────────────────────────────────────────────────────────
// resetPassword — admin sets a new password for any non-admin user
// ─────────────────────────────────────────────────────────────────────────────

export const resetPassword = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.')
  if (context.auth.token.role !== 'admin') {
    throw new functions.https.HttpsError('permission-denied', 'Only admins can reset passwords.')
  }

  const { uid, newPassword } = data as { uid: string; newPassword: string }
  if (!uid)                               throw new functions.https.HttpsError('invalid-argument', 'uid is required.')
  if (!newPassword || newPassword.length < 6) throw new functions.https.HttpsError('invalid-argument', 'Password must be at least 6 characters.')

  // Prevent resetting another admin's password
  const target = await admin.auth().getUser(uid)
  if ((target.customClaims as any)?.role === 'admin') {
    throw new functions.https.HttpsError('permission-denied', "Cannot reset another admin's password.")
  }

  await admin.auth().updateUser(uid, { password: newPassword })
  return { success: true }
})

// ─────────────────────────────────────────────────────────────────────────────
// gradeShortAnswers — teacher marks short-answer questions correct/incorrect
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// purgeChatMessages — delete messages older than the configured retention window
// ─────────────────────────────────────────────────────────────────────────────

export const purgeChatMessages = functions.pubsub.schedule('every 24 hours').onRun(async () => {
  const settingsSnap = await db.collection('chat_settings').doc('global').get()
  if (!settingsSnap.exists) return null

  const retentionDays: number | null = settingsSnap.data()?.retentionDays ?? null
  if (retentionDays === null) return null  // "Forever" — nothing to delete

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - retentionDays)
  const cutoffTs = admin.firestore.Timestamp.fromDate(cutoff)

  const channelsSnap = await db.collection('chat_channels').get()
  for (const channelDoc of channelsSnap.docs) {
    const oldMessages = await channelDoc.ref
      .collection('messages')
      .where('createdAt', '<', cutoffTs)
      .get()
    const batch = db.batch()
    oldMessages.docs.forEach(d => batch.delete(d.ref))
    if (!oldMessages.empty) await batch.commit()
  }
  return null
})

// ─────────────────────────────────────────────────────────────────────────────
// gradeShortAnswers — teacher marks short-answer questions correct/incorrect
// ─────────────────────────────────────────────────────────────────────────────

export const gradeShortAnswers = functions.https.onCall(async (data, context) => {
  requireTeacherOrAdmin(context)

  const { submissionId, answers } = data as {
    submissionId: string
    answers: Array<{ questionId: string; isCorrect: boolean }>
  }
  if (!submissionId || typeof submissionId !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'submissionId is required.')
  }

  const subRef  = db.collection('submissions').doc(submissionId)
  const subSnap = await subRef.get()
  if (!subSnap.exists) throw new functions.https.HttpsError('not-found', 'Submission not found.')

  const sub        = subSnap.data()!
  const assignSnap = await db.collection('assignments').doc(sub.assignmentId).get()
  const assignment = assignSnap.data()!

  // Load test to get point values
  const testSnap = await db.collection('tests')
    .where('assignmentId', '==', sub.assignmentId)
    .limit(1)
    .get()
  const test = testSnap.docs[0]?.data()

  // Merge teacher marks into existing gradedAnswers
  const existing = (sub.testAnswers as any[]) ?? []
  const answerMap = Object.fromEntries(answers.map(a => [a.questionId, a.isCorrect]))

  let totalScore = 0
  const updated = existing.map((ga: any) => {
    const overrideMark = answerMap[ga.questionId]
    const q = (test?.questions as any[])?.find((q: any) => q.id === ga.questionId)
    const isCorrect = overrideMark !== undefined ? overrideMark : ga.isCorrect
    const pts = isCorrect ? (q?.points ?? 0) : 0
    totalScore += pts ?? (ga.pointsAwarded ?? 0)
    return { ...ga, isCorrect, pointsAwarded: pts }
  })

  // Recalculate total
  const maxScore = (test?.questions as any[])?.reduce((s: number, q: any) => s + (q.points ?? 0), 0) ?? sub.maxScore
  const percentageScore = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0
  const passingScore    = assignment.passingScore as number | null
  const passed          = passingScore !== null ? percentageScore >= passingScore : null
  const pointsToAward   = passed ? (assignment.pointsValue as number) : 0

  await db.runTransaction(async (tx) => {
    tx.update(subRef, {
      testAnswers:   updated,
      score:         totalScore,
      maxScore,
      percentageScore,
      passed,
      status:        'graded',
      gradedBy:      context.auth!.uid,
      gradedAt:      admin.firestore.FieldValue.serverTimestamp(),
      pointsAwarded: pointsToAward,
    })

    if (pointsToAward > 0) {
      const logRef = db.collection('points_log').doc()
      tx.set(logRef, {
        studentId:   sub.studentId,
        points:      pointsToAward,
        reason:      'test_pass',
        referenceId: submissionId,
        awardedBy:   context.auth!.uid,
        createdAt:   admin.firestore.FieldValue.serverTimestamp(),
      })
      tx.update(db.collection('users').doc(sub.studentId), {
        totalPoints: admin.firestore.FieldValue.increment(pointsToAward),
      })
    }
  })

  await updateProgress(sub.studentId as string, sub.cohortId as string)

  if (pointsToAward > 0) {
    const newTotal = ((await db.collection('users').doc(sub.studentId as string).get()).data()?.totalPoints ?? 0) as number
    await checkLevelUp(sub.studentId as string, newTotal)
  }

  // Push notification to student — test result available
  const studentSnap = await db.collection('users').doc(sub.studentId as string).get()
  const tokens: string[] = studentSnap.data()?.fcmTokens ?? []
  const testOpts = {
    title: passed ? '✅ Test passed!' : '📝 Test result available',
    body:  `You scored ${percentageScore}% on your test.`,
    url:   '/assignments',
  }
  await Promise.all([
    tokens.length > 0 ? sendPush(tokens, { ...testOpts, tag: 'test-result' }) : Promise.resolve(),
    saveNotifications([sub.studentId as string], testOpts),
  ])

  return { success: true, percentageScore, passed }
})

// ─────────────────────────────────────────────────────────────────────────────
// Push notification helpers
// ─────────────────────────────────────────────────────────────────────────────

async function sendPush(
  tokens: string[],
  opts: { title: string; body: string; url?: string; tag?: string },
) {
  if (tokens.length === 0) return
  const uniqueTokens = [...new Set(tokens)]
  try {
    for (let i = 0; i < uniqueTokens.length; i += 500) {
      const chunk = uniqueTokens.slice(i, i + 500)
      const res = await admin.messaging().sendEachForMulticast({
        tokens: chunk,
        // Data-only — no notification field so FCM does not auto-display.
        // The service worker's onBackgroundMessage handler is the sole display path.
        data: {
          title: opts.title,
          body:  opts.body,
          url:   opts.url ?? '/',
          tag:   opts.tag ?? 'cineforge',
        },
        webpush: {
          headers: { Urgency: 'high' },
        },
      })
      const successCount = res.responses.filter(r => r.success).length
      const failCount    = res.responses.filter(r => !r.success).length
      console.log('sendPush result', {
        title: opts.title,
        tokenCount: chunk.length,
        successCount,
        failCount,
        errors: res.responses.filter(r => !r.success).map(r => r.error?.message),
      })
      // Remove stale tokens that are no longer registered
      const stale = res.responses
        .map((r, idx) => (!r.success ? chunk[idx] : null))
        .filter(Boolean) as string[]
      if (stale.length > 0) {
        const usersSnap = await db.collection('users')
          .where('fcmTokens', 'array-contains-any', stale)
          .get()
        await Promise.all(usersSnap.docs.map(d =>
          d.ref.update({ fcmTokens: admin.firestore.FieldValue.arrayRemove(...stale) }),
        ))
      }
    }
  } catch (err: any) {
    console.error('sendPush error', { message: err?.message })
  }
}

async function saveNotifications(
  uids: string[],
  opts: { title: string; body: string; url?: string },
) {
  if (uids.length === 0) return
  const batch = db.batch()
  for (const uid of uids) {
    const ref = db.collection('notifications').doc()
    batch.set(ref, {
      uid,
      title:     opts.title,
      body:      opts.body,
      url:       opts.url ?? '/',
      isRead:    false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    })
  }
  await batch.commit()
}

// ─────────────────────────────────────────────────────────────────────────────
// checkLevelUp — detect and notify when a student reaches a new experience level
// ─────────────────────────────────────────────────────────────────────────────

async function checkLevelUp(uid: string, newTotal: number) {
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
// onAssignmentPublished — push to all students in the cohort
// ─────────────────────────────────────────────────────────────────────────────

export const onAssignmentPublished = functions.firestore
  .document('assignments/{id}')
  .onWrite(async (change) => {
    const before = change.before.data()
    const after  = change.after.data()
    if (!after || before?.isPublished === after.isPublished) return
    if (!after.isPublished) return

    const cohortId = after.cohortId as string | undefined
    if (!cohortId) return

    const studentsSnap = await db.collection('users')
      .where('cohortId', '==', cohortId)
      .where('role', '==', 'student')
      .get()

    const tokens: string[] = []
    studentsSnap.docs.forEach(d => tokens.push(...(d.data().fcmTokens ?? [])))

    const opts = {
      title: '📋 New assignment posted',
      body:  after.title ?? 'A new assignment has been published.',
      url:   '/assignments',
    }
    await Promise.all([
      sendPush(tokens, { ...opts, tag: 'assignment' }),
      saveNotifications(studentsSnap.docs.map(d => d.id), opts),
    ])
  })

// ─────────────────────────────────────────────────────────────────────────────
// onBookingConfirmed — push to the student who made the booking
// ─────────────────────────────────────────────────────────────────────────────

export const onBookingConfirmed = functions.firestore
  .document('room_bookings/{id}')
  .onUpdate(async (change) => {
    const before = change.before.data()
    const after  = change.after.data()
    if (!after) return null

    // Only fire when status actually changes to a terminal state
    if (before?.status === after.status) return null
    if (after.status !== 'confirmed' && after.status !== 'denied') return null

    // Atomic idempotency guard — prevents duplicate pushes if Firestore retries
    const alreadySent = await db.runTransaction(async tx => {
      const fresh = await tx.get(change.after.ref)
      if (fresh.data()?.pushSent === true) return true
      tx.update(change.after.ref, { pushSent: true })
      return false
    })
    if (alreadySent) return null

    const uid: string = after.studentId ?? after.userId
    if (!uid) return null

    const userSnap = await db.collection('users').doc(uid).get()
    const tokens: string[] = userSnap.data()?.fcmTokens ?? []

    const bookingOpts = after.status === 'confirmed'
      ? { title: '✅ Room booking confirmed', body: `Your booking for ${after.roomName ?? 'the room'} has been confirmed.`, url: '/booking' }
      : { title: '❌ Room booking denied',    body: `Your booking for ${after.roomName ?? 'the room'} was not approved.`,  url: '/booking' }
    await Promise.all([
      sendPush(tokens, { ...bookingOpts, tag: 'booking-update' }),
      saveNotifications([uid], bookingOpts),
    ])
    return null
  })

// ─────────────────────────────────────────────────────────────────────────────
// onChatMessage — push notification to all channel members except the sender
// ─────────────────────────────────────────────────────────────────────────────

export const onChatMessage = functions.firestore
  .document('chat_channels/{channelId}/messages/{msgId}')
  .onCreate(async (snap, context) => {
    const msg = snap.data()

    // Booking system posts set skipPush to avoid double notifications
    if (msg.skipPush === true) return null

    // Atomic idempotency guard — prevents race between concurrent function instances
    const msgRef = snap.ref
    const alreadySent = await db.runTransaction(async tx => {
      const fresh = await tx.get(msgRef)
      if (fresh.data()?.pushSent === true) return true
      tx.update(msgRef, { pushSent: true })
      return false
    })
    if (alreadySent) return null

    const senderId   = (msg.authorId   as string) || ''
    const senderName = (msg.authorName as string) || 'Someone'
    const messageText = ((msg.content as string) ?? '').slice(0, 100)
                      || (msg.attachments?.length ? '📎 Attachment' : '')

    const channelId = context.params.channelId

    // Fetch channel doc
    const channelDoc = await db.collection('chat_channels').doc(channelId).get()
    const isDM = channelDoc.data()?.isDM === true
    const channelName = isDM ? null : (channelDoc.exists ? ((channelDoc.data()?.name as string) ?? 'Chat') : 'Chat')

    // Collect FCM tokens — DMs only push to the other member, channels push to all
    const tokens: string[] = []

    if (isDM) {
      const memberIds = (channelDoc.data()?.memberIds ?? []) as string[]
      await Promise.all(
        memberIds.filter(uid => uid !== senderId).map(async uid => {
          const u = await db.collection('users').doc(uid).get()
          ;(u.data()?.fcmTokens ?? []).forEach((t: string) => { if (t) tokens.push(t) })
        }),
      )
    } else {
      const usersSnap = await db.collection('users').get()
      usersSnap.forEach(userDoc => {
        if (userDoc.id === senderId) return
        const fcmTokens = userDoc.data().fcmTokens
        if (Array.isArray(fcmTokens)) {
          fcmTokens.forEach((t: string) => { if (t) tokens.push(t) })
        }
      })
    }

    if (tokens.length === 0) return null

    // Deduplicate
    const uniqueTokens = [...new Set(tokens)]

    const notifBody = channelName ? `${channelName}\n${messageText}` : messageText
    console.log('onChatMessage: sending', { channelId, isDM, senderName, channelName, tokenCount: uniqueTokens.length })

    // Send in batches of 500 (FCM multicast limit)
    for (let i = 0; i < uniqueTokens.length; i += 500) {
      const chunk = uniqueTokens.slice(i, i + 500)
      await admin.messaging().sendEachForMulticast({
        tokens: chunk,
        // Data-only — service worker's onBackgroundMessage is the sole display path.
        data: {
          type:      isDM ? 'dm' : 'chat',
          channelId,
          title:     senderName,
          body:      notifBody,
          url:       '/chat',
          tag:       `chat-${channelId}`,
        },
        webpush: {
          headers: { Urgency: 'high' },
        },
      })
    }

    return null
  })

// ─────────────────────────────────────────────────────────────────────────────
// generateFoodBoxPdf — Swedish PDF for the admin export
// ─────────────────────────────────────────────────────────────────────────────

function generateFoodBoxPdf(d: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 0, size: 'A4' })
    const bufs: Buffer[] = []
    doc.on('data', (c: Buffer) => bufs.push(c))
    doc.on('end',  () => resolve(Buffer.concat(bufs)))
    doc.on('error', reject)

    const PW = 595
    const PH = 842
    const M  = 48
    const CW = PW - M * 2

    const logoPath = path.join(__dirname, '../assets/fire.png')

    const effectiveDate = d.adminDate       ?? d.date       ?? d.pickupDate ?? ''
    const effectiveTime = d.adminPickupTime ?? d.pickupTime ?? ''
    const adminModified = !!(d.adminDate || d.adminPickupTime)

    // ── Dark header band ─────────────────────────────────────────────────────
    doc.rect(0, 0, PW, 110).fill('#0f172a')

    const logoY = 22, logoH = 48
    doc.image(logoPath, M, logoY, { width: logoH, height: logoH })
    doc.fillColor('#ffffff').fontSize(22).font('Helvetica-Bold')
       .text('CineForge', M + logoH + 8, logoY + (logoH / 2) - 13)
    doc.fillColor('rgba(255,255,255,0.50)').fontSize(10).font('Helvetica')
       .text('Food Box Order', M + logoH + 8, logoY + logoH - 13)

    // Status pill
    const statusLabel = d.status === 'confirmed' ? 'CONFIRMED' : d.status === 'cancelled' ? 'CANCELLED' : 'PENDING'
    const statusColor = d.status === 'confirmed' ? '#10b981' : d.status === 'cancelled' ? '#ef4444' : '#f59e0b'
    doc.roundedRect(PW - M - 90, 36, 90, 24, 4).fill(statusColor)
    doc.fillColor('#ffffff').fontSize(10).font('Helvetica-Bold')
       .text(statusLabel, PW - M - 90, 43, { width: 90, align: 'center' })

    // ── Accent stripe ────────────────────────────────────────────────────────
    doc.rect(0, 110, PW, 3).fill('#f97316')

    // ── Body helpers ─────────────────────────────────────────────────────────
    let y = 136

    function sectionHead(title: string) {
      doc.fillColor('#0f172a').fontSize(9).font('Helvetica-Bold')
         .text(title.toUpperCase(), M, y, { characterSpacing: 1.2 })
      y = doc.y + 3
      doc.rect(M, y, CW, 1).fill('#e2e8f0')
      y += 10
    }

    function field(label: string, value: string) {
      doc.fillColor('#64748b').fontSize(8).font('Helvetica')
         .text(label.toUpperCase(), M, y, { characterSpacing: 0.8, width: CW })
      y = doc.y + 2
      doc.fillColor('#0f172a').fontSize(12).font('Helvetica-Bold')
         .text(value || '–', M, y, { width: CW })
      y = doc.y + 14
    }

    function fieldPair(l1: string, v1: string, l2: string, v2: string) {
      const hw = CW / 2 - 8
      doc.fillColor('#64748b').fontSize(8).font('Helvetica')
         .text(l1.toUpperCase(), M, y, { characterSpacing: 0.8, width: hw })
      const ly = doc.y + 2
      doc.fillColor('#0f172a').fontSize(12).font('Helvetica-Bold')
         .text(v1 || '–', M, ly, { width: hw })
      const endL = doc.y
      doc.fillColor('#64748b').fontSize(8).font('Helvetica')
         .text(l2.toUpperCase(), M + CW / 2, y, { characterSpacing: 0.8, width: hw })
      const ry = doc.y + 2
      doc.fillColor('#0f172a').fontSize(12).font('Helvetica-Bold')
         .text(v2 || '–', M + CW / 2, ry, { width: hw })
      y = Math.max(endL, doc.y) + 14
    }

    function studentList(label: string, students: string[]) {
      if (!students.length) return
      doc.fillColor('#64748b').fontSize(8).font('Helvetica')
         .text(label.toUpperCase(), M, y, { characterSpacing: 0.8, width: CW })
      y = doc.y + 2
      doc.fillColor('#0f172a').fontSize(10).font('Helvetica')
         .text(students.join(', '), M, y, { width: CW })
      y = doc.y + 10
    }

    function heatField(canHeat: boolean | null) {
      const val = canHeat === true ? 'Ja' : canHeat === false ? 'Nej' : '–'
      doc.fillColor('#64748b').fontSize(8).font('Helvetica')
         .text('KAN VÄRMA MATEN', M, y, { characterSpacing: 0.8 })
      y = doc.y + 2
      doc.fillColor('#0f172a').fontSize(12).font('Helvetica-Bold')
         .text(val, M, y)
      y = doc.y + 14
    }

    // ── Order details ────────────────────────────────────────────────────────
    sectionHead('Orderdetaljer')
    field('Student', d.studentName || '–')
    fieldPair('Datum', effectiveDate, 'Upphämtningstid', effectiveTime || '–')

    // ── Morning ──────────────────────────────────────────────────────────────
    const morningStudents: string[] = d.morningStudents ?? []
    if (morningStudents.length > 0 || d.morningDiet?.trim()) {
      y += 4
      sectionHead(`Morgonkaffe / te  (${morningStudents.length} personer)`)
      studentList('Studenter', morningStudents)
      if (d.morningDiet?.trim()) field('Specialkost', d.morningDiet)
    }

    // ── Lunch ────────────────────────────────────────────────────────────────
    const lunchStudents: string[] = d.lunchStudents ?? []
    if (lunchStudents.length > 0 || d.lunchDiet?.trim()) {
      y += 4
      sectionHead(`Lunchlåda  (${lunchStudents.length} personer)`)
      studentList('Studenter', lunchStudents)
      heatField(d.lunchCanHeat)
      if (d.lunchDiet?.trim()) field('Specialkost', d.lunchDiet)
    }

    // ── Dinner ───────────────────────────────────────────────────────────────
    const dinnerStudents: string[] = d.dinnerStudents ?? []
    if (dinnerStudents.length > 0 || d.dinnerDiet?.trim()) {
      y += 4
      sectionHead(`Middagslåda  (${dinnerStudents.length} personer)`)
      studentList('Studenter', dinnerStudents)
      heatField(d.dinnerCanHeat)
      if (d.dinnerDiet?.trim()) field('Specialkost', d.dinnerDiet)
    }

    // ── Other notes ──────────────────────────────────────────────────────────
    if (d.otherNotes?.trim()) {
      y += 4
      sectionHead('Övriga anteckningar')
      doc.fillColor('#374151').fontSize(11).font('Helvetica')
         .text(d.otherNotes, M, y, { width: CW })
      y = doc.y + 14
    }

    // ── Contact ──────────────────────────────────────────────────────────────
    y += 4
    sectionHead('Kontaktuppgifter')
    fieldPair('Kontaktperson', d.contactPerson || '–', 'Telefonnummer', d.phoneNumber || '–')

    // ── Admin-confirmed date/time notice ─────────────────────────────────────
    if (d.status === 'confirmed' || adminModified) {
      y += 6
      const noticeH = adminModified ? 52 : 36
      doc.roundedRect(M, y, CW, noticeH, 6).fill('#f0fdf4')
      doc.rect(M, y, 4, noticeH).fill('#10b981')
      doc.fillColor('#14532d').fontSize(9).font('Helvetica-Bold')
         .text('Datum och tid bekräftad av admin', M + 14, y + 8, { width: CW - 20 })
      if (adminModified) {
        doc.fillColor('#166534').fontSize(9).font('Helvetica')
           .text(`Datum: ${effectiveDate}${effectiveTime ? `  ·  Upphämtningstid: ${effectiveTime}` : ''}`, M + 14, y + 22, { width: CW - 20 })
        doc.fillColor('#166534').fontSize(8).font('Helvetica')
           .text('(Admin har justerat datum/tid från ursprunglig beställning)', M + 14, y + 36, { width: CW - 20 })
      } else {
        doc.fillColor('#166534').fontSize(9).font('Helvetica')
           .text(`Datum: ${effectiveDate}${effectiveTime ? `  ·  Upphämtningstid: ${effectiveTime}` : ''}`, M + 14, y + 22, { width: CW - 20 })
      }
      y += noticeH + 10
    }

    // ── Footer ───────────────────────────────────────────────────────────────
    doc.rect(0, PH - 36, PW, 36).fill('#0f172a')
    doc.fillColor('rgba(255,255,255,0.4)').fontSize(8).font('Helvetica')
       .text(`Generated by CineForge  ·  ${new Date().toLocaleDateString('en-SE')}`, M, PH - 22, { width: CW })
    doc.fillColor('rgba(255,255,255,0.4)').fontSize(8)
       .text(`Order ID: ${d.id ?? ''}`, M, PH - 22, { width: CW, align: 'right' })

    doc.end()
  })
}

function pdfTextBox(doc: PDFKit.PDFDocument, x: number, y: number, w: number, content: string, minH = 38): number {
  const text = content?.trim() || '–'
  const h = Math.max(minH, doc.heightOfString(text, { width: w - 10 }) + 14)
  doc.rect(x, y, w, h).stroke()
  doc.font('Helvetica').fontSize(10).fillColor('#000000')
     .text(text, x + 5, y + 6, { width: w - 10 })
  return y + h
}

function pdfHeatRowSwedish(doc: PDFKit.PDFDocument, x: number, y: number, w: number, canHeat: boolean | null): number {
  const h = 20, cbS = 10
  doc.rect(x, y, w, h).fill('#FFFF00').stroke('#000000')
  doc.fillColor('#000000').font('Helvetica').fontSize(11)

  const question = 'Kan du värma maten?'
  doc.text(question, x + 5, y + 5)
  const qW = doc.widthOfString(question)

  const jaX = x + 5 + qW + 14
  doc.text('Ja', jaX, y + 5)
  const jaCbX = jaX + doc.widthOfString('Ja') + 5
  const cbY = y + 5
  doc.rect(jaCbX, cbY, cbS, cbS).stroke('#000000')
  if (canHeat === true) {
    doc.moveTo(jaCbX + 2, cbY + 5).lineTo(jaCbX + 4, cbY + 8).lineTo(jaCbX + 9, cbY + 2).stroke('#000000')
  }

  const nejX = jaCbX + cbS + 18
  doc.font('Helvetica').text('Nej', nejX, y + 5)
  const nejCbX = nejX + doc.widthOfString('Nej') + 5
  doc.rect(nejCbX, cbY, cbS, cbS).stroke('#000000')
  if (canHeat === false) {
    doc.moveTo(nejCbX + 2, cbY + 5).lineTo(nejCbX + 4, cbY + 8).lineTo(nejCbX + 9, cbY + 2).stroke('#000000')
  }

  return y + h
}

function pdfHeatRow(doc: PDFKit.PDFDocument, x: number, y: number, w: number, canHeat: boolean | null): number {
  const h = 20, cbS = 10
  doc.rect(x, y, w, h).fill('#FFFF00').stroke('#000000')
  doc.fillColor('#000000').font('Helvetica').fontSize(11)

  const question = 'Do you have access to heat up the food?'
  doc.text(question, x + 5, y + 5)
  const qW = doc.widthOfString(question)

  // Yes label + checkbox
  const yesX = x + 5 + qW + 14
  doc.text('Yes', yesX, y + 5)
  const yesCbX = yesX + doc.widthOfString('Yes') + 5
  const cbY = y + 5
  doc.rect(yesCbX, cbY, cbS, cbS).stroke('#000000')
  if (canHeat === true) {
    doc.moveTo(yesCbX + 2, cbY + 5)
       .lineTo(yesCbX + 4, cbY + 8)
       .lineTo(yesCbX + 9, cbY + 2)
       .stroke('#000000')
  }

  // No label + checkbox
  const noX = yesCbX + cbS + 22
  doc.font('Helvetica').text('No', noX, y + 5)
  const noCbX = noX + doc.widthOfString('No') + 5
  doc.rect(noCbX, cbY, cbS, cbS).stroke('#000000')
  if (canHeat === false) {
    doc.moveTo(noCbX + 2, cbY + 5)
       .lineTo(noCbX + 4, cbY + 8)
       .lineTo(noCbX + 9, cbY + 2)
       .stroke('#000000')
  }

  return y + h
}

// ─────────────────────────────────────────────────────────────────────────────
// sendFoodBoxEmail — generate PDF replica of form and email it via Resend
// ─────────────────────────────────────────────────────────────────────────────

const FOOD_BOX_RECIPIENT = 'fredrik.fridlund@regionvarmland.se'

export const sendFoodBoxEmail = functions.runWith({ secrets: ['RESEND_API_KEY'] }).https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.')

  const d = data as any
  const emailCfg = await getEmailConfig()

  const recipients = new Set<string>([FOOD_BOX_RECIPIENT])
  if (emailCfg?.foodBoxEmail && emailCfg.foodBoxEmail !== FOOD_BOX_RECIPIENT) {
    recipients.add(emailCfg.foodBoxEmail)
  }

  const pdfBuffer = await generateFoodBoxPdf(d)
  const filename  = `food-order-${d.pickupDate}-${d.contactPerson.replace(/\s+/g, '-')}.pdf`
  const fromName  = emailCfg?.fromName  || 'CineForge'
  const fromEmail = emailCfg?.fromEmail || 'onboarding@resend.dev'

  await getResend().emails.send({
    from:        `${fromName} <${fromEmail}>`,
    to:          [...recipients],
    replyTo:    d.studentEmail || undefined,
    subject:     `Food Box Order – ${d.pickupDate} at ${d.pickupTime} (${d.contactPerson})`,
    text:        `New food box order from ${d.studentName}. See attached PDF.`,
    attachments: [{ filename, content: pdfBuffer.toString('base64') }],
  })

  return { success: true }
})

// ─────────────────────────────────────────────────────────────────────────────
// onPlanComment — push notification to student when teacher leaves feedback
// ─────────────────────────────────────────────────────────────────────────────

export const onPlanComment = functions.firestore
  .document('plan_comments/{commentId}')
  .onCreate(async (snap) => {
    const data = snap.data()
    const studentId: string = data.studentId
    const teacherName: string = data.teacherName ?? 'Your teacher'
    const step: string = data.step ?? 'your plan'

    const stepLabels: Record<string, string> = {
      situation:  'Now',
      goal:       'Objective',
      obstacles:  'Problems',
      resources:  'Resources',
      action:     'Actions',
      evaluation: 'Evaluation',
    }
    const stepLabel = stepLabels[step] ?? step

    const userSnap = await db.collection('users').doc(studentId).get()
    const tokens: string[] = userSnap.data()?.fcmTokens ?? []
    if (!tokens.length) return null

    const planOpts = {
      title: teacherName,
      body:  `New feedback on ${stepLabel} in your development plan.`,
      url:   '/my-plan',
    }
    await Promise.all([
      sendPush(tokens, { ...planOpts, tag: 'plan-comment' }),
      saveNotifications([studentId], planOpts),
    ])
    return null
  })

// ─────────────────────────────────────────────────────────────────────────────
// sendMinivanEmail — notify staff about a new minivan booking request via Resend
// ─────────────────────────────────────────────────────────────────────────────

export const sendMinivanEmail = functions.runWith({ secrets: ['RESEND_API_KEY'] }).https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.')

  const emailCfg = await getEmailConfig()
  if (!emailCfg?.minivanEmail) return { skipped: true }

  const d = data as any
  const fromName  = emailCfg?.fromName  || 'CineForge'
  const fromEmail = emailCfg?.fromEmail || 'onboarding@resend.dev'

  const html = [
    `<b>Contact:</b> ${escapeHtml(d.contactPerson)} — ${escapeHtml(d.phoneNumber)}`,
    `<b>Student:</b> ${escapeHtml(d.studentName)}`,
    `<b>Departure:</b> ${escapeHtml(d.dateFrom)} at ${escapeHtml(d.timeFrom)}`,
    `<b>Return:</b> ${escapeHtml(d.dateTo)} at ${escapeHtml(d.timeTo)}`,
    `<b>Destination:</b> ${escapeHtml(d.destination)}`,
    `<b>Purpose:</b> ${escapeHtml(d.purpose)}`,
    `<b>Passengers:</b> ${escapeHtml(d.passengers)}`,
    d.notes ? `<b>Notes:</b> ${escapeHtml(d.notes)}` : '',
  ].filter(Boolean).join('<br>')

  await getResend().emails.send({
    from:      `${fromName} <${fromEmail}>`,
    to:        [emailCfg.minivanEmail],
    replyTo:  d.studentEmail || undefined,
    subject:   `Minivan Request – ${d.dateFrom} → ${d.dateTo} (${d.contactPerson})`,
    html,
  })

  return { success: true }
})

// ─────────────────────────────────────────────────────────────────────────────
// Booking notification helpers
// ─────────────────────────────────────────────────────────────────────────────

async function getOrCreateBookingsChannel(): Promise<string> {
  const snap = await db.collection('chat_channels')
    .where('name', '==', 'Bookings')
    .limit(1)
    .get()

  if (!snap.empty) return snap.docs[0].id

  const ref = await db.collection('chat_channels').add({
    name:             'Bookings',
    description:      'Food box orders and minivan requests',
    order:            99,
    isPublic:         false,
    allowedRoles:     ['teacher', 'admin'],
    allowedCohortIds: [],
    allowedTeamIds:   [],
    memberIds:        [],
    createdAt:        admin.firestore.FieldValue.serverTimestamp(),
    createdBy:        'system',
  })
  return ref.id
}

async function postToBookingsChannel(channelId: string, text: string) {
  await db.collection('chat_channels').doc(channelId)
    .collection('messages').add({
      authorId:        'system',
      authorName:      'CineForge',
      authorAvatarUrl: null,
      content:         text,
      attachments:     [],
      reactions:       {},
      skipPush:        true,   // prevent onChatMessage from sending a duplicate push
      createdAt:       admin.firestore.FieldValue.serverTimestamp(),
    })
  await db.collection('chat_channels').doc(channelId).update({
    lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
  })
}

async function pushToTeachersAndAdmins(title: string, body: string, url: string) {
  const snap = await db.collection('users')
    .where('role', 'in', ['teacher', 'admin'])
    .get()
  const tokens: string[] = []
  const uids: string[] = []
  snap.docs.forEach(d => {
    tokens.push(...(d.data().fcmTokens ?? []))
    uids.push(d.id)
  })
  await Promise.all([
    sendPush(tokens, { title, body, url, tag: 'booking' }),
    saveNotifications(uids, { title, body, url }),
  ])
}

async function pushToStudent(studentId: string, title: string, body: string) {
  const snap = await db.collection('users').doc(studentId).get()
  const tokens: string[] = snap.data()?.fcmTokens ?? []
  await sendPush(tokens, { title, body, url: '/booking', tag: 'booking-update' })
}

// ─────────────────────────────────────────────────────────────────────────────
// onFoodBoxOrderCreated — notify teachers/admins via chat + push
// ─────────────────────────────────────────────────────────────────────────────

export const onFoodBoxOrderCreated = functions.firestore
  .document('food_box_orders/{id}')
  .onCreate(async (snap) => {
    if (snap.data().notifSent === true) return
    await snap.ref.update({ notifSent: true })
    const d = snap.data()
    const meals = [
      (d.morningStudents?.length > 0) ? `☕ Morgon ×${d.morningStudents.length}` : '',
      (d.lunchStudents?.length   > 0) ? `🥗 Lunch ×${d.lunchStudents.length}`   : '',
      (d.dinnerStudents?.length  > 0) ? `🍽️ Middag ×${d.dinnerStudents.length}`  : '',
    ].filter(Boolean).join('  ·  ')

    const text = `🍱 **New food box order** from ${d.studentName}\nDate: ${d.date}  ·  ${meals}`

    const channelId = await getOrCreateBookingsChannel()
    await postToBookingsChannel(channelId, text)
    await pushToTeachersAndAdmins(
      '🍱 New food box order',
      `${d.studentName} — date ${d.date}`,
      '/admin/food-box-orders',
    )
  })

// ─────────────────────────────────────────────────────────────────────────────
// onFoodBoxOrderUpdated — push student when status changes
// ─────────────────────────────────────────────────────────────────────────────

export const onFoodBoxOrderUpdated = functions.firestore
  .document('food_box_orders/{id}')
  .onUpdate(async (change) => {
    const before = change.before.data()
    const after  = change.after.data()

    // Admin changed schedule (date or time)
    const foodScheduleChanged =
      before.adminPickupTime !== after.adminPickupTime ||
      before.adminDate       !== after.adminDate
    if (foodScheduleChanged && after.pickupTimeModified) {
      const effectiveDate = after.adminDate ?? after.date
      const effectiveTime = after.adminPickupTime ?? after.pickupTime
      await pushToStudent(after.studentId, '⏰ Food box schedule updated', `Your food box has been rescheduled to ${effectiveDate}${effectiveTime ? ` at ${effectiveTime}` : ''}.`)
    }

    if (before.status === after.status) return
    if (after.notifiedStatus === after.status) return
    await change.after.ref.update({ notifiedStatus: after.status })

    if (after.status === 'confirmed') {
      const effectiveTime = after.adminPickupTime ?? after.pickupTime
      await pushToStudent(after.studentId, '✅ Food box order confirmed', `Your order for ${after.date} has been confirmed.${effectiveTime ? ` Pick-up at ${effectiveTime}.` : ''}`)
    } else if (after.status === 'cancelled') {
      await pushToStudent(after.studentId, '❌ Food box order cancelled', `Your order for ${after.date} has been cancelled.`)
    }
  })

// ─────────────────────────────────────────────────────────────────────────────
// foodBoxPickupReminder — runs every 5 min, pushes student 30 min before pick-up
// ─────────────────────────────────────────────────────────────────────────────

export const foodBoxPickupReminder = functions.pubsub
  .schedule('every 5 minutes')
  .onRun(async () => {
    const now = new Date()
    // Window: 28–33 min from now (catches any 5-min tick that overlaps the 30-min mark)
    const windowStart = new Date(now.getTime() + 28 * 60 * 1000)
    const windowEnd   = new Date(now.getTime() + 33 * 60 * 1000)

    const todayStr = now.toISOString().slice(0, 10)
    const tomorrowStr = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

    const snap = await db.collection('food_box_orders')
      .where('status', '==', 'confirmed')
      .where('reminderSent', '!=', true)
      .where('date', 'in', [todayStr, tomorrowStr])
      .get()

    for (const doc of snap.docs) {
      const order = doc.data()
      if (!order.pickupTime) continue

      // Parse pick-up datetime (HH:MM on the order date, local-ish — treat as UTC for simplicity)
      const [h, m] = (order.pickupTime as string).split(':').map(Number)
      const pickupDate = new Date(`${order.date}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00`)

      if (pickupDate >= windowStart && pickupDate <= windowEnd) {
        await doc.ref.update({ reminderSent: true })
        await pushToStudent(
          order.studentId,
          '🍱 Food pick-up in 30 minutes',
          `Your food box for ${order.date} is ready at ${order.pickupTime}. Don't forget to pick it up!`,
        )
      }
    }

    return null
  })

// ─────────────────────────────────────────────────────────────────────────────
// onMinivanBookingCreated — notify teachers/admins via chat + push
// ─────────────────────────────────────────────────────────────────────────────

export const onMinivanBookingCreated = functions.firestore
  .document('minivan_bookings/{id}')
  .onCreate(async (snap) => {
    if (snap.data().notifSent === true) return
    await snap.ref.update({ notifSent: true })
    const d = snap.data()
    const text = `🚐 **New minivan request** from ${d.studentName}\n${d.dateFrom} → ${d.dateTo}  ·  ${d.destination}  ·  Driver: ${d.driverName || '–'}`

    const channelId = await getOrCreateBookingsChannel()
    await postToBookingsChannel(channelId, text)
    await pushToTeachersAndAdmins(
      '🚐 New minivan request',
      `${d.studentName} — ${d.destination} on ${d.dateFrom}`,
      '/admin/minivan',
    )
  })

// ─────────────────────────────────────────────────────────────────────────────
// onMinivanBookingUpdated — push student when status changes
// ─────────────────────────────────────────────────────────────────────────────

export const onMinivanBookingUpdated = functions.firestore
  .document('minivan_bookings/{id}')
  .onUpdate(async (change) => {
    const before = change.before.data()
    const after  = change.after.data()

    // Admin changed schedule (date or time)
    const scheduleFieldsChanged =
      before.adminTimeFrom !== after.adminTimeFrom ||
      before.adminTimeTo   !== after.adminTimeTo   ||
      before.adminDateFrom !== after.adminDateFrom ||
      before.adminDateTo   !== after.adminDateTo
    if (scheduleFieldsChanged && after.scheduleModified) {
      const depDate = after.adminDateFrom ?? after.dateFrom
      const depTime = after.adminTimeFrom ?? after.timeFrom
      const retDate = after.adminDateTo   ?? after.dateTo
      const retTime = after.adminTimeTo   ?? after.timeTo
      await pushToStudent(after.studentId, '⏰ Minivan schedule updated', `Your trip to ${after.destination}: departure ${depDate} at ${depTime}, return ${retDate} at ${retTime}.`)
    }

    if (before.status === after.status) return
    if (after.notifiedStatus === after.status) return
    await change.after.ref.update({ notifiedStatus: after.status })

    if (after.status === 'approved') {
      const depTime = after.adminTimeFrom ?? after.timeFrom
      await pushToStudent(after.studentId, '✅ Minivan request approved', `Your trip to ${after.destination} on ${after.dateFrom} at ${depTime} has been approved.`)
    } else if (after.status === 'rejected') {
      await pushToStudent(after.studentId, '❌ Minivan request rejected', `Your trip to ${after.destination} on ${after.dateFrom} was not approved.`)
    }
  })

// ─────────────────────────────────────────────────────────────────────────────
// onEquipmentBookingCreated — notify teachers/admins of new equipment requests
// ─────────────────────────────────────────────────────────────────────────────

export const onEquipmentBookingCreated = functions.firestore
  .document('equipment_bookings/{bookingId}')
  .onCreate(async (snap) => {
    const booking = snap.data()

    // Rate limit: max 5 pending bookings per student
    const pendingSnap = await db.collection('equipment_bookings')
      .where('studentId', '==', booking.studentId)
      .where('status', '==', 'pending')
      .get()
    if (pendingSnap.size >= 5) {
      await snap.ref.delete()
      return null
    }

    await pushToTeachersAndAdmins(
      '📦 Equipment booking request',
      `${booking.studentName} requested equipment for "${booking.projectName}"`,
      '/teacher/equipment-requests',
    )
    return null
  })

// ─────────────────────────────────────────────────────────────────────────────
// onEquipmentBookingUpdated — notify student when booking status changes
// ─────────────────────────────────────────────────────────────────────────────

export const onEquipmentBookingUpdated = functions.firestore
  .document('equipment_bookings/{bookingId}')
  .onUpdate(async (change) => {
    const before = change.before.data()
    const after  = change.after.data()
    if (before.status === after.status) return null
    const studentSnap = await db.collection('users').doc(after.studentId as string).get()
    const tokens: string[] = studentSnap.data()?.fcmTokens ?? []
    if (after.status === 'confirmed') {
      await sendPush(tokens, {
        title: '✅ Equipment booking confirmed',
        body:  `Your equipment for "${after.projectName}" has been confirmed`,
        url:   '/booking/equipment',
        tag:   'equipment-booking',
      })
    } else if (after.status === 'cancelled') {
      await sendPush(tokens, {
        title: '❌ Equipment booking cancelled',
        body:  `Your equipment request for "${after.projectName}" was not approved`,
        url:   '/booking/equipment',
        tag:   'equipment-booking',
      })
    }
    return null
  })

// ─────────────────────────────────────────────────────────────────────────────
// onInventoryProjectUpdated — notify borrowers when project status changes
// ─────────────────────────────────────────────────────────────────────────────

export const onInventoryProjectUpdated = functions.firestore
  .document('inventory_projects/{projectId}')
  .onUpdate(async (change) => {
    const before = change.before.data()
    const after  = change.after.data()
    if (before.status === after.status) return null
    if (after.status !== 'returned') return null
    const borrowerIds: string[] = after.borrowerIds ?? []
    for (const uid of borrowerIds) {
      const userSnap = await db.collection('users').doc(uid).get()
      const tokens: string[] = userSnap.data()?.fcmTokens ?? []
      if (tokens.length === 0) continue
      await sendPush(tokens, {
        title: '✅ Equipment returned',
        body:  `Project "${after.name}" has been marked as returned`,
        url:   '/booking/equipment',
        tag:   'inventory',
      })
    }
    return null
  })

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
// exportFoodBoxPdf — admin callable: load order, generate Swedish PDF, return base64
// ─────────────────────────────────────────────────────────────────────────────

export const exportFoodBoxPdf = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.')
  const claims = context.auth.token as any
  if (claims.role !== 'admin' && claims.role !== 'teacher') {
    throw new functions.https.HttpsError('permission-denied', 'Admins and teachers only.')
  }

  const { orderId } = data as { orderId: string }
  if (!orderId) throw new functions.https.HttpsError('invalid-argument', 'orderId required.')

  const snap = await db.collection('food_box_orders').doc(orderId).get()
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Order not found.')

  const order = snap.data()!
  const pdfBuffer = await generateFoodBoxPdf(order)
  return { pdf: pdfBuffer.toString('base64') }
})

// ─────────────────────────────────────────────────────────────────────────────
// exportMinivanPdf — admin callable: generate minivan booking PDF
// ─────────────────────────────────────────────────────────────────────────────

export const exportMinivanPdf = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.')
  const claims = context.auth.token as any
  if (claims.role !== 'admin' && claims.role !== 'teacher') {
    throw new functions.https.HttpsError('permission-denied', 'Admins and teachers only.')
  }

  const { bookingId } = data as { bookingId: string }
  if (!bookingId) throw new functions.https.HttpsError('invalid-argument', 'bookingId required.')

  const snap = await db.collection('minivan_bookings').doc(bookingId).get()
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Booking not found.')

  const b = snap.data()!
  const depDate = b.adminDateFrom ?? b.dateFrom
  const depTime = b.adminTimeFrom ?? b.timeFrom
  const retDate = b.adminDateTo   ?? b.dateTo
  const retTime = b.adminTimeTo   ?? b.timeTo

  const pdfBuffer: Buffer = await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 0, size: 'A4' })
    const bufs: Buffer[] = []
    doc.on('data', (c: Buffer) => bufs.push(c))
    doc.on('end',  () => resolve(Buffer.concat(bufs)))
    doc.on('error', reject)

    const PW  = 595  // A4 width pts
    const PH  = 842  // A4 height pts
    const M   = 48   // side margin
    const CW  = PW - M * 2  // content width

    const logoPath = path.join(__dirname, '../assets/fire.png')

    // ── Dark header band ────────────────────────────────────────────────────
    doc.rect(0, 0, PW, 110).fill('#0f172a')

    // CineForge wordmark — fire logo, name centred, subtitle bottom-aligned
    const logoY = 22, logoH = 48
    doc.image(logoPath, M, logoY, { width: logoH, height: logoH })
    // "CineForge" vertically centred on logo
    doc.fillColor('#ffffff').fontSize(22).font('Helvetica-Bold')
       .text('CineForge', M + logoH + 8, logoY + (logoH / 2) - 13)
    // "Vehicle Booking" bottom-aligned with logo
    doc.fillColor('rgba(255,255,255,0.50)').fontSize(10).font('Helvetica')
       .text('Vehicle Booking', M + logoH + 8, logoY + logoH - 13)

    // Status pill (top-right of header)
    const statusLabel = (b.status as string) === 'approved' ? 'APPROVED' : (b.status as string) === 'rejected' ? 'REJECTED' : 'PENDING'
    const statusColor = (b.status as string) === 'approved' ? '#10b981' : (b.status as string) === 'rejected' ? '#ef4444' : '#f59e0b'
    doc.roundedRect(PW - M - 90, 36, 90, 24, 4).fill(statusColor)
    doc.fillColor('#ffffff').fontSize(10).font('Helvetica-Bold')
       .text(statusLabel, PW - M - 90, 43, { width: 90, align: 'center' })

    // ── Accent stripe ────────────────────────────────────────────────────────
    doc.rect(0, 110, PW, 3).fill('#f97316')

    // ── Body ─────────────────────────────────────────────────────────────────
    let y = 136

    // Helper: section heading
    function sectionHead(title: string) {
      doc.fillColor('#0f172a').fontSize(9).font('Helvetica-Bold')
         .text(title.toUpperCase(), M, y, { characterSpacing: 1.2 })
      y = doc.y + 3
      doc.rect(M, y, CW, 1).fill('#e2e8f0')
      y += 10
    }

    // Helper: field row
    function field(label: string, value: string, half = false) {
      const fw = half ? CW / 2 - 8 : CW
      doc.fillColor('#64748b').fontSize(8).font('Helvetica')
         .text(label.toUpperCase(), M, y, { characterSpacing: 0.8, width: fw })
      y = doc.y + 2
      doc.fillColor('#0f172a').fontSize(12).font('Helvetica-Bold')
         .text(value || '–', M, y, { width: fw })
      y = doc.y + 14
    }

    function fieldPair(l1: string, v1: string, l2: string, v2: string) {
      const hw = CW / 2 - 8
      // left
      doc.fillColor('#64748b').fontSize(8).font('Helvetica')
         .text(l1.toUpperCase(), M, y, { characterSpacing: 0.8, width: hw })
      const ly = doc.y + 2
      doc.fillColor('#0f172a').fontSize(12).font('Helvetica-Bold')
         .text(v1 || '–', M, ly, { width: hw })
      const endL = doc.y
      // right
      doc.fillColor('#64748b').fontSize(8).font('Helvetica')
         .text(l2.toUpperCase(), M + CW / 2, y, { characterSpacing: 0.8, width: hw })
      const ry = doc.y + 2
      doc.fillColor('#0f172a').fontSize(12).font('Helvetica-Bold')
         .text(v2 || '–', M + CW / 2, ry, { width: hw })
      y = Math.max(endL, doc.y) + 14
    }

    // ── Trip section ─────────────────────────────────────────────────────────
    sectionHead('Trip Details')
    if (b.vehicle) field('Vehicle', b.vehicle)
    field('Destination', b.destination)
    field('Purpose', b.purpose)
    fieldPair('Departure date', depDate, 'Departure time', depTime)
    fieldPair('Return date', retDate, 'Return time', retTime)

    y += 4
    sectionHead('Contact Information')
    fieldPair('Contact person', b.contactPerson, 'Phone', b.phoneNumber)
    field('Student', b.studentName)
    field('Driver', b.driverName || '–')

    if (b.notes?.trim()) {
      y += 4
      sectionHead('Notes')
      doc.fillColor('#374151').fontSize(11).font('Helvetica')
         .text(b.notes, M, y, { width: CW })
      y = doc.y + 14
    }

    // ── Admin modification notice ────────────────────────────────────────────
    if (b.adminDateFrom || b.adminTimeFrom || b.adminDateTo || b.adminTimeTo) {
      y += 6
      doc.roundedRect(M, y, CW, 36, 6).fill('#fffbeb')
      doc.rect(M, y, 4, 36).fill('#f59e0b')
      doc.fillColor('#92400e').fontSize(9).font('Helvetica-Bold')
         .text('NOTE — Schedule updated by admin', M + 14, y + 7, { width: CW - 20 })
      doc.fillColor('#78350f').fontSize(9).font('Helvetica')
         .text(`New departure: ${depDate} at ${depTime}  ·  New return: ${retDate} at ${retTime}`, M + 14, y + 19, { width: CW - 20 })
      y += 50
    }

    // ── Footer ───────────────────────────────────────────────────────────────
    doc.rect(0, PH - 36, PW, 36).fill('#0f172a')
    doc.fillColor('rgba(255,255,255,0.4)').fontSize(8).font('Helvetica')
       .text(`Generated by CineForge  ·  ${new Date().toLocaleDateString('en-SE')}`, M, PH - 22, { width: CW })
    doc.fillColor('rgba(255,255,255,0.4)').fontSize(8)
       .text(`Booking ID: ${snap.id}`, M, PH - 22, { width: CW, align: 'right' })

    doc.end()
  })

  return { pdf: pdfBuffer.toString('base64') }
})

// ─────────────────────────────────────────────────────────────────────────────
// sendEventInviteNotifications — callable: send invite push to invitees
// ─────────────────────────────────────────────────────────────────────────────

export const sendEventInviteNotifications = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in')

  const inviteeIds: string[] = data.inviteeIds ?? []
  if (!inviteeIds.length) return { sent: 0 }

  const organizerName: string = data.organizerName ?? 'Someone'
  const title: string         = data.title ?? 'Meeting'
  const dateStr: string       = data.dateStr ?? ''
  const timeStr: string       = data.timeStr ?? ''
  const location: string      = data.location ?? ''
  const canceled: boolean     = data.canceled === true
  const locationPart          = location ? ` · ${location}` : ''

  const tokens: string[] = (await Promise.all(
    inviteeIds.map(async uid => {
      // Primary: look up by document ID (inviteeIds now stores the Firestore doc ID = auth UID)
      const byId = await db.collection('users').doc(uid).get()
      if (byId.exists) {
        const tokens = (byId.data()?.fcmTokens ?? []) as string[]
        if (tokens.length) return tokens
      }
      // Fallback: query by uid field (for any legacy stored values)
      const byField = await db.collection('users').where('uid', '==', uid).get()
      return byField.docs.flatMap(d => (d.data().fcmTokens ?? []) as string[])
    })
  )).flat()
  if (!tokens.length) return { sent: 0 }

  const pushTitle = canceled
    ? `❌ ${organizerName} canceled: "${title}"`
    : `📅 ${organizerName} invited you: "${title}"`
  const pushBody = canceled ? '' : `${dateStr} at ${timeStr}${locationPart}`

  await sendPush(tokens, {
    title: pushTitle,
    body:  pushBody,
    url:   '/calendar',
    tag:   `event-invite-${context.auth.uid}-${Date.now()}`,
  })

  return { sent: tokens.length }
})

// ─────────────────────────────────────────────────────────────────────────────
// sendEventReminders — push notification 15 min before calendar events
// Runs every 5 minutes; sends to events starting in 13–18 min window
// ─────────────────────────────────────────────────────────────────────────────

async function sendFcmToTokens(tokens: string[], title: string, body: string): Promise<void> {
  if (!tokens.length) return
  const messaging = admin.messaging()
  // Send in batches of 500 (FCM multicast limit)
  for (let i = 0; i < tokens.length; i += 500) {
    const batch = tokens.slice(i, i + 500)
    await messaging.sendEachForMulticast({
      tokens: batch,
      notification: { title, body },
      data: { title, body, tag: 'event-reminder' },
      webpush: {
        notification: {
          title,
          body,
          icon: '/icons/icon-192.png',
          badge: '/icons/icon-192.png',
          tag: 'event-reminder',
        },
      },
    })
  }
}

export const sendEventReminders = functions.pubsub
  .schedule('every 5 minutes')
  .onRun(async () => {
    const now     = Date.now()
    const winFrom = new Date(now + 13 * 60 * 1000)  // 13 min from now
    const winTo   = new Date(now + 18 * 60 * 1000)  // 18 min from now

    const fromTs = admin.firestore.Timestamp.fromDate(winFrom)
    const toTs   = admin.firestore.Timestamp.fromDate(winTo)

    // ── Lesson events ────────────────────────────────────────────────────────
    const lessonsSnap = await db.collection('lessons')
      .where('startTime', '>=', fromTs)
      .where('startTime', '<=', toTs)
      .get()

    for (const lessonDoc of lessonsSnap.docs) {
      const lesson = lessonDoc.data()
      const startTime: admin.firestore.Timestamp = lesson.startTime
      const timeStr = startTime.toDate().toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
      const title   = lesson.title ?? 'Lesson'
      const notifTitle = `Upcoming: ${title}`
      const notifBody  = `Starts at ${timeStr}${lesson.classroom ? ` · ${lesson.classroom}` : ''}`

      // Notify all students in this cohort
      if (lesson.cohortId) {
        const studentsSnap = await db.collection('users')
          .where('cohortId', '==', lesson.cohortId)
          .where('isActive', '==', true)
          .get()
        const studentTokens = studentsSnap.docs
          .flatMap(d => (d.data().fcmTokens as string[] | undefined) ?? [])
          .filter(Boolean)
        await sendFcmToTokens(studentTokens, notifTitle, notifBody)
      }

      // Notify the teacher(s) on this lesson
      const teacherIds: string[] = [
        ...(lesson.teacherIds ?? []),
        ...(lesson.teacherId ? [lesson.teacherId] : []),
      ].filter((v, i, a) => v && a.indexOf(v) === i)

      for (const tid of teacherIds) {
        const tSnap = await db.collection('users').doc(tid).get()
        const tokens: string[] = (tSnap.data()?.fcmTokens ?? []) as string[]
        await sendFcmToTokens(tokens, notifTitle, notifBody)
      }
    }

    // ── Personal events ──────────────────────────────────────────────────────
    const personalSnap = await db.collection('personal_events')
      .where('startTime', '>=', fromTs)
      .where('startTime', '<=', toTs)
      .get()

    for (const evDoc of personalSnap.docs) {
      const ev = evDoc.data()
      const startTime: admin.firestore.Timestamp = ev.startTime
      const timeStr = startTime.toDate().toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
      const notifTitle = `Upcoming: ${ev.title ?? 'Personal event'}`
      const notifBody  = `Starts at ${timeStr}${ev.location ? ` · ${ev.location}` : ''}`

      const uSnap  = await db.collection('users').doc(ev.userId).get()
      const ownerTokens: string[] = (uSnap.data()?.fcmTokens ?? []) as string[]

      const inviteeIds: string[] = ev.inviteeIds ?? []
      const inviteeTokens: string[] = []
      if (inviteeIds.length > 0) {
        const inviteeSnaps = await Promise.all(inviteeIds.map(uid => db.collection('users').doc(uid).get()))
        inviteeSnaps.forEach(s => inviteeTokens.push(...((s.data()?.fcmTokens ?? []) as string[])))
      }

      await sendFcmToTokens([...ownerTokens, ...inviteeTokens], notifTitle, notifBody)
    }
  })

// ─────────────────────────────────────────────────────────────────────────────
// onSemesterEventStart — daily push to teachers/admins for events starting today
// ─────────────────────────────────────────────────────────────────────────────

export const onSemesterEventStart = functions.pubsub
  .schedule('0 8 * * *')
  .timeZone('Europe/Stockholm')
  .onRun(async () => {
    const now   = new Date()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day   = String(now.getDate()).padStart(2, '0')
    const todayMmDd = `${month}-${day}`

    // Find active semester events starting today
    const eventsSnap = await db.collection('semester_events')
      .where('startDate', '==', todayMmDd)
      .where('isActive', '==', true)
      .get()

    if (eventsSnap.empty) return

    // Collect FCM tokens for all teachers and admins
    const usersSnap = await db.collection('users')
      .where('isActive', '==', true)
      .get()

    const tokens: string[] = []
    for (const uDoc of usersSnap.docs) {
      const u = uDoc.data()
      const roles: string[] = u.roles ?? []
      if (roles.includes('teacher') || roles.includes('admin') || u.role === 'teacher' || u.role === 'admin') {
        const fcm: string[] = u.fcmTokens ?? []
        tokens.push(...fcm)
      }
    }

    for (const evDoc of eventsSnap.docs) {
      const ev = evDoc.data()
      await sendFcmToTokens(
        tokens,
        ev.title ?? 'Semester Event',
        ev.description || `Starting today — ${todayMmDd}`,
      )
    }
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

      // Skip if already processed
      if (lesson.penaltiesAppliedAt) continue

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

// ─────────────────────────────────────────────────────────────────────────────
// exportUserData — GDPR right of access (callable, owner or admin only)
// ─────────────────────────────────────────────────────────────────────────────

export const exportUserData = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.')

  const { userId } = data as { userId?: string }
  const uid = userId ?? context.auth.uid

  // Only the account owner or an admin may export
  const callerDoc = await db.collection('users').doc(context.auth.uid).get()
  const callerRole = callerDoc.data()?.role ?? context.auth.token.role
  if (uid !== context.auth.uid && callerRole !== 'admin') {
    throw new functions.https.HttpsError('permission-denied', 'You may only export your own data.')
  }

  const [
    userSnap,
    pointsSnap,
    attendanceSnap,
    submissionsSnap,
    chatSnap,
    todosSnap,
    planSnap,
    bookingsSnap,
    absenceSnap,
  ] = await Promise.all([
    db.collection('users').doc(uid).get(),
    db.collection('points_log').where('studentId', '==', uid).get(),
    db.collectionGroup('attendance').where('studentId', '==', uid).get(),
    db.collection('submissions').where('studentId', '==', uid).get(),
    db.collectionGroup('messages').where('authorId', '==', uid).get(),
    db.collection('todos').where('studentId', '==', uid).get(),
    db.collection('development_plans').doc(uid).get(),
    db.collection('room_bookings').where('studentId', '==', uid).get(),
    db.collection('absence_reports').where('studentId', '==', uid).get(),
  ])

  const toObj = (snap: admin.firestore.DocumentSnapshot | admin.firestore.QueryDocumentSnapshot) =>
    ({ id: snap.id, ...snap.data() })

  return {
    exportedAt: new Date().toISOString(),
    profile: userSnap.exists ? toObj(userSnap) : null,
    pointsLog: pointsSnap.docs.map(toObj),
    attendance: attendanceSnap.docs.map(toObj),
    submissions: submissionsSnap.docs.map(toObj),
    chatMessages: chatSnap.docs.map(toObj),
    todos: todosSnap.docs.map(toObj),
    developmentPlan: planSnap.exists ? toObj(planSnap) : null,
    roomBookings: bookingsSnap.docs.map(toObj),
    absenceReports: absenceSnap.docs.map(toObj),
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// deleteUserData — GDPR right to erasure (callable, owner or admin only)
// ─────────────────────────────────────────────────────────────────────────────

export const deleteUserData = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.')

  const { userId } = data as { userId?: string }
  const uid = userId ?? context.auth.uid

  const callerDoc = await db.collection('users').doc(context.auth.uid).get()
  const callerRole = callerDoc.data()?.role ?? context.auth.token.role
  if (uid !== context.auth.uid && callerRole !== 'admin') {
    throw new functions.https.HttpsError('permission-denied', 'You may only delete your own account.')
  }

  const batch = db.batch()

  // Collections to delete outright
  const ownedCollections = [
    db.collection('points_log').where('studentId', '==', uid),
    db.collection('submissions').where('studentId', '==', uid),
    db.collection('todos').where('studentId', '==', uid),
    db.collection('room_bookings').where('studentId', '==', uid),
    db.collection('absence_reports').where('studentId', '==', uid),
    db.collection('minivan_bookings').where('studentId', '==', uid),
    db.collection('food_box_orders').where('studentId', '==', uid),
    db.collection('prize_claims').where('studentId', '==', uid),
  ]

  const snaps = await Promise.all(ownedCollections.map(q => q.get()))
  for (const snap of snaps) {
    for (const d of snap.docs) batch.delete(d.ref)
  }

  // Anonymise attendance records (school keeps stats, not PII)
  const attendanceSnap = await db.collectionGroup('attendance').where('studentId', '==', uid).get()
  for (const d of attendanceSnap.docs) {
    batch.update(d.ref, { studentName: 'Deleted User', studentId: uid })
  }

  // Delete development plan
  batch.delete(db.collection('development_plans').doc(uid))

  // Delete plan comments authored by or about this user
  const planCommentsSnap = await db.collection('plan_comments').where('studentId', '==', uid).get()
  for (const d of planCommentsSnap.docs) batch.delete(d.ref)

  // Delete user doc
  batch.delete(db.collection('users').doc(uid))

  await batch.commit()

  // Delete Firebase Auth account
  try {
    await admin.auth().deleteUser(uid)
  } catch (err: any) {
    // Account may already be deleted — not fatal
    console.warn('deleteUserData: auth delete skipped', err?.message)
  }

  console.log(`deleteUserData: deleted data for uid=${uid}`)
  return { success: true }
})

// ─────────────────────────────────────────────────────────────────────────────
// disableUser — disable Firebase Auth account + mark Firestore doc disabled
// ─────────────────────────────────────────────────────────────────────────────

export const disableUser = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.')
  const callerDoc = await db.collection('users').doc(context.auth.uid).get()
  const callerRole = callerDoc.data()?.role ?? context.auth.token.role
  if (!['admin', 'teacher'].includes(callerRole)) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only.')
  }
  const { uid } = data as { uid: string }
  await admin.auth().updateUser(uid, { disabled: true })
  await db.collection('users').doc(uid).update({ disabled: true, isActive: false })
  return { success: true }
})

// ─────────────────────────────────────────────────────────────────────────────
// restoreUser — re-enable Firebase Auth account + clear disabled flag
// ─────────────────────────────────────────────────────────────────────────────

export const restoreUser = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.')
  const callerDoc = await db.collection('users').doc(context.auth.uid).get()
  const callerRole = callerDoc.data()?.role ?? context.auth.token.role
  if (!['admin', 'teacher'].includes(callerRole)) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only.')
  }
  const { uid } = data as { uid: string }
  await admin.auth().updateUser(uid, { disabled: false })
  await db.collection('users').doc(uid).update({ disabled: false, isActive: true })
  return { success: true }
})

// ─────────────────────────────────────────────────────────────────────────────
// exportProductionPdf — callable: generate production breakdown PDF
// ─────────────────────────────────────────────────────────────────────────────

export const exportProductionPdf = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.')

  const { productionId } = data as { productionId: string }
  if (!productionId) throw new functions.https.HttpsError('invalid-argument', 'productionId required.')

  const prodSnap = await db.collection('productions').doc(productionId).get()
  if (!prodSnap.exists) throw new functions.https.HttpsError('not-found', 'Production not found.')
  const prod = prodSnap.data()!

  const uid    = context.auth.uid
  const claims = context.auth.token as any
  const isStaff = claims.role === 'teacher' || claims.role === 'admin'
  const canAccess =
    isStaff ||
    prod.createdBy === uid ||
    (prod.collaborators ?? []).includes(uid) ||
    (prod.viewerIds    ?? []).includes(uid) ||
    prod.isPublic === true
  if (!canAccess) throw new functions.https.HttpsError('permission-denied', 'Access denied.')

  const [scenesSnap, castSnap, daysSnap, crewSnap, locSnap] = await Promise.all([
    db.collection(`productions/${productionId}/scenes`).orderBy('sceneNumber').get(),
    db.collection(`productions/${productionId}/cast`).orderBy('castId').get(),
    db.collection(`productions/${productionId}/shootingDays`).orderBy('dayNumber').get(),
    db.collection(`productions/${productionId}/crew`).get(),
    db.collection(`productions/${productionId}/locations`).get(),
  ])

  const scenes    = scenesSnap.docs.map(d => ({ id: d.id, ...d.data() })) as any[]
  const cast      = castSnap.docs.map(d => ({ id: d.id, ...d.data() })) as any[]
  const days      = daysSnap.docs.map(d => ({ id: d.id, ...d.data() })) as any[]
  const crew      = crewSnap.docs.map(d => ({ id: d.id, ...d.data() })) as any[]
  const locations = locSnap.docs.map(d => ({ id: d.id, ...d.data() })) as any[]
  const locById: Record<string, any> = Object.fromEntries(locations.map((l: any) => [l.id, l]))

  const castMap: Record<number, string> = {}
  cast.forEach((c: any) => { castMap[c.castId] = c.characterName })

  const pdfBuffer: Buffer = await new Promise((resolve, reject) => {
    const doc  = new PDFDocument({ margin: 0, size: 'A4' })
    const bufs: Buffer[] = []
    doc.on('data',  (c: Buffer) => bufs.push(c))
    doc.on('end',   () => resolve(Buffer.concat(bufs)))
    doc.on('error', reject)

    const PW = 595, PH = 842, M = 48, CW = PW - M * 2
    const logoPath = path.join(__dirname, '../assets/fire.png')

    // ── Header band ──────────────────────────────────────────────────────────
    doc.rect(0, 0, PW, 110).fill('#0f172a')
    const logoY = 22, logoH = 48
    doc.image(logoPath, M, logoY, { width: logoH, height: logoH })
    doc.fillColor('#ffffff').fontSize(22).font('Helvetica-Bold')
       .text('CineForge', M + logoH + 8, logoY + (logoH / 2) - 13)
    doc.fillColor('rgba(255,255,255,0.50)').fontSize(10).font('Helvetica')
       .text('Production Plan', M + logoH + 8, logoY + logoH - 13)

    // ── Accent stripe ────────────────────────────────────────────────────────
    doc.rect(0, 110, PW, 3).fill('#f97316')

    let y = 126

    // ── Production title ─────────────────────────────────────────────────────
    doc.fillColor('#0f172a').fontSize(20).font('Helvetica-Bold')
       .text(prod.title || 'Untitled Production', M, y, { width: CW })
    y = doc.y + 4
    doc.fillColor('#64748b').fontSize(9).font('Helvetica')
       .text(`Script Breakdown · ${new Date().toLocaleDateString('en-SE')}`, M, y, { width: CW })
    y = doc.y + 20

    // ── Helpers ───────────────────────────────────────────────────────────────
    function sectionHead(title: string): void {
      doc.fillColor('#0f172a').fontSize(9).font('Helvetica-Bold')
         .text(title.toUpperCase(), M, y, { characterSpacing: 1.2 })
      y = doc.y + 3
      doc.rect(M, y, CW, 1).fill('#e2e8f0')
      y += 10
    }

    function addPageIfNeeded(needed = 40): void {
      if (y > PH - 56 - needed) {
        doc.rect(0, PH - 36, PW, 36).fill('#0f172a')
        doc.fillColor('rgba(255,255,255,0.4)').fontSize(8).font('Helvetica')
           .text(`Generated by CineForge · ${new Date().toLocaleDateString('en-SE')}`, M, PH - 22, { width: CW })
        doc.addPage()
        y = 40
      }
    }

    // Shrink font until text fits in maxW (single-line), then draw it
    function fitCell(
      text: string, cx: number, cy: number, w: number, h: number,
      font: string, startSz: number, color: string,
    ): void {
      const padX = 3
      const t    = (text ?? '').trim() || '–'
      let sz     = startSz
      doc.font(font).fontSize(sz)
      while (sz > 5 && doc.widthOfString(t) > w - padX * 2) {
        sz -= 0.3
        doc.fontSize(sz)
      }
      const padY = Math.max(1, (h - sz) / 2)
      doc.fillColor(color).text(t, cx + padX, cy + padY, { width: w - padX * 2, lineBreak: false })
    }

    // Multi-line cell: returns actual height used (>= minH)
    function wrapCell(
      text: string, cx: number, cy: number, w: number, minH: number,
      font: string, sz: number, color: string,
    ): number {
      const padX = 3, padY = 3
      const t    = (text ?? '').trim()
      if (!t) return minH
      doc.font(font).fontSize(sz)
      const textH = doc.heightOfString(t, { width: w - padX * 2 })
      const h     = Math.max(minH, textH + padY * 2)
      doc.fillColor(color).text(t, cx + padX, cy + padY, { width: w - padX * 2 })
      return h
    }

    // ── Scenes table ─────────────────────────────────────────────────────────
    if (scenes.length > 0) {
      sectionHead('Script Breakdown')

      // 9 columns: #, I/E, D/N, Location, Description, Cast, Props, Make-up, Costume
      // Total CW = 499
      const HCOLS   = ['#', 'I/E', 'D/N', 'LOCATION', 'DESCRIPTION', 'CAST', 'PROPS', 'MAKE-UP', 'COSTUME']
      const HWIDTHS = [20,   24,    22,    68,          100,           64,     52,      74,         75]
      // Sum: 20+24+22+68+100+64+52+74+75 = 499 ✓
      const WRAP_COLS = new Set([3, 4, 5, 6, 7, 8]) // location, description, cast, props, makeup, costume

      function drawSceneTableHead(): void {
        const rh = 18
        let cx = M
        doc.rect(M, y, CW, rh).fill('#1e293b')
        HCOLS.forEach((col, i) => {
          doc.fillColor('#94a3b8').fontSize(6.5).font('Helvetica-Bold')
             .text(col, cx + 3, y + 5, { width: HWIDTHS[i] - 6, lineBreak: false })
          cx += HWIDTHS[i]
        })
        y += rh
      }

      drawSceneTableHead()

      scenes.forEach((scene, idx) => {
        const castNames  = ((scene.castIds ?? []) as number[]).map(id => castMap[id] ?? String(id)).join(', ')
        const linkedLoc  = scene.locationId ? locById[scene.locationId] : null
        const locationDisplay = linkedLoc?.address
          ? `${scene.location ?? ''} — ${linkedLoc.address}`
          : (scene.location ?? '')
        const cells = [
          String(scene.sceneNumber ?? ''),
          scene.intExt ?? '',
          scene.dayNight === 'Night' ? 'N' : 'D',
          locationDisplay,
          scene.description ?? '',
          castNames,
          scene.props ?? '',
          scene.makeup ?? '',
          scene.costume ?? '',
        ]

        // Auto-size row height based on wrapping columns
        const sz = 7, padY = 4, minH = 15
        doc.font('Helvetica').fontSize(sz)
        let rh = minH
        WRAP_COLS.forEach(i => {
          const t = (cells[i] ?? '').trim()
          if (t) rh = Math.max(rh, doc.heightOfString(t, { width: HWIDTHS[i] - 6 }) + padY * 2)
        })

        addPageIfNeeded(rh)
        if (idx > 0 && y === 40) drawSceneTableHead()
        let cx = M
        if (idx % 2 === 0) doc.rect(M, y, CW, rh).fill('#f8fafc')
        cells.forEach((cell, i) => {
          doc.strokeColor('#e2e8f0').lineWidth(0.5).rect(cx, y, HWIDTHS[i], rh).stroke()
          if (WRAP_COLS.has(i)) {
            const t = (cell ?? '').trim() || '–'
            doc.font('Helvetica').fontSize(sz).fillColor('#1e293b')
               .text(t, cx + 3, y + padY, { width: HWIDTHS[i] - 6 })
          } else {
            fitCell(cell, cx, y, HWIDTHS[i], rh, 'Helvetica', sz, '#1e293b')
          }
          cx += HWIDTHS[i]
        })
        y += rh
      })
      y += 20
    }

    // ── Cast table ────────────────────────────────────────────────────────────
    if (cast.length > 0) {
      addPageIfNeeded(60)
      sectionHead('Cast')

      const CC = ['ID', 'CHARACTER', 'ACTOR / ACTRESS', 'SCENES']
      const CW2 = [28, 160, 160, CW - 28 - 160 - 160]
      const rh = 18
      let cx = M
      doc.rect(M, y, CW, rh).fill('#1e293b')
      CC.forEach((h, i) => {
        doc.fillColor('#94a3b8').fontSize(7).font('Helvetica-Bold')
           .text(h, cx + 3, y + 5, { width: CW2[i] - 6, lineBreak: false })
        cx += CW2[i]
      })
      y += rh

      cast.forEach((member: any, idx: number) => {
        addPageIfNeeded(rh)
        const memberScenes = scenes
          .filter((s: any) => ((s.castIds ?? []) as number[]).includes(member.castId))
          .map((s: any) => String(s.sceneNumber))
          .join(', ')
        const cells = [
          String(member.castId),
          member.characterName || '–',
          member.actorName || '–',
          memberScenes || '–',
        ]
        cx = M
        if (idx % 2 === 0) doc.rect(M, y, CW, rh).fill('#f8fafc')
        cells.forEach((cell, i) => {
          doc.strokeColor('#e2e8f0').lineWidth(0.5).rect(cx, y, CW2[i], rh).stroke()
          fitCell(cell, cx, y, CW2[i], rh, 'Helvetica', 8, '#1e293b')
          cx += CW2[i]
        })
        y += rh
      })
      y += 20
    }

    // ── Crew ──────────────────────────────────────────────────────────────────
    if (crew.length > 0) {
      addPageIfNeeded(60)
      sectionHead('Crew')

      const CC2 = ['ROLE', 'ASSIGNED NAME']
      const CW3 = [180, CW - 180]
      const rh = 18
      let cx = M
      doc.rect(M, y, CW, rh).fill('#1e293b')
      CC2.forEach((h, i) => {
        doc.fillColor('#94a3b8').fontSize(7).font('Helvetica-Bold')
           .text(h, cx + 3, y + 5, { width: CW3[i] - 6, lineBreak: false })
        cx += CW3[i]
      })
      y += rh

      crew.forEach((member: any, idx: number) => {
        addPageIfNeeded(rh)
        const cells = [
          member.roleName || '–',
          member.assignedName || '–',
        ]
        cx = M
        if (idx % 2 === 0) doc.rect(M, y, CW, rh).fill('#f8fafc')
        cells.forEach((cell: string, i: number) => {
          doc.strokeColor('#e2e8f0').lineWidth(0.5).rect(cx, y, CW3[i], rh).stroke()
          fitCell(cell, cx, y, CW3[i], rh, 'Helvetica', 8, '#1e293b')
          cx += CW3[i]
        })
        y += rh
      })
      y += 20
    }

    // ── Schedule — 2-row per scene (call-sheet format) ───────────────────────
    if (days.length > 0) {
      addPageIfNeeded(60)
      sectionHead('Shooting Schedule')

      // Column x-positions
      const SNW  = 38   // scene number
      const IEW  = 32   // INT/EXT  /  D/N in row 2
      const LOCW = 210  // location  /  description in row 2
      const CASTW = 115 // cast
      const FLAGW = CW - SNW - IEW - LOCW - CASTW  // remaining ~104
      const cx0 = M
      const cx1 = cx0 + SNW
      const cx2 = cx1 + IEW
      const cx3 = cx2 + LOCW
      const cx4 = cx3 + CASTW
      const rowH1 = 18, rowH2 = 14

      days.forEach((day: any) => {
        addPageIfNeeded(80)

        // Day header — centered, large
        const rawDate = day.date
          ? new Date(day.date + 'T12:00:00').toLocaleDateString('en-SE', {
              weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
            }).toUpperCase()
          : ''
        const dayHeader = `DAY ${day.dayNumber}${rawDate ? `   ·   ${rawDate}` : ''}`
        doc.fillColor('#1e3a5f').fontSize(13).font('Helvetica-Bold')
           .text(dayHeader, M, y, { width: CW, align: 'center' })
        y = doc.y + 3

        const workLine = day.startTime && day.endTime
          ? `${day.startTime} – ${day.endTime}`
          : (day.workHours ?? '')
        if (workLine) {
          doc.fillColor('#64748b').fontSize(9).font('Helvetica')
             .text(workLine, M, y, { width: CW, align: 'center' })
          y = doc.y + 3
        }
        y += 8

        const dayScenes = ((day.sceneIds ?? []) as string[])
          .map((sid: string) => scenes.find((sc: any) => sc.id === sid))
          .filter(Boolean)
          .sort((a: any, b: any) => (a.sceneNumber ?? 0) - (b.sceneNumber ?? 0))

        dayScenes.forEach((scene: any) => {
          const castStr    = ((scene.castIds ?? []) as number[])
            .map((id: number) => castMap[id] ?? String(id)).join(', ')
          const scLinkedLoc  = scene.locationId ? locById[scene.locationId] : null
          const scLocDisplay = scLinkedLoc?.address
            ? `${(scene.location ?? '').toUpperCase()}  ·  ${scLinkedLoc.address}`
            : (scene.location ?? '').toUpperCase()
          const descText = scene.description ?? ''

          // Pre-calculate row 2 height based on wrapped description
          doc.font('Helvetica').fontSize(7.5)
          const descW   = LOCW + CASTW + FLAGW - 6
          const descH   = descText ? doc.heightOfString(descText, { width: descW }) : 0
          const dynRowH2 = Math.max(rowH2, descH + 6)
          const totalH   = rowH1 + dynRowH2

          addPageIfNeeded(totalH + 4)

          // ── Fill cell backgrounds ────────────────────────────────────────────
          doc.rect(cx0, y, SNW, totalH).fill('#2E75B6')
          doc.rect(cx1, y, IEW,  rowH1).fill('#EEF4FB')
          doc.rect(cx2, y, LOCW, rowH1).fill('#EEF4FB')
          doc.rect(cx3, y, CASTW, rowH1).fill('#EEF4FB')
          doc.rect(cx4, y, FLAGW, rowH1).fill('#EEF4FB')
          doc.rect(cx1, y + rowH1, IEW + LOCW + CASTW + FLAGW, dynRowH2).fill('#FFFFFF')

          // ── Scene number (vertically centred) ───────────────────────────────
          doc.fillColor('#FFFFFF').fontSize(11).font('Helvetica-Bold')
             .text(String(scene.sceneNumber ?? ''), cx0, y + totalH / 2 - 6, {
               width: SNW, align: 'center', lineBreak: false,
             })

          // ── Row 1: INT/EXT | Location (auto-fit) | Cast (auto-fit) ──────────
          fitCell(scene.intExt ?? '',  cx1, y, IEW,   rowH1, 'Helvetica-Bold', 8,   '#1e3a5f')
          fitCell(scLocDisplay,        cx2, y, LOCW,  rowH1, 'Helvetica-Bold', 8,   '#1e3a5f')
          fitCell(castStr,             cx3, y, CASTW, rowH1, 'Helvetica',      7.5, '#374151')

          // ── Row 2: D/N | Description (wrapped) ──────────────────────────────
          fitCell(scene.dayNight ?? '', cx1, y + rowH1, IEW, dynRowH2, 'Helvetica-Oblique', 8, '#64748b')
          if (descText) {
            doc.font('Helvetica').fontSize(7.5).fillColor('#374151')
               .text(descText, cx2 + 3, y + rowH1 + 3, { width: descW })
          }

          // ── Borders ──────────────────────────────────────────────────────────
          doc.strokeColor('#CBD5E1').lineWidth(0.4)
          doc.rect(M, y, CW, totalH).stroke()
          doc.moveTo(cx1, y).lineTo(cx1, y + totalH).stroke()
          doc.moveTo(cx1, y + rowH1).lineTo(M + CW, y + rowH1).stroke()
          doc.moveTo(cx2, y).lineTo(cx2, y + rowH1).stroke()
          doc.moveTo(cx3, y).lineTo(cx3, y + rowH1).stroke()

          y += totalH + 2
        })

        if (dayScenes.length === 0) {
          doc.fillColor('#94a3b8').fontSize(8).font('Helvetica-Oblique')
             .text('No scenes scheduled.', M + 10, y)
          y = doc.y + 4
        }

        // End of day line
        const cnt = dayScenes.length
        doc.fillColor('#94a3b8').fontSize(8).font('Helvetica-Oblique')
           .text(
             `End of Day ${day.dayNumber}  ·  ${cnt} scene${cnt !== 1 ? 's' : ''}`,
             M, y + 5, { width: CW, align: 'center' },
           )
        y = doc.y + 16
      })
    }

    // ── Footer ────────────────────────────────────────────────────────────────
    doc.rect(0, PH - 36, PW, 36).fill('#0f172a')
    doc.fillColor('rgba(255,255,255,0.4)').fontSize(8).font('Helvetica')
       .text(`Generated by CineForge · ${new Date().toLocaleDateString('en-SE')}`, M, PH - 22, { width: CW })
    doc.fillColor('rgba(255,255,255,0.4)').fontSize(8)
       .text(prod.title || '', M, PH - 22, { width: CW, align: 'right' })

    doc.end()
  })

  return { pdf: pdfBuffer.toString('base64') }
})

// ─────────────────────────────────────────────────────────────────────────────
// dailyTeacherSummary — Mon–Fri 08:00 morning briefing push to teachers/admins
// ─────────────────────────────────────────────────────────────────────────────

export const dailyTeacherSummary = functions.pubsub
  .schedule('0 8 * * 1-5')
  .timeZone('Europe/Stockholm')
  .onRun(async () => {
    const today    = new Date()
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    const todayStr = today.toISOString().slice(0, 10)

    const [lessonsSnap, equipmentSnap, absenceSnap, overdueSnap] = await Promise.all([
      db.collection('lessons')
        .where('startTime', '>=', admin.firestore.Timestamp.fromDate(today))
        .where('startTime', '<',  admin.firestore.Timestamp.fromDate(tomorrow))
        .get(),
      db.collection('equipment_bookings').where('status', '==', 'pending').get(),
      db.collection('absence_reports').where('status', '==', 'pending').get(),
      db.collection('inventory_projects').where('status', '==', 'checked-out').where('returnDate', '<', todayStr).get(),
    ])

    const parts: string[] = []
    if (lessonsSnap.size    > 0) parts.push(`${lessonsSnap.size} lesson${lessonsSnap.size > 1 ? 's' : ''} today`)
    if (equipmentSnap.size  > 0) parts.push(`${equipmentSnap.size} equipment request${equipmentSnap.size > 1 ? 's' : ''}`)
    if (absenceSnap.size    > 0) parts.push(`${absenceSnap.size} absence report${absenceSnap.size > 1 ? 's' : ''}`)
    if (overdueSnap.size    > 0) parts.push(`${overdueSnap.size} overdue return${overdueSnap.size > 1 ? 's' : ''}`)

    if (parts.length === 0) return null

    const dateLabel = new Intl.DateTimeFormat('en-SE', { weekday: 'long', day: 'numeric', month: 'short' }).format(today)
    await pushToTeachersAndAdmins(
      `☀️ Good morning — ${dateLabel}`,
      parts.join(' · '),
      '/teacher',
    )
    return null
  })

// ─────────────────────────────────────────────────────────────────────────────
// receiveOfficeCalendarEvent — HTTP webhook for Power Automate → Office 365
// calendar sync. One sync config (office_calendar_syncs/{syncId}) per external
// Outlook calendar; each carries its own shared secret and target cohortId.
// No Firebase Auth involved — Power Automate authenticates with a header secret.
// ─────────────────────────────────────────────────────────────────────────────

interface OfficeSyncPayload {
  externalId:  string            // Outlook event Id from the Graph trigger
  subject?:    string
  start?:      string            // ISO datetime
  end?:        string            // ISO datetime
  location?:   string
  isAllDay?:   boolean | string  // Power Automate often sends "True"/"False" as text
  changeType?: string
}

// Power Automate's raw-JSON body editor frequently stringifies non-string dynamic
// content (booleans included), so accept either shape here.
function toBool(v: boolean | string | undefined): boolean {
  if (typeof v === 'boolean') return v
  return String(v ?? '').toLowerCase() === 'true'
}

// ─────────────────────────────────────────────────────────────────────────────
// inspectUserClaims — admin: get + optionally clear stale cohortId claim
// Usage: { uid, fix: false } → inspect only  |  { uid, fix: true } → clear claim
// ─────────────────────────────────────────────────────────────────────────────

export const inspectUserClaims = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.')
  if (context.auth.token.role !== 'admin') throw new functions.https.HttpsError('permission-denied', 'Admin only.')

  const uid = data?.uid as string | undefined
  if (!uid) throw new functions.https.HttpsError('invalid-argument', 'uid required.')

  const userRecord = await admin.auth().getUser(uid)
  const claims     = userRecord.customClaims ?? {}
  const firestoreSnap = await db.collection('users').doc(uid).get()
  const firestoreDoc  = firestoreSnap.exists ? firestoreSnap.data() : null

  const report = {
    uid,
    email:             userRecord.email,
    claimRole:         claims.role     ?? null,
    claimCohortId:     claims.cohortId ?? null,
    firestoreRole:     firestoreDoc?.role     ?? null,
    firestoreCohortId: firestoreDoc?.cohortId ?? null,
    mismatch:          (claims.cohortId ?? null) !== (firestoreDoc?.cohortId ?? null),
    fixed:             false,
  }

  if (data?.fix === true && report.mismatch) {
    await admin.auth().setCustomUserClaims(uid, {
      ...claims,
      cohortId: firestoreDoc?.cohortId ?? null,
    })
    report.fixed = true
  }

  return report
})

// ─────────────────────────────────────────────────────────────────────────────
// fixAllTeacherClaims — admin: scan all teacher/admin users and clear stale cohortId claims
// ─────────────────────────────────────────────────────────────────────────────

export const fixAllTeacherClaims = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.')
  if (context.auth.token.role !== 'admin') throw new functions.https.HttpsError('permission-denied', 'Admin only.')

  const usersSnap = await db.collection('users')
    .where('role', 'in', ['teacher', 'admin'])
    .get()

  const results: { uid: string; email: string; was: string | null; fixed: boolean }[] = []

  for (const docSnap of usersSnap.docs) {
    const fsData  = docSnap.data()
    const uid     = docSnap.id
    let userRecord: admin.auth.UserRecord
    try { userRecord = await admin.auth().getUser(uid) } catch { continue }
    const claims = userRecord.customClaims ?? {}
    const claimCohortId = claims.cohortId ?? null
    if (claimCohortId !== null) {
      await admin.auth().setCustomUserClaims(uid, { ...claims, cohortId: null })
      results.push({ uid, email: userRecord.email ?? '', was: claimCohortId, fixed: true })
    } else {
      results.push({ uid, email: userRecord.email ?? '', was: null, fixed: false })
    }
  }

  return { scanned: results.length, fixed: results.filter(r => r.fixed).length, results }
})

export const receiveOfficeCalendarEvent = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed. Use POST.' })
    return
  }

  const syncId = String(req.query.syncId ?? '')
  if (!syncId) {
    res.status(400).json({ error: 'Missing ?syncId=... in the webhook URL.' })
    return
  }

  const syncSnap = await db.collection('office_calendar_syncs').doc(syncId).get()
  if (!syncSnap.exists) {
    res.status(404).json({ error: 'Unknown syncId.' })
    return
  }
  const sync = syncSnap.data()!

  const providedSecret = req.get('x-webhook-secret') ?? ''
  if (!sync.webhookSecret || providedSecret !== sync.webhookSecret) {
    res.status(401).json({ error: 'Invalid or missing x-webhook-secret header.' })
    return
  }

  if (sync.enabled === false) {
    // Toggled off in the app — accept the call so the Power Automate run
    // still shows "succeeded", but don't write anything.
    res.status(200).json({ ok: true, skipped: true, reason: 'sync is disabled' })
    return
  }

  const body = (req.body ?? {}) as OfficeSyncPayload

  // Log full payload so we can see exactly what Power Automate sends
  console.log('[officeSync] raw body:', JSON.stringify({
    externalId:  body.externalId,
    subject:     body.subject,
    start:       body.start,
    end:         body.end,
    isAllDay:    body.isAllDay,
    changeType:  body.changeType,
    location:    body.location,
    syncId,
    allKeys: Object.keys(req.body ?? {}),
  }))

  if (!body.externalId) {
    res.status(400).json({ error: 'externalId is required.' })
    return
  }

  const docId = `${syncId}_${body.externalId}`
  const eventRef = db.collection('synced_events').doc(docId)

  try {
    const DELETE_MARKERS = [
      'deleted', 'delete', 'removed',
      'togs bort', 'borttagen', 'raderad',
      'cancelled', 'canceled',
    ]
    const changeTypeLc = (body.changeType ?? '').toLowerCase()
    const isDelete = DELETE_MARKERS.some(m => changeTypeLc.includes(m)) || !body.subject

    console.log('[officeSync] action:', isDelete ? 'DELETE' : 'UPSERT',
      '| changeType:', body.changeType, '| docId:', docId)

    if (isDelete) {
      await eventRef.delete()
      // Also scan for any docs with same externalId but different syncId prefix (safety net)
      const staleSnap = await db.collection('synced_events')
        .where('externalId', '==', body.externalId)
        .get()
      if (!staleSnap.empty) {
        const batch = db.batch()
        staleSnap.docs.forEach(d => batch.delete(d.ref))
        await batch.commit()
        console.log('[officeSync] deleted', staleSnap.size, 'stale doc(s) with externalId', body.externalId)
      }
    } else {
      const startDate = body.start ? new Date(body.start) : null
      const endDate   = body.end   ? new Date(body.end)   : null
      if (!startDate || isNaN(startDate.getTime())) {
        res.status(400).json({ error: 'start is required and must be a valid ISO datetime.' })
        return
      }
      const allDay = toBool(body.isAllDay)
      console.log('[officeSync] allDay resolved:', allDay, '(raw:', body.isAllDay, ')')
      await eventRef.set({
        syncId,
        cohortId:   sync.cohortId ?? 'all',
        externalId: body.externalId,
        title:      body.subject,
        startTime:  admin.firestore.Timestamp.fromDate(startDate),
        endTime:    endDate && !isNaN(endDate.getTime()) ? admin.firestore.Timestamp.fromDate(endDate) : null,
        allDay,
        location:   body.location || null,
        source:     'office365',
        updatedAt:  admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true })
    }

    await syncSnap.ref.update({
      lastReceivedAt: admin.firestore.FieldValue.serverTimestamp(),
      eventCount:     admin.firestore.FieldValue.increment(1),
    })

    res.status(200).json({ ok: true })
  } catch (err: any) {
    console.error('receiveOfficeCalendarEvent failed', err)
    res.status(500).json({ error: err?.message ?? 'Unknown error' })
  }
})
