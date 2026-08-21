import * as path from 'path'
import { functions, db, escapeHtml, getResend, getEmailConfig, requireTeacherOrAdmin, PDFDocument } from './lib'
import { getOrCreateBookingsChannel, postToBookingsChannel, pushToTeachersAndAdmins, pushToStudent } from './notifications-core'

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
