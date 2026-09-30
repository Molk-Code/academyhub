import type {
  ProductionCrewAssignmentDoc, CrewRoleDoc, EquipmentBookingDoc, EquipmentDoc,
} from '@/types'

// Shared budget math — kept in one place so the equipment booking page, the
// per-production Budget tab, and the production-period budget overview never
// drift apart on what "over budget" means.

export function calcRentalDays(from: string, to: string): number {
  if (!from || !to) return 1
  const a = new Date(from + 'T00:00:00')
  const b = new Date(to + 'T00:00:00')
  const diff = Math.round((b.getTime() - a.getTime()) / 86400000)
  return diff > 0 ? diff : 1
}

// Week discount: 5+ days → only charge 5 days per 7-day block (weekends free)
export function billableDays(days: number): number {
  if (days < 5) return days
  return Math.ceil(days / 7) * 5
}

export function salaryCost(
  crewAssignments: ProductionCrewAssignmentDoc[],
  crewRoles: CrewRoleDoc[],
  shootingDayCount: number,
): number {
  return crewAssignments
    .filter(a => a.assignedName?.trim())
    .reduce((sum, a) => {
      const role = crewRoles.find(r => r.id === a.roleId)
      const rate = (a as any).dayRateOverride ?? role?.dayRate ?? 0
      return sum + rate * shootingDayCount
    }, 0)
}

// Bookings that no longer hold a claim on the budget
const INACTIVE_BOOKING_STATUSES = new Set(['denied', 'cancelled'])

export function bookingEquipmentCost(
  booking: EquipmentBookingDoc,
  equipmentById: Record<string, EquipmentDoc>,
): number {
  if (INACTIVE_BOOKING_STATUSES.has(booking.status)) return 0
  const days = billableDays(calcRentalDays(booking.checkoutDate, booking.returnDate))
  return (booking.items ?? []).reduce((sum, item) => {
    const eq = equipmentById[item.equipmentId]
    return sum + (eq?.priceInclVat ?? 0) * item.quantity * days
  }, 0)
}

export function equipmentCostForProduction(
  productionId: string,
  bookings: EquipmentBookingDoc[],
  equipmentById: Record<string, EquipmentDoc>,
): number {
  return bookings
    .filter(b => b.productionId === productionId)
    .reduce((sum, b) => sum + bookingEquipmentCost(b, equipmentById), 0)
}
