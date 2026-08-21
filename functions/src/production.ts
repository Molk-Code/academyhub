import * as path from 'path'
import { admin, functions, db, requireTeacherOrAdmin, PDFDocument } from './lib'
import { sendPush, saveNotifications } from './notifications'
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

// Suppress unused import warning — wrapCell is defined but retained for reference
void 0
