import { FieldValue } from 'firebase-admin/firestore'
import { GoogleAuth } from 'google-auth-library'
import { functions, db, escapeHtml, sendEmailOrThrow, getEmailConfig, LIMITS, REGION, allow } from './lib'
import { requireSuperAdminSession } from './school-admin'
import { hashIp, clientIp } from './contact'
import { selectionProblem, quote, planLabel, planFor, modulesFor, type PlanSelection, type Quote, type ModuleFlag } from './pricing'

// ─────────────────────────────────────────────────────────────────────────────
// Customer orders: how a new customer (school) comes in, gets paid for and is
// set up. Every customer starts as customer_orders/{id}, whoever created it:
//
//   superadmin form ─┐                        ┌─ invoice: superadmin marks it paid
//                    ├─ awaiting_payment ─────┤
//   self-service ────┘                        └─ card (later): provider webhook
//                              │ confirmPayment / startOrderNow
//                              ▼
//                           queued ──▶ provisioning ──▶ live
//                                           │
//                                           ▼
//                                        failed ──(retry)──▶ queued
//
// confirmPayment() is the one way a payment is recorded: the invoice action
// calls it now, a card provider's webhook will call it later. Setup runs from
// the "queued" state only, so how the order was paid never reaches it.
//
// Orders, their events and the short-name reservations are read by the
// superadmin only (firestore.rules) and written only here.
// ─────────────────────────────────────────────────────────────────────────────

export const ORDER_STATUSES = ['awaiting_payment', 'queued', 'provisioning', 'live', 'failed', 'cancelled', 'removing', 'removed'] as const
export type OrderStatus = typeof ORDER_STATUSES[number]

export const PAYMENT_METHODS = ['invoice', 'card'] as const
export type PaymentMethod = typeof PAYMENT_METHODS[number]

/** after_payment: setup starts once paid. immediately: start now, invoice is paid later */
export const START_POLICIES = ['after_payment', 'immediately'] as const
export type StartPolicy = typeof START_POLICIES[number]

/** Setup steps, in order. Labels are shown in the superadmin progress list. */
export const PROVISIONING_STEPS = [
  { id: 'project',       label: 'Create the Firebase project (EU)' },
  { id: 'services',      label: 'Database, sign-in and storage' },
  { id: 'deploy',        label: 'Install the app, rules and functions' },
  { id: 'school',        label: 'School record and login page profile' },
  { id: 'domain',        label: 'Address and DNS' },
  { id: 'signin_domain', label: 'Allow sign-in on the address' },
  { id: 'invite',        label: 'Invite the school admin' },
] as const
export type StepId = typeof PROVISIONING_STEPS[number]['id']

/** Short names nobody can take: our own hosts and words we may need later */
export const RESERVED_SHORT_NAMES = [
  'www', 'app', 'apps', 'admin', 'superadmin', 'api', 'mail', 'email', 'smtp', 'ftp', 'cdn', 'static', 'assets',
  'auth', 'login', 'signin', 'signup', 'account', 'billing', 'pay', 'payment', 'invoice', 'shop', 'store',
  'help', 'support', 'docs', 'status', 'blog', 'news', 'dev', 'test', 'staging', 'stage', 'preview', 'demo',
  'sandbox', 'qa', 'beta', 'eu', 'cineforge', 'molkom', 'example', 'local', 'localhost', 'emulator', 'production',
]

export function customerBaseDomain(): string {
  return (process.env.CUSTOMER_BASE_DOMAIN || 'cineforge.se').toLowerCase()
}

// ── Validation ───────────────────────────────────────────────────────────────

export interface OrderInput {
  organisation: { name: string; orgNumber: string | null }
  school: { name: string; shortName: string }
  admin: { name: string; email: string }
  billing: { email: string; reference: string | null; address: string | null }
  plan: {
    /** Chosen plan per module (functions/src/pricing.ts) */
    selection: PlanSelection
    /** Price computed here from the price list */
    quote: Quote
    planName: string | null
    modules: { academy: boolean; production: boolean; rentalInventory: boolean }
    maxStudents: number | null
    /** Assets included (Rental & Inventory); absent on orders made before asset limits */
    maxAssets?: number | null
    storageQuotaGB: number | null
  }
  payment: { method: PaymentMethod }
  startPolicy: StartPolicy
  notes: string | null
}

const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]{2,}$/

/** A problem with the short name, or null when it can be used */
export function shortNameProblem(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return 'Short name is required.'
  if (!/^[a-z][a-z0-9-]{1,28}[a-z0-9]$/.test(v)) return 'Short name: 3–30 lowercase letters, digits or dashes, starting with a letter.'
  if (v.includes('--')) return 'Short name: no double dashes.'
  if (RESERVED_SHORT_NAMES.includes(v)) return `"${v}" is reserved.`
  return null
}

/**
 * Validated copy of an order. selfService: what a customer may set themselves
 * (no notes, always invoice paid before setup, terms must be accepted).
 */
export function validateOrderInput(data: unknown, opts: { selfService: boolean }): OrderInput {
  const d = (data ?? {}) as Record<string, any>
  const bad = (msg: string) => new functions.https.HttpsError('invalid-argument', msg)
  const str = (v: unknown, label: string, max: number, required = true): string | null => {
    if (v === undefined || v === null || v === '') { if (required) throw bad(`${label} is required.`); return null }
    if (typeof v !== 'string') throw bad(`${label} must be text.`)
    const s = v.trim()
    if (!s && required) throw bad(`${label} is required.`)
    if (s.length > max) throw bad(`${label}: at most ${max} characters.`)
    return s || null
  }
  const email = (v: unknown, label: string) => {
    const s = str(v, label, 200)!.toLowerCase()
    if (!EMAIL_RE.test(s)) throw bad(`${label} must be a valid email address.`)
    return s
  }
  const intOrNull = (v: unknown, label: string, max: number) => {
    if (v === undefined || v === null || v === '') return null
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > max) throw bad(`${label} must be a whole number from 0 to ${max}.`)
    return v
  }

  const shortName = typeof d.school?.shortName === 'string' ? d.school.shortName.trim().toLowerCase() : d.school?.shortName
  const problem = shortNameProblem(shortName)
  if (problem) throw bad(problem)

  const method = d.payment?.method ?? 'invoice'
  if (!PAYMENT_METHODS.includes(method)) throw bad('Unknown payment method.')
  if (method === 'card') throw bad('Card payment is not available yet.')
  const startPolicy = d.startPolicy ?? 'after_payment'
  if (!START_POLICIES.includes(startPolicy)) throw bad('Unknown start policy.')
  if (opts.selfService && startPolicy !== 'after_payment') throw bad('Setup starts once the order is approved.')

  return {
    organisation: { name: str(d.organisation?.name, 'Organisation', 160)!, orgNumber: str(d.organisation?.orgNumber, 'Organisation number', 30, false) },
    school: { name: str(d.school?.name, 'School name', 80)!, shortName },
    admin: { name: str(d.admin?.name, 'Admin name', 120)!, email: email(d.admin?.email, 'Admin email') },
    billing: {
      email: email(d.billing?.email, 'Invoice email'),
      reference: str(d.billing?.reference, 'Invoice reference', 120, false),
      address: str(d.billing?.address, 'Invoice address', 300, false),
    },
    plan: validatePlanInput(d.plan, opts),
    payment: { method },
    startPolicy,
    notes: opts.selfService ? null : str(d.notes, 'Notes', 2000, false),
  }
}

/**
 * The plan part of an order, or of a plan change for a live customer:
 * modules and price from the plans chosen, and the student and asset limits
 * from those plans unless the superadmin sets them (not self-service).
 */
export function validatePlanInput(data: unknown, opts: { selfService: boolean }): OrderInput['plan'] {
  const p = (data ?? {}) as Record<string, any>
  const bad = (msg: string) => new functions.https.HttpsError('invalid-argument', msg)
  const intOrNull = (v: unknown, label: string, max: number) => {
    if (v === undefined || v === null || v === '') return null
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > max) throw bad(`${label} must be a whole number from 0 to ${max}.`)
    return v
  }
  const rawSel = (p.selection ?? {}) as Record<string, unknown>
  const planProblem = selectionProblem(rawSel)
  if (planProblem) throw bad(planProblem)
  const selection = Object.fromEntries(Object.entries(rawSel).filter(([, v]) => typeof v === 'string' && v)) as PlanSelection
  if (opts.selfService) {
    for (const [m, id] of Object.entries(selection)) {
      if (planFor(m as ModuleFlag, id)?.hidden) throw bad('That plan is not available to order online yet. Please contact us.')
    }
  }
  // Students and assets included in the plan, unless the superadmin sets a limit
  const planStudents = planFor('academy', selection.academy)?.maxStudents ?? null
  const planAssets = planFor('rentalInventory', selection.rentalInventory)?.maxAssets ?? null
  return {
    selection,
    quote: quote(selection),
    planName: planLabel(selection).slice(0, 120),
    modules: modulesFor(selection),
    maxStudents: (opts.selfService ? null : intOrNull(p.maxStudents, 'Student limit', 100_000)) ?? planStudents,
    maxAssets: (opts.selfService ? null : intOrNull(p.maxAssets, 'Asset limit', 1_000_000)) ?? planAssets,
    storageQuotaGB: opts.selfService ? null : intOrNull(p.storageQuotaGB, 'Storage quota', 100_000),
  }
}

// ── State changes ────────────────────────────────────────────────────────────

type Actor = { email: string } | { provider: string } | { system: string }

const orders = () => db.collection('customer_orders')

const newEvent = (orderId: string) => orders().doc(orderId).collection('events').doc()

function emptySteps() {
  return Object.fromEntries(PROVISIONING_STEPS.map(s => [s.id, { status: 'pending' }]))
}

/** Creates an order and reserves its short name, atomically. */
export async function createOrder(input: OrderInput, meta: { source: 'superadmin' | 'self_service'; by: Actor; terms?: { version: string } | null; ipHash?: string; preview?: boolean }): Promise<string> {
  const ref = orders().doc()
  const slugRef = db.collection('customer_slugs').doc(input.school.shortName)
  const startNow = input.startPolicy === 'immediately'
  await db.runTransaction(async tx => {
    if ((await tx.get(slugRef)).exists) throw new functions.https.HttpsError('already-exists', `The short name "${input.school.shortName}" is taken.`)
    tx.create(slugRef, { orderId: ref.id, at: FieldValue.serverTimestamp() })
    tx.create(ref, {
      ...input,
      address: `${input.school.shortName}.${customerBaseDomain()}`,
      source: meta.source,
      status: startNow ? 'queued' : 'awaiting_payment',
      payment: { method: input.payment.method, status: 'pending', invoiceNumber: null, paidAt: null, confirmedBy: null, providerRef: null },
      provisioning: { steps: emptySteps(), attempts: 0, startedAt: null, finishedAt: null, error: null, note: null },
      terms: meta.terms ? { version: meta.terms.version, acceptedAt: FieldValue.serverTimestamp() } : null,
      ipHash: meta.ipHash ?? null,
      preview: meta.preview ?? false,
      createdBy: meta.by,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    tx.create(newEvent(ref.id), { at: FieldValue.serverTimestamp(), by: meta.by, action: 'created', detail: { source: meta.source, startPolicy: input.startPolicy } })
  })
  return ref.id
}

async function transition(orderId: string, by: Actor, action: string, apply: (o: FirebaseFirestore.DocumentData) => Record<string, unknown>, detail: Record<string, unknown> = {}) {
  const ref = orders().doc(orderId)
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref)
    if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Order not found.')
    const update = apply(snap.data()!)
    tx.update(ref, { ...update, updatedAt: FieldValue.serverTimestamp() })
    tx.create(newEvent(orderId), { at: FieldValue.serverTimestamp(), by, action, detail })
    return { ...snap.data(), ...update }
  })
}

const precondition = (msg: string) => new functions.https.HttpsError('failed-precondition', msg)

/**
 * Records a payment. Called by the superadmin's "Mark invoice paid" now and by
 * a card provider's webhook later. Queues setup when the order was waiting for
 * it; a payment arriving after setup started (pay-later invoice) only records it.
 */
export async function confirmPayment(orderId: string, by: Actor, ref: { invoiceNumber?: string | null; providerRef?: string | null } = {}) {
  return transition(orderId, by, 'payment_confirmed', o => {
    if (o.status === 'cancelled') throw precondition('The order is cancelled.')
    if (o.payment?.status === 'paid') throw precondition('The payment is already recorded.')
    return {
      'payment.status': 'paid',
      'payment.paidAt': FieldValue.serverTimestamp(),
      'payment.confirmedBy': by,
      'payment.invoiceNumber': ref.invoiceNumber ?? o.payment?.invoiceNumber ?? null,
      'payment.providerRef': ref.providerRef ?? null,
      ...(o.status === 'awaiting_payment' ? { status: 'queued' } : {}),
    }
  }, { invoiceNumber: ref.invoiceNumber ?? null })
}

/** Start setup before the invoice is paid (the customer pays later) */
export async function startOrderNow(orderId: string, by: Actor) {
  return transition(orderId, by, 'started_before_payment', o => {
    if (o.status !== 'awaiting_payment') throw precondition('Only an order waiting for payment can be started early.')
    return { status: 'queued' }
  })
}

/** Sets the invoice number on an order (e.g. once the invoice is sent) */
export async function setInvoiceNumber(orderId: string, by: Actor, invoiceNumber: string | null) {
  return transition(orderId, by, 'invoice_number', o => {
    if (o.payment?.method !== 'invoice') throw precondition('This order is not paid by invoice.')
    return { 'payment.invoiceNumber': invoiceNumber }
  }, { invoiceNumber })
}

/** Cancels an order that isn't set up yet and frees its short name */
export async function cancelOrder(orderId: string, by: Actor) {
  const o = await transition(orderId, by, 'cancelled', o => {
    if (!['awaiting_payment', 'queued', 'failed'].includes(o.status)) {
      throw precondition(o.status === 'live' ? 'This customer is live: remove it instead.' : `An order that is ${o.status} can't be cancelled.`)
    }
    if (o.provisioning?.state?.projectId) throw precondition('Setup already created a project for this order: remove the customer instead, so the project and its address go too.')
    return { status: 'cancelled' }
  })
  const slugRef = db.collection('customer_slugs').doc(String(o.school?.shortName))
  await db.runTransaction(async tx => {
    const s = await tx.get(slugRef)
    if (s.exists && s.data()?.orderId === orderId) tx.delete(slugRef)
  })
}

/** Puts a failed setup back in the queue; finished steps are kept */
export async function retryOrder(orderId: string, by: Actor) {
  return transition(orderId, by, 'retry', o => {
    if (o.status !== 'failed') throw precondition('Only a failed setup can be retried.')
    if (o.removal) return { status: 'removing', 'provisioning.error': null }
    return { status: 'queued', 'provisioning.error': null }
  })
}

// ── Setup ────────────────────────────────────────────────────────────────────

export interface StepContext { orderId: string; order: FirebaseFirestore.DocumentData }
/** Runs one setup step; returns what to show next to it (e.g. a project id) */
export type StepRunner = (ctx: StepContext) => Promise<Record<string, unknown> | void>
export type Provisioner = Record<StepId, StepRunner>

/**
 * Which setup the backend runs, from PROVISIONING_MODE:
 *   off (default) — orders wait in the queue; nothing outside this project is touched
 *   simulate      — every step succeeds without doing anything; emulator only
 * The live steps (Google Cloud project, Hostup DNS…) come once the Google Cloud
 * organisation and the Hostup API key exist.
 */
export function provisionerFor(mode: string | undefined): Provisioner | null {
  if (mode === 'simulate') {
    if (process.env.FUNCTIONS_EMULATOR !== 'true') {
      console.error('PROVISIONING_MODE=simulate is only allowed in the emulator: setup not started.')
      return null
    }
    return Object.fromEntries(PROVISIONING_STEPS.map(s => [s.id, async () => ({ simulated: true })])) as unknown as Provisioner
  }
  return null
}

/**
 * Runs the steps of a queued order in order, skipping ones already done (so a
 * retry continues where it stopped). Claims the order first so two runs never
 * overlap.
 */
export async function runProvisioning(orderId: string, provisioner: Provisioner | null): Promise<OrderStatus> {
  const ref = orders().doc(orderId)
  const sys = { system: 'provisioning' }
  if (!provisioner) {
    await ref.update({ 'provisioning.note': 'Automatic setup is not switched on yet: the order waits here.', updatedAt: FieldValue.serverTimestamp() })
    return 'queued'
  }
  const claimed = await db.runTransaction(async tx => {
    const s = await tx.get(ref)
    if (s.data()?.status !== 'queued') return null
    tx.update(ref, {
      status: 'provisioning', 'provisioning.note': null, 'provisioning.error': null,
      'provisioning.attempts': FieldValue.increment(1), 'provisioning.startedAt': FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    return s.data()!
  })
  if (!claimed) return (await ref.get()).data()?.status

  for (const step of PROVISIONING_STEPS) {
    if (claimed.provisioning?.steps?.[step.id]?.status === 'done') continue
    await ref.update({ [`provisioning.steps.${step.id}`]: { status: 'running', at: FieldValue.serverTimestamp() } })
    try {
      const result = await provisioner[step.id]({ orderId, order: claimed })
      await ref.update({ [`provisioning.steps.${step.id}`]: { status: 'done', at: FieldValue.serverTimestamp(), ...(result ?? {}) } })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await ref.update({
        [`provisioning.steps.${step.id}`]: { status: 'failed', at: FieldValue.serverTimestamp(), error: message.slice(0, 500) },
        status: 'failed', 'provisioning.error': `${step.label}: ${message}`.slice(0, 600), updatedAt: FieldValue.serverTimestamp(),
      })
      await ref.collection('events').add({ at: FieldValue.serverTimestamp(), by: sys, action: 'setup_failed', detail: { step: step.id, error: message.slice(0, 500) } })
      return 'failed'
    }
  }
  await ref.update({ status: 'live', 'provisioning.finishedAt': FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
  await ref.collection('events').add({ at: FieldValue.serverTimestamp(), by: sys, action: 'live', detail: {} })
  return 'live'
}

export const onCustomerOrderQueued = functions.region(REGION).runWith({ ...LIMITS, maxInstances: 3, timeoutSeconds: 540 })
  .firestore.document('customer_orders/{orderId}')
  .onWrite(async (change, context) => {
    const before = change.before.exists ? change.before.data()?.status : null
    const after = change.after.exists ? change.after.data()?.status : null
    if (after === before) return
    const orderId = context.params.orderId
    if (process.env.PROVISIONING_MODE === 'cloudbuild') {
      if (after === 'queued') await startSetupBuild(orderId, 'setup')
      if (after === 'removing') await startSetupBuild(orderId, 'remove')
      return
    }
    if (after === 'queued') await runProvisioning(orderId, provisionerFor(process.env.PROVISIONING_MODE))
  })

// ── Setup in Cloud Build (PROVISIONING_MODE=cloudbuild) ──────────────────────
// The steps (scripts/customer-setup) run as a Cloud Build job in this project,
// as the customer-setup service account, from the release published with
// scripts/publish-release.mjs (platform/release). The job writes its progress
// to the order. Setup takes 20–40 minutes, mostly the deploy and the certificate.

export interface SetupConfig {
  controlProject: string
  folderId: string
  billingAccount: string
  setupServiceAccount: string
  superadminEmails: string
  release: { bucket: string; object: string }
}

export function setupConfig(release: { bucket?: string; object?: string } | undefined): SetupConfig | string {
  const e = process.env
  const missing = ['CUSTOMER_FOLDER_ID', 'BILLING_ACCOUNT_ID', 'SETUP_SERVICE_ACCOUNT', 'SUPERADMIN_EMAILS'].filter(k => !e[k])
  if (missing.length) return `Setup isn't configured: ${missing.join(', ')} missing in functions/.env.<project>.`
  if (!release?.bucket || !release?.object) return 'No release published yet: run scripts/publish-release.mjs.'
  return {
    controlProject: String(e.GCLOUD_PROJECT ?? e.GCP_PROJECT),
    folderId: e.CUSTOMER_FOLDER_ID!, billingAccount: e.BILLING_ACCOUNT_ID!,
    setupServiceAccount: e.SETUP_SERVICE_ACCOUNT!, superadminEmails: e.SUPERADMIN_EMAILS!,
    release: { bucket: release.bucket, object: release.object },
  }
}

/** The Cloud Build request for one order (pure, so it's tested) */
export function setupBuildRequest(orderId: string, mode: 'setup' | 'remove' | 'plan', c: SetupConfig) {
  const install = mode === 'setup' ? 'npm ci --no-audit --no-fund && npm --prefix functions ci --no-audit --no-fund' : 'npm ci --no-audit --no-fund'
  const secret = (name: string) => ({ versionName: `projects/${c.controlProject}/secrets/${name}/versions/latest`, env: name })
  return {
    source: { storageSource: { bucket: c.release.bucket, object: c.release.object } },
    steps: [{
      name: 'node:22',
      entrypoint: 'bash',
      args: ['-c', `${install} && node scripts/customer-setup/run.mjs`],
      env: [
        `ORDER_ID=${orderId}`, `MODE=${mode}`, `CONTROL_PROJECT=${c.controlProject}`, `FOLDER_ID=${c.folderId}`,
        `BILLING_ACCOUNT=${c.billingAccount}`, `SETUP_SA=${c.setupServiceAccount}`, `SUPERADMIN_EMAILS=${c.superadminEmails}`,
        `ZONE=${customerBaseDomain()}`,
      ],
      secretEnv: ['HOSTUP_API_KEY', 'RESEND_API_KEY'],
    }],
    availableSecrets: { secretManager: [secret('HOSTUP_API_KEY'), secret('RESEND_API_KEY')] },
    serviceAccount: `projects/${c.controlProject}/serviceAccounts/${c.setupServiceAccount}`,
    options: { logging: 'CLOUD_LOGGING_ONLY', machineType: 'E2_HIGHCPU_8' },
    timeout: mode === 'plan' ? '1200s' : '7200s',
    tags: ['customer-setup', mode, orderId.toLowerCase()],
  }
}

const cloudAuth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] })
const BUILDS_REGION = 'europe-west1'

async function cloudBuild(method: string, path: string, body?: unknown) {
  const client = await cloudAuth.getClient()
  const res = await client.request({ url: `https://cloudbuild.googleapis.com/v1/${path}`, method: method as 'GET' | 'POST', data: body })
  return res.data as Record<string, any>
}

/** Submits the setup (or removal) job; on any problem the order fails with the reason */
export async function startSetupBuild(orderId: string, mode: 'setup' | 'remove') {
  const ref = orders().doc(orderId)
  const claimed = await db.runTransaction(async tx => {
    const s = await tx.get(ref)
    const status = s.data()?.status
    if (status !== (mode === 'setup' ? 'queued' : 'removing')) return false
    if (mode === 'setup') {
      tx.update(ref, {
        status: 'provisioning', 'provisioning.note': 'Starting the setup job…', 'provisioning.error': null,
        'provisioning.attempts': FieldValue.increment(1), 'provisioning.startedAt': FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      })
    } else {
      tx.update(ref, { 'provisioning.note': 'Starting the removal job…', 'provisioning.error': null, updatedAt: FieldValue.serverTimestamp() })
    }
    return true
  })
  if (!claimed) return
  try {
    const release = (await db.collection('platform').doc('release').get()).data() as { bucket?: string; object?: string } | undefined
    const cfg = setupConfig(release)
    if (typeof cfg === 'string') throw new Error(cfg)
    const op = await cloudBuild('POST', `projects/${cfg.controlProject}/locations/${BUILDS_REGION}/builds`, setupBuildRequest(orderId, mode, cfg))
    const build = op?.metadata?.build ?? {}
    await ref.update({
      'provisioning.buildId': build.id ?? null, 'provisioning.logUrl': build.logUrl ?? null,
      'provisioning.release': release?.object ?? null,
      'provisioning.note': mode === 'setup' ? 'Setup job started: installing, then the steps below.' : 'Removal job started.',
      updatedAt: FieldValue.serverTimestamp(),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await ref.update({ status: 'failed', 'provisioning.note': null, 'provisioning.error': `Couldn't start the ${mode === 'setup' ? 'setup' : 'removal'} job: ${message}`.slice(0, 600), updatedAt: FieldValue.serverTimestamp() })
  }
}

/** A job that stopped without reporting (crash, timeout, cancelled) marks the order failed */
export async function refreshOrder(orderId: string) {
  const ref = orders().doc(orderId)
  const o = (await ref.get()).data()
  if (!o) throw new functions.https.HttpsError('not-found', 'Order not found.')
  const control = String(process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT)
  if (o.planChange?.status === 'running' && o.planChange.buildId) {
    const build = await cloudBuild('GET', `projects/${control}/locations/${BUILDS_REGION}/builds/${o.planChange.buildId}`)
    if (['FAILURE', 'INTERNAL_ERROR', 'TIMEOUT', 'CANCELLED', 'EXPIRED'].includes(build.status)) {
      await ref.update({ 'planChange.status': 'failed', 'planChange.error': `The plan change job stopped (${build.status}): see its log.`, updatedAt: FieldValue.serverTimestamp() })
    }
  }
  const buildId = o.provisioning?.buildId
  if (!['provisioning', 'removing'].includes(o.status) || !buildId) return { status: o.status, build: null }
  const build = await cloudBuild('GET', `projects/${control}/locations/${BUILDS_REGION}/builds/${buildId}`)
  const ended = ['FAILURE', 'INTERNAL_ERROR', 'TIMEOUT', 'CANCELLED', 'EXPIRED'].includes(build.status)
  if (ended) {
    await ref.update({ status: 'failed', 'provisioning.note': null, 'provisioning.error': `The ${o.status === 'removing' ? 'removal' : 'setup'} job stopped (${build.status}) before finishing: see its log.`, updatedAt: FieldValue.serverTimestamp() })
  }
  return { status: ended ? 'failed' : o.status, build: build.status as string }
}

/** Removes a set-up customer: its DNS records and its project. Asked three times in the page; the name is checked here */
export async function requestRemoval(orderId: string, by: Actor, confirmName: unknown) {
  return transition(orderId, by, 'removal_requested', o => {
    const hasProject = !!o.provisioning?.state?.projectId
    if (!(o.status === 'live' || (o.status === 'failed' && hasProject))) throw precondition('Only a customer that has been set up (or partly set up) can be removed.')
    if (typeof confirmName !== 'string' || confirmName.trim() !== String(o.school?.name ?? '').trim()) throw precondition("The name typed doesn't match the school's name.")
    return { status: 'removing', removal: true }
  })
}

/**
 * Changes a live customer's plan: upgrade, downgrade, or modules on and off.
 * The customer's school record lives in its own project, so a short job
 * (MODE=plan, as the setup account) writes it there and then the order. Nothing
 * is deleted: over a lower limit, the school only can't add more.
 */
export async function requestPlanChange(orderId: string, by: { email: string }, input: unknown) {
  const plan = validatePlanInput(input, { selfService: false })
  const ref = orders().doc(orderId)
  await transition(orderId, by, 'plan_change_requested', o => {
    if (o.status !== 'live' || !o.provisioning?.state?.projectId) throw precondition('Only a live customer can change plan.')
    if (o.planChange?.status === 'running') throw precondition('A plan change is already running.')
    return { planChange: { plan, status: 'running', error: null, buildId: null, logUrl: null, by: by.email, requestedAt: FieldValue.serverTimestamp() } }
  }, { to: plan.planName })
  const mode = process.env.PROVISIONING_MODE
  try {
    if (mode === 'cloudbuild') {
      const release = (await db.collection('platform').doc('release').get()).data() as { bucket?: string; object?: string } | undefined
      const cfg = setupConfig(release)
      if (typeof cfg === 'string') throw new Error(cfg)
      const op = await cloudBuild('POST', `projects/${cfg.controlProject}/locations/${BUILDS_REGION}/builds`, setupBuildRequest(orderId, 'plan', cfg))
      const build = op?.metadata?.build ?? {}
      await ref.update({ 'planChange.buildId': build.id ?? null, 'planChange.logUrl': build.logUrl ?? null, updatedAt: FieldValue.serverTimestamp() })
    } else if (mode === 'simulate' && process.env.FUNCTIONS_EMULATOR === 'true') {
      // No customer project in the emulator: only the order changes
      await ref.update({ plan, 'planChange.status': 'done', 'planChange.doneAt': FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
      await newEvent(orderId).create({ at: FieldValue.serverTimestamp(), by: { system: 'setup' }, action: 'plan_changed', detail: { to: plan.planName } })
    } else {
      throw new Error('Setup jobs are switched off (PROVISIONING_MODE).')
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await ref.update({ 'planChange.status': 'failed', 'planChange.error': `Couldn't start the plan change: ${message}`.slice(0, 600), updatedAt: FieldValue.serverTimestamp() })
  }
}

// ── Superadmin callables ─────────────────────────────────────────────────────

const superadminCall = (fn: (data: Record<string, any>, actor: { email: string }) => Promise<unknown>) =>
  functions.region(REGION).runWith({ ...LIMITS, maxInstances: 2 }).https.onCall(async (data, context) => {
    const actor = await requireSuperAdminSession(context)
    return fn((data ?? {}) as Record<string, any>, { email: actor.email })
  })

const orderIdOf = (d: Record<string, any>) => {
  if (typeof d.orderId !== 'string' || !/^[A-Za-z0-9]{1,40}$/.test(d.orderId)) throw new functions.https.HttpsError('invalid-argument', 'orderId is required.')
  return d.orderId
}
const invoiceNumberOf = (v: unknown) => {
  if (v === undefined || v === null || v === '') return null
  if (typeof v !== 'string' || v.trim().length > 40) throw new functions.https.HttpsError('invalid-argument', 'Invoice number: at most 40 characters.')
  return v.trim()
}

export const createCustomerOrder = superadminCall(async (d, by) => {
  const orderId = await createOrder(validateOrderInput(d, { selfService: false }), { source: 'superadmin', by })
  return { orderId }
})
export const markOrderPaid = superadminCall(async (d, by) => { await confirmPayment(orderIdOf(d), by, { invoiceNumber: invoiceNumberOf(d.invoiceNumber) }); return { ok: true } })
export const setOrderInvoiceNumber = superadminCall(async (d, by) => { await setInvoiceNumber(orderIdOf(d), by, invoiceNumberOf(d.invoiceNumber)); return { ok: true } })
export const startCustomerOrder = superadminCall(async (d, by) => { await startOrderNow(orderIdOf(d), by); return { ok: true } })
export const cancelCustomerOrder = superadminCall(async (d, by) => { await cancelOrder(orderIdOf(d), by); return { ok: true } })
export const retryCustomerOrder = superadminCall(async (d, by) => { await retryOrder(orderIdOf(d), by); return { ok: true } })
export const refreshCustomerOrder = superadminCall(async d => refreshOrder(orderIdOf(d)))
export const changeCustomerPlan = superadminCall(async (d, by) => { await requestPlanChange(orderIdOf(d), by, d.plan); return { ok: true } })
export const removeCustomer = superadminCall(async (d, by) => { await requestRemoval(orderIdOf(d), by, d.confirmName); return { ok: true } })

/** Whether a short name can be used; superadmin form checks as you type */
export async function shortNameAvailable(v: unknown): Promise<{ ok: boolean; problem: string | null; address: string | null }> {
  const name = typeof v === 'string' ? v.trim().toLowerCase() : v
  const problem = shortNameProblem(name)
  if (problem) return { ok: false, problem, address: null }
  const taken = (await db.collection('customer_slugs').doc(name as string).get()).exists
  return { ok: !taken, problem: taken ? 'Already taken.' : null, address: `${name}.${customerBaseDomain()}` }
}
export const checkCustomerShortName = superadminCall(async d => shortNameAvailable(d.shortName))

// ── Self-service orders (off until SELF_SERVICE_ORDERS=true) ────────────────
// Signed-out callers, like the contact form: honeypot, rate limits, terms
// acceptance required. The order waits for payment (invoice: the superadmin's
// approval) before anything is set up.
//
// While it's off, the superadmin can still use the hidden order page (preview):
// such orders are marked preview: true. Without ORDER_TERMS_VERSION set, a
// preview accepts the draft terms version the page sends.

const ORDERS_PER_IP_PER_HOUR = 3
const ORDERS_GLOBAL_PER_HOUR = 10
const HOUR = 60 * 60_000

export async function handleSelfServiceOrder(
  data: unknown,
  meta: { ip: string },
  deps: { sendEmail: (msg: Parameters<typeof sendEmailOrThrow>[0]) => Promise<unknown>; notifyEmail: string | undefined; termsVersion: string | undefined; preview?: boolean },
): Promise<{ ok: true; address: string }> {
  const d = (data ?? {}) as Record<string, any>
  if (typeof d.website === 'string' && d.website.trim() !== '') return { ok: true, address: '' } // honeypot
  const termsVersion = deps.termsVersion
    ?? (deps.preview && typeof d.termsVersion === 'string' && /^[a-z0-9.-]{1,40}$/.test(d.termsVersion) ? d.termsVersion : undefined)
  if (!termsVersion) throw new functions.https.HttpsError('unavailable', 'Ordering online is not open yet. Please contact us.')
  if (d.acceptTerms !== true || d.termsVersion !== termsVersion) {
    throw new functions.https.HttpsError('failed-precondition', 'Accept the current terms and data processing agreement to order.')
  }
  const input = validateOrderInput(d, { selfService: true })

  const ipHash = await hashIp(meta.ip)
  const tooMany = () => new functions.https.HttpsError('resource-exhausted', 'Too many orders right now. Please try again later or contact us.')
  if (!(await allow(`ip_${ipHash}`, 'order', ORDERS_PER_IP_PER_HOUR, HOUR))) throw tooMany()
  if (!(await allow('global', 'order', ORDERS_GLOBAL_PER_HOUR, HOUR))) throw tooMany()

  const orderId = await createOrder(input, { source: 'self_service', by: { system: 'self_service' }, terms: { version: termsVersion }, ipHash, preview: !!deps.preview })
  const address = `${input.school.shortName}.${customerBaseDomain()}`
  if (deps.preview) return { ok: true, address }

  // The order is saved; a failed email is logged, never surfaced
  try {
    if (!deps.notifyEmail) throw new Error('CONTACT_NOTIFY_EMAIL is not set: order saved but nobody was emailed')
    const cfg = await getEmailConfig()
    await deps.sendEmail({
      from: `${cfg?.fromName || 'CineForge'} <${cfg?.fromEmail || 'onboarding@resend.dev'}>`,
      to: [deps.notifyEmail],
      replyTo: input.admin.email,
      subject: `[CineForge order] ${input.school.name} (${input.organisation.name})`.replace(/[\r\n]+/g, ' '),
      html: [
        `<b>School:</b> ${escapeHtml(input.school.name)} — ${escapeHtml(input.school.shortName)}.${escapeHtml(customerBaseDomain())}`,
        `<b>Organisation:</b> ${escapeHtml(input.organisation.name)}`,
        `<b>Order id:</b> ${escapeHtml(orderId)}`,
        'Review it under Superadmin → Customers.',
      ].join('<br>'),
    })
  } catch (err) {
    console.error(`Order ${orderId} saved, but the notification email failed:`, err)
  }
  return { ok: true, address }
}

/** A superadmin previewing the hidden order page */
async function isSuperAdminCaller(context: functions.https.CallableContext): Promise<boolean> {
  try { await requireSuperAdminSession(context); return true } catch { return false }
}

const orderingOpen = () => process.env.SELF_SERVICE_ORDERS === 'true'
const notOpen = () => new functions.https.HttpsError('unavailable', 'Ordering online is not open yet. Please contact us.')

export const submitCustomerOrder = functions.region(REGION)
  .runWith({ ...LIMITS, maxInstances: 3, secrets: ['RESEND_API_KEY'] })
  .https.onCall(async (data, context) => {
    const preview = !orderingOpen() && await isSuperAdminCaller(context)
    if (!orderingOpen() && !preview) throw notOpen()
    if (process.env.CONTACT_REQUIRE_APP_CHECK === 'true' && !context.app) {
      throw new functions.https.HttpsError('failed-precondition', 'This form must be sent from the CineForge site.')
    }
    const req = context.rawRequest as unknown as { headers?: Record<string, unknown>; ip?: string }
    return handleSelfServiceOrder(data, { ip: clientIp(req) }, {
      notifyEmail: process.env.CONTACT_NOTIFY_EMAIL || undefined,
      termsVersion: process.env.ORDER_TERMS_VERSION || undefined,
      preview,
      sendEmail: process.env.FUNCTIONS_EMULATOR === 'true'
        ? async msg => { console.log('[emulator] order email not sent:\n' + JSON.stringify(msg, null, 2)) }
        : sendEmailOrThrow,
    })
  })

/** Short-name check for the order page; rate-limited per IP */
export const checkOrderShortName = functions.region(REGION).runWith({ ...LIMITS, maxInstances: 3 }).https.onCall(async (data, context) => {
  if (!orderingOpen() && !(await isSuperAdminCaller(context))) throw notOpen()
  const req = context.rawRequest as unknown as { headers?: Record<string, unknown>; ip?: string }
  if (!(await allow(`ip_${await hashIp(clientIp(req))}`, 'order_name', 60, HOUR))) {
    throw new functions.https.HttpsError('resource-exhausted', 'Too many checks right now. Try again later.')
  }
  return shortNameAvailable((data as Record<string, unknown> | null)?.shortName)
})
