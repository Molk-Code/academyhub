import type { EquipmentBookingDoc, EquipmentDoc, InventoryItemDoc, InventoryProjectDoc } from '@/types'
import type { CurrencyCode } from '@/contexts/SchoolContext'
import { calcRentalDays, billableDays } from './productionBudget'
import { itemCategory, partStatus, isItemUnavailable } from './bookingParts'
import { toCsv, downloadFile, fileSlug, type CsvFormat } from './csv'

// Rental summary for one booking or project: items, days, day price, discount
// and total, as a PDF (rentalSummaryPdf.ts) or CSV rows for accounting
// software. Not a payment flow and not a tax invoice: the document says so
// until the seller's legal details are filled in (settings/rental_summary).
//
// Prices: with a VAT rate set, amounts are excl. VAT (the item's price excl.
// VAT, or its price incl. VAT less that rate) and VAT is added on the total.
// Without one, amounts are the catalog prices as borrowers see them and no VAT
// line is shown: no tax rule is assumed.

export interface SellerDetails {
  legalName?: string
  orgNumber?: string
  vatNumber?: string
  address?: string
  email?: string
  paymentTerms?: string
}

/** settings/rental_summary */
export interface RentalSummarySettings {
  vatRate?: number | null      // percent, e.g. 25; absent = not set
  seller?: SellerDetails
}

export interface SummaryConfig {
  currency: CurrencyCode
  vatRate: number | null
  seller: SellerDetails
}

export const LEGAL_FIELDS: (keyof SellerDetails)[] = ['legalName', 'orgNumber', 'vatNumber', 'address']

/** Every legal field filled in and a VAT rate set: the "not a tax invoice" mark goes */
export function hasLegalDetails(cfg: SummaryConfig): boolean {
  return cfg.vatRate != null && LEGAL_FIELDS.every(f => !!cfg.seller[f]?.trim())
}

export function summaryConfig(currency: CurrencyCode, s: RentalSummarySettings | null | undefined): SummaryConfig {
  const r = s?.vatRate
  return {
    currency,
    vatRate: typeof r === 'number' && r >= 0 && r <= 100 ? r : null,
    seller: s?.seller ?? {},
  }
}

export interface SummaryLineInput {
  equipmentId: string
  name: string
  quantity: number
  kitName?: string
}

export interface SummaryInput {
  kind: 'booking' | 'project'
  id: string
  title: string
  customer: string
  customerEmail?: string
  from: string
  to: string
  lines: SummaryLineInput[]
}

export interface SummaryLine extends SummaryLineInput {
  dayPrice: number      // excl. VAT with a rate set, else as listed
  amount: number        // dayPrice × quantity × rental days
  discount: number      // week discount + the extra discount
  net: number           // amount − discount
  vat: number | null
  total: number
}

export interface RentalSummary {
  input: SummaryInput
  rentalDays: number
  chargedDays: number
  extraDiscountPct: number
  vatRate: number | null
  lines: SummaryLine[]
  amount: number
  discount: number
  net: number
  vat: number | null
  total: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function buildSummary(
  input: SummaryInput,
  catalog: Map<string, Pick<EquipmentDoc, 'priceExclVat' | 'priceInclVat'>>,
  cfg: Pick<SummaryConfig, 'vatRate'>,
  extraDiscountPct = 0,
): RentalSummary {
  const rentalDays = calcRentalDays(input.from, input.to)
  const chargedDays = billableDays(rentalDays)
  const extra = Math.min(Math.max(extraDiscountPct || 0, 0), 100) / 100
  const r = cfg.vatRate == null ? null : cfg.vatRate / 100
  const lines = input.lines.map((l): SummaryLine => {
    const eq = catalog.get(l.equipmentId)
    const excl = eq?.priceExclVat ?? 0, incl = eq?.priceInclVat ?? 0
    const dayPrice = round2(r == null ? incl : excl > 0 ? excl : incl / (1 + r))
    const amount = round2(dayPrice * l.quantity * rentalDays)
    const afterWeek = dayPrice * l.quantity * chargedDays
    const net = round2(afterWeek * (1 - extra))
    const vat = r == null ? null : round2(net * r)
    return { ...l, dayPrice, amount, discount: round2(amount - net), net, vat, total: round2(net + (vat ?? 0)) }
  })
  const sum = (f: (l: SummaryLine) => number) => round2(lines.reduce((s, l) => s + f(l), 0))
  return {
    input, rentalDays, chargedDays, extraDiscountPct: extra * 100, vatRate: cfg.vatRate,
    lines,
    amount: sum(l => l.amount),
    discount: sum(l => l.discount),
    net: sum(l => l.net),
    vat: r == null ? null : sum(l => l.vat ?? 0),
    total: sum(l => l.total),
  }
}

// ── From bookings and projects ───────────────────────────────────────────────

/**
 * What a booking rents: denied parts and items marked not available are left
 * out. `skipSetUp` also leaves out parts set up in an inventory project (the
 * period export counts those under the project).
 */
export function bookingSummaryInput(
  b: EquipmentBookingDoc,
  catalog: Map<string, { category?: string }>,
  skipSetUp = false,
): SummaryInput {
  const lines = (b.items ?? [])
    .filter(it => !isItemUnavailable(b, it))
    .filter(it => {
      const s = partStatus(b, itemCategory(it, catalog))
      return s !== 'denied' && !(skipSetUp && s === 'set-up')
    })
    .map(it => ({ equipmentId: it.equipmentId, name: it.equipmentName, quantity: it.quantity, kitName: it.kitName }))
  return {
    kind: 'booking', id: b.id, title: b.projectName,
    customer: b.guestName || b.studentName, customerEmail: b.guestEmail || b.studentEmail,
    from: b.checkoutDate, to: b.returnDate, lines,
  }
}

/** Every row of a project, numbered units of an item counted together */
export function projectSummaryInput(p: InventoryProjectDoc, rows: InventoryItemDoc[]): SummaryInput {
  const byItem = new Map<string, SummaryLineInput>()
  for (const row of rows) {
    const key = row.equipmentId || `manual:${row.equipmentName}`
    const line = byItem.get(key)
    if (line) line.quantity++
    else byItem.set(key, { equipmentId: row.equipmentId ?? '', name: row.equipmentName.replace(/\s+#\d+$/, ''), quantity: 1 })
  }
  return {
    kind: 'project', id: p.id, title: p.name,
    customer: (p.borrowers ?? []).join(', '),
    from: p.checkoutDate, to: p.returnDate,
    lines: [...byItem.values()].sort((a, b) => a.name.localeCompare(b.name, 'sv', { numeric: true })),
  }
}

/** Short reference printed on the document and in the CSV */
export const summaryRef = (i: Pick<SummaryInput, 'kind' | 'id'>) =>
  `${i.kind === 'booking' ? 'B' : 'P'}-${i.id.slice(0, 8).toUpperCase()}`

// ── CSV ───────────────────────────────────────────────────────────────────────

export type { CsvFormat }
export { downloadFile }

export const CSV_COLUMNS = [
  'Reference', 'Type', 'Title', 'Customer', 'Customer email', 'From', 'To', 'Item', 'Article', 'Kit',
  'Quantity', 'Rental days', 'Charged days', 'Day price', 'Amount', 'Discount', 'Net', 'VAT rate', 'VAT', 'Total', 'Currency',
]

export function summaryCsv(summaries: RentalSummary[], currency: CurrencyCode, format: CsvFormat): string {
  const rows = summaries.flatMap(s => s.lines.map(l => [
    summaryRef(s.input), s.input.kind, s.input.title, s.input.customer, s.input.customerEmail,
    s.input.from, s.input.to, l.name, l.equipmentId, l.kitName,
    l.quantity, s.rentalDays, s.chargedDays, l.dayPrice, l.amount, l.discount, l.net,
    s.vatRate, l.vat, l.total, currency,
  ]))
  return toCsv([CSV_COLUMNS, ...rows], format)
}

export const summaryFileName = (s: RentalSummary, ext: string) =>
  `rental-summary-${summaryRef(s.input)}-${fileSlug(s.input.title)}.${ext}`
