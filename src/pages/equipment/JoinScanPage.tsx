import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { startCameraScan, type ScanControls } from '@/lib/cameraScanner'
import { scanSessionIdFrom } from '@/lib/scanSessionLink'
import { Scan, LogIn, X } from 'lucide-react'

// /scan: join a desktop's scanning session from inside the app. Opened from
// the installed app (home-screen shortcut or Inventory → "Use this phone as
// scanner"), which is already signed in, so the phone needn't sign in again in
// the browser that its camera app would open.
export default function JoinScanPage() {
  const navigate = useNavigate()
  const { profile, loading } = useAuth()
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<ScanControls | null>(null)
  const [active, setActive] = useState(false)
  const [message, setMessage] = useState('')

  function stop() {
    controlsRef.current?.stop(); controlsRef.current = null
    setActive(false)
  }

  async function start() {
    setMessage('')
    setActive(true)
    try {
      controlsRef.current = await startCameraScan(videoRef.current!, 'qr', text => {
        const id = scanSessionIdFrom(text)
        if (!id) { setMessage('That isn’t a scanning-session code. Scan the QR code shown on the computer.'); return }
        stop()
        navigate(`/scan/${id}`)
      })
    } catch (e: any) {
      setActive(false)
      setMessage(e?.message?.includes('ermission') ? 'Camera permission denied' : 'Could not access camera')
    }
  }

  useEffect(() => () => controlsRef.current?.stop(), [])

  const base: React.CSSProperties = {
    minHeight: '100dvh', background: '#0a0a0f', color: '#f0f0f5', fontFamily: 'Inter, system-ui, sans-serif',
    display: 'flex', flexDirection: 'column', padding: '1rem', gap: '1rem', maxWidth: 520, margin: '0 auto',
  }
  const primary: React.CSSProperties = {
    padding: '14px', background: '#4cd964', border: 'none', borderRadius: 12, color: '#000', fontWeight: 700,
    fontSize: '1rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  }

  if (loading) return <div style={base} />

  if (!profile) {
    return (
      <div style={{ ...base, alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
        <LogIn size={40} color="#4cd964" />
        <h1 style={{ fontWeight: 700, fontSize: '1.25rem' }}>Sign in required</h1>
        <button onClick={() => navigate('/login?redirect=/scan')} style={{ ...primary, padding: '10px 24px' }}>Sign in</button>
      </div>
    )
  }

  return (
    <div style={base}>
      <div>
        <h1 style={{ fontWeight: 700, fontSize: '1.1rem' }}>Use this phone as scanner</h1>
        <p style={{ color: '#8a8aab', fontSize: '.85rem', marginTop: 4 }}>
          On the computer, open the project and choose the phone scanner. Then scan the QR code it shows.
        </p>
      </div>

      <div style={{ position: 'relative', background: '#000', borderRadius: 12, overflow: 'hidden', aspectRatio: '1/1' }}>
        <video ref={videoRef} playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', display: active ? 'block' : 'none' }} />
        {!active && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Scan size={48} color="#2a2a3a" aria-hidden="true" />
          </div>
        )}
      </div>

      {message && (
        <p role="alert" style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 10, padding: '10px 14px', fontSize: '.8rem', color: '#f87171', display: 'flex', alignItems: 'center', gap: 6 }}>
          <X size={14} aria-hidden="true" /> {message}
        </p>
      )}

      {active
        ? <button onClick={stop} style={{ ...primary, background: '#1a1a25', border: '1px solid #2a2a3a', color: '#f0f0f5' }}>Stop camera</button>
        : <button onClick={start} style={primary}><Scan size={20} aria-hidden="true" /> Scan the computer’s QR code</button>}
    </div>
  )
}
