import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { db } from './lib'

// ─────────────────────────────────────────────────────────────────────────────
// TEMPORARY one-off repair tool — deployed to clean up pre-existing orphaned
// data from before deleteScene/deleteAllScenes cascaded to shots and
// shootingDays.sceneIds. Staff-only. Remove this file (and its export in
// index.ts) once the affected productions have been repaired.
// ─────────────────────────────────────────────────────────────────────────────

export const repairOrphanedShots = onCall(
  { region: 'us-central1' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.')
    const claims = request.auth.token as any
    if (claims.role !== 'teacher' && claims.role !== 'admin') {
      throw new HttpsError('permission-denied', 'Staff only.')
    }

    const { productionId } = (request.data ?? {}) as { productionId?: string }
    if (!productionId) throw new HttpsError('invalid-argument', 'productionId is required.')

    const prodRef = db.collection('productions').doc(productionId)
    const [scenesSnap, shotsSnap, daysSnap] = await Promise.all([
      prodRef.collection('scenes').get(),
      prodRef.collection('shots').get(),
      prodRef.collection('shootingDays').get(),
    ])
    const liveSceneIds = new Set(scenesSnap.docs.map(d => d.id))

    const orphanedShots = shotsSnap.docs.filter(d => !liveSceneIds.has(d.data().sceneId))

    const dayUpdates: { id: string; before: string[]; after: string[] }[] = []
    for (const d of daysSnap.docs) {
      const before = (d.data().sceneIds ?? []) as string[]
      const after = before.filter(sid => liveSceneIds.has(sid))
      if (after.length !== before.length) dayUpdates.push({ id: d.id, before, after })
    }

    const batch = db.batch()
    orphanedShots.forEach(d => batch.delete(d.ref))
    dayUpdates.forEach(u => batch.update(prodRef.collection('shootingDays').doc(u.id), { sceneIds: u.after }))
    await batch.commit()

    return {
      deletedShotIds: orphanedShots.map(d => d.id),
      dayUpdates,
    }
  },
)
