// Set up a new customer deployment (one Firebase project per customer, same
// codebase). See docs/customer-provisioning.md for the whole checklist.
//
//   node scripts/provision-customer.mjs <customerId> [options]
//
// Without --project it only writes local files and prints the next steps —
// it never touches a Firebase project. With --project <id> it also seeds
// schools/<customerId> and public_config/main there (refusing to overwrite an
// existing school unless --overwrite), using your gcloud login.
//
// Options:
//   --project <firebaseProjectId>   seed this project (and name it in the files)
//   --name "Nordic Film Academy"    display name (default: customerId)
//   --short-name "Nordic"           short name (default: name)
//   --modules academy,production,rental_inventory   (default: all three)
//   --front-door academy|rental_inventory|production (default: first module)
//   --max-students 250  --storage-gb 50  --plan "Academy + Production"
//   --domain app.example.com        custom domain (APP_URL); default <project>.web.app
//   --region europe-west1           functions region (default europe-west1)
//   --overwrite                     replace an existing schools/<customerId>
import { execFileSync } from 'child_process'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import path from 'path'

const ROOT = new URL('..', import.meta.url).pathname
const PRODUCTION_PROJECT = 'academy-hub-c252f'
const MODULE_FLAG = { academy: 'academy', production: 'production', rental_inventory: 'rentalInventory' }

// ── Arguments ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const customerId = args[0]
const opt = name => { const i = args.indexOf(`--${name}`); return i > 0 ? args[i + 1] : undefined }
const flag = name => args.includes(`--${name}`)
const fail = msg => { console.error(`✖ ${msg}`); process.exit(1) }

if (!customerId || customerId.startsWith('--')) fail('usage: node scripts/provision-customer.mjs <customerId> [options] — see the header of this file')
if (!/^[a-z0-9-]{2,40}$/.test(customerId)) fail('customerId: 2–40 lowercase letters, digits or dashes')
if (['molkom', 'eu', 'emulator', 'example', 'local', 'production', 'development', 'test'].includes(customerId)) fail(`"${customerId}" is reserved`)

const project = opt('project')
if (project !== undefined && !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project)) fail('--project must be a Firebase project id')
if (project === PRODUCTION_PROJECT) fail(`refusing to provision a customer into the production project ${PRODUCTION_PROJECT}`)

const name = opt('name') ?? customerId
const shortName = opt('short-name') ?? name
const moduleIds = (opt('modules') ?? 'academy,production,rental_inventory').split(',').map(s => s.trim()).filter(Boolean)
for (const m of moduleIds) if (!MODULE_FLAG[m]) fail(`unknown module "${m}" (academy, production, rental_inventory)`)
const modules = Object.fromEntries(Object.entries(MODULE_FLAG).map(([id, f]) => [f, moduleIds.includes(id)]))
const frontDoor = opt('front-door') ?? moduleIds[0] ?? 'academy'
if (!MODULE_FLAG[frontDoor]) fail('--front-door must be academy, rental_inventory or production')
const num = (s, label) => { if (s === undefined) return null; const n = Number(s); if (!Number.isInteger(n) || n < 0) fail(`${label} must be a whole number`); return n }
const maxStudents = num(opt('max-students'), '--max-students')
const storageGB = num(opt('storage-gb'), '--storage-gb')
const planName = opt('plan') ?? null
const region = opt('region') ?? 'europe-west1'
const domain = opt('domain')
const projectLabel = project ?? '<firebase-project-id>'
const appUrl = domain ? `https://${domain}` : `https://${projectLabel}.web.app`

// ── Local files (kept if they already exist) ─────────────────────────────────
const written = []
function writeOnce(rel, content) {
  const file = path.join(ROOT, rel)
  if (existsSync(file)) { written.push(`kept     ${rel} (already exists)`); return }
  writeFileSync(file, content)
  written.push(`wrote    ${rel}`)
}

writeOnce(`.env.${customerId}`, `# ${name} — used by vite --mode ${customerId} (gitignored).
# Fill in from Firebase console → ${projectLabel} → Project settings → Your apps → Web app.
# Vite loads .env first and this file on top: keep every key below set here.
VITE_FIREBASE_API_KEY=PASTE_ME
VITE_FIREBASE_AUTH_DOMAIN=${projectLabel}.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=${projectLabel}
VITE_FIREBASE_STORAGE_BUCKET=${projectLabel}.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=PASTE_ME
VITE_FIREBASE_APP_ID=PASTE_ME
# Cloud Messaging → Web Push certificates (empty = push notifications off)
VITE_FIREBASE_VAPID_KEY=
# App Check (reCAPTCHA v3 site key) — empty = App Check off
VITE_RECAPTCHA_V3_SITE_KEY=

VITE_SCHOOL_ID=${customerId}
VITE_FUNCTIONS_REGION=${region}
`)

if (project) {
  writeOnce(`functions/.env.${project}`, `FUNCTIONS_REGION=${region}
SCHOOL_ID=${customerId}
APP_URL=${appUrl}
BACKUP_BUCKET=gs://${project}-backups
`)
}

const base = JSON.parse(readFileSync(path.join(ROOT, 'firebase.json'), 'utf-8'))
const customerConfig = {
  ...base,
  hosting: {
    ...base.hosting,
    public: `dist-${customerId}`,
    predeploy: ['node scripts/gen-build-id.mjs', `npx vite build --mode ${customerId} --outDir dist-${customerId}`, `node scripts/copy-build-id.mjs dist-${customerId}`],
  },
  firestore: { ...base.firestore, rules: `firestore.${customerId}.rules`, predeploy: [`node scripts/build-rules.mjs ${customerId}`] },
}
delete customerConfig.emulators
writeOnce(`firebase.${customerId}.json`, JSON.stringify(customerConfig, null, 2) + '\n')

// ── Seeding (only with --project) ────────────────────────────────────────────
async function seed() {
  const env = { ...process.env }
  try { env.CLOUDSDK_PYTHON ??= execFileSync(path.join(homedir(), '.local/bin/uv'), ['python', 'find', '3.12'], { encoding: 'utf-8' }).trim() } catch {}
  const gcloud = process.env.GCLOUD ?? path.join(homedir(), 'google-cloud-sdk/bin/gcloud')
  const token = execFileSync(gcloud, ['auth', 'print-access-token'], { env, encoding: 'utf-8' }).trim()
  const BASE = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'x-goog-user-project': project }
  const toValue = v => v === null ? { nullValue: null }
    : typeof v === 'boolean' ? { booleanValue: v }
    : typeof v === 'number' ? { integerValue: String(v) }
    : v instanceof Date ? { timestampValue: v.toISOString() }
    : typeof v === 'object' ? { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toValue(x)])) } }
    : { stringValue: String(v) }
  const fields = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => [k, toValue(v)]))
  const get = async p => (await fetch(`${BASE}/${p}`, { headers })).status
  const put = async (p, body, mustNotExist) => {
    const res = await fetch(`${BASE}/${p}${mustNotExist ? '?currentDocument.exists=false' : ''}`, { method: 'PATCH', headers, body: JSON.stringify({ fields: fields(body) }) })
    if (!res.ok) fail(`writing ${p} failed: ${res.status} ${await res.text()}`)
  }

  const schoolStatus = await get(`schools/${customerId}`)
  if (schoolStatus === 200 && !flag('overwrite')) fail(`schools/${customerId} already exists in ${project} — nothing written (pass --overwrite to replace it)`)
  if (schoolStatus !== 200 && schoolStatus !== 404) fail(`could not read ${project} (HTTP ${schoolStatus}) — check gcloud auth and the project id`)

  await put(`schools/${customerId}`, {
    name, shortName, modules, publicShop: false, planName, maxStudents, storageQuotaGB: storageGB,
    status: 'trial', isBeta: false, currency: 'SEK', onboardingDate: new Date(),
  }, !flag('overwrite'))
  console.log(`seeded   schools/${customerId} in ${project}`)

  if (await get('public_config/main') === 404) {
    await put('public_config/main', { name, shortName, frontDoor }, true)
    console.log(`seeded   public_config/main in ${project}`)
  } else {
    console.log(`kept     public_config/main in ${project} (already exists)`)
  }
}

if (project) await seed()

// ── Next steps ───────────────────────────────────────────────────────────────
const P = projectLabel
console.log(`\n${written.join('\n')}

Customer ${customerId}: ${name}
  modules: ${moduleIds.join(', ') || 'core only'} · front door: ${frontDoor} · region: ${region}

Next steps (docs/customer-provisioning.md has the full checklist):
  1. Firebase project ${P}: Blaze plan; Firestore (default) in eur3; Storage in an EU location;
     Authentication → Email/Password; a Web app (paste its config into .env.${customerId}).
${project ? '' : `  2. Re-run with --project ${P} to write functions/.env.${P} and seed the school.\n`}  3. Secrets:           firebase functions:secrets:set RESEND_API_KEY --project ${P}
  4. Superadmin:        functions/.env must list SUPERADMIN_EMAILS (gitignored, shared by all projects)
  5. Backups bucket:    gcloud storage buckets create gs://${P}-backups --location=EU --uniform-bucket-level-access --public-access-prevention --project ${P}
  6. Deploy (in order):
       firebase deploy --config firebase.${customerId}.json --only firestore,storage --project ${P}
       firebase deploy --config firebase.${customerId}.json --only functions --project ${P}
       firebase deploy --config firebase.${customerId}.json --only hosting --project ${P}
  7. Domain:            Hosting → Add custom domain${domain ? ` (${domain})` : ''}, then add it to Auth → authorized domains
  8. First admin:       create the invite from the superadmin, then run the smoke test checklist`)
