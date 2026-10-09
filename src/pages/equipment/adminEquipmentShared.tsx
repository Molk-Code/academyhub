import { useState } from 'react'
import { uploadFile, optimizeImageUrl } from '@/lib/cloudinary'
import type { EquipmentCategoryDoc, EquipmentDoc } from '@/types'

// ── Types & constants ─────────────────────────────────────────────────────────

export const DEFAULT_CATEGORIES: Omit<EquipmentCategoryDoc, 'id'>[] = [
  { name: 'CAMERA',   color: 'blue',   order: 0 },
  { name: 'GRIP',     color: 'orange', order: 1 },
  { name: 'LIGHTS',   color: 'yellow', order: 2 },
  { name: 'SOUND',    color: 'green',  order: 3 },
  { name: 'LOCATION', color: 'purple', order: 4 },
  { name: 'BOOKS',    color: 'pink',   order: 5 },
  { name: 'OTHER',    color: 'zinc',   order: 6 },
]

export const COLOR_HEX: Record<string, { text: string; bg: string; border: string }> = {
  blue:    { text: '#93c5fd', bg: 'rgba(59,130,246,.15)',  border: 'rgba(59,130,246,.35)'  },
  orange:  { text: '#fdba74', bg: 'rgba(249,115,22,.15)',  border: 'rgba(249,115,22,.35)'  },
  yellow:  { text: '#fde047', bg: 'rgba(234,179,8,.15)',   border: 'rgba(234,179,8,.35)'   },
  green:   { text: '#86efac', bg: 'rgba(34,197,94,.15)',   border: 'rgba(34,197,94,.35)'   },
  purple:  { text: '#d8b4fe', bg: 'rgba(168,85,247,.15)',  border: 'rgba(168,85,247,.35)'  },
  pink:    { text: '#f9a8d4', bg: 'rgba(236,72,153,.15)',  border: 'rgba(236,72,153,.35)'  },
  red:     { text: '#fca5a5', bg: 'rgba(239,68,68,.15)',   border: 'rgba(239,68,68,.35)'   },
  cyan:    { text: '#67e8f9', bg: 'rgba(6,182,212,.15)',   border: 'rgba(6,182,212,.35)'   },
  emerald: { text: '#6ee7b7', bg: 'rgba(16,185,129,.15)',  border: 'rgba(16,185,129,.35)'  },
  amber:   { text: '#fcd34d', bg: 'rgba(245,158,11,.15)',  border: 'rgba(245,158,11,.35)'  },
  indigo:  { text: '#a5b4fc', bg: 'rgba(99,102,241,.15)', border: 'rgba(99,102,241,.35)'  },
  teal:    { text: '#5eead4', bg: 'rgba(20,184,166,.15)',  border: 'rgba(20,184,166,.35)'  },
  zinc:    { text: '#d4d4d8', bg: 'rgba(113,113,122,.15)', border: 'rgba(113,113,122,.35)' },
}

export const COLOR_OPTIONS = Object.keys(COLOR_HEX)

export function catColors(colorKey: string) {
  return COLOR_HEX[colorKey] ?? COLOR_HEX.zinc
}

export function catStyle(name: string, cats: EquipmentCategoryDoc[]): React.CSSProperties {
  const found = cats.find(c => c.name === name)
  const c = catColors(found?.color ?? 'zinc')
  return { color: c.text, background: c.bg, border: `1px solid ${c.border}` }
}

export const BOOKING_STATUSES = ['all', 'pending', 'confirmed', 'checked-out', 'returned', 'denied', 'cancelled'] as const

export const STATUS_COLOR: Record<string, string> = {
  pending:       '#f59e0b',
  confirmed:     '#4cd964',
  'checked-out': '#f97316',
  returned:      '#4cd964',
  denied:        '#f87171',
  cancelled:     '#6b7280',
}

export const inp: React.CSSProperties = {
  width: '100%', padding: '10px 12px', background: '#0e0e16',
  border: '1px solid #2a2a3a', borderRadius: 10, color: '#f0f0f5',
  fontSize: '.875rem', outline: 'none',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function EquipmentImg({ url, name, fallback }: { url: string | undefined | null; name: string; fallback: React.ReactNode }) {
  const [failed, setFailed] = useState(false)
  if (!url || failed) return <>{fallback}</>
  return <img src={optimizeImageUrl(url)} alt={name} onError={() => setFailed(true)} />
}

export function formatDate(d: string) {
  if (!d) return ''
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export async function uploadEquipmentImage(file: File, onProgress: (p: number) => void): Promise<string> {
  const result = await uploadFile(file, onProgress)
  return result.secureUrl
}

export function printQRLabel(name: string, id: string, category: string, container: HTMLDivElement | null) {
  if (!container) return
  const svg = container.querySelector('svg')
  if (!svg) return
  const svgData = new XMLSerializer().serializeToString(svg)
  const win = window.open('', '_blank', 'width=700,height=800')
  if (!win) return
  win.document.write(`<html><head><title>QR — ${name}</title>
    <style>
      *{box-sizing:border-box;margin:0;padding:0}
      @page{size:100mm 100mm;margin:0}
      html,body{width:100mm;height:100mm;background:#fff}
      body{font-family:Arial,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:6mm}
      .wrap{padding:6px;border:1.5px solid #e5e7eb;border-radius:6px;display:inline-block;line-height:0}
      .wrap svg{width:70mm;height:70mm}
      h1{font-size:13px;font-weight:700;color:#111;text-align:center;line-height:1.2;max-width:88mm;word-break:break-word}
      .cat{font-size:9px;font-weight:700;color:#6b7280;letter-spacing:.1em;text-transform:uppercase}
      button{margin-top:10px;padding:8px 20px;background:#111;color:#fff;border:none;border-radius:5px;font-size:12px;cursor:pointer}
      @media print{button{display:none}}
    </style></head>
    <body>
    <h1>${name}</h1>
    <p class="cat">${category}</p>
    <div class="wrap">${svgData}</div>
    <button onclick="window.print();window.close()">🖨️ Print</button>
    </body></html>`)
  win.document.close()
  win.focus()
  setTimeout(() => win.print(), 300)
}

// QR codes encode the equipment doc id (both the in-app scanner and the
// remote/mobile scan page resolve a scanned id back to an equipment doc).
// Individual-unit QRs append "::N" so a scan can be traced back to a specific
// physical unit (e.g. "Easyrig Minimax #2") instead of the equipment type as a whole.
export function qrUnitValue(item: EquipmentDoc, unit: number): string {
  return `${item.id}::${unit}`
}
