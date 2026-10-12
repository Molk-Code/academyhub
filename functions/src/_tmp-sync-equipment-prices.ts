import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { db } from './lib'

// ─────────────────────────────────────────────────────────────────────────────
// TEMPORARY one-off tool — syncs equipment.priceInclVat/priceExclVat against
// a {name: priceInclVat} map scraped from an external rental-house price
// list. Staff-only. Remove this file (and its export in index.ts) after use.
// ─────────────────────────────────────────────────────────────────────────────

function normalize(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').trim()
}

export const tmpSyncEquipmentPrices = onCall(
  { region: 'us-central1' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.')
    const claims = request.auth.token as any
    if (claims.role !== 'teacher' && claims.role !== 'admin') {
      throw new HttpsError('permission-denied', 'Staff only.')
    }

    const { prices, dryRun } = (request.data ?? {}) as { prices?: Record<string, number>; dryRun?: boolean }
    if (!prices || typeof prices !== 'object') throw new HttpsError('invalid-argument', 'prices map is required.')

    const byNorm = new Map<string, { name: string; price: number }>()
    for (const [name, price] of Object.entries(prices)) {
      byNorm.set(normalize(name), { name, price })
    }

    const snap = await db.collection('equipment').get()
    const matchedExternalNorms = new Set<string>()
    const updated: { id: string; name: string; oldInclVat: number; newInclVat: number }[] = []
    const unmatchedOurItems: string[] = []

    const batch = db.batch()
    for (const doc of snap.docs) {
      const data = doc.data()
      const norm = normalize(data.name ?? '')
      const match = byNorm.get(norm)
      if (!match) {
        unmatchedOurItems.push(data.name ?? doc.id)
        continue
      }
      matchedExternalNorms.add(norm)
      const newInclVat = match.price
      const newExclVat = Math.round((newInclVat / 1.25) * 100) / 100
      if (data.priceInclVat !== newInclVat || data.priceExclVat !== newExclVat) {
        updated.push({ id: doc.id, name: data.name, oldInclVat: data.priceInclVat ?? 0, newInclVat })
        if (!dryRun) batch.update(doc.ref, { priceInclVat: newInclVat, priceExclVat: newExclVat })
      }
    }
    if (!dryRun) await batch.commit()

    const unmatchedExternalNames = [...byNorm.entries()]
      .filter(([norm]) => !matchedExternalNorms.has(norm))
      .map(([, v]) => v.name)

    return {
      dryRun: !!dryRun,
      updatedCount: updated.length,
      updated,
      unmatchedOurItems,
      unmatchedExternalNames,
    }
  },
)
