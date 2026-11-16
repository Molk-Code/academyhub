// Pure helpers for the customer setup: names and generated files. No network,
// so they're unit-tested (scripts/customer-setup/config.test.mjs).

export const REGION = 'europe-west1'
export const FIRESTORE_LOCATION = 'eur3'
export const STORAGE_LOCATION = 'EUROPE-WEST1'
export const BACKUP_LOCATION = 'EU'
export const APP_ENGINE_LOCATION = 'europe-west'
export const BACKUP_RETENTION_DAYS = 30

/** APIs a customer project needs (what cineforge-eu has on, for these functions) */
export const SERVICES = [
  'firebase.googleapis.com', 'firestore.googleapis.com', 'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com', 'firebasestorage.googleapis.com', 'storage.googleapis.com',
  'firebasehosting.googleapis.com', 'firebaserules.googleapis.com', 'firebaseinstallations.googleapis.com',
  'fcm.googleapis.com', 'fcmregistrations.googleapis.com', 'cloudfunctions.googleapis.com', 'cloudbuild.googleapis.com',
  'artifactregistry.googleapis.com', 'run.googleapis.com', 'eventarc.googleapis.com',
  'pubsub.googleapis.com', 'cloudscheduler.googleapis.com', 'secretmanager.googleapis.com',
  'appengine.googleapis.com', 'iam.googleapis.com', 'iamcredentials.googleapis.com',
  'logging.googleapis.com', 'cloudbilling.googleapis.com', 'serviceusage.googleapis.com',
  'cloudresourcemanager.googleapis.com',
]

/** Service agents a new project only gets on first use; the first deploy fails without them */
export const SERVICE_IDENTITIES = ['cloudfunctions.googleapis.com', 'run.googleapis.com', 'cloudbuild.googleapis.com', 'firestore.googleapis.com']

/** Project id for a customer: cf-<short name>-<4 random>; deleted ids can never be reused */
export function projectIdFor(shortName, random = Math.random) {
  const suffix = Array.from({ length: 4 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(random() * 36)]).join('')
  const base = `cf-${shortName}`.slice(0, 30 - 5).replace(/-+$/, '')
  return `${base}-${suffix}`
}

/** The label a DNS record has inside the zone: "test-setup" for test-setup.cineforge.se */
export function relativeName(fqdn, zone) {
  const name = fqdn.replace(/\.$/, '').toLowerCase()
  if (name === zone) return '@'
  if (!name.endsWith(`.${zone}`)) throw new Error(`${fqdn} is not inside ${zone}`)
  return name.slice(0, -(zone.length + 1))
}

/**
 * Records Hosting asks for, as Hostup records: requiredDnsUpdates.desired and
 * the certificate's DNS challenge, only those to ADD, only for this address
 * (never the zone root or another name).
 */
export function recordsToAdd(customDomain, address, zone) {
  const sets = [...(customDomain?.requiredDnsUpdates?.desired ?? []), ...(customDomain?.cert?.verification?.dns?.desired ?? [])]
  const out = []
  for (const set of sets) {
    const domain = String(set.domainName ?? '').replace(/\.$/, '').toLowerCase()
    if (domain !== address && !domain.endsWith(`.${address}`)) continue
    for (const r of set.records ?? []) {
      if (r.requiredAction && r.requiredAction !== 'ADD') continue
      if (!['A', 'AAAA', 'TXT', 'CNAME'].includes(r.type)) continue
      const rec = { type: r.type, name: relativeName(domain, zone), value: String(r.rdata).replace(/^"|"$/g, ''), ttl: 300 }
      if (!out.some(o => o.type === rec.type && o.name === rec.name && o.value === rec.value)) out.push(rec)
    }
  }
  return out
}

/** Hostup records that belong to this address (for removal): the name itself and names under it */
export function recordsForAddress(records, address) {
  return records.filter(r => {
    const n = String(r.name ?? '').replace(/\.$/, '').toLowerCase()
    return n === address || n.endsWith(`.${address}`)
  })
}

/** .env.<mode> for the web app build: every key set, so nothing leaks from .env */
export function webEnv({ webConfig, schoolId, address }) {
  return [
    `VITE_FIREBASE_API_KEY=${webConfig.apiKey}`,
    `VITE_FIREBASE_AUTH_DOMAIN=${webConfig.authDomain}`,
    `VITE_FIREBASE_PROJECT_ID=${webConfig.projectId}`,
    `VITE_FIREBASE_STORAGE_BUCKET=${webConfig.storageBucket}`,
    `VITE_FIREBASE_MESSAGING_SENDER_ID=${webConfig.messagingSenderId}`,
    `VITE_FIREBASE_APP_ID=${webConfig.appId}`,
    'VITE_FIREBASE_VAPID_KEY=',
    `VITE_FUNCTIONS_REGION=${REGION}`,
    `VITE_SITE_URL=https://${address}`,
    `VITE_SCHOOL_ID=${schoolId}`,
    'VITE_CLOUDINARY_CLOUD_NAME=',
    'VITE_CLOUDINARY_UPLOAD_PRESET=',
    'VITE_STRIPE_PUBLISHABLE_KEY=',
    '',
  ].join('\n')
}

/** functions/.env.<projectId> */
export function functionsEnv({ projectId, schoolId, address, superadminEmails }) {
  return [
    `FUNCTIONS_REGION=${REGION}`,
    `SCHOOL_ID=${schoolId}`,
    `APP_URL=https://${address}`,
    `BACKUP_BUCKET=${projectId}-backups`,
    `SUPERADMIN_EMAILS=${superadminEmails}`,
    'SUPERADMIN_REQUIRE_GOOGLE=true',
    '',
  ].join('\n')
}

/** firebase.<mode>.json: cineforge-eu's config with this customer's build, dist and rules */
export function firebaseConfig(euConfig, { mode, schoolId }) {
  const c = JSON.parse(JSON.stringify(euConfig))
  delete c.emulators
  c.hosting.public = `dist-${mode}`
  c.hosting.predeploy = [
    'node scripts/gen-build-id.mjs',
    `npx vite build --mode ${mode} --outDir dist-${mode}`,
    `node scripts/copy-build-id.mjs dist-${mode}`,
  ]
  c.firestore = { ...c.firestore, rules: `firestore.${schoolId}.rules`, predeploy: [`node scripts/build-rules.mjs ${schoolId}`] }
  return c
}
