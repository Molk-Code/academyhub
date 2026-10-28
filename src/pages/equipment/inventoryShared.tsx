import { useState } from 'react'
import { optimizeImageUrl } from '@/lib/cloudinary'

export function EquipmentImg({ url, name, fallback }: { url: string | undefined | null; name: string; fallback: React.ReactNode }) {
  const [failed, setFailed] = useState(false)
  if (!url || failed) return <>{fallback}</>
  return <img src={optimizeImageUrl(url)} alt={name} onError={() => setFailed(true)} />
}

export function today() {
  return new Date().toISOString().slice(0, 10)
}

export function isOverdue(returnDate: string): boolean {
  if (!returnDate) return false
  return returnDate < today()
}

export function formatDate(d: string) {
  if (!d) return '—'
  const dt = new Date(d + 'T12:00:00')
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function overdueDays(returnDate: string): number {
  if (!returnDate) return 0
  const diff = Math.round((new Date(today()).getTime() - new Date(returnDate + 'T00:00:00').getTime()) / 86400000)
  return diff > 0 ? diff : 0
}

// Individual-unit QR codes are encoded as "<qrCode or name>::<unit number>"
// (see qrUnitValue) and barcodes as "<id>.<unit number>" (see barcodeUnitValue)
// so a scan can be traced back to a specific physical unit rather than just
// the equipment type. USB barcode scanners type as if on a US keyboard, so on
// a Swedish layout a scanned QR's "::" arrives as "ÖÖ" — accept that too.
// EAN-14 (GTIN-14) labels are numeric, so they carry the equipment's own
// number instead of its id: indicator 0, restricted-circulation prefix 20
// (internal use, never clashes with retail GTINs), 7-digit equipment number,
// 3-digit unit (000 = shared label for all units), then the GS1 check digit.
function gs1CheckDigit(digits: string): number {
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    sum += Number(digits[digits.length - 1 - i]) * (i % 2 === 0 ? 3 : 1)
  }
  return (10 - (sum % 10)) % 10
}

export function ean14Value(gtinNo: number, unit: number | null): string {
  const body = '020' + String(gtinNo).padStart(7, '0') + String(unit ?? 0).padStart(3, '0')
  return body + gs1CheckDigit(body)
}

// Accepts what scanners type for a GS1-128 label: "01" + GTIN, optionally
// with a "]C1" symbology prefix or the printed "(01) " form, or the bare GTIN.
export function parseEan14(raw: string): { gtinNo: number; unit: number | null } | null {
  const digits = raw.trim().replace(/^\]C1/, '').replace(/[()\s]/g, '')
  const gtin = /^01\d{14}$/.test(digits) ? digits.slice(2) : /^\d{14}$/.test(digits) ? digits : null
  if (!gtin || !gtin.startsWith('020') || gs1CheckDigit(gtin.slice(0, 13)) !== Number(gtin[13])) return null
  const unit = parseInt(gtin.slice(10, 13), 10)
  return { gtinNo: parseInt(gtin.slice(3, 10), 10), unit: unit || null }
}

export function parseScanText(raw: string): { base: string; unit: number | null; gtinNo?: number } {
  const ean = parseEan14(raw)
  if (ean) return { base: raw.trim(), unit: ean.unit, gtinNo: ean.gtinNo }
  const text = raw.trim()
  // "." only counts as a separator after a Firestore id, so names like
  // "Canon 24-70 f2.8" (older QRs may encode a name) aren't split.
  const m = text.match(/^(.*?)(?:::|ÖÖ|öö)(\d+)$/) ?? text.match(/^([A-Za-z0-9]{20})\.(\d+)$/)
  if (m) return { base: m[1], unit: parseInt(m[2], 10) }
  return { base: text, unit: null }
}

export function beep(freq: number) {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.3, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3)
    osc.start()
    osc.stop(ctx.currentTime + 0.3)
  } catch {}
}
