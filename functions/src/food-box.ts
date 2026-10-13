import { functions, db, getResend, getEmailConfig, requireTeacherOrAdmin, PDFDocument } from './lib'
import { getOrCreateBookingsChannel, postToBookingsChannel, pushToAdmins, pushToStudent } from './notifications-core'

// ─────────────────────────────────────────────────────────────────────────────
// generateFoodBoxPdf — Swedish kitchen pickup checklist, modeled on the
// school's own paper form ("Beställningslista för avhämtning från köket"):
// a plain printable form with Kontaktperson/Mobilnummer/Datum/Tid fields, an
// "Önskad måltid" summary (package + headcount + heat-up question), and a
// Namn / Internat / Lunch / Middag checkbox table — rather than a styled
// digital receipt — so kitchen staff can work from something that matches
// what they're used to.
// ─────────────────────────────────────────────────────────────────────────────

function generateFoodBoxPdf(d: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // Smaller bottom margin than top/left/right so the footer (drawn at an
    // explicit y near the physical page bottom) has room — PDFKit auto-adds
    // a page if a .text() call falls outside the configured margin box, even
    // with an explicit y.
    const doc = new PDFDocument({ margins: { top: 48, bottom: 10, left: 48, right: 48 }, size: 'A4' })
    const bufs: Buffer[] = []
    doc.on('data', (c: Buffer) => bufs.push(c))
    doc.on('end',  () => resolve(Buffer.concat(bufs)))
    doc.on('error', reject)

    const PW = 595
    const PH = 842
    const M  = 48
    const CW = PW - M * 2

    const effectiveDate = d.adminDate       ?? d.date       ?? d.pickupDate ?? ''
    const effectiveTime = d.adminPickupTime ?? d.pickupTime ?? ''
    const adminModified = !!(d.adminDate || d.adminPickupTime)

    const morningStudents: string[] = d.morningStudents ?? []
    const lunchStudents:   string[] = d.lunchStudents   ?? []
    const dinnerStudents:  string[] = d.dinnerStudents  ?? []

    let y = M

    // ── Title ────────────────────────────────────────────────────────────────
    doc.fillColor('#000000').fontSize(17).font('Helvetica-Bold')
       .text('Beställningslista för avhämtning från köket', M, y, { width: CW })
    y = doc.y + 8

    // Status pill, top-right of the title
    const statusLabel = d.status === 'confirmed' ? 'BEKRÄFTAD' : d.status === 'cancelled' ? 'AVBOKAD' : 'VÄNTAR'
    const statusColor = d.status === 'confirmed' ? '#10b981' : d.status === 'cancelled' ? '#ef4444' : '#f59e0b'
    doc.roundedRect(PW - M - 80, M, 80, 20, 4).fill(statusColor)
    doc.fillColor('#ffffff').fontSize(9).font('Helvetica-Bold')
       .text(statusLabel, PW - M - 80, M + 5, { width: 80, align: 'center' })

    // Yellow lead-time banner, same as the paper form
    const bannerH = 20
    doc.rect(M, y, CW, bannerH).fill('#fff6a3')
    doc.fillColor('#000000').fontSize(10).font('Helvetica-Bold')
       .text('Beställningen är inlämnad till köket', M + 8, y + 5)
    y += bannerH + 16

    // ── Contact / date / time fields ────────────────────────────────────────
    function filledField(label: string, value: string, x: number, w: number) {
      doc.fillColor('#000000').fontSize(10).font('Helvetica')
         .text(`${label}: `, x, y, { continued: true })
         .font('Helvetica-Bold').text(value || '–')
    }
    filledField('Kontaktperson', d.contactPerson || '–', M, CW / 2)
    doc.fillColor('#000000').fontSize(10).font('Helvetica')
       .text('Mobilnummer: ', M + CW / 2, y, { continued: true })
       .font('Helvetica-Bold').text(d.phoneNumber || '–')
    y = doc.y + 10

    filledField('Datum för avhämtning', effectiveDate || '–', M, CW)
    y = doc.y + 10
    filledField('Tid för avhämtning', effectiveTime || '–', M, CW)
    y = doc.y + 18

    // ── Checkbox + line-drawing helpers ─────────────────────────────────────
    function checkbox(x: number, cy: number, checked: boolean) {
      const s = 10
      doc.rect(x, cy, s, s).stroke('#000000')
      if (checked) {
        doc.moveTo(x + 2, cy + 5).lineTo(x + 4, cy + 8).lineTo(x + 8, cy + 2).stroke('#000000')
      }
    }

    // ── "Önskad måltid" summary ─────────────────────────────────────────────
    doc.fillColor('#000000').fontSize(11).font('Helvetica-Bold').text('Önskad måltid:', M, y)
    y = doc.y + 8

    function mealPackage(label: string, students: string[], canHeat: boolean | null) {
      checkbox(M, y, students.length > 0)
      doc.fillColor('#000000').fontSize(10).font('Helvetica')
         .text(label, M + 16, y - 1)
      doc.text(`Antal personer: ${students.length}`, M + 160, y - 1)
      y += 18
      doc.text('Möjlighet att värma matlådan?', M + 16, y)
      doc.text('Ja', M + 200, y, { continued: false })
      checkbox(M + 218, y - 1, canHeat === true)
      doc.text('Nej', M + 240, y)
      checkbox(M + 262, y - 1, canHeat === false)
      y += 22
    }

    mealPackage('Lunchpaket', lunchStudents, d.lunchCanHeat)
    mealPackage('Middagspaket', dinnerStudents, d.dinnerCanHeat)
    y += 4

    // ── Namn / Internat / Lunch / Middag table ──────────────────────────────
    const names = Array.from(new Set([...morningStudents, ...lunchStudents, ...dinnerStudents])).sort((a, b) => a.localeCompare(b, 'sv'))

    const colName = M
    const colNameW = CW - 240
    const col1 = M + colNameW
    const col2 = col1 + 80
    const col3 = col2 + 80
    const colW = 80
    const rowH = 22
    const headerH = 24

    function tableHeader() {
      doc.rect(M, y, CW, headerH).fill('#f1f5f9')
      doc.fillColor('#000000').fontSize(9).font('Helvetica-Bold')
         .text('Namn', colName + 6, y + 7)
         .text('Internat', col1, y + 7, { width: colW, align: 'center' })
         .text('Lunch', col2, y + 7, { width: colW, align: 'center' })
         .text('Middag', col3, y + 7, { width: colW, align: 'center' })
      doc.rect(M, y, CW, headerH).stroke('#cbd5e1')
      y += headerH
    }

    tableHeader()

    if (names.length === 0) {
      doc.fillColor('#64748b').fontSize(9).font('Helvetica-Oblique')
         .text('Inga namn tillagda', colName + 6, y + 7)
      y += rowH
    } else {
      for (const name of names) {
        if (y + rowH > PH - 70) {
          doc.addPage()
          y = M
          tableHeader()
        }
        doc.rect(M, y, CW, rowH).stroke('#e2e8f0')
        doc.fillColor('#000000').fontSize(10).font('Helvetica')
           .text(name, colName + 6, y + 6, { width: colNameW - 10 })
        const cbY = y + 6
        checkbox(col1 + colW / 2 - 5, cbY, morningStudents.includes(name))
        checkbox(col2 + colW / 2 - 5, cbY, lunchStudents.includes(name))
        checkbox(col3 + colW / 2 - 5, cbY, dinnerStudents.includes(name))
        y += rowH
      }
    }
    y += 16

    // ── Notes (diet, other notes) ───────────────────────────────────────────
    const notes = [
      d.morningDiet?.trim() ? `Internat – specialkost: ${d.morningDiet.trim()}` : '',
      d.lunchDiet?.trim()   ? `Lunch – specialkost: ${d.lunchDiet.trim()}`     : '',
      d.dinnerDiet?.trim()  ? `Middag – specialkost: ${d.dinnerDiet.trim()}`   : '',
      d.otherNotes?.trim()  ? `Övrigt: ${d.otherNotes.trim()}`                 : '',
    ].filter(Boolean)
    if (notes.length > 0) {
      if (y + notes.length * 14 + 10 > PH - 70) { doc.addPage(); y = M }
      doc.fillColor('#000000').fontSize(9).font('Helvetica')
      for (const note of notes) {
        doc.text(note, M, y, { width: CW })
        y = doc.y + 4
      }
      y += 10
    }

    // ── Admin-confirmed date/time notice ────────────────────────────────────
    if (adminModified) {
      if (y + 40 > PH - 70) { doc.addPage(); y = M }
      const noticeH = 36
      doc.roundedRect(M, y, CW, noticeH, 6).fill('#f0fdf4')
      doc.rect(M, y, 4, noticeH).fill('#10b981')
      doc.fillColor('#14532d').fontSize(9).font('Helvetica-Bold')
         .text('Admin har justerat datum/tid från ursprunglig beställning', M + 14, y + 8, { width: CW - 20 })
      doc.fillColor('#166534').fontSize(9).font('Helvetica')
         .text(`Datum: ${effectiveDate}  ·  Tid: ${effectiveTime || '–'}`, M + 14, y + 21, { width: CW - 20 })
      y += noticeH + 10
    }

    // ── Footer ───────────────────────────────────────────────────────────────
    doc.fillColor('#94a3b8').fontSize(7).font('Helvetica')
       .text(`Genererad av CineForge  ·  ${new Date().toLocaleDateString('sv-SE')}  ·  Order-ID: ${d.id ?? ''}`, M, PH - 28, { width: CW })

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

// Preserve legacy exports for helpers unused by callers but retained for parity
export const _pdfHelpers = { pdfTextBox, pdfHeatRowSwedish, pdfHeatRow }

// ─────────────────────────────────────────────────────────────────────────────
// sendFoodBoxEmail — generate PDF replica of form and email it via Resend
// ─────────────────────────────────────────────────────────────────────────────

const FOOD_BOX_RECIPIENT = 'fredrik.fridlund@regionvarmland.se'

export const sendFoodBoxEmail = functions.runWith({ secrets: ['RESEND_API_KEY'] }).https.onCall(async (data, context) => {
  requireTeacherOrAdmin(context)

  const d = data as any
  const emailCfg = await getEmailConfig()

  const recipients = new Set<string>([FOOD_BOX_RECIPIENT])
  if (emailCfg?.foodBoxEmail && emailCfg.foodBoxEmail !== FOOD_BOX_RECIPIENT) {
    recipients.add(emailCfg.foodBoxEmail)
  }

  const sanitize = (s: string) => String(s ?? '').replace(/[\r\n]/g, ' ').trim()
  const pdfBuffer = await generateFoodBoxPdf(d)
  const filename  = `food-order-${sanitize(d.pickupDate)}-${sanitize(d.contactPerson).replace(/\s+/g, '-')}.pdf`
  const fromName  = emailCfg?.fromName  || 'CineForge'
  const fromEmail = emailCfg?.fromEmail || 'onboarding@resend.dev'

  await getResend().emails.send({
    from:        `${fromName} <${fromEmail}>`,
    to:          [...recipients],
    replyTo:    d.studentEmail || undefined,
    subject:     `Food Box Order – ${sanitize(d.pickupDate)} at ${sanitize(d.pickupTime)} (${sanitize(d.contactPerson)})`,
    text:        `New food box order from ${sanitize(d.studentName)}. See attached PDF.`,
    attachments: [{ filename, content: pdfBuffer.toString('base64') }],
  })

  return { success: true }
})

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
      (d.morningStudents?.length > 0) ? `🏠 Internat ×${d.morningStudents.length}` : '',
      (d.lunchStudents?.length   > 0) ? `🥗 Lunch ×${d.lunchStudents.length}`   : '',
      (d.dinnerStudents?.length  > 0) ? `🍽️ Middag ×${d.dinnerStudents.length}`  : '',
    ].filter(Boolean).join('  ·  ')

    const text = `🍱 **New food box order** from ${d.studentName}\nDate: ${d.date}  ·  ${meals}`

    const channelId = await getOrCreateBookingsChannel()
    await postToBookingsChannel(channelId, text)
    await pushToAdmins(
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

  const order = { ...snap.data()!, id: snap.id }
  const pdfBuffer = await generateFoodBoxPdf(order)
  return { pdf: pdfBuffer.toString('base64') }
})
