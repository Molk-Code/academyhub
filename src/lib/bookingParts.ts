import { httpsCallable } from 'firebase/functions'
import { functions } from '@/lib/firebase'
import type { EquipmentBookingDoc, EquipmentBookingItem, EquipmentResponsibility } from '@/types'

// An equipment booking is split into parts by catalog category, so each part
// can be accepted or denied by the staff member responsible for that category
// (settings/equipment.responsibility). Bookings decided before parts existed
// have no categoryDecisions — their overall status applies to every part.

export const OTHER_CATEGORY = 'Other'

export type PartStatus = 'pending' | 'confirmed' | 'denied' | 'set-up'

export interface BookingPart { category: string; items: EquipmentBookingItem[] }

type CategoryLookup = Map<string, { category?: string }>

export function itemCategory(item: EquipmentBookingItem, catalog?: CategoryLookup): string {
  return item.category || catalog?.get(item.equipmentId)?.category || OTHER_CATEGORY
}

// Parts in the order their first item appears in the booking
export function bookingParts(b: EquipmentBookingDoc, catalog?: CategoryLookup): BookingPart[] {
  const parts = new Map<string, EquipmentBookingItem[]>()
  for (const it of b.items ?? []) {
    const c = itemCategory(it, catalog)
    if (!parts.has(c)) parts.set(c, [])
    parts.get(c)!.push(it)
  }
  return [...parts].map(([category, items]) => ({ category, items }))
}

export function handlesCategory(r: EquipmentResponsibility | undefined, category: string): boolean {
  if (r === undefined || r === 'all') return true
  if (r === 'none') return false
  return r.includes(category)
}

export function partStatus(b: EquipmentBookingDoc, category: string): PartStatus {
  if (b.setUpCategories?.[category]) return 'set-up'
  const d = b.categoryDecisions?.[category]
  if (d) return d.status
  if (!b.categoryDecisions) {
    if (b.status === 'confirmed') return 'confirmed'
    if (b.status === 'denied') return 'denied'
    if (b.status === 'checked-out' || b.status === 'returned') return 'set-up'
  }
  return 'pending'
}

const OPEN = new Set(['pending', 'confirmed', 'denied'])

// Categories of this booking the user may still decide on / set up
export function myParts(b: EquipmentBookingDoc, r: EquipmentResponsibility | undefined, catalog?: CategoryLookup) {
  const mine = bookingParts(b, catalog).filter(p => handlesCategory(r, p.category))
  const open = OPEN.has(b.status) || (b.status === 'checked-out' && mine.some(p => partStatus(b, p.category) === 'confirmed'))
  return {
    all:     mine,
    pending: open ? mine.filter(p => partStatus(b, p.category) === 'pending') : [],
    toSetUp: open ? mine.filter(p => partStatus(b, p.category) === 'confirmed') : [],
  }
}

// Does the booking split across categories so parts are worth showing?
export function hasSeveralParts(b: EquipmentBookingDoc, catalog?: CategoryLookup): boolean {
  return bookingParts(b, catalog).length > 1
}

export const decideEquipmentBookingParts = (bookingId: string, categories: string[], decision: 'confirmed' | 'denied' | 'pending', note?: string) =>
  httpsCallable<{ bookingId: string; categories: string[]; decision: string; note?: string }, { status: string }>(
    functions, 'decideEquipmentBookingParts',
  )({ bookingId, categories, decision, note })
