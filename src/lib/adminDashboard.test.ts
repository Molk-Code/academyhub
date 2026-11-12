import { describe, expect, it } from 'vitest'
import type { InventoryProjectDoc, EquipmentBookingDoc } from '@/types'
import { equipmentOut, pickupsToday, daysOverdue, localDate } from './adminDashboard'

const p = (id: string, status: string, returnDate: string, extra: Partial<InventoryProjectDoc> = {}) =>
  ({ id, name: id, status, returnDate, checkoutDate: '2026-11-01', borrowers: [], ...extra }) as InventoryProjectDoc

describe('equipmentOut', () => {
  const today = '2026-11-12'
  const r = equipmentOut([
    p('late', 'checked-out', '2026-11-10'),
    p('today', 'active', '2026-11-12', { pendingSignatureUids: ['u1'] }),
    p('later', 'checked-out', '2026-11-20'),
    p('back', 'returned', '2026-11-01'),
    p('old', 'archived', '2026-10-01'),
  ], today)
  it('only projects still out, overdue first', () => {
    expect(r.out.map(x => x.id)).toEqual(['late', 'today', 'later'])
  })
  it('overdue, due today and awaiting signatures', () => {
    expect(r.overdue.map(x => x.id)).toEqual(['late'])
    expect(r.dueToday.map(x => x.id)).toEqual(['today'])
    expect(r.awaitingSignatures.map(x => x.id)).toEqual(['today'])
  })
})

describe('pickupsToday', () => {
  it('confirmed bookings collected today', () => {
    const b = (id: string, status: string, checkoutDate: string) => ({ id, status, checkoutDate }) as EquipmentBookingDoc
    expect(pickupsToday([b('a', 'confirmed', '2026-11-12'), b('b', 'pending', '2026-11-12'), b('c', 'confirmed', '2026-11-13')], '2026-11-12')
      .map(x => x.id)).toEqual(['a'])
  })
})

describe('daysOverdue / localDate', () => {
  it('counts whole days', () => {
    expect(daysOverdue('2026-11-10', '2026-11-12')).toBe(2)
    expect(daysOverdue('2026-11-12', '2026-11-12')).toBe(0)
    expect(daysOverdue('', '2026-11-12')).toBe(0)
  })
  it('formats as YYYY-MM-DD', () => {
    expect(localDate(new Date(2026, 10, 2))).toBe('2026-11-02')
  })
})
