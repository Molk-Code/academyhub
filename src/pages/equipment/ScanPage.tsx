import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { doc, addDoc, updateDoc, collection, serverTimestamp, onSnapshot, getDocs } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { BrowserMultiFormatReader } from '@zxing/browser'
import { NotFoundException } from '@zxing/library'
import { Scan, Check, X, Wifi, WifiOff, LogIn, AlertTriangle } from 'lucide-react'

const COOLDOWN_MS = 2500 // ms to block re-scan after a successful scan

interface ScanSession {
  projectId: string
  projectName: string
  mode: 'checkout' | 'checkin'
  active: boolean
}

interface ScanEntry { name: string; time: string; ok: boolean }
type CooldownState = { active: false } | { active: true; name: string; ok: boolean; progress: number }

function beep(ok: boolean) {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain); gain.connect(ctx.destination)
    if (ok) {
      osc.frequency.value = 880
      gain.gain.setValueAtTime(0.3, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25)
      osc.start(); osc.stop(ctx.currentTime + 0.25)
    } else {
      osc.frequency.value = 220
      gain.gain.setValueAtTime(0.4, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4)
      osc.start(); osc.stop(ctx.currentTime + 0.4)
    }
  } catch {}
}

export default function ScanPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  const { profile, loading: authLoading } = useAuth()

  const [session, setSession] = useState<ScanSession | null>(null)
  const [sessionLoading, setSessionLoading] = useState(true)
  const [sessionEnded, setSessionEnded] = useState(false)
  const [scanEntries, setScanEntries] = useState<ScanEntry[]>([])
  const [scanActive, setScanActive] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const [cooldown, setCooldown] = useState<CooldownState>({ active: false })

  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<{ stop: () => void } | null>(null)
  const cooldownRef = useRef(false)          // fast ref to block scans during cooldown
  const sessionRef = useRef<ScanSession | null>(null)
  const equipmentCacheRef = useRef<Record<string, string>>({})
  const cooldownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Listen to session doc
  useEffect(() => {
    if (!sessionId) return
    const unsub = onSnapshot(doc(db, 'scan_sessions', sessionId), snap => {
      if (!snap.exists()) { setSessionLoading(false); setSessionEnded(true); return }
      const data = snap.data() as ScanSession
      setSession(data); sessionRef.current = data
      setSessionLoading(false)
      if (!data.active) setSessionEnded(true)
    })
    return unsub
  }, [sessionId])

  // Pre-load equipment name cache
  useEffect(() => {
    getDocs(collection(db, 'equipment')).then(snap => {
      snap.docs.forEach(d => { equipmentCacheRef.current[d.id] = (d.data() as any).name ?? d.id })
    }).catch(() => {})
  }, [])

  // Cooldown: countdown progress from 100 → 0, then unlock
  function startCooldown(name: string, ok: boolean) {
    if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current)
    cooldownRef.current = true
    const start = Date.now()
    setCooldown({ active: true, name, ok, progress: 100 })

    cooldownTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - start
      const remaining = Math.max(0, 1 - elapsed / COOLDOWN_MS) * 100
      if (remaining <= 0) {
        clearInterval(cooldownTimerRef.current!)
        cooldownTimerRef.current = null
        cooldownRef.current = false
        setCooldown({ active: false })
      } else {
        setCooldown({ active: true, name, ok, progress: remaining })
      }
    }, 30)
  }

  useEffect(() => () => {
    if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current)
  }, [])

  const handleScan = useCallback(async (text: string) => {
    if (cooldownRef.current) return
    const sess = sessionRef.current
    if (!sess || !sess.active || !sessionId) return

    const equipmentName = equipmentCacheRef.current[text] ?? text
    let ok = false

    try {
      if (sess.mode === 'checkout') {
        await addDoc(collection(db, `inventory_projects/${sess.projectId}/items`), {
          equipmentId: equipmentCacheRef.current[text] ? text : '',
          equipmentName,
          checkoutTimestamp: new Date().toISOString(),
          checkinTimestamp: '',
          status: 'checked-out',
          damageNotes: '',
          assignedTo: '',
          scannedViaSession: sessionId,
        })
      } else {
        await addDoc(collection(db, `scan_sessions/${sessionId}/checkins`), {
          equipmentName,
          equipmentId: equipmentCacheRef.current[text] ? text : '',
          scannedAt: serverTimestamp(),
        })
      }
      ok = true
    } catch {}

    beep(ok)
    startCooldown(equipmentName, ok)
    setScanEntries(prev => [{ name: equipmentName, time: new Date().toLocaleTimeString(), ok }, ...prev.slice(0, 29)])
  }, [sessionId])

  async function startScanner() {
    setCameraError('')
    setScanActive(true)
    const reader = new BrowserMultiFormatReader()
    try {
      const controls = await reader.decodeFromConstraints(
        { video: { facingMode: 'environment' } },
        videoRef.current!,
        (result, err) => {
          if (result) handleScan(result.getText())
          if (err && !(err instanceof NotFoundException)) { /* silent */ }
        },
      )
      controlsRef.current = controls
    } catch (e: any) {
      setScanActive(false)
      setCameraError(e?.message?.includes('ermission') ? 'Camera permission denied' : 'Could not access camera')
    }
  }

  function stopScanner() {
    controlsRef.current?.stop(); controlsRef.current = null
    setScanActive(false)
  }

  useEffect(() => () => stopScanner(), [])

  // ── Render ────────────────────────────────────────────────────────────────────

  const base: React.CSSProperties = {
    minHeight: '100dvh', background: '#0a0a0f', color: '#f0f0f5',
    fontFamily: 'Inter, system-ui, sans-serif', display: 'flex', flexDirection: 'column',
  }

  if (authLoading || sessionLoading) {
    return (
      <div style={{ ...base, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        <div style={{ width: 32, height: 32, border: '3px solid #2a2a3a', borderTopColor: '#4cd964', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
        <p style={{ color: '#6a6a80', fontSize: '.9rem' }}>Loading session…</p>
      </div>
    )
  }

  if (!profile) {
    return (
      <div style={{ ...base, alignItems: 'center', justifyContent: 'center', gap: 16, padding: '2rem', textAlign: 'center' }}>
        <LogIn size={40} color="#4cd964" />
        <h2 style={{ fontWeight: 700, fontSize: '1.25rem' }}>Sign in required</h2>
        <p style={{ color: '#6a6a80', fontSize: '.9rem' }}>You need to be signed in to use the scanner.</p>
        <button
          onClick={() => navigate(`/login?redirect=/scan/${sessionId}`)}
          style={{ padding: '10px 24px', background: '#4cd964', color: '#000', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: '.9rem', cursor: 'pointer' }}
        >
          Sign in
        </button>
      </div>
    )
  }

  if (sessionEnded || !session) {
    return (
      <div style={{ ...base, alignItems: 'center', justifyContent: 'center', gap: 16, padding: '2rem', textAlign: 'center' }}>
        <WifiOff size={40} color="#6a6a80" />
        <h2 style={{ fontWeight: 700, fontSize: '1.25rem' }}>Session ended</h2>
        <p style={{ color: '#6a6a80', fontSize: '.9rem' }}>This scanning session has been stopped from the desktop.</p>
        <p style={{ fontSize: '.75rem', color: '#4a4a60' }}>You can close this tab.</p>
      </div>
    )
  }

  return (
    <div style={base}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:.4; } }
        @keyframes scaleIn { from { transform: scale(0.6); opacity: 0; } to { transform: scale(1); opacity: 1; } }
      `}</style>

      {/* Header */}
      <div style={{ background: 'rgba(10,10,15,.95)', borderBottom: '1px solid #1a1a25', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: '.95rem', color: '#f0f0f5' }}>Scanner</div>
          <div style={{ fontSize: '.7rem', color: '#6a6a80', marginTop: 1 }}>{session.projectName}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Wifi size={14} color="#4cd964" />
          <span style={{ fontSize: '.75rem', color: '#4cd964', fontWeight: 600 }}>
            {session.mode === 'checkout' ? 'Checkout' : 'Check-in'}
          </span>
        </div>
      </div>

      {/* Camera area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '1rem', gap: '1rem' }}>
        <div style={{ position: 'relative', background: '#000', borderRadius: 12, overflow: 'hidden', aspectRatio: '4/3' }}>
          <video ref={videoRef} style={{ width: '100%', height: '100%', objectFit: 'cover', display: scanActive ? 'block' : 'none' }} />

          {!scanActive && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
              <Scan size={48} color="#2a2a3a" />
              <p style={{ color: '#4a4a60', fontSize: '.85rem' }}>Tap Start to activate camera</p>
            </div>
          )}

          {/* Reticle + scanning indicator (hidden during cooldown) */}
          {scanActive && !cooldown.active && (
            <>
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                <div style={{ width: 200, height: 200, border: '2px solid rgba(76,217,100,.7)', borderRadius: 12, boxShadow: '0 0 0 9999px rgba(0,0,0,.35)' }} />
              </div>
              <div style={{ position: 'absolute', top: 12, left: 12, display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(0,0,0,.6)', borderRadius: 20, padding: '4px 10px' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#4cd964', animation: 'pulse 1.2s ease-in-out infinite', flexShrink: 0 }} />
                <span style={{ fontSize: '.7rem', color: '#4cd964', fontWeight: 700 }}>Scanning…</span>
              </div>
            </>
          )}

          {/* ── Scan confirmation overlay ── */}
          {cooldown.active && (
            <div style={{
              position: 'absolute', inset: 0,
              background: cooldown.ok ? 'rgba(0,20,0,.92)' : 'rgba(30,0,0,.92)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12,
            }}>
              {/* Big icon */}
              <div style={{
                width: 80, height: 80, borderRadius: '50%',
                background: cooldown.ok ? 'rgba(76,217,100,.2)' : 'rgba(239,68,68,.2)',
                border: `3px solid ${cooldown.ok ? '#4cd964' : '#f87171'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                animation: 'scaleIn .2s ease-out',
              }}>
                {cooldown.ok
                  ? <Check size={40} color="#4cd964" strokeWidth={3} />
                  : <AlertTriangle size={36} color="#f87171" strokeWidth={2.5} />
                }
              </div>

              {/* Item name */}
              <p style={{ fontWeight: 700, fontSize: '1.1rem', color: '#f0f0f5', textAlign: 'center', padding: '0 24px', lineHeight: 1.3, animation: 'scaleIn .25s ease-out' }}>
                {cooldown.name}
              </p>
              <p style={{ fontSize: '.75rem', color: cooldown.ok ? '#4cd964' : '#f87171', fontWeight: 600 }}>
                {cooldown.ok ? (session.mode === 'checkout' ? 'Checked out' : 'Checked in') : 'Failed — try again'}
              </p>

              {/* Progress bar: drains left-to-right over COOLDOWN_MS */}
              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 4, background: 'rgba(255,255,255,.1)' }}>
                <div style={{
                  height: '100%',
                  width: `${cooldown.progress}%`,
                  background: cooldown.ok ? '#4cd964' : '#f87171',
                  transition: 'width 30ms linear',
                  borderRadius: '0 2px 2px 0',
                }} />
              </div>
            </div>
          )}
        </div>

        {cameraError && (
          <div style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 10, padding: '10px 14px', fontSize: '.8rem', color: '#f87171', display: 'flex', alignItems: 'center', gap: 6 }}>
            <X size={14} />{cameraError}
          </div>
        )}

        {/* Start / Stop */}
        {!scanActive ? (
          <button
            onClick={startScanner}
            style={{ padding: '14px', background: '#4cd964', border: 'none', borderRadius: 12, color: '#000', fontWeight: 700, fontSize: '1rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          >
            <Scan size={20} /> Start Scanning
          </button>
        ) : (
          <button
            onClick={stopScanner}
            style={{ padding: '14px', background: '#1a1a25', border: '1px solid #2a2a3a', borderRadius: 12, color: '#f0f0f5', fontWeight: 700, fontSize: '1rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          >
            Stop Camera
          </button>
        )}

        {/* Recent scans */}
        {scanEntries.length > 0 && (
          <div style={{ background: '#0e0e16', border: '1px solid #1a1a25', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '8px 12px', borderBottom: '1px solid #1a1a25', fontSize: '.7rem', fontWeight: 700, color: '#4a4a60', textTransform: 'uppercase', letterSpacing: '.08em' }}>
              Scanned this session ({scanEntries.length})
            </div>
            <div style={{ maxHeight: 200, overflowY: 'auto' }}>
              {scanEntries.map((e, i) => (
                <div key={i} style={{ padding: '8px 12px', borderBottom: i < scanEntries.length - 1 ? '1px solid #1a1a25' : 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
                  {e.ok
                    ? <Check size={14} color="#4cd964" style={{ flexShrink: 0 }} />
                    : <X size={14} color="#f87171" style={{ flexShrink: 0 }} />
                  }
                  <span style={{ flex: 1, fontSize: '.85rem', color: e.ok ? '#f0f0f5' : '#f87171', fontWeight: i === 0 ? 700 : 400 }}>{e.name}</span>
                  <span style={{ fontSize: '.7rem', color: '#4a4a60' }}>{e.time}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
