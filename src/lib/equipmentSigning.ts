import { httpsCallable } from 'firebase/functions'
import { functions } from '@/lib/firebase'
import type { EquipmentSignatureDoc, InventoryItemDoc, InventoryProjectDoc } from '@/types'
import { printEquipmentContract } from '@/lib/equipmentContract'

export type SignatureState = 'signed' | 'changed' | 'requested' | 'not-requested'

export const requestEquipmentSignatures = (projectId: string) =>
  httpsCallable<{ projectId: string }, { notified: number; alreadySigned: number }>(functions, 'requestEquipmentSignatures')({ projectId })

export const signEquipmentContract = (projectId: string, typedName: string) =>
  httpsCallable<{ projectId: string; typedName: string; accepted: boolean }, { signatureId: string }>(functions, 'signEquipmentContract')({ projectId, typedName, accepted: true })

// Latest signature per borrower (signatures are append-only; re-signing adds one)
export function latestByUid(sigs: EquipmentSignatureDoc[]): Map<string, EquipmentSignatureDoc> {
  const m = new Map<string, EquipmentSignatureDoc>()
  for (const s of [...sigs].sort((a, b) => (a.signedAt?.toMillis() ?? 0) - (b.signedAt?.toMillis() ?? 0))) m.set(s.uid, s)
  return m
}

// Does the signed snapshot still match the project as it is now? Mirrors the
// fields the server fingerprints (terms aside — new terms don't void old signatures).
export function stillMatches(sig: EquipmentSignatureDoc, project: InventoryProjectDoc, items: InventoryItemDoc[]): boolean {
  const s = sig.snapshot
  if (s.projectName !== project.name || s.dateFrom !== project.checkoutDate || s.dateTo !== project.returnDate) return false
  const now = items.map(i => `${i.id}\u0000${i.equipmentName}`).sort()
  const then = s.items.map(i => `${i.id}\u0000${i.name}`).sort()
  return now.length === then.length && now.every((v, i) => v === then[i])
}

export function signatureState(
  project: InventoryProjectDoc,
  items: InventoryItemDoc[],
  sig: EquipmentSignatureDoc | undefined,
): SignatureState {
  if (sig) return stillMatches(sig, project, items) ? 'signed' : 'changed'
  return project.signatureRequest ? 'requested' : 'not-requested'
}

function fmt(d: string) {
  if (!d) return ''
  const dt = new Date(d + 'T00:00:00')
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

// Print the contract exactly as it was signed, with the e-signature filled in
export function printSignedContract(sig: EquipmentSignatureDoc) {
  printEquipmentContract({
    projectName: sig.snapshot.projectName,
    borrowerName: sig.typedName,
    dateFrom: fmt(sig.snapshot.dateFrom),
    dateTo: fmt(sig.snapshot.dateTo),
    items: sig.snapshot.items.map(i => ({ product: i.name })),
    legalText: sig.snapshot.legalText,
    signature: {
      typedName: sig.typedName,
      accountName: sig.accountName,
      email: sig.email,
      signedAt: sig.signedAt?.toDate().toLocaleString('sv-SE') ?? '',
      ip: sig.ip,
      contractHash: sig.contractHash,
    },
  })
}
