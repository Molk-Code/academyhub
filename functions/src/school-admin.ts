import { randomUUID } from 'crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { admin, functions, db, LIMITS, REGION, SCHOOL_ID } from './lib'

// ─────────────────────────────────────────────────────────────────────────────
// updateSchoolModules — superadmin only: modules, public shop, plan limits and
// the login page profile, written together with an audit entry
// ─────────────────────────────────────────────────────────────────────────────

/** Superadmins: verified email addresses listed in SUPERADMIN_EMAILS (comma-separated) */
export function superadminEmails(): string[] {
  return (process.env.SUPERADMIN_EMAILS ?? '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
}

export function requireSuperAdmin(context: functions.https.CallableContext): { uid: string; email: string } {
  const token = context.auth?.token
  if (!context.auth || !token) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.')
  const email = String(token.email ?? '').toLowerCase()
  if (token.email_verified !== true || !email || !superadminEmails().includes(email)) {
    throw new functions.https.HttpsError('permission-denied', 'Superadmin only.')
  }
  return { uid: context.auth.uid, email }
}

const FRONT_DOORS = ['academy', 'rental_inventory', 'production'] as const
type FrontDoor = typeof FRONT_DOORS[number]

export interface ModulesInput {
  /** Defaults to this deployment's school */
  schoolId: string
  modules: { academy: boolean; production: boolean; rentalInventory: boolean }
  publicShop: boolean
  planName: string | null
  maxStudents: number | null
  storageQuotaGB: number | null
  /** Login page profile; '' clears a field. Omitted: profile unchanged */
  profile?: Partial<Record<'name' | 'shortName' | 'tagline' | 'primaryColor' | 'logoUrl', string> & { frontDoor: FrontDoor | '' }>
}

const PROFILE_LIMITS = { name: 80, shortName: 40, tagline: 120, primaryColor: 7, logoUrl: 500 } as const

export function validateModulesInput(data: unknown): ModulesInput {
  const d = (data ?? {}) as Record<string, any>
  const bad = (msg: string) => new functions.https.HttpsError('invalid-argument', msg)
  const m = d.modules ?? {}
  for (const k of ['academy', 'production', 'rentalInventory']) {
    if (typeof m[k] !== 'boolean') throw bad(`modules.${k} must be true or false.`)
  }
  if (Object.keys(m).some(k => !['academy', 'production', 'rentalInventory'].includes(k))) throw bad('Unknown module.')
  const publicShop = d.publicShop ?? false
  if (typeof publicShop !== 'boolean') throw bad('publicShop must be true or false.')
  if (publicShop && !m.rentalInventory) throw bad('The public shop needs Rental & Inventory.')

  const planName = d.planName === undefined || d.planName === null || d.planName === '' ? null : d.planName
  if (planName !== null && (typeof planName !== 'string' || planName.trim().length > 60)) throw bad('Plan name: up to 60 characters.')
  const intOrNull = (v: unknown, name: string, max: number) => {
    if (v === undefined || v === null || v === '') return null
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > max || !Number.isInteger(v)) throw bad(`${name} must be a whole number from 0 to ${max}.`)
    return v
  }

  let profile: ModulesInput['profile']
  if (d.profile !== undefined && d.profile !== null) {
    if (typeof d.profile !== 'object') throw bad('profile must be an object.')
    profile = {}
    for (const [k, v] of Object.entries(d.profile as Record<string, unknown>)) {
      if (k === 'frontDoor') {
        if (v !== '' && !FRONT_DOORS.includes(v as FrontDoor)) throw bad('Unknown front door.')
        profile.frontDoor = v as FrontDoor | ''
        continue
      }
      if (!(k in PROFILE_LIMITS)) throw bad(`Unknown profile field ${k}.`)
      if (typeof v !== 'string' || v.trim().length > PROFILE_LIMITS[k as keyof typeof PROFILE_LIMITS]) throw bad(`profile.${k} is too long.`)
      const value = v.trim()
      if (k === 'primaryColor' && value && !/^#[0-9a-fA-F]{6}$/.test(value)) throw bad('Colour must look like #f97316.')
      if (k === 'logoUrl' && value && !/^(https:\/\/|\/)/.test(value)) throw bad('Logo must be an https:// or site-relative URL.')
      ;(profile as Record<string, string>)[k] = value
    }
  }

  const schoolId = d.schoolId === undefined || d.schoolId === null ? SCHOOL_ID : d.schoolId
  if (typeof schoolId !== 'string' || !/^[a-z0-9-]{1,40}$/.test(schoolId)) throw bad('Invalid school id.')
  // public_config/main belongs to this deployment, i.e. to SCHOOL_ID only
  if (profile && Object.keys(profile).length && schoolId !== SCHOOL_ID) throw bad(`The login page profile belongs to ${SCHOOL_ID}.`)

  return {
    schoolId,
    modules: { academy: m.academy, production: m.production, rentalInventory: m.rentalInventory },
    publicShop,
    planName: planName === null ? null : planName.trim(),
    maxStudents: intOrNull(d.maxStudents, 'Student limit', 100_000),
    storageQuotaGB: intOrNull(d.storageQuotaGB, 'Storage quota', 100_000),
    profile,
  }
}

const SCHOOL_FIELDS = ['modules', 'publicShop', 'planName', 'maxStudents', 'storageQuotaGB'] as const
const pick = (o: Record<string, unknown> | undefined, keys: readonly string[]) =>
  Object.fromEntries(keys.map(k => [k, o?.[k] ?? null]))

/** Applies a validated update and logs it; returns the after-state */
export async function applySchoolUpdate(input: ModulesInput, actor: { uid: string; email: string }) {
  const schoolId = input.schoolId
  const schoolRef  = db.collection('schools').doc(schoolId)
  const profileRef = db.collection('public_config').doc('main')
  const auditRef   = db.collection('school_audit').doc()

  return db.runTransaction(async tx => {
    const [school, profile] = await Promise.all([tx.get(schoolRef), tx.get(profileRef)])
    if (!school.exists) throw new functions.https.HttpsError('not-found', `School ${schoolId} not found.`)

    const profileKeys = input.profile ? Object.keys(input.profile) : []
    const before = { school: pick(school.data(), SCHOOL_FIELDS), profile: pick(profile.data(), profileKeys) }

    const schoolUpdate: Record<string, unknown> = { modules: input.modules, publicShop: input.publicShop }
    for (const k of ['planName', 'maxStudents', 'storageQuotaGB'] as const) {
      schoolUpdate[k] = input[k] === null ? FieldValue.delete() : input[k]
    }
    tx.set(schoolRef, schoolUpdate, { merge: true })

    const profileUpdate: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(input.profile ?? {})) profileUpdate[k] = v === '' ? FieldValue.delete() : v
    if (profileKeys.length) tx.set(profileRef, profileUpdate, { merge: true })

    const after = {
      school: { ...pick(school.data(), SCHOOL_FIELDS), modules: input.modules, publicShop: input.publicShop,
        planName: input.planName, maxStudents: input.maxStudents, storageQuotaGB: input.storageQuotaGB },
      profile: Object.fromEntries(profileKeys.map(k => [k, (input.profile as Record<string, string>)[k] || null])),
    }
    tx.create(auditRef, { schoolId, by: actor, at: FieldValue.serverTimestamp(), action: 'updateSchoolModules', before, after })
    return after
  })
}

export const updateSchoolModules = functions.region(REGION).runWith({ ...LIMITS, maxInstances: 2 }).https.onCall(async (data, context) => {
  const actor = requireSuperAdmin(context)
  const input = validateModulesInput(data)
  const after = await applySchoolUpdate(input, actor)
  return { ok: true, after }
})

// ─────────────────────────────────────────────────────────────────────────────
// uploadSchoolLogo — superadmin only: stores a login page logo under
// branding/ (public read in storage.rules, no client writes) and returns its
// download URL for the profile
// ─────────────────────────────────────────────────────────────────────────────

const LOGO_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg' }
const MAX_LOGO_BYTES = 1024 * 1024

export function validateLogo(data: unknown): { contentType: string; bytes: Buffer } {
  const d = (data ?? {}) as Record<string, unknown>
  const bad = (msg: string) => new functions.https.HttpsError('invalid-argument', msg)
  const contentType = String(d.contentType ?? '')
  if (!LOGO_TYPES[contentType]) throw bad('Logo must be PNG, JPEG, WebP or SVG.')
  if (typeof d.base64 !== 'string' || !d.base64) throw bad('No image data.')
  const bytes = Buffer.from(d.base64, 'base64')
  if (bytes.length === 0 || bytes.length > MAX_LOGO_BYTES) throw bad('Logo must be at most 1 MB.')
  return { contentType, bytes }
}

export const uploadSchoolLogo = functions.region(REGION).runWith({ ...LIMITS, maxInstances: 2 }).https.onCall(async (data, context) => {
  requireSuperAdmin(context)
  const { contentType, bytes } = validateLogo(data)
  const bucket = admin.storage().bucket()
  const path = `branding/logo-${Date.now()}.${LOGO_TYPES[contentType]}`
  const token = randomUUID()
  await bucket.file(path).save(bytes, {
    contentType,
    metadata: { cacheControl: 'public, max-age=31536000', metadata: { firebaseStorageDownloadTokens: token } },
  })
  const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`
  return { url }
})
