import { admin, functions, db } from './lib'

// ─────────────────────────────────────────────────────────────────────────────
// onCohortCreated — give every new class its own private chat channel
// ─────────────────────────────────────────────────────────────────────────────

export function classChannelName(cohortName: string): string {
  return cohortName.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
}

export const onCohortCreated = functions.firestore
  .document('cohorts/{cohortId}')
  .onCreate(async (snap, context) => {
    const cohortId = context.params.cohortId as string
    const name = (snap.data().name as string | undefined) ?? 'class'
    // Deterministic id makes retries idempotent; create() fails if it already exists.
    await db.collection('chat_channels').doc(`class_${cohortId}`).create({
      name:             classChannelName(name),
      description:      `Channel for ${name}`,
      order:            50,
      isPublic:         false,
      allowedRoles:     [],
      allowedCohortIds: [cohortId],
      allowedTeamIds:   [],
      memberIds:        [],
      createdAt:        admin.firestore.FieldValue.serverTimestamp(),
      createdBy:        'system',
    }).catch((e: { code?: number }) => { if (e.code !== 6 /* ALREADY_EXISTS */) throw e })
    return null
  })
