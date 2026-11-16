import { FieldValue } from 'firebase-admin/firestore'
import { scrypt, randomBytes, timingSafeEqual } from 'crypto'
import { promisify } from 'util'
import { functions, db, LIMITS, REGION, SCHOOL_ID, allow, escapeHtml, getEmailConfig, sendEmailOrThrow } from './lib'
import { hashIp, clientIp } from './contact'

// The public rental shop (/shop): who decides whether it's open, and its
// optional password.
//
// - The school admin opens and closes it (schools.publicShop), here.
// - The superadmin can override that (schools.publicShopOverride): 'on' keeps
//   it open, 'off' keeps it closed, absent leaves it to the school admin.
// - Only with Rental & Inventory. Legacy schools (no modules): open exactly
//   when they're in rental mode, as before.
// - A password (shop_private/config, never readable by clients) locks it:
//   schools.shopLocked says so, the rules then stop public catalog reads and
//   the catalog and bookings go through these functions with the password.

export type ShopOverride = 'on' | 'off'

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>
const privateRef = () => db.collection('shop_private').doc('config')

/** Same as publicShopOpen in src/lib/features.ts and firestore.rules (before the lock) */
export function shopOpen(s: FirebaseFirestore.DocumentData): boolean {
  if (s.modules == null) return s.productType === 'rental'
  if (s.modules.rentalInventory !== true) return false
  if (s.publicShopOverride === 'on') return true
  if (s.publicShopOverride === 'off') return false
  return s.publicShop === true
}

export const MIN_PASSWORD = 6
export const MAX_PASSWORD = 100

export async function hashShopPassword(password: string) {
  const salt = randomBytes(16)
  const hash = await scryptAsync(password, salt, 32)
  return { salt: salt.toString('base64'), hash: hash.toString('base64') }
}

export async function shopPasswordMatches(password: unknown): Promise<boolean> {
  if (typeof password !== 'string' || !password || password.length > MAX_PASSWORD) return false
  const p = (await privateRef().get()).data()
  if (!p?.hash || !p?.salt) return false
  const want = Buffer.from(p.hash, 'base64')
  const got = await scryptAsync(password, Buffer.from(p.salt, 'base64'), want.length)
  return timingSafeEqual(want, got)
}

/**
 * For signed-out shop visitors: the shop must be open and, when locked, the
 * password right (rate-limited per IP). Throws otherwise.
 */
export async function requireShopAccess(s: FirebaseFirestore.DocumentData, password: unknown, ip: string) {
  if (!shopOpen(s)) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.')
  if (s.shopLocked !== true) return
  const ipHash = await hashIp(ip)
  if (!(await allow(`ip_${ipHash}`, 'shop-password', 10, 10 * 60_000))) {
    throw new functions.https.HttpsError('resource-exhausted', 'Too many attempts. Wait a few minutes and try again.')
  }
  if (!(await shopPasswordMatches(password))) throw new functions.https.HttpsError('permission-denied', 'Wrong password.')
}

async function schoolDoc() {
  return (await db.collection('schools').doc(SCHOOL_ID).get()).data() ?? {}
}

// ── setShopSettings: the school admin opens/closes the shop and sets its password ──

export interface ShopSettingsInput {
  /** Open (true) or closed (false); omitted: unchanged */
  open?: boolean
  /** A new password; null removes it; omitted: unchanged */
  password?: string | null
}

export function validateShopSettings(data: unknown): ShopSettingsInput {
  const d = (data ?? {}) as Record<string, unknown>
  const bad = (msg: string) => new functions.https.HttpsError('invalid-argument', msg)
  const out: ShopSettingsInput = {}
  if (d.open !== undefined) {
    if (typeof d.open !== 'boolean') throw bad('open must be true or false.')
    out.open = d.open
  }
  if (d.password !== undefined) {
    if (d.password === null) out.password = null
    else if (typeof d.password !== 'string' || d.password.length < MIN_PASSWORD || d.password.length > MAX_PASSWORD) {
      throw bad(`The password needs ${MIN_PASSWORD} to ${MAX_PASSWORD} characters.`)
    } else out.password = d.password
  }
  if (out.open === undefined && out.password === undefined) throw bad('Nothing to change.')
  return out
}

export async function applyShopSettings(input: ShopSettingsInput, by: { uid: string }) {
  const s = await schoolDoc()
  if (s.modules != null && s.modules.rentalInventory !== true) {
    throw new functions.https.HttpsError('failed-precondition', 'The public shop needs Rental & Inventory.')
  }
  const update: Record<string, unknown> = {}
  if (input.open !== undefined) update.publicShop = input.open
  if (input.password !== undefined) {
    if (input.password === null) {
      await privateRef().delete()
      update.shopLocked = false
    } else {
      await privateRef().set({ ...(await hashShopPassword(input.password)), setAt: FieldValue.serverTimestamp(), setBy: by.uid })
      update.shopLocked = true
    }
  }
  await db.collection('schools').doc(SCHOOL_ID).set(update, { merge: true })
  const after = { ...s, ...update }
  return { open: shopOpen(after), adminOpen: after.publicShop === true, override: (after.publicShopOverride ?? null) as ShopOverride | null, locked: after.shopLocked === true }
}

export const setShopSettings = functions.region(REGION).runWith({ ...LIMITS, maxInstances: 2 }).https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.')
  if (context.auth.token.role !== 'admin') throw new functions.https.HttpsError('permission-denied', 'Only school admins can change the shop.')
  if (!(await allow(context.auth.uid, 'shop-settings', 10))) throw new functions.https.HttpsError('resource-exhausted', 'Too many changes. Wait a minute.')
  return applyShopSettings(validateShopSettings(data), { uid: context.auth.uid })
})

// ── shopCatalog: the catalog of a locked shop, for the right password ──

/** What a shop visitor sees of an item (no notes, locations or service details) */
const PUBLIC_ITEM_FIELDS = ['name', 'category', 'description', 'imageUrl', 'imageUrls', 'priceInclVat', 'totalQuantity', 'included', 'linkUrl', 'isActive', 'accessoryIds'] as const

export async function lockedShopCatalog() {
  const [items, categories] = await Promise.all([
    db.collection('equipment').where('isActive', '==', true).get(),
    db.collection('equipment_categories').get(),
  ])
  return {
    equipment: items.docs.map(d => ({ id: d.id, ...Object.fromEntries(PUBLIC_ITEM_FIELDS.filter(k => d.data()[k] !== undefined).map(k => [k, d.data()[k]])) })),
    categories: categories.docs.map(d => ({ id: d.id, ...d.data() })),
  }
}

export const shopCatalog = functions.region(REGION).runWith({ ...LIMITS, maxInstances: 5 }).https.onCall(async (data, context) => {
  const s = await schoolDoc()
  await requireShopAccess(s, (data as Record<string, unknown> | null)?.password, clientIp(context.rawRequest as never))
  return lockedShopCatalog()
})

// ── Emails to shop guests (they have no account, so no push or inbox) ──

export type GuestEmailKind = 'received' | 'confirmed' | 'denied' | 'cancelled' | 'message'

/** Subject and body for a guest's email about their request (pure, so it's tested) */
export function guestEmailContent(kind: GuestEmailKind, b: FirebaseFirestore.DocumentData, shopName: string, extra?: string) {
  const items = ((b.items ?? []) as { equipmentName?: string; quantity?: number }[])
    .map(i => `${escapeHtml(i.equipmentName ?? '')}${(i.quantity ?? 1) > 1 ? ` × ${i.quantity}` : ''}`).join('<br>')
  const when = `${escapeHtml(b.checkoutDate)} – ${escapeHtml(b.returnDate)}`
  const head = {
    received: [`Your request to ${shopName} is received`, `Thanks, ${escapeHtml(b.guestName)}. We have your request and will get back to you.`],
    confirmed: [`Your request to ${shopName} is confirmed`, `Your equipment is booked.`],
    denied: [`Your request to ${shopName} couldn't be confirmed`, `Sorry, we can't confirm this request.`],
    cancelled: [`Your request to ${shopName} is cancelled`, `This request has been cancelled.`],
    message: [`A message about your request to ${shopName}`, ''],
  }[kind]
  const note = extra ? `<div style="white-space:pre-wrap;margin:12px 0">${escapeHtml(extra)}</div>` : ''
  return {
    subject: head[0].replace(/[\r\n]+/g, ' ').slice(0, 200),
    html: [head[1] && `<p>${head[1]}</p>`, note, `<p><b>${escapeHtml(b.projectName || 'Your request')}</b><br>${when}</p>`, `<p>${items}</p>`]
      .filter(Boolean).join(''),
  }
}

/** Emails a shop guest; a failure is logged, never thrown (the booking itself is fine) */
export async function emailGuest(b: FirebaseFirestore.DocumentData, kind: GuestEmailKind, extra?: string) {
  const to = typeof b.guestEmail === 'string' ? b.guestEmail : ''
  if (!b.isGuest || !to) return
  try {
    const [cfg, school] = await Promise.all([getEmailConfig(), db.collection('schools').doc(SCHOOL_ID).get()])
    const fromEmail = cfg?.fromEmail
    if (!fromEmail || fromEmail === 'onboarding@resend.dev') throw new Error('No sender address set up (email_config/global)')
    const shopName = String(school.data()?.name ?? cfg?.fromName ?? 'the rental shop')
    const { subject, html } = guestEmailContent(kind, b, escapeHtml(shopName), extra)
    await sendEmailOrThrow({ from: `${cfg?.fromName || shopName} <${fromEmail}>`, to: [to], subject, html })
  } catch (err) {
    console.error(`Shop guest email (${kind}) failed:`, err)
  }
}
