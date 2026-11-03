import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, Package } from 'lucide-react'

export const SCAN_FLASH_MS = 1000

export interface ScanFlashData {
  name: string
  imageUrl?: string | null
  label: string               // e.g. "Checked out"
  warn?: boolean
}

// Shows the last scanned item for SCAN_FLASH_MS. A new scan replaces it at
// once and restarts the timer, so the newest item always gets its full second.
export function useScanFlash() {
  const [flash, setFlash] = useState<(ScanFlashData & { key: number }) | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const show = useCallback((data: ScanFlashData) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setFlash({ ...data, key: Date.now() + Math.random() })
    timerRef.current = setTimeout(() => setFlash(null), SCAN_FLASH_MS)
  }, [])
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])
  return { flash, show }
}

const KEYFRAMES = `
@keyframes scan-flash-in{0%{transform:scale(.7);opacity:0}60%{transform:scale(1.04);opacity:1}100%{transform:scale(1)}}
@keyframes scan-flash-bar{from{transform:scaleX(1)}to{transform:scaleX(0)}}
`

export function ScanFlash({ flash }: { flash: (ScanFlashData & { key: number }) | null }) {
  if (!flash) return null
  const accent = flash.warn ? '#f5a623' : '#4cd964'
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', padding: 16 }}>
      <style>{KEYFRAMES}</style>
      {/* key remounts the card so every scan replays the animation */}
      <div
        key={flash.key}
        style={{
          width: 'min(320px, 100%)', background: 'rgba(14,14,22,.96)', border: `2px solid ${accent}`,
          borderRadius: 18, overflow: 'hidden', boxShadow: `0 20px 60px rgba(0,0,0,.6), 0 0 40px ${accent}33`,
          animation: 'scan-flash-in .22s ease-out', textAlign: 'center',
        }}
      >
        <div style={{ aspectRatio: '4/3', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {flash.imageUrl
            ? <img src={flash.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            : <Package size={64} color="#9a9ab0" />}
        </div>
        <div style={{ padding: '12px 16px 14px' }}>
          <div style={{ fontWeight: 700, fontSize: '1.1rem', color: '#f0f0f5', lineHeight: 1.3 }}>{flash.name}</div>
          <div style={{ marginTop: 4, fontSize: '.8rem', fontWeight: 700, color: accent, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {flash.warn ? <AlertTriangle size={14} /> : <Check size={14} strokeWidth={3} />} {flash.label}
          </div>
        </div>
        <div style={{ height: 4, background: accent, transformOrigin: 'left', animation: `scan-flash-bar ${SCAN_FLASH_MS}ms linear forwards` }} />
      </div>
    </div>
  )
}

export interface NotInProjectData {
  name: string
  imageUrl?: string | null
  known: boolean                  // the code matched an item in the equipment list
  otherProjects: string[] | null  // null = still looking
}

// Check-in of something that isn't checked out in this project.
export function NotInProjectModal({ data, onClose }: { data: NotInProjectData; onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 1001, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <style>{KEYFRAMES}</style>
      <div
        onClick={e => e.stopPropagation()}
        role="alertdialog"
        style={{
          width: 'min(380px, 100%)', background: '#14141e', border: '2px solid #f87171', borderRadius: 18,
          padding: 20, textAlign: 'center', animation: 'scan-flash-in .22s ease-out', color: '#f0f0f5',
        }}
      >
        <div style={{ width: 56, height: 56, margin: '0 auto 12px', borderRadius: '50%', background: 'rgba(239,68,68,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <AlertTriangle size={28} color="#f87171" />
        </div>
        {data.imageUrl && (
          <img src={data.imageUrl} alt="" style={{ width: 96, height: 72, objectFit: 'contain', background: '#fff', borderRadius: 8, margin: '0 auto 10px', display: 'block' }} />
        )}
        <div style={{ fontWeight: 700, fontSize: '1.05rem' }}>{data.name}</div>
        <p style={{ fontSize: '.9rem', color: '#f87171', fontWeight: 600, margin: '8px 0 0' }}>
          {data.known ? 'This item is not checked out in this project.' : 'This code is not in the equipment list.'}
        </p>
        {data.known && (
          <p style={{ fontSize: '.85rem', color: '#a0a0b8', margin: '8px 0 0', lineHeight: 1.45 }}>
            {data.otherProjects === null
              ? 'Looking in other projects…'
              : data.otherProjects.length > 0
                ? <>It is checked out in <strong style={{ color: '#f0f0f5' }}>{data.otherProjects.join(', ')}</strong>. Check it in there.</>
                : 'Check other projects — it is not checked out in any active project.'}
          </p>
        )}
        <button
          type="button"
          onClick={onClose}
          style={{ marginTop: 16, width: '100%', padding: '10px', background: '#2a2a3a', border: 'none', borderRadius: 10, color: '#f0f0f5', fontWeight: 700, fontSize: '.9rem', cursor: 'pointer' }}
        >
          OK
        </button>
      </div>
    </div>
  )
}
