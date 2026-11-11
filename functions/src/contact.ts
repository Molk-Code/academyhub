import { createHash, randomBytes } from 'crypto'
import { FieldValue, FieldPath, Timestamp } from 'firebase-admin/firestore'
import { functions, db, escapeHtml, sendEmailOrThrow, getEmailConfig, LIMITS, REGION, allow } from './lib'

// ─────────────────────────────────────────────────────────────────────────────
// Public contact form (login page → /contact). Signed-out callers allowed.
// Requests land in contact_requests (admin-only in firestore.rules; written
// only here) and are emailed to CONTACT_NOTIFY_EMAIL.
// ─────────────────────────────────────────────────────────────────────────────

// How long contact requests are kept before purgeOldContactRequests deletes
// them (legal-hold excepted). The privacy policy states the same period:
// keep contactRetentionMonths in src/config/legal.ts in step with this.
export const CONTACT_RETENTION_MONTHS = 12

export const CONTACT_CATEGORIES = ['school_enquiry', 'support', 'legal'] as const
export type ContactCategory = typeof CONTACT_CATEGORIES[number]

const PER_IP_PER_HOUR = 5
const GLOBAL_PER_HOUR = 20
const HOUR = 60 * 60_000

export interface ContactInput {
  name: string
  email: string
  organisation: string | null
  category: ContactCategory
  message: string
}

const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]{2,}$/

// Validated copy of the caller's data, or an invalid-argument error
export function validateContact(data: unknown): ContactInput {
  const d = (data ?? {}) as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const bad = (msg: string) => new functions.https.HttpsError('invalid-argument', msg)

  const name = str(d.name)
  const email = str(d.email)
  const organisation = str(d.organisation)
  const message = str(d.message)
  const category = d.category

  if (!name || name.length > 120) throw bad('Name is required (max 120 characters).')
  if (email.length > 200 || !EMAIL_RE.test(email)) throw bad('A valid email address is required (max 200 characters).')
  if (d.organisation !== undefined && d.organisation !== null && typeof d.organisation !== 'string') throw bad('Organisation must be text.')
  if (organisation.length > 200) throw bad('Organisation is too long (max 200 characters).')
  if (!CONTACT_CATEGORIES.includes(category as ContactCategory)) throw bad('Unknown category.')
  if (message.length < 10 || message.length > 4000) throw bad('Message must be 10–4000 characters.')

  return { name, email, organisation: organisation || null, category: category as ContactCategory, message }
}

// Random per-project salt for IP hashes, created on first use. Kept in a
// collection with no client rules, so only the Admin SDK can read it.
let saltCache: string | null = null
async function ipSalt(): Promise<string> {
  if (saltCache) return saltCache
  const ref = db.collection('private_config').doc('contact')
  saltCache = await db.runTransaction(async tx => {
    const existing = (await tx.get(ref)).data()?.ipSalt as string | undefined
    if (existing) return existing
    const salt = randomBytes(32).toString('hex')
    tx.set(ref, { ipSalt: salt }, { merge: true })
    return salt
  })
  return saltCache
}

export async function hashIp(ip: string): Promise<string> {
  return createHash('sha256').update(`${await ipSalt()}:${ip}`).digest('hex')
}

function clientIp(req?: { headers?: Record<string, unknown>; ip?: string }): string {
  const fwd = req?.headers?.['x-forwarded-for']
  const first = (Array.isArray(fwd) ? fwd[0] : typeof fwd === 'string' ? fwd : '').split(',')[0].trim()
  return first || req?.ip || 'unknown'
}

type EmailMessage = Parameters<typeof sendEmailOrThrow>[0]

export interface ContactDeps {
  sendEmail: (msg: EmailMessage) => Promise<unknown>
  notifyEmail: string | undefined
}

// Everything submitContactRequest does, minus the callable wrapper, so tests
// can run it against the emulator with a fake mailer.
export async function handleContactRequest(
  data: unknown,
  meta: { ip: string; userAgent: string },
  deps: ContactDeps,
): Promise<{ ok: true }> {
  // Honeypot: real users never see the field, bots fill it. Pretend success.
  const website = (data as Record<string, unknown> | null)?.website
  if (typeof website === 'string' && website.trim() !== '') return { ok: true }

  const input = validateContact(data)

  const ipHash = await hashIp(meta.ip)
  const tooMany = () => new functions.https.HttpsError('resource-exhausted', 'Too many messages right now — please try again later or email us directly.')
  if (!(await allow(`ip_${ipHash}`, 'contact', PER_IP_PER_HOUR, HOUR))) throw tooMany()
  if (!(await allow('global', 'contact', GLOBAL_PER_HOUR, HOUR))) throw tooMany()

  const ref = await db.collection('contact_requests').add({
    ...input,
    status: 'new',
    createdAt: FieldValue.serverTimestamp(),
    ipHash,
    userAgent: meta.userAgent.slice(0, 200),
  })

  // The request is saved; a failed email is logged, never surfaced or undone
  try {
    if (!deps.notifyEmail) throw new Error('CONTACT_NOTIFY_EMAIL is not set — contact request saved but nobody was emailed')
    const emailCfg = await getEmailConfig()
    const fromName  = emailCfg?.fromName  || 'CineForge'
    const fromEmail = emailCfg?.fromEmail || 'onboarding@resend.dev'
    const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ')
    const label = { school_enquiry: 'School enquiry', support: 'Support', legal: 'Legal' }[input.category]
    await deps.sendEmail({
      from:    `${fromName} <${fromEmail}>`,
      to:      [deps.notifyEmail],
      replyTo: input.email,
      subject: oneLine(`[CineForge contact] ${label}: ${input.name}${input.organisation ? ` (${input.organisation})` : ''}`),
      html: [
        `<b>Category:</b> ${escapeHtml(label)}`,
        `<b>Name:</b> ${escapeHtml(input.name)}`,
        `<b>Email:</b> ${escapeHtml(input.email)}`,
        input.organisation ? `<b>Organisation:</b> ${escapeHtml(input.organisation)}` : '',
        `<b>Request id:</b> ${escapeHtml(ref.id)}`,
        '',
        `<div style="white-space:pre-wrap">${escapeHtml(input.message)}</div>`,
      ].filter(line => line !== '').join('<br>'),
    })
  } catch (err) {
    console.error(`Contact request ${ref.id} saved, but the notification email failed:`, err)
  }

  return { ok: true }
}

export const submitContactRequest = functions.region(REGION)
  .runWith({ ...LIMITS, maxInstances: 5, secrets: ['RESEND_API_KEY'] })
  .https.onCall(async (data, context) => {
    // App Check: off until the project has a reCAPTCHA site key and App
    // Check registered; set CONTACT_REQUIRE_APP_CHECK=true in
    // functions/.env.<project> to reject calls without a valid token.
    if (process.env.CONTACT_REQUIRE_APP_CHECK === 'true' && !context.app) {
      throw new functions.https.HttpsError('failed-precondition', 'This form must be sent from the CineForge app.')
    }
    const req = context.rawRequest as unknown as { headers?: Record<string, unknown>; ip?: string }
    const ua = req?.headers?.['user-agent']
    return handleContactRequest(data, { ip: clientIp(req), userAgent: typeof ua === 'string' ? ua : '' }, {
      notifyEmail: process.env.CONTACT_NOTIFY_EMAIL || undefined,
      // The emulator never sends real mail: print what would have gone out
      sendEmail: process.env.FUNCTIONS_EMULATOR === 'true'
        ? async msg => { console.log('[emulator] contact email not sent:\n' + JSON.stringify(msg, null, 2)) }
        : sendEmailOrThrow,
    })
  })

// ─────────────────────────────────────────────────────────────────────────────
// purgeOldContactRequests — daily: drop requests past the retention period
// (unless on legal hold) and the hourly rate-limit counters they left behind
// ─────────────────────────────────────────────────────────────────────────────

export async function purgeContactRequests(now = new Date()): Promise<{ deleted: number; kept: number }> {
  const cutoff = new Date(now)
  cutoff.setMonth(cutoff.getMonth() - CONTACT_RETENTION_MONTHS)
  const old = await db.collection('contact_requests')
    .where('createdAt', '<', Timestamp.fromDate(cutoff))
    .get()
  const doomed = old.docs.filter(d => d.data().status !== 'legal-hold')
  for (let i = 0; i < doomed.length; i += 400) {
    const batch = db.batch()
    doomed.slice(i, i + 400).forEach(d => batch.delete(d.ref))
    await batch.commit()
  }

  // Per-IP counters (rate_limits/ip_<hash>_contact) only matter for an hour
  const counters = await db.collection('rate_limits')
    .where(FieldPath.documentId(), '>=', 'ip_')
    .where(FieldPath.documentId(), '<', 'ip`')
    .get()
  const stale = counters.docs.filter(d => d.id.endsWith('_contact') && now.getTime() - (d.data().t ?? 0) > 2 * HOUR)
  for (let i = 0; i < stale.length; i += 400) {
    const batch = db.batch()
    stale.slice(i, i + 400).forEach(d => batch.delete(d.ref))
    await batch.commit()
  }

  return { deleted: doomed.length, kept: old.size - doomed.length }
}

export const purgeOldContactRequests = functions.region(REGION).runWith(LIMITS).pubsub
  .schedule('30 3 * * *')
  .timeZone('Europe/Stockholm')
  .onRun(async () => {
    const { deleted, kept } = await purgeContactRequests()
    console.log(`purgeOldContactRequests: deleted ${deleted}, kept ${kept} on legal hold`)
    return null
  })
