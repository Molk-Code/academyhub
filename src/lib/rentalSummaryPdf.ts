import { format } from 'date-fns'
import type { CurrencyCode } from '@/contexts/SchoolContext'
import { hasLegalDetails, summaryRef, type RentalSummary, type SummaryConfig } from './rentalSummary'

// One rental summary as a PDF (jsPDF, like the other PDF exports). Marked
// "Not a tax invoice" until the seller's legal details and a VAT rate are set.

const LOCALE: Record<CurrencyCode, string> = { SEK: 'sv-SE', EUR: 'en-IE', USD: 'en-US' }

export function money(n: number, currency: CurrencyCode): string {
  // The PDF's built-in font has no narrow no-break space or minus sign
  return new Intl.NumberFormat(LOCALE[currency], { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .format(n).replace(/[  ]/g, ' ').replace(/−/g, '-')
}

export async function rentalSummaryPdf(s: RentalSummary, cfg: SummaryConfig, issuer: string): Promise<Blob> {
  const { default: jsPDF } = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')
  const doc = new jsPDF()
  const m = (n: number) => money(n, cfg.currency)
  const seller = cfg.seller
  const legal = hasLegalDetails(cfg)
  const right = 196
  let y = 18

  doc.setFont('helvetica', 'bold'); doc.setFontSize(16)
  doc.text('Rental summary', 14, y)
  doc.setFontSize(11)
  doc.text(seller.legalName?.trim() || issuer, right, y, { align: 'right' })
  if (!legal) {
    y += 7
    doc.setTextColor(200, 30, 30); doc.setFontSize(10)
    doc.text('Not a tax invoice', 14, y)
    doc.setTextColor(0, 0, 0)
  }

  y += 9
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5)
  const meta: [string, string][] = [
    ['Reference', summaryRef(s.input)],
    ['Issued', format(new Date(), 'yyyy-MM-dd')],
    [s.input.kind === 'booking' ? 'Booking' : 'Project', s.input.title || '-'],
    ['Customer', [s.input.customer, s.input.customerEmail].filter(Boolean).join(', ') || '-'],
    ['Period', `${s.input.from} to ${s.input.to}`],
    ['Rental days', s.chargedDays === s.rentalDays ? String(s.rentalDays) : `${s.rentalDays} (charged ${s.chargedDays}, week discount)`],
  ]
  for (const [k, v] of meta) {
    doc.setTextColor(110, 110, 110); doc.text(k, 14, y)
    doc.setTextColor(0, 0, 0); doc.text(doc.splitTextToSize(v, 140), 50, y)
    y += 5.5
  }

  const priceHead = cfg.vatRate == null ? 'Day price' : 'Day price excl. VAT'
  autoTable(doc, {
    startY: y + 3,
    head: [['Item', 'Qty', 'Days', priceHead, 'Discount', 'Amount']],
    body: s.lines.map(l => [
      l.kitName ? `${l.name}\n(kit: ${l.kitName})` : l.name,
      String(l.quantity), String(s.rentalDays), m(l.dayPrice), l.discount ? `-${m(l.discount)}` : '', m(l.net),
    ]),
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [40, 40, 48] },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
  })
  y = (doc as any).lastAutoTable.finalY + 8

  const totals: [string, string, boolean?][] = [['Amount', m(s.amount)]]
  if (s.discount) {
    const parts = [s.chargedDays < s.rentalDays && 'week discount', s.extraDiscountPct && `${s.extraDiscountPct}% discount`].filter(Boolean)
    totals.push([`Discount (${parts.join(', ')})`, `-${m(s.discount)}`])
  }
  if (s.vat == null) {
    totals.push(['Total', m(s.total), true])
  } else {
    totals.push(['Total excl. VAT', m(s.net)], [`VAT ${s.vatRate}%`, m(s.vat)], ['Total incl. VAT', m(s.total), true])
  }
  doc.setFontSize(10)
  for (const [k, v, bold] of totals) {
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.text(k, 140, y, { align: 'right' }); doc.text(v, right, y, { align: 'right' })
    y += 6
  }

  y += 6
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(90, 90, 90)
  const notes: string[] = []
  if (cfg.vatRate == null) notes.push('Prices are the catalog prices as listed. No VAT rate is set, so VAT is not shown separately.')
  if (s.chargedDays < s.rentalDays) notes.push('Week discount: from 5 rental days, 5 days are charged per started week.')
  if (seller.paymentTerms?.trim()) notes.push(seller.paymentTerms.trim())
  const sellerLine = [seller.legalName, seller.orgNumber && `Org. no. ${seller.orgNumber}`, seller.vatNumber && `VAT no. ${seller.vatNumber}`, seller.address, seller.email]
    .map(v => v?.trim()).filter(Boolean).join(' · ')
  if (sellerLine) notes.push(sellerLine)
  if (!legal) notes.push('This summary lists rented items and prices. It is not a tax invoice.')
  for (const n of notes) {
    const lines = doc.splitTextToSize(n, right - 14)
    doc.text(lines, 14, y)
    y += lines.length * 4.2 + 1.5
  }
  return doc.output('blob')
}
