import type { EquipmentDoc } from '@/types'

// Maintenance: which catalog items need attention. "In service" = units away
// for service right now (excluded from booking and check-out by the server);
// "overdue" / "due soon" = the next service date has passed / is close.

export const DUE_SOON_DAYS = 30

export type ServiceState = 'in-service' | 'overdue' | 'due-soon'

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function serviceState(item: Pick<EquipmentDoc, 'maintenanceUnits' | 'nextServiceDate'>, today: string): ServiceState | null {
  if ((item.maintenanceUnits ?? 0) > 0) return 'in-service'
  if (!item.nextServiceDate) return null
  if (item.nextServiceDate <= today) return 'overdue'
  if (item.nextServiceDate <= addDays(today, DUE_SOON_DAYS)) return 'due-soon'
  return null
}

/** What the "needs service" list and the dashboard count show: in service or overdue */
export function needsService(items: (Pick<EquipmentDoc, 'maintenanceUnits' | 'nextServiceDate'> & { isActive?: boolean })[], today: string): number {
  return items.filter(i => i.isActive !== false && ['in-service', 'overdue'].includes(serviceState(i, today) ?? '')).length
}
