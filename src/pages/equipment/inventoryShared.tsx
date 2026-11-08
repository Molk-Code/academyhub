import { useState } from 'react'
import { collection, doc, runTransaction } from 'firebase/firestore'
import { db } from '@/lib/firebase'
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

// ── Matching scans against a project's item rows ─────────────────────────────
// Items imported from a booking arrive as generic "pending" rows — "2x Godox
// TL60 Kit 2-kit" becomes two rows of that name. A checkout scan of a unit
// ("Godox TL60 Kit 2-kit #1") fills one of those rows instead of adding a new
// one. The row keeps its booked name (the signed contract lists that name) and
// records which physical unit went out in `unit`.
type ScanRow = { id: string; equipmentId: string; equipmentName: string; status: string; unit?: number | null }
const OUT = new Set(['checked-out', 'damaged', 'missing'])

// Name including the unit that was scanned out, e.g. "Godox TL60 Kit 2-kit #1"
export function itemDisplayName(i: { equipmentName: string; unit?: number | null }): string {
  return i.unit && !i.equipmentName.endsWith(`#${i.unit}`) ? `${i.equipmentName} #${i.unit}` : i.equipmentName
}

export type CheckoutMatch<T> = { kind: 'duplicate'; item: T } | { kind: 'booked'; item: T } | { kind: 'new' }

export function matchCheckoutScan<T extends ScanRow>(items: T[], equipmentId: string, scannedName: string, unit: number | null): CheckoutMatch<T> {
  const same = (i: T) => (equipmentId ? i.equipmentId === equipmentId : i.equipmentName === scannedName)
  // The same physical unit can't go out twice (codes without a unit number
  // can't tell units apart, so those always count as another one)
  if (unit != null) {
    const dup = items.find(i => OUT.has(i.status) && (itemDisplayName(i) === scannedName || (same(i) && i.unit === unit)))
    if (dup) return { kind: 'duplicate', item: dup }
  }
  const pending = items.filter(i => i.status === 'pending' && same(i))
  const slot = pending.find(i => i.equipmentName === scannedName) ?? pending[0]
  return slot ? { kind: 'booked', item: slot } : { kind: 'new' }
}

// Checkout a scan safely when two scanners (desktop + phone) work the same
// project at once. matchCheckoutScan picks from each device's own copy of the
// list, which can be a moment old, so the write is re-checked atomically:
//  · a booked row is only filled if it is still "pending" (else the next one)
//  · a numbered unit holds a marker inventory_projects/{id}/unit_out/{equipmentId}__{unit}
//    while it is out — a second scan of it is refused. A marker whose item is
//    no longer out (returned by any route) is stale and simply replaced.
export type CheckoutResult = { kind: 'duplicate' } | { kind: 'booked'; id: string } | { kind: 'new'; id: string }

export async function checkoutScan<T extends ScanRow>(opts: {
  projectId: string
  items: T[]
  equipmentId: string
  scannedName: string
  unit: number | null
  bookedFields?: Record<string, unknown>   // extra fields when filling a booked row
  newRow: Record<string, unknown>          // the row to add when nothing booked is left
}): Promise<CheckoutResult> {
  const { projectId, items, equipmentId, scannedName, unit } = opts
  const first = matchCheckoutScan(items, equipmentId, scannedName, unit)
  if (first.kind === 'duplicate') return { kind: 'duplicate' }

  const same = (i: T) => (equipmentId ? i.equipmentId === equipmentId : i.equipmentName === scannedName)
  const pending = items.filter(i => i.status === 'pending' && same(i))
  const candidates = [...pending.filter(i => i.equipmentName === scannedName), ...pending.filter(i => i.equipmentName !== scannedName)]
  const itemsCol = collection(db, 'inventory_projects', projectId, 'items')
  const lockRef = equipmentId && unit != null ? doc(db, 'inventory_projects', projectId, 'unit_out', `${equipmentId}__${unit}`) : null
  const now = new Date().toISOString()

  return runTransaction(db, async tx => {
    if (lockRef) {
      const lock = await tx.get(lockRef)
      const heldId = lock.exists() ? (lock.data().itemId as string | undefined) : undefined
      if (heldId) {
        const held = await tx.get(doc(itemsCol, heldId))
        if (held.exists() && OUT.has(held.data().status)) return { kind: 'duplicate' } as const
      }
    }
    for (const c of candidates) {
      const row = await tx.get(doc(itemsCol, c.id))
      if (row.exists() && row.data().status === 'pending') {
        tx.update(row.ref, { status: 'checked-out', checkoutTimestamp: now, ...(unit != null ? { unit } : {}), ...(opts.bookedFields ?? {}) })
        if (lockRef) tx.set(lockRef, { itemId: c.id })
        return { kind: 'booked', id: c.id } as const
      }
    }
    const ref = doc(itemsCol)
    tx.set(ref, { checkoutTimestamp: now, ...opts.newRow, ...(unit != null ? { unit } : {}) })
    if (lockRef) tx.set(lockRef, { itemId: ref.id })
    return { kind: 'new', id: ref.id } as const
  })
}

export function matchCheckinScan<T extends ScanRow>(items: T[], equipmentId: string, scannedName: string, unit: number | null): T | undefined {
  const out = items.filter(i => i.status === 'checked-out')
  return out.find(i => itemDisplayName(i) === scannedName || i.equipmentName === scannedName)
    ?? (equipmentId && unit != null ? out.find(i => i.equipmentId === equipmentId && i.unit === unit) : undefined)
    // Rows without a recorded unit (older, or booked by name) take any unit back
    ?? (equipmentId ? out.find(i => i.equipmentId === equipmentId && (unit == null || i.unit == null)) : undefined)
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

// Web addresses typed into equipment text, made clickable (new tab)
const URL_RE = /(https?:\/\/[^\s<>"]+|www\.[^\s<>"]+)/gi

export function externalHref(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`
}

export function LinkifiedText({ text }: { text: string }) {
  const parts = text.split(URL_RE)
  return (
    <>
      {parts.map((part, i) => {
        if (i % 2 === 0) return part
        // Keep sentence punctuation after a link out of the link itself
        const trail = part.match(/[.,;:!?)]+$/)?.[0] ?? ''
        const url = trail ? part.slice(0, -trail.length) : part
        return (
          <span key={i}>
            <a href={externalHref(url)} target="_blank" rel="noopener noreferrer" style={{ color: '#f26419', textDecoration: 'underline', wordBreak: 'break-all' }}>{url}</a>
            {trail}
          </span>
        )
      })}
    </>
  )
}
