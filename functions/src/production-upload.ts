import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { admin, db, allow } from './lib'

// ─────────────────────────────────────────────────────────────────────────────
// uploadScreenplay — callable: upload a production's screenplay PDF.
//
// Storage Rules can't reliably call firestore.get() cross-service for plain
// student accounts in this project (it works for staff, whose role claim
// short-circuits isTeacherOrAdmin() before the cross-service call ever runs —
// but errors out for students, who fall through to it). Writing the file
// here via the Admin SDK, after checking ownership directly against
// Firestore, sidesteps that entirely. Using the v2 API (Cloud Run-based) for
// a larger request-body ceiling than 1st-gen's ~10MB.
// ─────────────────────────────────────────────────────────────────────────────

// 15 MB: the file travels base64-encoded (+33 %), which has to stay under the
// 32 MB request limit; 1 GiB and at most 4 uploads per instance keep several
// of them from running one instance out of memory.
const MAX_BYTES = 15 * 1024 * 1024 // 15 MB

export const uploadScreenplay = onCall(
  { region: 'us-central1', memory: '1GiB', concurrency: 4, maxInstances: 20 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.')
    const role = request.auth.token.role
    if (!['student', 'teacher', 'admin'].includes(role) && !(await db.collection('users').doc(request.auth.uid).get()).exists) {
      throw new HttpsError('permission-denied', 'This account is not part of the school.')
    }
    if (!(await allow(request.auth.uid, 'screenplay-upload', 10))) {
      throw new HttpsError('resource-exhausted', 'Too many uploads — wait a minute and try again.')
    }

    const { productionId, fileBase64 } = (request.data ?? {}) as { productionId?: string; fileBase64?: string }
    if (!productionId || !fileBase64) {
      throw new HttpsError('invalid-argument', 'productionId and fileBase64 are required.')
    }

    const prodSnap = await db.collection('productions').doc(productionId).get()
    if (!prodSnap.exists) throw new HttpsError('not-found', 'Production not found.')
    const prod = prodSnap.data()!

    const uid     = request.auth.uid
    const claims  = request.auth.token as any
    const isStaff = claims.role === 'teacher' || claims.role === 'admin'
    const canEdit = isStaff
      || prod.createdBy === uid
      || (prod.collaborators ?? []).includes(uid)
    if (!canEdit) throw new HttpsError('permission-denied', 'You do not have edit access to this production.')

    const buffer = Buffer.from(fileBase64, 'base64')
    if (buffer.length === 0) throw new HttpsError('invalid-argument', 'Empty file.')
    if (buffer.length > MAX_BYTES) {
      throw new HttpsError('invalid-argument', `File is too large (max ${MAX_BYTES / (1024 * 1024)} MB).`)
    }

    const path = `productions/${productionId}/screenplay.pdf`
    await admin.storage().bucket().file(path).save(buffer, {
      contentType: 'application/pdf',
      resumable: false,
    })

    return { path }
  },
)
