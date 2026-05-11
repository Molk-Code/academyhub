import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { collection, query, where, onSnapshot, doc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'
import { usePwaInstall } from '@/hooks/usePwaInstall'
import type { QrDisplayDeviceDoc } from '@/types'

const SESSION_SECS = 30

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !(window as any).MSStream
}

function isInStandaloneMode() {
  return window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true
}

// ── Shared install banner ─────────────────────────────────────────────────────

function InstallBanner() {
  const { canInstall, install } = usePwaInstall()
  const [showIos, setShowIos] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (!isInStandaloneMode() && isIos()) setShowIos(true)
  }, [])

  if (dismissed || isInStandaloneMode()) return null

  if (canInstall) {
    return (
      <div className="flex items-center justify-center gap-3 py-3 px-6 bg-zinc-900 border-t border-white/10">
        <button
          onClick={install}
          className="flex items-center gap-2 px-5 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-sm font-bold transition-colors"
        >
          <span>📲</span> Add to Home Screen
        </button>
        <button onClick={() => setDismissed(true)} className="text-gray-600 hover:text-gray-400 text-xs">Dismiss</button>
      </div>
    )
  }

  if (showIos) {
    return (
      <div className="flex items-center justify-between gap-4 py-3 px-6 bg-zinc-900 border-t border-white/10">
        <p className="text-gray-400 text-sm">
          <span className="text-white font-bold">Add to Home Screen:</span>{' '}
          tap <span className="text-brand-400 font-bold">Share ↑</span> then{' '}
          <span className="text-brand-400 font-bold">Add to Home Screen</span>
        </p>
        <button onClick={() => setDismissed(true)} className="text-gray-600 hover:text-gray-400 text-xs flex-shrink-0">✕</button>
      </div>
    )
  }

  return null
}

// ── Device selector ───────────────────────────────────────────────────────────

function DeviceSelector() {
  const [devices, setDevices] = useState<QrDisplayDeviceDoc[]>([])
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'qr_display_devices'), where('isActive', '==', true)),
      snap => setDevices(snap.docs.map(d => ({ id: d.id, ...d.data() }) as QrDisplayDeviceDoc)),
    )
    return unsub
  }, [])

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      <div className="px-10 pt-10 pb-6 flex items-start justify-between border-b border-white/10">
        <div>
          <p className="text-gray-400 text-lg font-medium tracking-widest uppercase mb-1">
            {format(now, 'EEEE, d MMMM yyyy')}
          </p>
          <h1 className="text-5xl font-black tracking-tight">QR DISPLAY</h1>
          <p className="text-gray-500 text-lg mt-2">Select a device to show attendance QR codes</p>
        </div>
        <div className="text-right">
          <p className="text-5xl font-mono font-bold tabular-nums">{format(now, 'HH:mm')}</p>
          <p className="text-gray-500 text-sm mt-1 uppercase tracking-widest">Local time</p>
        </div>
      </div>
      <div className="flex-1 px-10 py-10">
        {devices.length === 0 ? (
          <p className="text-gray-600 text-2xl text-center mt-16">No active display devices configured.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-4xl">
            {devices.map(device => (
              <a
                key={device.id}
                href={`/qr-display?device=${device.id}`}
                className="block rounded-2xl border border-white/10 bg-zinc-900/50 hover:bg-zinc-800/60 hover:border-brand-500/40 transition-all p-8"
              >
                <div className="text-5xl mb-4">📺</div>
                <h2 className="text-2xl font-black text-white">{device.name}</h2>
                <p className="text-gray-500 text-sm mt-2 tracking-widest uppercase">Open display →</p>
              </a>
            ))}
          </div>
        )}
      </div>
      <p className="text-center text-gray-700 text-xs pb-4 tracking-widest uppercase">CineForge · Attendance QR Display</p>
    </div>
  )
}

// ── Single device display ─────────────────────────────────────────────────────

function QrDeviceDisplay({ deviceId }: { deviceId: string }) {
  const [now, setNow] = useState(new Date())
  const [device, setDevice] = useState<QrDisplayDeviceDoc | null>(null)
  const [attendeeCount, setAttendeeCount] = useState(0)
  const [pulse, setPulse] = useState(false)

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  // Single document listener — no queries, no indexes needed
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'qr_display_devices', deviceId), snap => {
      if (snap.exists()) setDevice({ id: snap.id, ...snap.data() } as QrDisplayDeviceDoc)
      else setDevice(null)
    })
    return unsub
  }, [deviceId])

  // Attendee count for the active lesson
  useEffect(() => {
    const lessonId = device?.activeLessonId
    if (!lessonId) { setAttendeeCount(0); return }
    const unsub = onSnapshot(
      collection(db, 'lessons', lessonId, 'attendance'),
      snap => setAttendeeCount(snap.size),
    )
    return unsub
  }, [device?.activeLessonId])

  // Pulsing idle animation
  useEffect(() => {
    if (device?.activeToken) return
    const id = setInterval(() => setPulse(p => !p), 1500)
    return () => clearInterval(id)
  }, [device?.activeToken])

  const hasSession  = !!device?.activeToken
  const expiresMs   = device?.tokenExpiresAt?.toMillis?.() ?? 0
  const countdown   = Math.max(0, Math.ceil((expiresMs - now.getTime()) / 1000))
  const pct         = Math.min(1, countdown / SESSION_SECS)
  const deviceName  = device?.name ?? 'QR DISPLAY'

  if (!hasSession) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex flex-col">
        {/* Compact header */}
        <div className="px-8 pt-6 pb-4 flex items-center justify-between border-b border-white/10 flex-shrink-0">
          <div>
            <p className="text-gray-400 text-sm font-medium tracking-widest uppercase">{format(now, 'EEEE, d MMMM yyyy')}</p>
            <h1 className="text-3xl font-black tracking-tight mt-0.5">{deviceName}</h1>
          </div>
          <p className="text-4xl font-mono font-bold tabular-nums">{format(now, 'HH:mm')}</p>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-8">
          <div className={cn(
            'w-32 h-32 rounded-3xl flex items-center justify-center transition-all duration-1000',
            pulse ? 'bg-brand-500/20 scale-105' : 'bg-brand-500/5 scale-100',
          )}>
            <span className="text-6xl">📱</span>
          </div>
          <div className="text-center space-y-3">
            <p className={cn('text-5xl font-black transition-opacity duration-1000', pulse ? 'opacity-100' : 'opacity-40')}>
              WAITING FOR SESSION
            </p>
            <p className="text-gray-500 text-xl">A teacher will start attendance shortly</p>
          </div>
        </div>
        <InstallBanner />
        <p className="text-center text-gray-700 text-xs pb-4 tracking-widest uppercase">CineForge · Attendance QR Display</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      {/* Compact header */}
      <div className="px-8 pt-6 pb-4 flex items-center justify-between border-b border-white/10 flex-shrink-0">
        <div>
          <p className="text-gray-400 text-sm font-medium tracking-widest uppercase">{format(now, 'EEEE, d MMMM yyyy')}</p>
          <h1 className="text-3xl font-black tracking-tight mt-0.5">{deviceName}</h1>
        </div>
        <div className="text-right">
          <p className="text-4xl font-mono font-bold tabular-nums">{format(now, 'HH:mm')}</p>
          {/* Progress bar in header */}
          <div className="flex items-center gap-2 mt-1 justify-end">
            <div className="w-28 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className={cn('h-full rounded-full transition-all duration-1000 ease-linear', countdown <= 5 ? 'bg-rose-500' : 'bg-brand-500')}
                style={{ width: `${pct * 100}%` }}
              />
            </div>
            <span className={cn('font-mono text-xs font-bold tabular-nums w-6', countdown <= 5 ? 'text-rose-400' : 'text-gray-400')}>
              {countdown}s
            </span>
          </div>
        </div>
      </div>

      {/* QR code — fills remaining space */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-4 gap-4">
        <div className="bg-white rounded-3xl shadow-2xl p-4" style={{ width: 'min(80vmin, 680px)', height: 'min(80vmin, 680px)' }}>
          <QRCodeSVG
            value={device.activeToken!}
            size={undefined as any}
            level="H"
            style={{ width: '100%', height: '100%' }}
          />
        </div>

        {/* Attendee count + scan hint below the code */}
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3 bg-emerald-900/30 border border-emerald-700/40 rounded-2xl px-6 py-3">
            <span className="text-emerald-400 text-3xl font-black tabular-nums">{attendeeCount}</span>
            <span className="text-emerald-300 text-base font-semibold">checked in</span>
          </div>
          <p className="text-gray-600 text-sm uppercase tracking-widest">Scan with CineForge to check in</p>
        </div>
      </div>

      <InstallBanner />
      <p className="text-center text-gray-700 text-xs pb-3 tracking-widest uppercase">CineForge · Attendance QR Display</p>
    </div>
  )
}

// ── Root ──────────────────────────────────────────────────────────────────────

export default function QrDisplay() {
  const [searchParams] = useSearchParams()
  const deviceId = searchParams.get('device')
  if (deviceId) return <QrDeviceDisplay deviceId={deviceId} />
  return <DeviceSelector />
}
