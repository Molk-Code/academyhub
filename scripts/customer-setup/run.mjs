// Runs in Cloud Build (submitted by functions/src/onboarding.ts) as the
// customer-setup service account:
//   ORDER_ID=<id> MODE=setup|remove node scripts/customer-setup/run.mjs
// Progress goes to customer_orders/<id> in the control project (cineforge-eu),
// which Superadmin → Customers shows live. Each step is safe to re-run.
import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { SETUP, remove, changePlan } from './steps.mjs'

const STEP_IDS = ['project', 'services', 'deploy', 'school', 'domain', 'signin_domain', 'invite']

const need = k => { const v = process.env[k]; if (!v) throw new Error(`${k} is not set`); return v }
const env = {
  CONTROL_PROJECT: need('CONTROL_PROJECT'),
  FOLDER_ID: need('FOLDER_ID'),
  BILLING_ACCOUNT: need('BILLING_ACCOUNT'),
  SETUP_SA: need('SETUP_SA'),
  SUPERADMIN_EMAILS: need('SUPERADMIN_EMAILS'),
  ZONE: process.env.ZONE || 'cineforge.se',
  RESEND_API_KEY: process.env.RESEND_API_KEY,
}
const orderId = need('ORDER_ID')
const mode = ['remove', 'plan'].includes(process.env.MODE) ? process.env.MODE : 'setup'

const controlDb = getFirestore(initializeApp({ credential: applicationDefault(), projectId: env.CONTROL_PROJECT }))
const ref = controlDb.collection('customer_orders').doc(orderId)
const event = (action, detail = {}) => ref.collection('events').add({ at: FieldValue.serverTimestamp(), by: { system: 'setup' }, action, detail })

const snap = await ref.get()
if (!snap.exists) throw new Error(`Order ${orderId} not found`)
const order = snap.data()
const state = { ...(order.provisioning?.state ?? {}) }

const ctx = {
  order, state, env, controlDb,
  async save(patch) {
    Object.assign(state, patch)
    await ref.update(Object.fromEntries(Object.entries(patch).map(([k, v]) => [`provisioning.state.${k}`, v])))
  },
  async note(text) { await ref.update({ 'provisioning.note': text, updatedAt: FieldValue.serverTimestamp() }) },
}

async function fail(where, err) {
  const message = (err instanceof Error ? err.message : String(err)).slice(0, 900)
  console.error(err)
  await ref.update({ status: 'failed', 'provisioning.error': `${where}: ${message}`.slice(0, 1000), 'provisioning.note': null, updatedAt: FieldValue.serverTimestamp() })
  await event(mode === 'remove' ? 'removal_failed' : 'setup_failed', { step: where, error: message.slice(0, 500) })
  process.exit(1)
}

// A plan change for a live customer: its school record, then the order. The
// order stays live whatever happens; only planChange reports the outcome.
if (mode === 'plan') {
  const plan = order.planChange?.plan
  try {
    if (!plan) throw new Error('No plan change on the order')
    await changePlan(ctx, plan)
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 900)
    console.error(err)
    await ref.update({ 'planChange.status': 'failed', 'planChange.error': message, updatedAt: FieldValue.serverTimestamp() })
    await event('plan_change_failed', { error: message.slice(0, 500) })
    process.exit(1)
  }
  await ref.update({ plan, 'planChange.status': 'done', 'planChange.error': null, 'planChange.doneAt': FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
  await event('plan_changed', { to: plan.planName })
  process.exit(0)
}

if (mode === 'remove') {
  try {
    await remove(ctx)
  } catch (err) { await fail('Removal', err) }
  await ref.update({ status: 'removed', 'provisioning.note': null, 'provisioning.removedAt': FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
  const slug = controlDb.collection('customer_slugs').doc(order.school.shortName)
  const s = await slug.get()
  if (s.exists && s.data()?.orderId === orderId) await slug.delete()
  await event('removed')
  process.exit(0)
}

for (const id of STEP_IDS) {
  if (order.provisioning?.steps?.[id]?.status === 'done') continue
  await ref.update({ [`provisioning.steps.${id}`]: { status: 'running', at: FieldValue.serverTimestamp() }, updatedAt: FieldValue.serverTimestamp() })
  console.log(`\n── ${id} ──`)
  try {
    const result = await SETUP[id](ctx)
    await ref.update({ [`provisioning.steps.${id}`]: { status: 'done', at: FieldValue.serverTimestamp(), ...(result ?? {}) }, 'provisioning.note': null })
  } catch (err) {
    await ref.update({ [`provisioning.steps.${id}`]: { status: 'failed', at: FieldValue.serverTimestamp(), error: String(err?.message ?? err).slice(0, 500) } })
    await fail(id, err)
  }
}
await ref.update({ status: 'live', 'provisioning.finishedAt': FieldValue.serverTimestamp(), 'provisioning.note': null, updatedAt: FieldValue.serverTimestamp() })
await event('live')
process.exit(0)
