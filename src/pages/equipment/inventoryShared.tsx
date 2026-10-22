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
export function parseScanText(raw: string): { base: string; unit: number | null } {
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
