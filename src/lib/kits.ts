import type { EquipmentBookingItem, EquipmentDoc, KitDoc } from '@/types'

// Kits: a named set of catalog items. A kit is booked or checked out as one
// line and expands to its items; each item keeps its own status. A kit is
// only as available as its scarcest member.

/** QR value on a kit's label */
export const KIT_CODE_PREFIX = 'kit:'
export const kitCode = (kitId: string) => `${KIT_CODE_PREFIX}${kitId}`
export function kitIdFromCode(text: string): string | null {
  const t = text.trim()
  return t.toLowerCase().startsWith(KIT_CODE_PREFIX) ? t.slice(KIT_CODE_PREFIX.length).trim() || null : null
}

/** Units of each item in one kit */
export function kitCounts(kit: Pick<KitDoc, 'itemIds'>): Map<string, number> {
  const m = new Map<string, number>()
  for (const id of kit.itemIds ?? []) m.set(id, (m.get(id) ?? 0) + 1)
  return m
}

/** How many whole kits are free, given free units per item (missing item → 0) */
export function kitsFree(kit: Pick<KitDoc, 'itemIds'>, freeOf: (equipmentId: string) => number | undefined): number {
  const counts = kitCounts(kit)
  if (!counts.size) return 0
  let n = Infinity
  for (const [id, per] of counts) n = Math.min(n, Math.floor(Math.max(0, freeOf(id) ?? 0) / per))
  return Number.isFinite(n) ? n : 0
}

/** Booking lines for `quantity` kits, one per item, tagged with the kit */
export function expandKit(kit: KitDoc, quantity: number, catalog: Map<string, Pick<EquipmentDoc, 'name'>>): EquipmentBookingItem[] {
  return [...kitCounts(kit)].map(([equipmentId, per]) => ({
    equipmentId,
    equipmentName: catalog.get(equipmentId)?.name ?? equipmentId,
    quantity: per * quantity,
    kitId: kit.id,
    kitName: kit.name,
  }))
}

/** One line per item: quantities of the same item added up (the first line's kit tag is kept) */
export function mergeLines(lines: EquipmentBookingItem[]): EquipmentBookingItem[] {
  const out = new Map<string, EquipmentBookingItem>()
  for (const l of lines) {
    const cur = out.get(l.equipmentId)
    if (cur) cur.quantity += l.quantity
    else out.set(l.equipmentId, { ...l })
  }
  return [...out.values()]
}

/** Units wanted per item across lines */
export function wantedPerItem(lines: Pick<EquipmentBookingItem, 'equipmentId' | 'quantity'>[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const l of lines) m.set(l.equipmentId, (m.get(l.equipmentId) ?? 0) + l.quantity)
  return m
}
