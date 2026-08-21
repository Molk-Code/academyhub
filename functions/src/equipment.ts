import * as path from 'path'
import { admin, functions, db, escapeHtml, getResend, getEmailConfig, requireTeacherOrAdmin, PDFDocument } from './lib'
import { sendPush, getOrCreateBookingsChannel, postToBookingsChannel, pushToTeachersAndAdmins, pushToStudent } from './notifications'

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
// sendMinivanEmail — notify staff about a new minivan booking request via Resend
// ─────────────────────────────────────────────────────────────────────────────

export const sendMinivanEmail = functions.runWith({ secrets: ['RESEND_API_KEY'] }).https.onCall(async (data, context) => {
  requireTeacherOrAdmin(context)

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
    subject:   `Minivan Request – ${String(d.dateFrom ?? '').replace(/[\r\n]/g, ' ')} → ${String(d.dateTo ?? '').replace(/[\r\n]/g, ' ')} (${String(d.contactPerson ?? '').replace(/[\r\n]/g, ' ')})`,
    html,
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
      // Notify the student before deleting so they know why it was rejected
      const studentSnap = await db.collection('users').doc(booking.studentId as string).get()
      const tokens: string[] = studentSnap.data()?.fcmTokens ?? []
      await sendPush(tokens, {
        title: '⚠️ Equipment booking limit reached',
        body: 'You already have 5 pending requests. Cancel or wait for one to be confirmed before adding more.',
        url: '/booking/equipment',
        tag: 'equipment-booking',
      })
      await snap.ref.delete()
      return null
    }

    // Enforce equipment access restrictions (filmYear2Only / allowedCohortIds)
    const studentSnap2 = await db.collection('users').doc(booking.studentId as string).get()
    const studentData = studentSnap2.data()
    const items: { equipmentId: string }[] = booking.items ?? []
    for (const item of items) {
      if (!item.equipmentId) continue
      const equipSnap = await db.collection('equipment').doc(item.equipmentId).get()
      if (!equipSnap.exists) continue
      const equip = equipSnap.data()!
      const cohortSnap = studentData?.cohortId
        ? await db.collection('cohorts').doc(studentData.cohortId).get()
        : null
      const programYear: number = cohortSnap?.data()?.programYear ?? 1
      if (equip.filmYear2Only && programYear !== 2) {
        await snap.ref.delete()
        const tokens: string[] = studentData?.fcmTokens ?? []
        await sendPush(tokens, {
          title: '🚫 Booking rejected',
          body: `"${equip.name}" is only available to Year 2 students`,
          url: '/booking/equipment',
          tag: 'equipment-booking',
        })
        return null
      }
      if (equip.allowedCohortIds?.length > 0 && studentData?.cohortId && !equip.allowedCohortIds.includes(studentData.cohortId)) {
        await snap.ref.delete()
        const tokens: string[] = studentData?.fcmTokens ?? []
        await sendPush(tokens, {
          title: '🚫 Booking rejected',
          body: `"${equip.name}" is not available for your class`,
          url: '/booking/equipment',
          tag: 'equipment-booking',
        })
        return null
      }
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
    } else if (after.status === 'checked-out') {
      await sendPush(tokens, {
        title: '📦 Equipment checked out',
        body:  `Equipment for "${after.projectName}" has been handed over — remember to return it on time`,
        url:   '/booking/equipment',
        tag:   'equipment-booking',
      })
    } else if (after.status === 'returned') {
      await sendPush(tokens, {
        title: '✅ Equipment returned',
        body:  `Your equipment for "${after.projectName}" has been marked as returned`,
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

// Suppress unused-variable warnings for admin import required by pattern
void admin
