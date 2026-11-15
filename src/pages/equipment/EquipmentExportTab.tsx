import { useEffect, useMemo, useState } from 'react'
import { collection, doc, getDocs, setDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useCollection } from '@/hooks/useFirestore'
import type { EquipmentBookingDoc, EquipmentDoc, InventoryItemDoc, InventoryProjectDoc } from '@/types'
import {
  buildSummary, bookingSummaryInput, projectSummaryInput, summaryCsv, downloadFile, LEGAL_FIELDS,
  type CsvFormat, type SellerDetails,
} from '@/lib/rentalSummary'
import { Download, Loader2 } from 'lucide-react'
import { inp } from './adminEquipmentShared'
import { useSummaryConfig, CsvFormatSelect } from './RentalSummary'

// Equipment → Export: the details printed on rental summaries (VAT rate,
// seller) and a CSV of every booking and project in a period, one row per
// line, for accounting software. No payments are taken here.

const SELLER_FIELDS: { key: keyof SellerDetails; label: string; placeholder?: string; long?: boolean }[] = [
  { key: 'legalName', label: 'Legal name' },
  { key: 'orgNumber', label: 'Organisation number' },
  { key: 'vatNumber', label: 'VAT number' },
  { key: 'address', label: 'Address', long: true },
  { key: 'email', label: 'Billing email' },
  { key: 'paymentTerms', label: 'Payment terms (printed on the summary)', placeholder: 'e.g. Payment within 30 days to bank giro …', long: true },
]

const BILLABLE = new Set(['confirmed', 'checked-out', 'returned'])

export function ExportTab() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const { cfg, settings, loading } = useSummaryConfig()

  const [vat, setVat] = useState('')
  const [seller, setSeller] = useState<SellerDetails>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (loading) return
    setVat(settings?.vatRate != null ? String(settings.vatRate) : '')
    setSeller(settings?.seller ?? {})
  }, [loading, settings])

  async function save() {
    const v = vat.trim().replace(',', '.')
    const rate = v === '' ? null : Number(v)
    if (rate != null && (!Number.isFinite(rate) || rate < 0 || rate > 100)) { setError('VAT rate: a percentage from 0 to 100, or empty.'); return }
    const clean = Object.fromEntries(SELLER_FIELDS.map(f => [f.key, (seller[f.key] ?? '').trim().slice(0, 500)]))
    setSaving(true); setError(''); setSaved(false)
    try {
      await setDoc(doc(db, 'settings', 'rental_summary'), { vatRate: rate, seller: clean })
      setSaved(true)
    } catch (e: any) { setError(e?.message ?? 'Save failed') }
    finally { setSaving(false) }
  }

  // ── Period export ──
  const monthStart = new Date(); monthStart.setDate(1)
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const [from, setFrom] = useState(iso(new Date(monthStart.getFullYear(), monthStart.getMonth() - 1, 1)))
  const [to, setTo] = useState(iso(new Date(monthStart.getFullYear(), monthStart.getMonth(), 0)))
  const [csvFormat, setCsvFormat] = useState<CsvFormat>(cfg.currency === 'SEK' ? 'sv' : 'intl')
  const [exporting, setExporting] = useState(false)
  const [result, setResult] = useState('')
  const { data: equipment } = useCollection<EquipmentDoc>('equipment')
  const catalog = useMemo(() => new Map(equipment.map(e => [e.id, e])), [equipment])

  async function exportPeriod() {
    setExporting(true); setResult(''); setError('')
    try {
      const inRange = (d: string) => !!d && d >= from && d <= to
      const bookings = (await getDocs(collection(db, 'equipment_bookings'))).docs
        .map(d => ({ id: d.id, ...d.data() }) as EquipmentBookingDoc)
        .filter(b => BILLABLE.has(b.status) && inRange(b.checkoutDate))
      const projects = (await getDocs(collection(db, 'inventory_projects'))).docs
        .map(d => ({ id: d.id, ...d.data() }) as InventoryProjectDoc)
        .filter(p => inRange(p.checkoutDate))
      const inputs = bookings.map(b => bookingSummaryInput(b, catalog, true))
      for (const p of projects) {
        const rows = (await getDocs(collection(db, 'inventory_projects', p.id, 'items'))).docs.map(d => ({ id: d.id, ...d.data() }) as InventoryItemDoc)
        inputs.push(projectSummaryInput(p, rows))
      }
      const summaries = inputs.filter(i => i.lines.length).sort((a, b) => a.from.localeCompare(b.from)).map(i => buildSummary(i, catalog, cfg))
      if (!summaries.length) { setResult('Nothing rented out in this period.'); return }
      downloadFile(`rental-lines-${from}-to-${to}.csv`, summaryCsv(summaries, cfg.currency, csvFormat))
      const lines = summaries.reduce((n, s) => n + s.lines.length, 0)
      setResult(`${summaries.length} bookings and projects, ${lines} lines.`)
    } catch (e: any) { setError(e?.message ?? 'Export failed') }
    finally { setExporting(false) }
  }

  const card: React.CSSProperties = { background: '#0e0e16', border: '1px solid #2a2a3a', borderRadius: 14, padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: 10 }
  const btn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 10, border: 'none', background: '#4cd964', color: '#000', fontSize: '.8rem', fontWeight: 600, cursor: 'pointer', alignSelf: 'flex-start' }
  const label: React.CSSProperties = { fontSize: '.75rem', color: '#8a8aab' }
  const missing = LEGAL_FIELDS.filter(f => !cfg.seller[f]?.trim()).length + (cfg.vatRate == null ? 1 : 0)

  return (
    <div style={{ maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={card}>
        <p style={{ fontWeight: 700, color: '#f0f0f5' }}>Bookings and projects in a period</p>
        <p style={{ ...label, fontSize: '.8rem' }}>
          One row per line, for importing into accounting software. Includes confirmed, checked-out and returned bookings and every project
          starting in the period. Parts of a booking set up in a project are counted under the project.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><span style={label}>From</span>
            <input type="date" style={inp} value={from} onChange={e => setFrom(e.target.value)} /></label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><span style={label}>To</span>
            <input type="date" style={inp} value={to} onChange={e => setTo(e.target.value)} /></label>
          <CsvFormatSelect value={csvFormat} onChange={setCsvFormat} />
        </div>
        <button style={btn} disabled={exporting || !from || !to || from > to} onClick={exportPeriod}>
          {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Download CSV
        </button>
        {result && <p role="status" style={{ fontSize: '.8rem', color: '#a0a0b5' }}>{result}</p>}
      </div>

      <div style={card}>
        <p style={{ fontWeight: 700, color: '#f0f0f5' }}>Details on rental summaries</p>
        <p style={{ ...label, fontSize: '.8rem' }}>
          Summaries are marked <strong>"Not a tax invoice"</strong> until the legal name, organisation number, VAT number, address and a VAT rate are filled in
          {missing ? ` (${missing} missing)` : ' (all filled in)'}. Even then, check with your accountant what an invoice must contain where you are:
          for example a unique invoice number, which summaries don't have.
        </p>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, maxWidth: 200 }}>
          <span style={label}>VAT rate (%)</span>
          <input style={inp} inputMode="decimal" value={vat} disabled={!isAdmin} onChange={e => setVat(e.target.value)} placeholder="Not set" />
        </label>
        <p style={{ ...label, marginTop: -4 }}>Empty: prices are shown as listed in the catalog, without a VAT line. Set it: prices excl. VAT, with VAT added.</p>
        {SELLER_FIELDS.map(f => (
          <label key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={label}>{f.label}</span>
            {f.long
              ? <textarea style={{ ...inp, minHeight: 56 }} value={seller[f.key] ?? ''} disabled={!isAdmin} placeholder={f.placeholder} onChange={e => setSeller(s => ({ ...s, [f.key]: e.target.value }))} />
              : <input style={inp} value={seller[f.key] ?? ''} disabled={!isAdmin} placeholder={f.placeholder} onChange={e => setSeller(s => ({ ...s, [f.key]: e.target.value }))} />}
          </label>
        ))}
        {error && <p role="alert" style={{ color: '#ff4757', fontSize: '.8rem' }}>{error}</p>}
        {isAdmin
          ? <button style={btn} disabled={saving} onClick={save}>{saving && <Loader2 size={14} className="animate-spin" />} Save</button>
          : <p style={label}>Only admins can change these.</p>}
        {saved && <p role="status" style={{ fontSize: '.8rem', color: '#4cd964' }}>Saved.</p>}
      </div>
    </div>
  )
}
