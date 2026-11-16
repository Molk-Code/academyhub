// The setup steps for one customer, in order. Each step is safe to run again:
// it checks what already exists first, so a retry continues where a failed
// run stopped. Values later steps need (project id, number, web app config,
// DNS record ids) are kept in the order's provisioning.state.
//
// This mirrors docs/customer-provisioning.md, which records why each part is
// there (most of it learned setting up cineforge-eu).
import { execFileSync } from 'child_process'
import { readFileSync, writeFileSync } from 'fs'
import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore'
import { google, waitForOperation, sleep, hostupZoneId, hostupRecords, hostupAddRecord, hostupDeleteRecord } from './clients.mjs'
import {
  REGION, FIRESTORE_LOCATION, STORAGE_LOCATION, BACKUP_LOCATION, APP_ENGINE_LOCATION, BACKUP_RETENTION_DAYS,
  SERVICES, SERVICE_IDENTITIES, projectIdFor, recordsToAdd, recordsForAddress, webEnv, functionsEnv, firebaseConfig, planFields, customerDnsRecords,
} from './config.mjs'

const CRM = 'https://cloudresourcemanager.googleapis.com/v3/'
const SU = 'https://serviceusage.googleapis.com/v1/'
const FB = 'https://firebase.googleapis.com/v1beta1/'
const FS = 'https://firestore.googleapis.com/v1/'
const GAE = 'https://appengine.googleapis.com/v1/'
const HOSTING = 'https://firebasehosting.googleapis.com/v1beta1/'
const IDT = 'https://identitytoolkit.googleapis.com/'
const GCS = 'https://storage.googleapis.com/storage/v1/'
const SM = 'https://secretmanager.googleapis.com/v1/'

const FIREBASE_TOOLS = 'firebase-tools@15.15.0'
const MODE = 'customer'

/**
 * ctx: { order, state, save(patch), env } where env holds FOLDER_ID,
 * BILLING_ACCOUNT, SETUP_SA, SUPERADMIN_EMAILS, ZONE, RESEND_API_KEY
 */

// ── IAM ──────────────────────────────────────────────────────────────────────

/** Adds role bindings to a project, retrying while new service accounts propagate */
async function grant(projectId, bindings) {
  for (let attempt = 0; ; attempt++) {
    try {
      const policy = await google('POST', `${CRM}projects/${projectId}:getIamPolicy`, {})
      let changed = false
      for (const [role, member] of bindings) {
        let b = (policy.bindings ??= []).find(x => x.role === role && !x.condition)
        if (!b) { b = { role, members: [] }; policy.bindings.push(b) }
        if (!b.members.includes(member)) { b.members.push(member); changed = true }
      }
      if (changed) await google('POST', `${CRM}projects/${projectId}:setIamPolicy`, { policy })
      return
    } catch (e) {
      if (attempt >= 8 || ![400, 409].includes(e.status)) throw e
      await sleep(15_000)
    }
  }
}

// ── Setup steps ──────────────────────────────────────────────────────────────

/** Project in the Customers folder, billing, APIs, App Engine app, service agents, default-account roles */
export async function project(ctx) {
  const { order, env } = ctx
  let { projectId } = ctx.state
  if (!projectId) {
    projectId = projectIdFor(order.school.shortName)
    await ctx.save({ projectId })
  }

  const existing = await google('GET', `${CRM}projects/${projectId}`, undefined, { allow: [403, 404] })
  if (existing.__status) {
    const displayName = `CineForge ${order.school.name}`.replace(/[^\p{L}\p{N} '"!-]/gu, ' ').slice(0, 30).trim()
    const op = await google('POST', `${CRM}projects`, {
      projectId, displayName, parent: `folders/${env.FOLDER_ID}`,
      labels: { cineforge_customer: order.school.shortName.slice(0, 63) },
    })
    await waitForOperation(CRM, op)
  }
  const p = await google('GET', `${CRM}projects/${projectId}`)
  const projectNumber = p.name.split('/')[1]
  await ctx.save({ projectNumber })

  // The setup account owns the project; the superadmin can manage it (Google
  // only lets a person outside the organisation become Owner by invitation)
  const superadmins = env.SUPERADMIN_EMAILS.split(',').map(s => s.trim()).filter(Boolean)
  await grant(projectId, [['roles/owner', `serviceAccount:${env.SETUP_SA}`]])
  await grant(projectId, superadmins.flatMap(e => [['roles/editor', `user:${e}`], ['roles/firebase.admin', `user:${e}`]]))

  await google('PUT', `https://cloudbilling.googleapis.com/v1/projects/${projectId}/billingInfo`, { billingAccountName: `billingAccounts/${env.BILLING_ACCOUNT}` })

  for (let i = 0; i < SERVICES.length; i += 20) {
    const op = await google('POST', `${SU}projects/${projectNumber}/services:batchEnable`, { serviceIds: SERVICES.slice(i, i + 20) })
    await waitForOperation(SU, op)
  }

  // Firestore before App Engine: creating the App Engine app first gives the
  // project a (default) database in Datastore mode, which Firebase can't use
  await ensureFirestore(projectId)

  const app = await google('GET', `${GAE}apps/${projectId}`, undefined, { allow: [404] })
  if (app.__status === 404) {
    const op = await google('POST', `${GAE}apps`, { id: projectId, locationId: APP_ENGINE_LOCATION })
    await waitForOperation(GAE, op)
  }

  for (const svc of SERVICE_IDENTITIES) {
    const op = await google('POST', `https://serviceusage.googleapis.com/v1beta1/projects/${projectNumber}/services/${svc}:generateServiceIdentity`, {})
    await waitForOperation('https://serviceusage.googleapis.com/v1beta1/', op)
  }

  // New organisations don't give default service accounts any role
  // (iam.automaticIamGrantsForDefaultServiceAccounts): grant what the old default gave
  await grant(projectId, [
    ['roles/editor', `serviceAccount:${projectId}@appspot.gserviceaccount.com`],
    ['roles/datastore.importExportAdmin', `serviceAccount:${projectId}@appspot.gserviceaccount.com`],
    ['roles/editor', `serviceAccount:${projectNumber}-compute@developer.gserviceaccount.com`],
    ['roles/cloudbuild.builds.builder', `serviceAccount:${projectNumber}-compute@developer.gserviceaccount.com`],
    ['roles/cloudbuild.builds.builder', `serviceAccount:${projectNumber}@cloudbuild.gserviceaccount.com`],
  ])
  return { projectId }
}

/**
 * The (default) database in Firestore (native) mode, in eur3. One that an App
 * Engine app already created in Datastore mode is switched while it's empty.
 */
async function ensureFirestore(projectId) {
  const url = `${FS}projects/${projectId}/databases/(default)`
  const db = await google('GET', url, undefined, { allow: [404] })
  if (db.__status === 404) {
    await waitForOperation(FS, await google('POST', `${FS}projects/${projectId}/databases?databaseId=(default)`, { type: 'FIRESTORE_NATIVE', locationId: FIRESTORE_LOCATION }))
    return
  }
  if (db.type === 'DATASTORE_MODE') {
    console.log('(default) is in Datastore mode: switching the empty database to Firestore mode')
    await waitForOperation(FS, await google('PATCH', `${url}?updateMask=type`, { type: 'FIRESTORE_NATIVE' }))
  }
}

/** Firebase, Firestore (eur3), Storage, backups bucket, sign-in, web app, Hosting site */
export async function services(ctx) {
  const { projectId, projectNumber } = ctx.state
  const address = ctx.order.address

  const fb = await google('GET', `${FB}projects/${projectId}`, undefined, { allow: [403, 404] })
  if (fb.__status) await waitForOperation(FB, await google('POST', `${FB}projects/${projectId}:addFirebase`, {}))

  await ensureFirestore(projectId)

  const storageBucket = `${projectId}.firebasestorage.app`
  const sb = await google('GET', `${GCS}b/${storageBucket}`, undefined, { allow: [404] })
  if (sb.__status === 404) {
    await google('POST', `https://firebasestorage.googleapis.com/v1alpha/projects/${projectId}/defaultBucket`, { location: STORAGE_LOCATION })
  }

  const backups = `${projectId}-backups`
  const bb = await google('GET', `${GCS}b/${backups}`, undefined, { allow: [404] })
  if (bb.__status === 404) {
    await google('POST', `${GCS}b?project=${projectId}`, {
      name: backups, location: BACKUP_LOCATION,
      iamConfiguration: { uniformBucketLevelAccess: { enabled: true }, publicAccessPrevention: 'enforced' },
      lifecycle: { rule: [{ action: { type: 'Delete' }, condition: { age: BACKUP_RETENTION_DAYS } }] },
    })
  }
  const policy = await google('GET', `${GCS}b/${backups}/iam`)
  const agent = `serviceAccount:service-${projectNumber}@gcp-sa-firestore.iam.gserviceaccount.com`
  if (!(policy.bindings ?? []).some(b => b.role === 'roles/storage.admin' && b.members.includes(agent))) {
    ;(policy.bindings ??= []).push({ role: 'roles/storage.admin', members: [agent] })
    await google('PUT', `${GCS}b/${backups}/iam`, policy)
  }

  await signInConfig(projectId, address)

  const apps = await google('GET', `${FB}projects/${projectId}/webApps`)
  let appId = apps?.apps?.[0]?.appId
  if (!appId) appId = (await waitForOperation(FB, await google('POST', `${FB}projects/${projectId}/webApps`, { displayName: 'CineForge' }))).appId
  const webConfig = await google('GET', `${FB}projects/${projectId}/webApps/${appId}/config`)
  await ctx.save({ webConfig })

  const sites = await google('GET', `${HOSTING}projects/${projectId}/sites`)
  if (!(sites?.sites ?? []).length) await google('POST', `${HOSTING}projects/${projectId}/sites?siteId=${projectId}`, {})
}

/** Email/password sign-in on, and the address allowed for sign-in */
async function signInConfig(projectId, address) {
  const url = `${IDT}admin/v2/projects/${projectId}/config`
  let cfg = await google('GET', url, undefined, { allow: [404] })
  if (cfg.__status === 404) {
    await google('POST', `${IDT}v2/projects/${projectId}/identityPlatform:initializeAuth`, {})
    cfg = await google('GET', url)
  }
  const domains = new Set([...(cfg.authorizedDomains ?? []), 'localhost', `${projectId}.firebaseapp.com`, `${projectId}.web.app`, address])
  await google('PATCH', `${url}?updateMask=signIn.email.enabled,signIn.email.passwordRequired,authorizedDomains`, {
    signIn: { email: { enabled: true, passwordRequired: true } },
    authorizedDomains: [...domains],
  })
}

/**
 * The customer's RESEND_API_KEY secret, kept equal to the control project's:
 * created when missing, and a new version added when the key changed (so a
 * corrected key reaches the customer on the next run).
 */
async function syncResendKey(projectId, key) {
  const base = `${SM}projects/${projectId}/secrets/RESEND_API_KEY`
  const secret = await google('GET', base, undefined, { allow: [404] })
  if (secret.__status === 404) {
    await google('POST', `${SM}projects/${projectId}/secrets?secretId=RESEND_API_KEY`, { replication: { automatic: {} }, labels: { 'firebase-managed': 'true' } })
  }
  const latest = await google('GET', `${base}/versions/latest:access`, undefined, { allow: [404, 400] })
  const current = latest.__status ? null : Buffer.from(latest.payload?.data ?? '', 'base64').toString()
  if (current !== (key ?? '')) {
    await google('POST', `${base}:addVersion`, { payload: { data: Buffer.from(key ?? '').toString('base64') } })
  }
}

/** Secrets, generated config files, then rules, functions and the app */
export async function deploy(ctx) {
  const { projectId, webConfig } = ctx.state
  const { order, env } = ctx
  const schoolId = order.school.shortName
  await ensureFirestore(projectId)

  await syncResendKey(projectId, env.RESEND_API_KEY)

  writeFileSync(`.env.${MODE}`, webEnv({ webConfig, schoolId, address: order.address }))
  writeFileSync(`functions/.env.${projectId}`, functionsEnv({ projectId, schoolId, address: order.address, superadminEmails: env.SUPERADMIN_EMAILS }))
  writeFileSync(`firebase.${MODE}.json`, JSON.stringify(firebaseConfig(JSON.parse(readFileSync('firebase.json', 'utf-8')), { mode: MODE, schoolId }), null, 2))

  const fire = (args, tries = 1) => {
    for (let i = 1; ; i++) {
      try {
        execFileSync('npx', ['-y', FIREBASE_TOOLS, ...args, '--project', projectId, '--non-interactive'], { stdio: 'inherit' })
        return
      } catch (e) {
        if (i >= tries) throw new Error(`firebase ${args.join(' ')} failed (see the build log)`)
        // A new or just-switched database answers 409 for a while: wait before retrying
        console.log(`retrying firebase ${args.join(' ')} in 60 s (${i}/${tries})`)
        execFileSync('sleep', ['60'])
      }
    }
  }
  fire(['deploy', '--config', `firebase.${MODE}.json`, '--only', 'firestore,storage', '--force'], 5)
  fire(['deploy', '--config', `firebase.${MODE}.json`, '--only', 'functions', '--force'], 3)
  fire(['functions:artifacts:setpolicy', '--location', REGION, '--force'], 2)
  fire(['deploy', '--config', `firebase.${MODE}.json`, '--only', 'hosting'], 3)
}

function customerDb(projectId) {
  const app = initializeApp({ credential: applicationDefault(), projectId }, `customer-${projectId}`)
  return getFirestore(app)
}

/** schools/<id>, the login page profile, and the email sender (copied from the control project) */
export async function school(ctx) {
  const { order, controlDb } = ctx
  const db = customerDb(ctx.state.projectId)
  const id = order.school.shortName
  const modules = order.plan.modules
  const frontDoor = modules.academy ? 'academy' : modules.rentalInventory ? 'rental_inventory' : 'production'
  const ref = db.collection('schools').doc(id)
  if (!(await ref.get()).exists) {
    await ref.set({
      schoolId: id, name: order.school.name, shortName: order.school.name, publicShop: false,
      ...planFields(order.plan),
      status: 'active', isBeta: false, currency: 'SEK', onboardingDate: FieldValue.serverTimestamp(),
    })
  }
  const profile = db.collection('public_config').doc('main')
  if (!(await profile.get()).exists) await profile.set({ name: order.school.name, shortName: order.school.name, frontDoor })
  const email = (await controlDb.collection('email_config').doc('global').get()).data()
  if (email) await db.collection('email_config').doc('global').set(email, { merge: true })
}

/**
 * A plan change for a live customer: the plan fields of schools/<id> (modules,
 * plan per module, limits) and the shop override. Usage, data and everything
 * else stay as they are.
 */
export async function changePlan(ctx, plan, shopOverride = null) {
  const db = customerDb(ctx.state.projectId)
  const ref = db.collection('schools').doc(ctx.order.school.shortName)
  if (!(await ref.get()).exists) throw new Error(`schools/${ctx.order.school.shortName} not found in ${ctx.state.projectId}`)
  // The superadmin's override of the public shop: absent leaves it to the school admin
  await ref.update({ ...planFields(plan), publicShopOverride: shopOverride ?? FieldValue.delete() })
}

/** https://<short name>.cineforge.se: Hosting custom domain, its records at Hostup, then wait for the certificate */
export async function domain(ctx) {
  const { projectId } = ctx.state
  const address = ctx.order.address
  const zone = ctx.env.ZONE
  const url = `${HOSTING}projects/${projectId}/sites/${projectId}/customDomains/${address}`
  const cd = await google('GET', url, undefined, { allow: [404] })
  if (cd.__status === 404) {
    await google('POST', `${HOSTING}projects/${projectId}/sites/${projectId}/customDomains?customDomainId=${address}`, {})
  }

  const zoneId = await hostupZoneId(zone)
  const added = [...(ctx.state.dnsRecords ?? [])]
  const until = Date.now() + 90 * 60_000
  for (;;) {
    const cur = await google('GET', url)
    const existing = await hostupRecords(zoneId)
    for (const rec of recordsToAdd(cur, address, zone)) {
      const full = rec.name === '@' ? zone : `${rec.name}.${zone}`
      const there = existing.some(r => r.type === rec.type && String(r.name).replace(/\.$/, '') === full && String(r.value).replace(/^"|"$/g, '') === rec.value)
      if (there) continue
      const made = await hostupAddRecord(zoneId, rec)
      added.push({ id: made.id, type: rec.type, name: full })
      await ctx.save({ dnsRecords: added })
    }
    // Google can say "propagating" for hours after the certificate already
    // works; accept that once the address answers over HTTPS (a bad
    // certificate makes fetch throw)
    const certOk = ['CERT_ACTIVE', 'CERT_EXPIRING_SOON'].includes(cur.cert?.state)
      || (cur.cert?.state === 'CERT_PROPAGATING' && await servesHttps(address))
    if (cur.hostState === 'HOST_ACTIVE' && cur.ownershipState === 'OWNERSHIP_ACTIVE' && certOk) return { address }
    await ctx.note(`Waiting for ${address}: host ${cur.hostState ?? '…'}, ownership ${cur.ownershipState ?? '…'}, certificate ${cur.cert?.state ?? '…'}`)
    if (Date.now() > until) throw new Error(`${address} isn't active after 90 minutes (host ${cur.hostState}, ownership ${cur.ownershipState}, certificate ${cur.cert?.state})`)
    await sleep(60_000)
  }
}

/**
 * The rental shop's own address (Rental Plus), on the customer's DNS: a Hosting
 * custom domain, the records the customer must add, and, once it's active,
 * public_config/main.shopDomain so that address opens on /shop. A previous
 * address is disconnected first; wanted = null only disconnects. Doesn't wait
 * for the customer's DNS: run again ("Check again") to see progress.
 */
export async function shopDomain(ctx, wanted, previous) {
  const { projectId } = ctx.state
  const base = `${HOSTING}projects/${projectId}/sites/${projectId}/customDomains`
  const profile = customerDb(projectId).collection('public_config').doc('main')
  if (previous && previous !== wanted) {
    await google('DELETE', `${base}/${previous}`, undefined, { allow: [404] })
    await profile.set({ shopDomain: FieldValue.delete() }, { merge: true })
  }
  if (!wanted) return { status: 'removed', records: [] }

  let cd = await google('GET', `${base}/${wanted}`, undefined, { allow: [404] })
  if (cd.__status === 404) await google('POST', `${base}?customDomainId=${wanted}`, {})
  // Hosting needs a moment to say which records it wants
  for (let i = 0; i < 10; i++) {
    cd = await google('GET', `${base}/${wanted}`)
    if (customerDnsRecords(cd, wanted).length || cd.hostState === 'HOST_ACTIVE') break
    await sleep(15_000)
  }
  const certOk = ['CERT_ACTIVE', 'CERT_EXPIRING_SOON'].includes(cd.cert?.state)
    || (cd.cert?.state === 'CERT_PROPAGATING' && await servesHttps(wanted))
  const active = cd.hostState === 'HOST_ACTIVE' && cd.ownershipState === 'OWNERSHIP_ACTIVE' && certOk
  await profile.set(active ? { shopDomain: wanted } : { shopDomain: FieldValue.delete() }, { merge: true })
  return {
    status: active ? 'active' : 'waiting_dns',
    records: customerDnsRecords(cd, wanted),
    hostState: cd.hostState ?? null, ownershipState: cd.ownershipState ?? null, certState: cd.cert?.state ?? null,
  }
}

async function servesHttps(address) {
  try {
    const res = await fetch(`https://${address}/`, { redirect: 'manual', signal: AbortSignal.timeout(15_000) })
    return res.status < 500
  } catch { return false }
}

/** Allow sign-in on the address (again, in case the domain step changed the config) */
export async function signin_domain(ctx) {
  await signInConfig(ctx.state.projectId, ctx.order.address)
}

/** An admin invitation in the customer's database, emailed to the school admin */
export async function invite(ctx) {
  const { order, env } = ctx
  await syncResendKey(ctx.state.projectId, env.RESEND_API_KEY)
  const db = customerDb(ctx.state.projectId)
  // A retry after a failed email reuses the invitation already saved
  const ref = ctx.state.inviteId ? db.collection('invitations').doc(ctx.state.inviteId) : await db.collection('invitations').add({
    email: order.admin.email.toLowerCase(), displayName: order.admin.name, role: 'admin', cohortId: null, used: false,
    createdAt: FieldValue.serverTimestamp(), expiresAt: Timestamp.fromDate(new Date(Date.now() + 14 * 86_400_000)),
  })
  if (!ctx.state.inviteId) await ctx.save({ inviteId: ref.id })
  const cfg = (await db.collection('email_config').doc('global').get()).data() ?? {}
  if (!env.RESEND_API_KEY || !cfg.fromEmail) throw new Error('No email sender configured (email_config/global or RESEND_API_KEY): invitation saved but not sent')
  const link = `https://${order.address}/accept-invite?token=${ref.id}`
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `${cfg.fromName || 'CineForge'} <${cfg.fromEmail}>`,
      to: [order.admin.email],
      subject: `Your CineForge for ${order.school.name} is ready`,
      html: `<div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px">
        <h2>Welcome to CineForge</h2>
        <p>${esc(order.school.name)} is set up at <strong>${esc(order.address)}</strong>. You're its administrator: create your account to get started. The link is valid for 14 days.</p>
        <p><a href="${link}" style="display:inline-block;background:#f97316;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600">Create your account</a></p>
      </div>`,
    }),
  })
  if (!res.ok) throw new Error(`Invitation saved, but the email failed: ${res.status} ${(await res.text()).slice(0, 200)}`)
  return { inviteId: ref.id }
}

export const SETUP = { project, services, deploy, school, domain, signin_domain, invite }

// ── Removal ──────────────────────────────────────────────────────────────────

/** Removes the address's records at Hostup, then deletes the project (Google keeps it 30 days) */
export async function remove(ctx) {
  const zone = ctx.env.ZONE
  const address = ctx.order.address
  const zoneId = await hostupZoneId(zone)
  for (const r of recordsForAddress(await hostupRecords(zoneId), address)) {
    await hostupDeleteRecord(zoneId, r.id)
    await ctx.note(`Removed DNS record ${r.type} ${r.name}`)
  }
  const { projectId } = ctx.state
  if (projectId) {
    const p = await google('GET', `${CRM}projects/${projectId}`, undefined, { allow: [403, 404] })
    if (!p.__status && p.state === 'ACTIVE') await waitForOperation(CRM, await google('DELETE', `${CRM}projects/${projectId}`))
  }
}
