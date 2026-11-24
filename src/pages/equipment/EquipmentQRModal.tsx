import { useRef, useState } from 'react'
import type { EquipmentDoc } from '@/types'
import { QRCodeSVG } from 'qrcode.react'
import { QrCode, X, Printer } from 'lucide-react'
import { printQRLabel, qrUnitValue } from './adminEquipmentShared'

export function QRModal({ item, onClose }: { item: EquipmentDoc; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const hasMultiple = item.totalQuantity > 1
  const [mode, setMode] = useState<'shared' | 'individual'>('shared')
  const [unit, setUnit] = useState(1)

  const qrValue = mode === 'individual' ? qrUnitValue(item, unit) : item.id
  const label   = mode === 'individual' ? `${item.name} #${unit}` : item.name

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.8)', backdropFilter: 'blur(8px)' }} onClick={onClose}>
      <div style={{ background: '#1c2026', border: '1px solid #31353c', borderRadius: 16, width: 320, padding: '1.5rem', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <span style={{ fontWeight: 700, fontSize: '.95rem', color: '#dfe2eb', display: 'flex', alignItems: 'center', gap: 6 }}>
            <QrCode size={16} color="#4edea3" /> QR Code
          </span>
          <button className="close-btn" onClick={onClose} style={{ position: 'static', width: 28, height: 28 }}><X size={14} /></button>
        </div>

        {hasMultiple && (
          <div style={{ display: 'flex', gap: 4, background: '#262a31', borderRadius: 10, padding: 4, marginBottom: '.75rem' }}>
            <button
              onClick={() => setMode('shared')}
              style={{ flex: 1, padding: '6px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: '.78rem', fontWeight: 700, background: mode === 'shared' ? '#4edea3' : 'transparent', color: mode === 'shared' ? '#000' : '#a9aeb8' }}
            >
              1 for all ({item.totalQuantity})
            </button>
            <button
              onClick={() => setMode('individual')}
              style={{ flex: 1, padding: '6px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: '.78rem', fontWeight: 700, background: mode === 'individual' ? '#4edea3' : 'transparent', color: mode === 'individual' ? '#000' : '#a9aeb8' }}
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
                  border: unit === n ? '2px solid #4edea3' : '1px solid #31353c',
                  background: unit === n ? 'rgba(76,217,100,.15)' : '#262a31',
                  color: unit === n ? '#4edea3' : '#a9aeb8',
                }}
              >
                {n}
              </button>
            ))}
          </div>
        )}

        {hasMultiple && item.plainLabelIsUnit1 && (mode === 'shared' || unit === 1) && (
          <p style={{ fontSize: '.72rem', color: '#a9aeb8', marginBottom: '.75rem' }}>
            {mode === 'shared'
              ? 'For this item, the label without a number counts as #1.'
              : "#1 doesn't need a new label: the one printed while there was a single item counts as #1."}
          </p>
        )}
        <p style={{ fontWeight: 600, fontSize: '.9rem', color: '#dfe2eb', marginBottom: '.75rem' }}>{label}</p>
        <div ref={ref} style={{ background: '#fff', borderRadius: 10, padding: 12, display: 'inline-block', marginBottom: '.75rem' }}>
          <QRCodeSVG value={qrValue} size={180} level="H" />
        </div>
        <p style={{ fontSize: 10, color: '#8c919b', fontFamily: 'monospace', marginBottom: '1rem', wordBreak: 'break-all' }}>{qrValue}</p>
        <button
          onClick={() => printQRLabel(label, qrValue, item.category, ref.current)}
          style={{ width: '100%', padding: '10px', background: '#262a31', border: '1px solid #31353c', borderRadius: 10, color: '#dfe2eb', fontSize: '.85rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
        >
          <Printer size={14} /> Print QR Label
        </button>
      </div>
    </div>
  )
}
