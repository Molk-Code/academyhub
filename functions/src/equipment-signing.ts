import { createHash } from 'crypto'
import { admin, db, functions, requireTeacherOrAdmin } from './lib'
import { sendPush, saveNotifications } from './notifications-core'

// ─────────────────────────────────────────────────────────────────────────────
// Electronic signing of equipment loan contracts
//
// Staff send a signing request to a project's borrowers; each borrower signs
// in My Bookings by ticking "I accept" and typing their name. Everything that
// makes the signature hold up as evidence is captured HERE, server-side, not
// trusted from the browser: the exact contract content (terms + project +
// item list) as a snapshot, its SHA-256 fingerprint, the signed-in account,
// server time, IP and user agent. Signatures live in
// inventory_projects/{id}/signatures — written only by these functions, never
// updated, so every signing (and re-signing) stays on record.
// ─────────────────────────────────────────────────────────────────────────────

// Keep in sync with LEGAL_TEXT in src/lib/equipmentContract.ts — the stored
// snapshot is what was actually agreed to, so older signatures keep their text.
const LEGAL_TEXT =
  "The following items are loaned to the above-mentioned borrower. The borrowers are aware that by signing this " +
  "agreement, they are responsible for handling, storing, and transporting the equipment in such a way that no " +
  "damage or abnormal wear and tear occurs. If any damage occurs, it must be reported immediately to the school's " +
  "representatives for loaned equipment. If the equipment is stolen or lost, it will be reported to the police " +
  "immediately, followed by investigations from the police, the school, and the insurance company. The borrower " +
  "may be required to cover all or part of the costs to compensate the school, which should be kept free of costs " +
  "in the event of an incident. Molkom Folk High School applies full-value compensation if an item needs to be " +
  "replaced, i.e., if damage occurs or the item is lost, the borrower will be charged the same cost as it would " +
  "take to replace it with a new purchase."

interface ContractSnapshot {
  legalText: string
  projectName: string
  dateFrom: string
  dateTo: string
  items: { id: string; name: string }[]
}

async function buildSnapshot(projectId: string) {
  const projRef = db.collection('inventory_projects').doc(projectId)
  const [projSnap, itemsSnap] = await Promise.all([projRef.get(), projRef.collection('items').get()])
  if (!projSnap.exists) throw new functions.https.HttpsError('not-found', 'Project not found.')
  const p = projSnap.data()!
  const snapshot: ContractSnapshot = {
    legalText:   LEGAL_TEXT,
    projectName: (p.name as string) ?? '',
    dateFrom:    (p.checkoutDate as string) ?? '',
    dateTo:      (p.returnDate as string) ?? '',
    // Every item regardless of status (returning an item doesn't change what
    // was agreed); sorted so the fingerprint is stable.
    items: itemsSnap.docs
      .map(d => ({ id: d.id, name: (d.data().equipmentName as string) ?? '' }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  }
  const hash = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
  return { project: p, projRef, snapshot, hash }
}

// Latest contract hash each borrower has signed.
async function signedHashes(projRef: FirebaseFirestore.DocumentReference) {
  const sigs = await projRef.collection('signatures').orderBy('signedAt', 'asc').get()
  const latest = new Map<string, string>()
  for (const d of sigs.docs) latest.set(d.data().uid as string, d.data().contractHash as string)
  return latest
}

export const requestEquipmentSignatures = functions.https.onCall(async (data, context) => {
  requireTeacherOrAdmin(context)
  const { projectId } = data as { projectId?: string }
  if (!projectId || typeof projectId !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'projectId is required.')
  }

  const { project, projRef, hash } = await buildSnapshot(projectId)
  const borrowerIds = ((project.borrowerIds as string[]) ?? []).filter(Boolean)
  if (borrowerIds.length === 0) {
    throw new functions.https.HttpsError('failed-precondition', 'This project has no borrowers with a CineForge account.')
  }

  // Only ask those who haven't signed the contract as it stands now
  const signed = await signedHashes(projRef)
  const toAsk = borrowerIds.filter(uid => signed.get(uid) !== hash)

  const requester = await db.collection('users').doc(context.auth!.uid).get()
  await projRef.update({
    signatureRequest: {
      requestedAt:     admin.firestore.FieldValue.serverTimestamp(),
      requestedBy:     context.auth!.uid,
      requestedByName: (requester.data()?.displayName as string) ?? '',
    },
  })

  if (toAsk.length > 0) {
    const users = await Promise.all(toAsk.map(uid => db.collection('users').doc(uid).get()))
    const tokens = users.flatMap(u => (u.data()?.fcmTokens as string[]) ?? [])
    const msg = {
      title: 'Sign equipment contract',
      body:  `${project.name ?? 'Your equipment loan'} — please review and sign in My Bookings.`,
      url:   '/my-bookings',
    }
    await Promise.all([
      sendPush([...new Set(tokens)], { ...msg, tag: `sign-${projectId}` }),
      saveNotifications(toAsk, msg),
    ])
  }

  return { notified: toAsk.length, alreadySigned: borrowerIds.length - toAsk.length }
})

export const signEquipmentContract = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.')
  const { projectId, typedName, accepted } = data as { projectId?: string; typedName?: string; accepted?: boolean }
  if (!projectId || typeof projectId !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'projectId is required.')
  }
  const name = typeof typedName === 'string' ? typedName.trim().replace(/\s+/g, ' ') : ''
  if (accepted !== true) {
    throw new functions.https.HttpsError('invalid-argument', 'You must accept the terms to sign.')
  }
  if (name.length < 2 || name.length > 100) {
    throw new functions.https.HttpsError('invalid-argument', 'Type your full name to sign.')
  }

  const uid = context.auth.uid
  const { project, projRef, snapshot, hash } = await buildSnapshot(projectId)
  if (!((project.borrowerIds as string[]) ?? []).includes(uid)) {
    throw new functions.https.HttpsError('permission-denied', 'You are not a borrower on this project.')
  }

  const user = (await db.collection('users').doc(uid).get()).data() ?? {}
  const req = context.rawRequest
  const forwarded = String(req?.headers?.['x-forwarded-for'] ?? '').split(',')[0].trim()

  const ref = await projRef.collection('signatures').add({
    uid,
    typedName:    name,
    accountName:  (user.displayName as string) ?? '',
    email:        (context.auth.token.email as string) ?? (user.email as string) ?? '',
    signedAt:     admin.firestore.FieldValue.serverTimestamp(),
    contractHash: hash,
    snapshot,
    ip:           forwarded || req?.ip || '',
    userAgent:    String(req?.headers?.['user-agent'] ?? '').slice(0, 300),
    method:       'cineforge-typed-name',
  })

  return { signatureId: ref.id, contractHash: hash }
})
