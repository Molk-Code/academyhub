import type { EquipmentDoc, ServiceUnit } from '@/types'

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

/** The day `months` months after `day` (clamped to the month's last day: 31 Jan + 1 month = 28/29 Feb) */
export function addMonths(day: string, months: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1 + months, 1))
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  first.setUTCDate(Math.min(d, last))
  return first.toISOString().slice(0, 10)
}

/** The next service date to suggest after a service on `day` (empty: no interval set) */
export const suggestedNextService = (item: Pick<EquipmentDoc, 'serviceIntervalMonths'>, day: string) =>
  item.serviceIntervalMonths ? addMonths(day, item.serviceIntervalMonths) : ''

/** Units in service after sending `unit` away, or bringing it (or every unit: null) back */
export function sendToService(units: ServiceUnit[], unit: number, note: string, since: string): ServiceUnit[] {
  return [...units.filter(u => u.unit !== unit), { unit, since, ...(note.trim() ? { note: note.trim().slice(0, 300) } : {}) }]
    .sort((a, b) => a.unit - b.unit)
}
export const backFromService = (units: ServiceUnit[], unit: number | null) => unit == null ? [] : units.filter(u => u.unit !== unit)

/** The equipment fields for a list of units in service (the count is what booking and check-out read) */
export const serviceFields = (units: ServiceUnit[]) => ({ serviceUnits: units, maintenanceUnits: units.length })
