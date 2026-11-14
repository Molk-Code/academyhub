// Publishes the code new customers are set up from: a tarball of the current
// commit (git archive: committed files only, so no .env secrets) uploaded to
// gs://<project>-releases, and platform/release pointing at it. Run after
// deploying cineforge-eu, so new customers get the same version:
//
//   node scripts/publish-release.mjs            (project cineforge-eu)
//   node scripts/publish-release.mjs --project <id>
import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync } from 'fs'
import { homedir, tmpdir } from 'os'
import path from 'path'

const args = process.argv.slice(2)
const project = args.includes('--project') ? args[args.indexOf('--project') + 1] : 'cineforge-eu'
if (project === 'academy-hub-c252f') { console.error('✖ refusing to publish into the production project'); process.exit(1) }

const git = (...a) => execFileSync('git', a, { encoding: 'utf-8' }).trim()
if (git('status', '--porcelain', '--untracked-files=no')) { console.error('✖ uncommitted changes: commit first, the release is the current commit'); process.exit(1) }
const sha = git('rev-parse', '--short=12', 'HEAD')

const env = { ...process.env }
try { env.CLOUDSDK_PYTHON ??= execFileSync(path.join(homedir(), '.local/bin/uv'), ['python', 'find', '3.12'], { encoding: 'utf-8' }).trim() } catch {}
const gcloud = process.env.GCLOUD ?? path.join(homedir(), 'google-cloud-sdk/bin/gcloud')
const bucket = `${project}-releases`
const object = `releases/${sha}.tgz`

const dir = mkdtempSync(path.join(tmpdir(), 'cf-release-'))
try {
  const file = path.join(dir, `${sha}.tgz`)
  execFileSync('git', ['archive', '--format=tar.gz', '-o', file, 'HEAD'])
  execFileSync(gcloud, ['storage', 'cp', file, `gs://${bucket}/${object}`, '--project', project], { env, stdio: 'inherit' })
} finally { rmSync(dir, { recursive: true, force: true }) }

const token = execFileSync(gcloud, ['auth', 'print-access-token'], { env, encoding: 'utf-8' }).trim()
const res = await fetch(`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/platform/release`, {
  method: 'PATCH',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'x-goog-user-project': project },
  body: JSON.stringify({ fields: {
    bucket: { stringValue: bucket }, object: { stringValue: object }, sha: { stringValue: sha },
    publishedAt: { timestampValue: new Date().toISOString() },
  } }),
})
if (!res.ok) { console.error(`✖ writing platform/release failed: ${res.status} ${await res.text()}`); process.exit(1) }
console.log(`published ${sha} → gs://${bucket}/${object}`)
