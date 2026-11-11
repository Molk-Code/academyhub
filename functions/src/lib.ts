import * as admin from 'firebase-admin'
import * as functions from 'firebase-functions/v1'
import { defineString } from 'firebase-functions/params'
import { Resend } from 'resend'
import * as PDFDocumentLib from 'pdfkit'
export const PDFDocument = PDFDocumentLib as unknown as typeof import('pdfkit')

admin.initializeApp()
export const db = admin.firestore()

export { admin, functions }

// Region every function deploys to. A param, not process.env: the CLI reads
// regions before it loads .env files. Set per project in
// functions/.env.<projectId> (us-central1 for production, europe-west1 for EU).
export const REGION = defineString('FUNCTIONS_REGION', { default: 'us-central1' })

// Site that password-reset and invite links send users back to. Unset
// (production) keeps today's URL; set it to the custom domain at cutover.
export const APP_URL = process.env.APP_URL ?? 'https://academy-hub-c252f.web.app'

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

// ── Load / abuse guards ───────────────────────────────────────────────────────

// Cap on concurrent instances for every function, so a flood of requests or
// events can't scale (and bill) without limit. Normal school traffic needs a
// handful; bursts like 20 items scanned at once still fit.
export const LIMITS = { maxInstances: 50 } as const

// A signed-in account that belongs to the school: it has a role claim (set
// from an invite) or a profile doc. A bare Firebase Auth account created
// straight against the API has neither.
export async function requireMember(context: functions.https.CallableContext): Promise<string> {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.')
  const role = context.auth.token.role
  if (role === 'student' || role === 'teacher' || role === 'admin') return context.auth.uid
  if ((await db.collection('users').doc(context.auth.uid).get()).exists) return context.auth.uid
  throw new functions.https.HttpsError('permission-denied', 'This account is not part of the school.')
}

// Fixed-window rate limit per user and action, e.g. allow(uid, 'pdf', 10) =
// at most 10 per minute (or per windowMs). Returns false when over the limit.
export async function allow(uid: string, key: string, perMinute: number, windowMs = 60_000): Promise<boolean> {
  const ref = db.collection('rate_limits').doc(`${uid}_${key}`)
  return db.runTransaction(async tx => {
    const s = (await tx.get(ref)).data() as { n: number; t: number } | undefined
    const now = Date.now()
    if (s && now - s.t < windowMs) {
      if (s.n >= perMinute) return false
      tx.set(ref, { n: s.n + 1, t: s.t })
    } else {
      tx.set(ref, { n: 1, t: now })
    }
    return true
  })
}

export async function requireAllowed(uid: string, key: string, perMinute: number): Promise<void> {
  if (!(await allow(uid, key, perMinute))) {
    throw new functions.https.HttpsError('resource-exhausted', 'Too many requests — wait a minute and try again.')
  }
}

// Give up on a slow outside service instead of holding the function for its
// whole timeout.
export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms)),
  ])
}

// Resend with a 10 s cap — a hung email API fails the call quickly instead of
// holding the function for its whole timeout. Errors still reach the caller.
export async function sendEmailOrThrow(msg: Parameters<ReturnType<typeof getResend>['emails']['send']>[0]) {
  const res = await withTimeout(getResend().emails.send(msg), 10_000, 'Email service')
  if ((res as { error?: { message?: string } })?.error) {
    throw new Error(`Email service error: ${(res as { error?: { message?: string } }).error?.message ?? 'unknown'}`)
  }
  return res
}
