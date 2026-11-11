// EU migration: after Firestore and Storage are copied into cineforge-eu, file
// URLs saved in documents (avatars, screenplays, guest teacher photos …) still
// name the old bucket. This swaps the bucket name in every such string; the
// object path and download token stay the same, and the token was copied
// with the file, so the links keep working against the EU bucket.
//
//   node scripts/eu-rewrite-storage-urls.mjs           # dry run: list what would change
//   node scripts/eu-rewrite-storage-urls.mjs --apply   # write the changes
//
// Uses your gcloud login (gcloud auth login) through the Firestore REST API.
// Scans every collection group named at the root or in src/ and functions/src.
import { execFileSync } from 'child_process'
import { readFileSync, readdirSync, statSync } from 'fs'
import { homedir } from 'os'
import path from 'path'

const PROJECT = 'cineforge-eu'
const FROM = '/v0/b/academy-hub-c252f.firebasestorage.app/'
const TO = '/v0/b/cineforge-eu.firebasestorage.app/'
const apply = process.argv.includes('--apply')
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`

// gcloud needs Python 3.10+; reuse the uv-installed one when it's there
const env = { ...process.env }
try { env.CLOUDSDK_PYTHON ??= execFileSync(path.join(homedir(), '.local/bin/uv'), ['python', 'find', '3.12'], { encoding: 'utf-8' }).trim() } catch {}
const gcloud = process.env.GCLOUD ?? path.join(homedir(), 'google-cloud-sdk/bin/gcloud')
let token = '', tokenAt = 0
function auth() {
  if (Date.now() - tokenAt > 30 * 60_000) {
    token = execFileSync(gcloud, ['auth', 'print-access-token'], { env, encoding: 'utf-8' }).trim()
    tokenAt = Date.now()
  }
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'x-goog-user-project': PROJECT }
}
async function api(url, init = {}) {
  const res = await fetch(url, { ...init, headers: auth() })
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${url} → ${res.status} ${await res.text()}`)
  return res.json()
}

// Collection names: everything at the root, plus subcollection names used in code
function namesInCode(dir, out = new Set()) {
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f)
    if (statSync(p).isDirectory()) namesInCode(p, out)
    else if (/\.(ts|tsx)$/.test(f)) {
      for (const m of readFileSync(p, 'utf-8').matchAll(/(?:collection|collectionGroup)\((?:db, )?['"]([A-Za-z_]+)['"]|, ['"]([A-Za-z_]+)['"]\)/g)) out.add(m[1] ?? m[2])
    }
  }
  return out
}
const roots = (await api(`${BASE}:listCollectionIds`, { method: 'POST', body: JSON.stringify({ pageSize: 500 }) })).collectionIds ?? []
const groups = [...new Set([...roots, ...namesInCode('src'), ...namesInCode('functions/src')])].sort()

// Returns a rewritten copy of a REST Value, or null when nothing in it changes
function rewrite(v) {
  if ('stringValue' in v) return v.stringValue.includes(FROM) ? { stringValue: v.stringValue.replaceAll(FROM, TO) } : null
  if ('arrayValue' in v) {
    const items = v.arrayValue.values ?? []
    const out = items.map(rewrite)
    return out.some(Boolean) ? { arrayValue: { values: items.map((x, i) => out[i] ?? x) } } : null
  }
  if ('mapValue' in v) {
    const fields = v.mapValue.fields ?? {}
    const out = Object.fromEntries(Object.entries(fields).map(([k, x]) => [k, rewrite(x)]))
    return Object.values(out).some(Boolean) ? { mapValue: { fields: Object.fromEntries(Object.entries(fields).map(([k, x]) => [k, out[k] ?? x])) } } : null
  }
  return null
}

const seen = new Set()
let scanned = 0, docsChanged = 0, fieldsChanged = 0
for (const group of groups) {
  let pageToken
  do {
    const body = { structuredQuery: { from: [{ collectionId: group, allDescendants: true }], orderBy: [{ field: { fieldPath: '__name__' } }], limit: 300 } }
    if (pageToken) body.structuredQuery.startAt = { values: [{ referenceValue: pageToken }], before: false }
    const rows = (await api(`${BASE}:runQuery`, { method: 'POST', body: JSON.stringify(body) })).filter(r => r.document)
    for (const { document: d } of rows) {
      if (seen.has(d.name)) continue
      seen.add(d.name); scanned++
      const changed = Object.entries(d.fields ?? {}).map(([k, v]) => [k, rewrite(v)]).filter(([, v]) => v)
      if (!changed.length) continue
      docsChanged++; fieldsChanged += changed.length
      const rel = d.name.split('/documents/')[1]
      console.log(`${apply ? 'update' : 'would update'} ${rel}: ${changed.map(([k]) => k).join(', ')}`)
      if (apply) {
        const mask = changed.map(([k]) => `updateMask.fieldPaths=${encodeURIComponent('`' + k.replace(/`/g, '\\`') + '`')}`).join('&')
        await api(`https://firestore.googleapis.com/v1/${d.name}?${mask}&currentDocument.updateTime=${encodeURIComponent(d.updateTime)}`, {
          method: 'PATCH', body: JSON.stringify({ fields: Object.fromEntries(changed) }),
        })
      }
    }
    pageToken = rows.length === 300 ? rows[rows.length - 1].document.name : undefined
  } while (pageToken)
}
console.log(`\n${groups.length} collection groups, ${scanned} documents scanned: ${docsChanged} documents / ${fieldsChanged} fields ${apply ? 'updated' : 'to update (dry run — pass --apply to write)'}`)
