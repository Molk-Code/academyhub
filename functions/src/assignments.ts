import { admin, functions, db, requireTeacherOrAdmin } from './lib'
import { sendPush, saveNotifications } from './notifications-core'
import { updateProgress, checkLevelUp } from './points'

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
