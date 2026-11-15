import { describe, it, expect, vi } from 'vitest'
import type { EquipmentBookingDoc, InventoryItemDoc, InventoryProjectDoc } from '@/types'
import {
  buildSummary, bookingSummaryInput, projectSummaryInput, summaryCsv, summaryConfig, hasLegalDetails, summaryRef,
  type SummaryInput,
} from './rentalSummary'

vi.mock('@/lib/firebase', () => ({ db: {}, functions: {} }))

const catalog = new Map([
  ['cam', { priceExclVat: 400, priceInclVat: 500, category: 'Camera' }],
  ['mic', { priceExclVat: 0, priceInclVat: 125, category: 'Sound' }],
])
const input = (from: string, to: string): SummaryInput => ({
  kind: 'booking', id: 'abcdefgh1234', title: 'Short film', customer: 'Kim', from, to,
  lines: [{ equipmentId: 'cam', name: 'FX6', quantity: 2 }, { equipmentId: 'mic', name: 'Mic', quantity: 1, kitName: 'Sound kit' }],
})

describe('rental summary', () => {
  it('without a VAT rate: catalog prices as listed, no VAT', () => {
    const s = buildSummary(input('2026-03-02', '2026-03-05'), catalog, { vatRate: null })
    expect(s.rentalDays).toBe(3)
    expect(s.lines.map(l => [l.dayPrice, l.net, l.vat])).toEqual([[500, 3000, null], [125, 375, null]])
    expect([s.discount, s.vat, s.total]).toEqual([0, null, 3375])
  })

  it('with a VAT rate: net price (or incl. price less VAT), VAT added', () => {
    const s = buildSummary(input('2026-03-02', '2026-03-05'), catalog, { vatRate: 25 })
    expect(s.lines.map(l => l.dayPrice)).toEqual([400, 100])
    expect([s.net, s.vat, s.total]).toEqual([2700, 675, 3375])
  })

  it('week discount and an extra discount', () => {
    const s = buildSummary(input('2026-03-02', '2026-03-09'), catalog, { vatRate: 25 }, 10)
    expect([s.rentalDays, s.chargedDays]).toEqual([7, 5])
    expect(s.amount).toBe(900 * 7)
    expect(s.net).toBe(900 * 5 * 0.9)
    expect(s.discount).toBe(900 * 7 - 900 * 5 * 0.9)
    expect(s.total).toBe(s.net * 1.25)
  })

  it('a booking leaves out denied parts and items marked not available', () => {
    const b = {
      id: 'b1', projectName: 'P', studentName: 'Kim', studentEmail: 'k@example.test', checkoutDate: '2026-03-02', returnDate: '2026-03-03',
      status: 'pending', categoryDecisions: { Sound: { status: 'denied', byUid: 's', byName: 'S' } },
      items: [{ equipmentId: 'cam', equipmentName: 'FX6', quantity: 1 }, { equipmentId: 'cam2', equipmentName: 'FX6 B', quantity: 1 }, { equipmentId: 'mic', equipmentName: 'Mic', quantity: 1 }],
      unavailableItems: { cam2: { byUid: 's', byName: 'S' } },
    } as unknown as EquipmentBookingDoc
    expect(bookingSummaryInput(b, catalog).lines.map(l => l.name)).toEqual(['FX6'])
    const setUp = { ...b, setUpCategories: { Camera: 'p1' } } as EquipmentBookingDoc
    expect(bookingSummaryInput(setUp, catalog).lines.map(l => l.name)).toEqual(['FX6'])
    expect(bookingSummaryInput(setUp, catalog, true).lines).toEqual([])
  })

  it('a project counts numbered units together', () => {
    const p = { id: 'p1', name: 'Shoot', borrowers: ['Kim', 'Sam'], checkoutDate: '2026-03-02', returnDate: '2026-03-04' } as InventoryProjectDoc
    const rows = [
      { equipmentId: 'cam', equipmentName: 'FX6 #1' }, { equipmentId: 'cam', equipmentName: 'FX6 #2' },
      { equipmentId: '', equipmentName: 'Gaffer tape' },
    ] as InventoryItemDoc[]
    const i = projectSummaryInput(p, rows)
    expect(i.customer).toBe('Kim, Sam')
    expect(i.lines).toEqual([{ equipmentId: 'cam', name: 'FX6', quantity: 2 }, { equipmentId: '', name: 'Gaffer tape', quantity: 1 }])
    expect(buildSummary(i, catalog, { vatRate: null }).total).toBe(2000)
  })

  it('CSV: one row per line, Swedish or international format', () => {
    const s = buildSummary({ ...input('2026-03-02', '2026-03-03'), title: 'Film; "cut"' }, catalog, { vatRate: 25 }, 12.5)
    const sv = summaryCsv([s], 'SEK', 'sv').replace('﻿', '').trim().split('\r\n')
    expect(sv).toHaveLength(3)
    expect(sv[0].split(';')[0]).toBe('Reference')
    expect(sv[1]).toContain('"Film; ""cut"""')
    expect(sv[1]).toContain(';700;25;175;875;SEK')
    expect(sv[2]).toContain(';Sound kit;1;1;1;100;100;12,5;87,5;25;21,88;109,38;SEK')
    const intl = summaryCsv([s], 'SEK', 'intl').trim().split('\r\n')
    expect(intl[1]).toContain('Film; ""cut""')
    expect(intl[1]).toContain(',700,25,175,875,SEK')
    expect(summaryRef(s.input)).toBe('B-ABCDEFGH')
  })

  it('the "not a tax invoice" mark goes only with every legal field and a VAT rate', () => {
    const seller = { legalName: 'Rent AB', orgNumber: '556000-0000', vatNumber: 'SE556000000001', address: 'Street 1' }
    expect(hasLegalDetails(summaryConfig('SEK', { seller }))).toBe(false)
    expect(hasLegalDetails(summaryConfig('SEK', { seller, vatRate: 25 }))).toBe(true)
    expect(hasLegalDetails(summaryConfig('SEK', { seller: { ...seller, vatNumber: ' ' }, vatRate: 25 }))).toBe(false)
    expect(summaryConfig('SEK', { vatRate: 140 }).vatRate).toBeNull()
  })
})
