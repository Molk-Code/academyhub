// HTTP clients for the customer setup (run.mjs): Google APIs with the
// build's own credentials (the customer-setup service account), and Hostup's
// DNS API with HOSTUP_API_KEY. Kept small and explicit: every call the setup
// makes is visible here or in steps.mjs.
import { GoogleAuth } from 'google-auth-library'

const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] })

export class ApiError extends Error {
  constructor(method, url, status, body) {
    super(`${method} ${url.replace(/\?.*$/, '')} → ${status}: ${typeof body === 'string' ? body.slice(0, 400) : JSON.stringify(body).slice(0, 400)}`)
    this.status = status
    this.body = body
  }
}

/** Google API call; returns parsed JSON (or null for an empty body) */
export async function google(method, url, body, { allow = [] } = {}) {
  const client = await auth.getClient()
  const { token } = await client.getAccessToken()
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let parsed = null
  try { parsed = text ? JSON.parse(text) : null } catch { parsed = text }
  if (!res.ok && !allow.includes(res.status)) throw new ApiError(method, url, res.status, parsed)
  return res.ok ? parsed : { __status: res.status, ...(typeof parsed === 'object' ? parsed : {}) }
}

export const sleep = ms => new Promise(r => setTimeout(r, ms))

/**
 * Waits for a long-running operation. `base` is the API root the operation
 * name is relative to, e.g. https://cloudresourcemanager.googleapis.com/v3/
 */
export async function waitForOperation(base, op, { timeoutMs = 15 * 60_000, everyMs = 5_000 } = {}) {
  if (!op?.name || op.done) {
    if (op?.error) throw new Error(`Operation failed: ${JSON.stringify(op.error)}`)
    return op?.response ?? op
  }
  const until = Date.now() + timeoutMs
  for (;;) {
    await sleep(everyMs)
    const cur = await google('GET', `${base}${op.name}`)
    if (cur.done) {
      if (cur.error) throw new Error(`Operation ${op.name} failed: ${JSON.stringify(cur.error)}`)
      return cur.response ?? cur
    }
    if (Date.now() > until) throw new Error(`Operation ${op.name} still running after ${timeoutMs / 60_000} minutes`)
  }
}

// ── Hostup DNS (https://developer.hostup.se) ───────────────────────────────────

const HOSTUP = 'https://cloud.hostup.se/api/v2'

async function hostup(method, path, body) {
  const key = process.env.HOSTUP_API_KEY
  if (!key) throw new Error('HOSTUP_API_KEY is not available to the setup')
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${HOSTUP}${path}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (res.status === 429 && attempt < 5) { await sleep((Number(res.headers.get('retry-after')) || 5) * 1000); continue }
    const text = await res.text()
    let parsed = null
    try { parsed = text ? JSON.parse(text) : null } catch { parsed = text }
    if (!res.ok && !(method === 'DELETE' && res.status === 404)) throw new ApiError(method, `${HOSTUP}${path}`, res.status, parsed)
    return parsed
  }
}

export async function hostupZoneId(zoneName) {
  const r = await hostup('GET', `/dns-zones?name=${encodeURIComponent(zoneName)}`)
  const zone = (r?.data ?? []).find(z => z.name === zoneName)
  if (!zone) throw new Error(`Hostup has no DNS zone ${zoneName} (or the API key can't see it)`)
  return zone.id
}

export async function hostupRecords(zoneId) {
  const r = await hostup('GET', `/dns-zones/${zoneId}`)
  return r?.records ?? []
}

export async function hostupAddRecord(zoneId, record) {
  return hostup('POST', `/dns-zones/${zoneId}/records`, record)
}

export async function hostupDeleteRecord(zoneId, recordId) {
  return hostup('DELETE', `/dns-zones/${zoneId}/records/${recordId}`)
}
