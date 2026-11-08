import { functions, LIMITS, admin, db } from './lib'

// ─────────────────────────────────────────────────────────────────────────────
// onProductionDeleted — remove everything that belonged to a production.
//
// The app deletes only the production document; Firestore keeps its
// subcollections (scenes, shots, cast, props, shooting days, …) and Storage
// keeps the screenplay, so deleted productions left student data behind.
// ─────────────────────────────────────────────────────────────────────────────

export const onProductionDeleted = functions.runWith(LIMITS).firestore
  .document('productions/{id}')
  .onDelete(async (snap, context) => {
    await db.recursiveDelete(snap.ref)
    await admin.storage().bucket()
      .deleteFiles({ prefix: `productions/${context.params.id}/` })
      .catch(err => console.error('onProductionDeleted: storage cleanup failed', err))
  })
