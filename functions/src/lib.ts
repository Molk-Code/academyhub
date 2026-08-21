import * as admin from 'firebase-admin'
import * as functions from 'firebase-functions/v1'
import { Resend } from 'resend'
import * as PDFDocumentLib from 'pdfkit'
export const PDFDocument = PDFDocumentLib as unknown as typeof import('pdfkit')

admin.initializeApp()
export const db = admin.firestore()

export { admin, functions }

export function getResend() {
  return new Resend(process.env.RESEND_API_KEY)
}

// Escape user-supplied content before inserting into HTML strings
export function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function requireTeacherOrAdmin(context: functions.https.CallableContext): void {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.')
  const r = context.auth.token.role
  if (r !== 'teacher' && r !== 'admin') {
    throw new functions.https.HttpsError('permission-denied', 'Only teachers and admins can perform this action.')
  }
}

export async function getEmailConfig() {
  const snap = await db.collection('email_config').doc('global').get()
  return snap.exists
    ? snap.data() as { foodBoxEmail: string; minivanEmail: string; fromName: string; fromEmail: string }
    : null
}
