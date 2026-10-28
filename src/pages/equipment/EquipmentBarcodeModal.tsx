import { useEffect, useRef, useState } from 'react'
import JsBarcode from 'jsbarcode'
import { doc, runTransaction } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { EquipmentDoc } from '@/types'
import { Barcode, X, Printer, Download, Copy, Check } from 'lucide-react'
import { printBarcodeLabel, barcodeUnitValue } from './adminEquipmentShared'
import { ean14Value } from './inventoryShared'

type Symbology = 'code128' | 'ean14'
const FORMAT_KEY = 'barcodeSymbology'

// Hands out the next free EAN-14 equipment number, once per equipment item.
async function ensureGtinNo(itemId: string): Promise<number> {
  return runTransaction(db, async tx => {
    const itemRef = doc(db, 'equipment', itemId)
    const counterRef = doc(db, 'settings', 'equipment_gtin')
    const [itemSnap, counterSnap] = await Promise.all([tx.get(itemRef), tx.get(counterRef)])
    const existing = itemSnap.data()?.gtinNo as number | undefined
    if (existing) return existing
    const next = ((counterSnap.data()?.next as number | undefined) ?? 1)
    tx.set(counterRef, { next: next + 1 }, { merge: true })
    tx.update(itemRef, { gtinNo: next })
    return next
  })
}

// What goes into the barcode vs. what's printed under it. EAN-14 is printed
// as GS1-128: application identifier (01) + the 14-digit GTIN.
interface BarcodeSpec { data: string; text: string; ean128: boolean }

// ── High-resolution PNG label (for P-touch Editor & other label software) ────
// Label software rasterises imported PDFs at low resolution, so offer a PNG
// rendered at print resolution instead: 100 × 50 mm at 600 dpi, with bars on
// whole-pixel module widths (no anti-aliased edges) and the DPI written into
// the file so the label lands at its real size.
const DPI = 600
const mm = (v: number) => Math.round((v / 25.4) * DPI)

function crc32(bytes: Uint8Array): number {
  let c = ~0
  for (const b of bytes) {
    c ^= b
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

// Insert a pHYs chunk (pixels per metre) right after IHDR.
function withDpi(png: Uint8Array, dpi: number): Uint8Array {
  const ppm = Math.round(dpi / 0.0254)
  const chunk = new Uint8Array(21)
  const dv = new DataView(chunk.buffer)
  dv.setUint32(0, 9)
  chunk.set([0x70, 0x48, 0x59, 0x73], 4) // "pHYs"
  dv.setUint32(8, ppm)
  dv.setUint32(12, ppm)
  chunk[16] = 1 // unit: metre
  dv.setUint32(17, crc32(chunk.subarray(4, 17)))
  const at = 8 + 25 // signature + IHDR chunk
  const out = new Uint8Array(png.length + chunk.length)
  out.set(png.subarray(0, at))
  out.set(chunk, at)
  out.set(png.subarray(at), at + chunk.length)
  return out
}

async function downloadBarcodePng(spec: BarcodeSpec, name: string, category: string) {
  const W = mm(100), H = mm(50)
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = '#111'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'

  // Barcode: count modules first, then pick the widest whole-pixel module that fits 92 mm
  const probe = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  JsBarcode(probe, spec.data, { format: 'CODE128', ean128: spec.ean128, width: 1, margin: 0, displayValue: false })
  const modules = parseFloat(probe.getAttribute('width') ?? '0') || 1
  const moduleW = Math.max(1, Math.floor(mm(92) / modules))
  const bc = document.createElement('canvas')
  JsBarcode(bc, spec.data, {
    format: 'CODE128',
    ean128: spec.ean128,
    width: moduleW,
    height: mm(16),
    margin: 0,
    // Drawn below ourselves — JsBarcode's canvas text clips descenders (g, p)
    displayValue: false,
    background: '#ffffff',
    lineColor: '#000000',
  })

  // Name + category, same proportions as the printed label
  let nameSize = mm(3.6)
  ctx.font = `bold ${nameSize}px Arial, sans-serif`
  while (ctx.measureText(name).width > mm(92) && nameSize > mm(2)) {
    nameSize -= 4
    ctx.font = `bold ${nameSize}px Arial, sans-serif`
  }
  const catSize = mm(2.4)
  const gap = mm(1.5)
  const codeSize = mm(3)
  const blockH = nameSize + (category ? gap + catSize : 0) + gap * 1.5 + bc.height + mm(1) + codeSize
  let y = Math.round((H - blockH) / 2)

  ctx.fillText(name, W / 2, y)
  y += nameSize + gap
  if (category) {
    ctx.fillStyle = '#6b7280'
    ctx.font = `bold ${catSize}px Arial, sans-serif`
    ctx.fillText(category.toUpperCase(), W / 2, y)
    y += catSize + gap
  }
  y += gap * 0.5
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(bc, Math.round((W - bc.width) / 2), Math.round(y))
  y += bc.height + mm(1)
  ctx.fillStyle = '#000'
  ctx.font = `${codeSize}px Menlo, Consolas, monospace`
  ctx.fillText(spec.text, W / 2, y)

  const blob: Blob = await new Promise(res => canvas.toBlob(b => res(b!), 'image/png'))
  const png = withDpi(new Uint8Array(await blob.arrayBuffer()), DPI)
  const url = URL.createObjectURL(new Blob([png as Uint8Array<ArrayBuffer>], { type: 'image/png' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `barcode-${name.replace(/[^\w\-#åäöÅÄÖ ]+/g, '').trim().replace(/\s+/g, '-') || 'label'}.png`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function BarcodeModal({ item, onClose }: { item: EquipmentDoc; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const hasMultiple = item.totalQuantity > 1
  const [mode, setMode] = useState<'shared' | 'individual'>('shared')
  const [unit, setUnit] = useState(1)
  const [copied, setCopied] = useState(false)
  const [symbology, setSymbology] = useState<Symbology>(() => {
    try { return localStorage.getItem(FORMAT_KEY) === 'ean14' ? 'ean14' : 'code128' } catch { return 'code128' }
  })
  const [gtinNo, setGtinNo] = useState<number | null>(item.gtinNo ?? null)
  const [gtinError, setGtinError] = useState('')

  function chooseSymbology(next: Symbology) {
    setSymbology(next)
    try { localStorage.setItem(FORMAT_KEY, next) } catch { /* ignore */ }
  }

  // First EAN-14 label for this item: give it an equipment number
  useEffect(() => {
    if (symbology !== 'ean14' || gtinNo) return
    setGtinError('')
    ensureGtinNo(item.id)
      .then(setGtinNo)
      .catch(() => setGtinError('Could not assign an EAN-14 number — check your connection and try again.'))
  }, [symbology, gtinNo, item.id])

  const label = mode === 'individual' ? `${item.name} #${unit}` : item.name
  const gtin = gtinNo ? ean14Value(gtinNo, mode === 'individual' ? unit : null) : null
  const spec: BarcodeSpec | null = symbology === 'code128'
    ? { data: mode === 'individual' ? barcodeUnitValue(item, unit) : item.id, text: '', ean128: false }
    : gtin ? { data: `01${gtin}`, text: `(01) ${gtin}`, ean128: true } : null
  if (spec && !spec.text) spec.text = spec.data
  // What "Copy code" puts on the clipboard: the id, or the bare 14-digit GTIN
  const copyValue = symbology === 'ean14' ? gtin : spec?.data

  useEffect(() => {
    if (!svgRef.current || !spec) return
    JsBarcode(svgRef.current, spec.data, {
      format: 'CODE128',
      ean128: spec.ean128,
      text: spec.text,
      width: 2,
      height: 70,
      margin: 10,
      fontSize: 14,
      displayValue: true,
      background: '#ffffff',
      lineColor: '#000000',
    })
  }, [spec?.data, spec?.text, spec?.ean128])

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.8)', backdropFilter: 'blur(8px)' }} onClick={onClose}>
      <div style={{ background: '#0e0e16', border: '1px solid #2a2a3a', borderRadius: 16, width: 360, maxWidth: 'calc(100vw - 32px)', padding: '1.5rem', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <span style={{ fontWeight: 700, fontSize: '.95rem', color: '#f0f0f5', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Barcode size={16} color="#4cd964" /> Barcode
          </span>
          <button className="close-btn" onClick={onClose} style={{ position: 'static', width: 28, height: 28 }}><X size={14} /></button>
        </div>

        <div style={{ display: 'flex', gap: 4, background: '#1a1a25', borderRadius: 10, padding: 4, marginBottom: '.75rem' }}>
          {(['code128', 'ean14'] as const).map(f => (
            <button
              key={f}
              onClick={() => chooseSymbology(f)}
              style={{ flex: 1, padding: '6px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: '.78rem', fontWeight: 700, background: symbology === f ? '#f0f0f5' : 'transparent', color: symbology === f ? '#000' : '#a0a0b5' }}
            >
              {f === 'code128' ? 'Code 128' : 'EAN-14'}
            </button>
          ))}
        </div>

        {hasMultiple && (
          <div style={{ display: 'flex', gap: 4, background: '#1a1a25', borderRadius: 10, padding: 4, marginBottom: '.75rem' }}>
            <button
              onClick={() => setMode('shared')}
              style={{ flex: 1, padding: '6px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: '.78rem', fontWeight: 700, background: mode === 'shared' ? '#4cd964' : 'transparent', color: mode === 'shared' ? '#000' : '#a0a0b5' }}
            >
              1 for all ({item.totalQuantity})
            </button>
            <button
              onClick={() => setMode('individual')}
              style={{ flex: 1, padding: '6px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: '.78rem', fontWeight: 700, background: mode === 'individual' ? '#4cd964' : 'transparent', color: mode === 'individual' ? '#000' : '#a0a0b5' }}
            >
              Individual
            </button>
          </div>
        )}

        {mode === 'individual' && hasMultiple && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginBottom: '.75rem' }}>
            {Array.from({ length: item.totalQuantity }, (_, i) => i + 1).map(n => (
              <button
                key={n}
                onClick={() => setUnit(n)}
                style={{
                  width: 32, height: 32, borderRadius: 8, cursor: 'pointer', fontSize: '.8rem', fontWeight: 700,
                  border: unit === n ? '2px solid #4cd964' : '1px solid #2a2a3a',
                  background: unit === n ? 'rgba(76,217,100,.15)' : '#1a1a25',
                  color: unit === n ? '#4cd964' : '#a0a0b5',
                }}
              >
                {n}
              </button>
            ))}
          </div>
        )}

        <p style={{ fontWeight: 600, fontSize: '.9rem', color: '#f0f0f5', marginBottom: '.75rem' }}>{label}</p>
        <div ref={ref} style={{ background: '#fff', borderRadius: 10, padding: 8, marginBottom: '1rem', overflowX: 'auto' }}>
          {spec
            ? <svg ref={svgRef} style={{ maxWidth: '100%', height: 'auto', display: 'block', margin: '0 auto' }} />
            : <p style={{ color: gtinError ? '#c0392b' : '#6b7280', fontSize: '.8rem', padding: '2rem .5rem' }}>{gtinError || 'Assigning EAN-14 number…'}</p>}
        </div>
        <button
          disabled={!spec}
          onClick={() => printBarcodeLabel(label, item.category, ref.current)}
          style={{ width: '100%', padding: '10px', background: '#1a1a25', border: '1px solid #2a2a3a', borderRadius: 10, color: '#f0f0f5', fontSize: '.85rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
        >
          <Printer size={14} /> Print Barcode Label
        </button>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button
            disabled={!spec}
            onClick={() => spec && downloadBarcodePng(spec, label, item.category)}
            title="High-resolution PNG (600 dpi, 100 × 50 mm) — import into P-touch Editor or other label software"
            style={{ flex: 1, padding: '10px', background: '#1a1a25', border: '1px solid #2a2a3a', borderRadius: 10, color: '#f0f0f5', fontSize: '.85rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
          >
            <Download size={14} /> Download PNG
          </button>
          <button
            disabled={!copyValue}
            onClick={() => { if (copyValue) navigator.clipboard?.writeText(copyValue).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }) }}
            title={symbology === 'ean14'
              ? "Copy the 14-digit GTIN — paste into P-touch Editor's GS1-128 barcode with AI (01)"
              : "Copy the code — paste into P-touch Editor's own Code 128 barcode for the sharpest print"}
            style={{ flex: 1, padding: '10px', background: '#1a1a25', border: '1px solid #2a2a3a', borderRadius: 10, color: copied ? '#4cd964' : '#f0f0f5', fontSize: '.85rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy code'}
          </button>
        </div>
      </div>
    </div>
  )
}
