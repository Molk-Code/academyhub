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
// (see qrUnitValue in AdminEquipmentPage) so a scan can be traced back to a
// specific physical unit rather than just the equipment type.
export function parseScanText(raw: string): { base: string; unit: number | null } {
  const m = raw.match(/^(.*)::(\d+)$/)
  if (m) return { base: m[1], unit: parseInt(m[2], 10) }
  return { base: raw, unit: null }
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
