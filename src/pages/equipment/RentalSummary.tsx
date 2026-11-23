import { useMemo, useState } from 'react'
import { FileText, Download, Loader2, X } from 'lucide-react'
import { useSchool } from '@/contexts/SchoolContext'
import { useDocument } from '@/hooks/useFirestore'
import type { EquipmentDoc } from '@/types'
import {
  buildSummary, summaryConfig, summaryCsv, downloadFile, summaryFileName, hasLegalDetails,
  type CsvFormat, type RentalSummarySettings, type SummaryInput,
} from '@/lib/rentalSummary'
import { money, rentalSummaryPdf } from '@/lib/rentalSummaryPdf'
import { inp } from './adminEquipmentShared'
import { usePlan } from '@/hooks/usePlan'

// Rental summary of one booking or project: totals, an optional extra
// discount, and downloads as PDF or CSV. Prices and seller details come from
// the catalog and settings/rental_summary (Equipment → Export). On Rental
// & Inventory Plus (plan features, functions/src/pricing.ts).

export function useSummaryConfig() {
  const { currency } = useSchool()
  const { data, loading } = useDocument<RentalSummarySettings & { id: string }>('settings', 'rental_summary')
  return { cfg: useMemo(() => summaryConfig(currency, data), [currency, data]), settings: data, loading }
}

export function RentalSummaryButton({ input, catalog, style, className }: {
  input: () => SummaryInput
  catalog: Map<string, EquipmentDoc>
  style?: React.CSSProperties
  className?: string
}) {
  const [open, setOpen] = useState<SummaryInput | null>(null)
  if (!usePlan().has('rentalExport')) return null
  return (
    <>
      <button type="button" onClick={() => setOpen(input())} style={style} className={className}>
        <FileText size={13} /> Rental summary
      </button>
      {open && <RentalSummaryModal input={open} catalog={catalog} onClose={() => setOpen(null)} />}
    </>
  )
}

function RentalSummaryModal({ input, catalog, onClose }: { input: SummaryInput; catalog: Map<string, EquipmentDoc>; onClose: () => void }) {
  const { name } = useSchool()
  const { cfg } = useSummaryConfig()
  const [discount, setDiscount] = useState('')
  const [csvFormat, setCsvFormat] = useState<CsvFormat>(cfg.currency === 'SEK' ? 'sv' : 'intl')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pct = Math.min(Math.max(Number(discount.replace(',', '.')) || 0, 0), 100)
  const s = useMemo(() => buildSummary(input, catalog, cfg, pct), [input, catalog, cfg, pct])
  const m = (n: number) => money(n, cfg.currency)
  const unpriced = s.lines.filter(l => l.dayPrice === 0).map(l => l.name)

  async function pdf() {
    setBusy(true); setError('')
    try { downloadFile(summaryFileName(s, 'pdf'), await rentalSummaryPdf(s, cfg, name)) }
    catch (e: any) { setError(e?.message ?? 'Could not make the PDF') }
    finally { setBusy(false) }
  }

  const btn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 10, border: '1px solid #31353c', background: '#262a31', color: '#dfe2eb', fontSize: '.8rem', fontWeight: 600, cursor: 'pointer' }
  const row = (k: string, v: string, bold = false) => (
    <p style={{ display: 'flex', justifyContent: 'space-between', fontWeight: bold ? 700 : 400, color: bold ? '#dfe2eb' : '#a9aeb8', margin: 0 }}><span>{k}</span><span>{v}</span></p>
  )

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.75)', padding: '1rem' }} onClick={onClose}>
      <div role="dialog" aria-label="Rental summary" style={{ background: '#1c2026', border: '1px solid #31353c', borderRadius: 16, width: '100%', maxWidth: 440, padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: 12, fontSize: '.85rem' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 700, color: '#dfe2eb' }}>Rental summary · {input.title}</span>
          <button className="close-btn" aria-label="Close" onClick={onClose} style={{ position: 'static', width: 28, height: 28 }}><X size={14} /></button>
        </div>
        <p style={{ color: '#a9aeb8', margin: 0 }}>
          {s.lines.length} {s.lines.length === 1 ? 'line' : 'lines'} · {input.from} to {input.to} · {s.rentalDays} {s.rentalDays === 1 ? 'day' : 'days'}
          {s.chargedDays < s.rentalDays && ` (charged ${s.chargedDays})`}
        </p>
        {s.lines.length === 0 && <p style={{ color: '#ffb340', margin: 0 }}>Nothing to charge: no items, or every part was denied.</p>}
        {unpriced.length > 0 && <p style={{ color: '#ffb340', margin: 0, fontSize: '.78rem' }}>No price in the catalog: {unpriced.join(', ')}</p>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {row('Amount', m(s.amount))}
          {s.discount > 0 && row('Discount', `-${m(s.discount)}`)}
          {s.vat == null ? row('Total', m(s.total), true) : <>
            {row('Total excl. VAT', m(s.net))}
            {row(`VAT ${s.vatRate}%`, m(s.vat))}
            {row('Total incl. VAT', m(s.total), true)}
          </>}
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: '#a9aeb8', flex: 1 }}>Extra discount (%)</span>
          <input style={{ ...inp, width: 90 }} inputMode="decimal" value={discount} onChange={e => setDiscount(e.target.value)} placeholder="0" />
        </label>

        <p style={{ fontSize: '.75rem', color: '#979ca7', margin: 0 }}>
          {cfg.vatRate == null
            ? 'No VAT rate is set (Equipment → Export), so prices are shown as listed, without a VAT line.'
            : `VAT ${cfg.vatRate}% from Equipment → Export.`}
          {!hasLegalDetails(cfg) && ' The PDF is marked "Not a tax invoice".'}
        </p>

        {error && <p role="alert" style={{ color: '#ff4757', margin: 0 }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button style={{ ...btn, background: '#4cd964', color: '#000', border: 'none' }} disabled={busy || !s.lines.length} onClick={pdf}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} PDF
          </button>
          <button style={btn} disabled={!s.lines.length} onClick={() => downloadFile(summaryFileName(s, 'csv'), summaryCsv([s], cfg.currency, csvFormat))}>
            <Download size={14} /> CSV
          </button>
          <CsvFormatSelect value={csvFormat} onChange={setCsvFormat} />
        </div>
      </div>
    </div>
  )
}

export function CsvFormatSelect({ value, onChange }: { value: CsvFormat; onChange: (v: CsvFormat) => void }) {
  return (
    <select aria-label="CSV format" style={{ ...inp, width: 'auto', fontSize: '.78rem' }} value={value} onChange={e => onChange(e.target.value as CsvFormat)}>
      <option value="sv">Swedish Excel (; and 0,5)</option>
      <option value="intl">International (, and 0.5)</option>
    </select>
  )
}
