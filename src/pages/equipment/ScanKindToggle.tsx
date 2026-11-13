import { QrCode, ScanBarcode } from 'lucide-react'
import type { ScanKind } from '@/lib/cameraScanner'

// QR / Barcode choice for camera scanning (project page and phone scanner)
export function ScanKindToggle({ value, onChange, large = false }: { value: ScanKind; onChange: (k: ScanKind) => void; large?: boolean }) {
  const option = (kind: ScanKind, label: string, Icon: typeof QrCode) => {
    const on = value === kind
    return (
      <button
        type="button"
        role="radio"
        aria-checked={on}
        onClick={() => onChange(kind)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: large ? '10px 16px' : '6px 12px', minHeight: large ? 44 : undefined,
          fontSize: large ? '.9rem' : '.8rem', fontWeight: 700, cursor: 'pointer', border: 'none',
          background: on ? 'rgba(242,100,25,.18)' : 'transparent',
          color: on ? '#f26419' : '#8a8aab',
        }}
      >
        <Icon size={large ? 16 : 14} aria-hidden="true" /> {label}
      </button>
    )
  }
  return (
    <div role="radiogroup" aria-label="What to scan with the camera"
      style={{ display: 'inline-flex', border: '1px solid #2a2a3a', borderRadius: 10, overflow: 'hidden', background: '#12121a' }}>
      {option('qr', 'QR code', QrCode)}
      <span aria-hidden="true" style={{ width: 1, background: '#2a2a3a' }} />
      {option('barcode', 'Barcode', ScanBarcode)}
    </div>
  )
}

// A wide frame over the camera picture: where to hold a barcode
export function BarcodeGuide({ hint = true }: { hint?: boolean }) {
  return (
    <div aria-hidden="true" style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
      <div style={{ width: '80%', height: '28%', border: '2px solid rgba(242,100,25,.9)', borderRadius: 10, boxShadow: '0 0 0 9999px rgba(0,0,0,.35)', position: 'relative' }}>
        <div style={{ position: 'absolute', left: 8, right: 8, top: '50%', height: 2, background: 'rgba(239,68,68,.85)' }} />
      </div>
      {hint && (
        <p style={{ marginTop: 10, fontSize: '.75rem', color: '#f0f0f5', background: 'rgba(0,0,0,.55)', padding: '3px 10px', borderRadius: 999 }}>
          Fill the frame with the barcode, 10–20 cm away
        </p>
      )}
    </div>
  )
}
