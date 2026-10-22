import { useEffect, useRef, useState } from 'react'
import JsBarcode from 'jsbarcode'
import type { EquipmentDoc } from '@/types'
import { Barcode, X, Printer } from 'lucide-react'
import { printBarcodeLabel, barcodeUnitValue } from './adminEquipmentShared'

export function BarcodeModal({ item, onClose }: { item: EquipmentDoc; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const hasMultiple = item.totalQuantity > 1
  const [mode, setMode] = useState<'shared' | 'individual'>('shared')
  const [unit, setUnit] = useState(1)

  const value = mode === 'individual' ? barcodeUnitValue(item, unit) : item.id
  const label = mode === 'individual' ? `${item.name} #${unit}` : item.name

  useEffect(() => {
    if (!svgRef.current) return
    JsBarcode(svgRef.current, value, {
      format: 'CODE128',
      width: 2,
      height: 70,
      margin: 10,
      fontSize: 14,
      displayValue: true,
      background: '#ffffff',
      lineColor: '#000000',
    })
  }, [value])

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.8)', backdropFilter: 'blur(8px)' }} onClick={onClose}>
      <div style={{ background: '#0e0e16', border: '1px solid #2a2a3a', borderRadius: 16, width: 360, maxWidth: 'calc(100vw - 32px)', padding: '1.5rem', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <span style={{ fontWeight: 700, fontSize: '.95rem', color: '#f0f0f5', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Barcode size={16} color="#4cd964" /> Barcode
          </span>
          <button className="close-btn" onClick={onClose} style={{ position: 'static', width: 28, height: 28 }}><X size={14} /></button>
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
          <svg ref={svgRef} style={{ maxWidth: '100%', height: 'auto', display: 'block', margin: '0 auto' }} />
        </div>
        <button
          onClick={() => printBarcodeLabel(label, item.category, ref.current)}
          style={{ width: '100%', padding: '10px', background: '#1a1a25', border: '1px solid #2a2a3a', borderRadius: 10, color: '#f0f0f5', fontSize: '.85rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
        >
          <Printer size={14} /> Print Barcode Label
        </button>
      </div>
    </div>
  )
}
