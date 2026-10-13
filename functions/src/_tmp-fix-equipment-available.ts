import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { db } from './lib'

// TEMPORARY — one-off fix for an equipment.available counter thrown off by
// deleting a project that still had checked-out items (a separate,
// pre-existing gap: deleteProjectFully doesn't release availability).
// Staff-only. Remove this file + its index.ts export after use.
export const tmpFixEquipmentAvailable = onCall(
  { region: 'us-central1' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.')
    const claims = request.auth.token as any
    if (claims.role !== 'teacher' && claims.role !== 'admin') {
      throw new HttpsError('permission-denied', 'Staff only.')
    }
    const { equipmentId, available } = (request.data ?? {}) as { equipmentId?: string; available?: number }
    if (!equipmentId || typeof available !== 'number') {
      throw new HttpsError('invalid-argument', 'equipmentId and available are required.')
    }
    await db.collection('equipment').doc(equipmentId).update({ available })
    return { ok: true }
  },
)
