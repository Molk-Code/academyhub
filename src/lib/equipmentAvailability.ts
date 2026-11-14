import { httpsCallable } from 'firebase/functions'
import { functions } from '@/lib/firebase'

// Server-side availability per date (functions/src/availability.ts). Bookings
// and new check-outs go through these, so two people can't take the same unit.

export interface Shortfall { equipmentId: string; name: string; wanted: number; free: number }

export const equipmentAvailability = (from: string, to: string, equipmentIds?: string[]) =>
  httpsCallable<{ from: string; to: string; equipmentIds?: string[] }, { available: Record<string, number> }>(
    functions, 'equipmentAvailability',
  )({ from, to, ...(equipmentIds ? { equipmentIds } : {}) }).then(r => r.data.available)

export const createEquipmentBooking = (data: Record<string, unknown>) =>
  httpsCallable<Record<string, unknown>, { bookingId: string }>(functions, 'createEquipmentBooking')(data).then(r => r.data.bookingId)

export interface UnitOut { equipmentId: string; equipmentName: string; unit?: number | null; scannedViaSession?: unknown; notInBooking?: unknown }

export const checkOutEquipmentUnits = (projectId: string, units: UnitOut[], assignedTo: string) =>
  httpsCallable<unknown, { itemIds: string[] }>(functions, 'checkOutEquipmentUnits')({ projectId, units, assignedTo }).then(r => r.data.itemIds)

/** The server's own message (e.g. which items aren't free), or a fallback */
export function bookingErrorMessage(err: unknown, fallback: string): string {
  return (err as { message?: string } | null)?.message || fallback
}
