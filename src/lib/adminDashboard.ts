// Pure rules behind the admin dashboard (tested without Firebase)
import type { InventoryProjectDoc, EquipmentBookingDoc } from '@/types'

// 'YYYY-MM-DD' in the viewer's local time — the format bookings and projects store
export function localDate(d: Date = new Date()): string {
  return d.toLocaleDateString('sv-SE')
}

export const isOut = (p: Pick<InventoryProjectDoc, 'status'>) => p.status === 'active' || p.status === 'checked-out'

export interface EquipmentOut {
  out: InventoryProjectDoc[]        // everything still out, overdue first, then by return date
  overdue: InventoryProjectDoc[]
  dueToday: InventoryProjectDoc[]
  awaitingSignatures: InventoryProjectDoc[]
}

export function equipmentOut(projects: InventoryProjectDoc[], today: string): EquipmentOut {
  const out = projects.filter(isOut).sort((a, b) => (a.returnDate || '9999').localeCompare(b.returnDate || '9999'))
  return {
    out,
    overdue: out.filter(p => p.returnDate && p.returnDate < today),
    dueToday: out.filter(p => p.returnDate === today),
    awaitingSignatures: out.filter(p => (p.pendingSignatureUids?.length ?? 0) > 0),
  }
}

// Confirmed bookings collected today that haven't been set up in inventory yet
export function pickupsToday(bookings: EquipmentBookingDoc[], today: string): EquipmentBookingDoc[] {
  return bookings.filter(b => b.status === 'confirmed' && b.checkoutDate === today)
}

// Whole days a return date is past `today` (0 when not overdue)
export function daysOverdue(returnDate: string, today: string): number {
  if (!returnDate || returnDate >= today) return 0
  return Math.round((Date.parse(today) - Date.parse(returnDate)) / 86_400_000)
}
