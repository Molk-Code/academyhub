import { useState, useEffect, useCallback, useRef } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import {
  collection, addDoc, updateDoc, doc, serverTimestamp, Timestamp, onSnapshot,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { nanoid } from 'nanoid'
import { X, Users, RefreshCw, Wifi, WifiOff, Monitor, ChevronDown, ExternalLink } from 'lucide-react'
import type { AttendanceRecordDoc, QrDisplayDeviceDoc } from '@/types'

const SESSION_SECS = 30

export default function AttendancePanel({
  lessonId,
  lessonTitle,
  visible = true,
  onClose,
  onDismiss,
  onExternalStart,
  onExternalStop,
}: {
  lessonId: string
  lessonTitle: string
  visible?: boolean
  onClose: () => void
  onDismiss?: () => void
  onExternalStart?: (deviceName: string) => void
  onExternalStop?: () => void
}) {
  const { profile } = useAuth()

  const [isActive,  setIsActive]  = useState(false)
  const [token,     setToken]     = useState('')
  const [countdown, setCountdown] = useState(SESSION_SECS)
  const [attendees, setAttendees] = useState<AttendanceRecordDoc[]>([])
  const sessionIdRef = useRef<string | null>(null)

  const isActiveRef = useRef(false)
  const deviceIdRef = useRef<string | undefined>(undefined)

  const [devices,          setDevices]          = useState<QrDisplayDeviceDoc[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState('')
  const [showDevicePicker, setShowDevicePicker] = useState(false)
  const [activeDeviceName, setActiveDeviceName] = useState('')

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'qr_display_devices'),
      snap => setDevices(
        snap.docs
          .filter(d => d.data().isActive !== false)
          .map(d => ({ id: d.id, ...d.data() }) as QrDisplayDeviceDoc),
      ),
    )
    return unsub
  }, [])

  const generateToken = useCallback(async () => {
    if (!profile || !isActiveRef.current) return
    const deviceId  = deviceIdRef.current
    const newToken  = nanoid(32)
    const expiresAt = Timestamp.fromMillis(Date.now() + SESSION_SECS * 1000)

    if (sessionIdRef.current) {
      try { await updateDoc(doc(db, 'attendance_sessions', sessionIdRef.current), { isActive: false }) } catch {}
    }

    if (!isActiveRef.current) return

    const ref = await addDoc(collection(db, 'attendance_sessions'), {
      lessonId,
      token:           newToken,
      expiresAt,
      createdBy:       profile.uid,
      isActive:        true,
      createdAt:       serverTimestamp(),
      displayDeviceId: deviceId ?? null,
    })

    sessionIdRef.current = ref.id
    setToken(newToken)
    setCountdown(SESSION_SECS)

    if (deviceId) {
      await updateDoc(doc(db, 'qr_display_devices', deviceId), {
        activeToken:    newToken,
        tokenExpiresAt: expiresAt,
        activeLessonId: lessonId,
      })
    }
  }, [profile, lessonId])

  useEffect(() => {
    if (!isActive) return
    const tick = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) { generateToken(); return SESSION_SECS }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(tick)
  }, [isActive, generateToken])

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'lessons', lessonId, 'attendance'),
      snap => setAttendees(snap.docs.map(d => d.data() as AttendanceRecordDoc)),
    )
    return unsub
  }, [lessonId])

  async function startAttendance(deviceId?: string) {
    isActiveRef.current = true
    deviceIdRef.current = deviceId
    setIsActive(true)
    if (deviceId) {
      const device = devices.find(d => d.id === deviceId)
      const name = device?.name ?? ''
      setActiveDeviceName(name)
      onExternalStart?.(name)
    }
    await generateToken()
  }

  async function stopAttendance() {
    isActiveRef.current = false
    const deviceId = deviceIdRef.current
    deviceIdRef.current = undefined
    setIsActive(false)
    setActiveDeviceName('')
    onExternalStop?.()

    if (sessionIdRef.current) {
      try { await updateDoc(doc(db, 'attendance_sessions', sessionIdRef.current), { isActive: false }) } catch {}
      sessionIdRef.current = null
    }

    if (deviceId) {
      await updateDoc(doc(db, 'qr_display_devices', deviceId), {
        activeToken:    null,
        tokenExpiresAt: null,
        activeLessonId: null,
      })
    }
  }

  // Stop + fully close
  async function handleStopAndClose() {
    await stopAttendance()
    onClose()
  }

  // X button / backdrop: if external device is active, just hide; otherwise stop + close
  function handleDismissOrClose() {
    if (activeDeviceName && onDismiss) {
      onDismiss()
    } else {
      handleStopAndClose()
    }
  }

  const pct = countdown / SESSION_SECS
  const qrDisplayUrl = `${window.location.origin}/qr-display?device=${selectedDeviceId}`

  // Component stays mounted when hidden so intervals/listeners keep running
  if (!visible) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={handleDismissOrClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/8">
          <div className="min-w-0">
            <p className="font-bold text-zinc-100">Attendance</p>
            <p className="text-xs text-zinc-500 truncate">{lessonTitle}</p>
          </div>
          <button onClick={handleDismissOrClose} className="p-1.5 ml-3 flex-shrink-0 text-zinc-400 hover:text-zinc-300 rounded-lg transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {!isActive ? (
            <div className="text-center space-y-3">
              <div className="w-14 h-14 bg-brand-50 rounded-full flex items-center justify-center mx-auto">
                <Wifi className="w-7 h-7 text-brand-500" />
              </div>
              <p className="text-sm text-zinc-500">Generate a rotating QR code for students to scan and check in.</p>

              <button onClick={() => startAttendance()} className="btn-primary py-2.5 px-6 mx-auto">
                Start Attendance
              </button>

              <div className="pt-1 border-t border-white/8 space-y-2">
                <button
                  onClick={() => setShowDevicePicker(v => !v)}
                  className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors mx-auto"
                >
                  <Monitor className="w-3.5 h-3.5" />
                  Start on External Device
                  <ChevronDown className={`w-3 h-3 transition-transform ${showDevicePicker ? 'rotate-180' : ''}`} />
                </button>

                {showDevicePicker && (
                  <div className="space-y-2">
                    {devices.length === 0 ? (
                      <p className="text-xs text-zinc-500 text-center py-1">
                        No devices configured.{' '}
                        <a href="/admin/qr-devices" target="_blank" rel="noopener noreferrer" className="underline hover:text-zinc-300">Add one</a>
                      </p>
                    ) : (
                      <>
                        <select
                          value={selectedDeviceId}
                          onChange={e => setSelectedDeviceId(e.target.value)}
                          className="input w-full text-sm py-1.5"
                        >
                          <option value="">Select device…</option>
                          {devices.map(d => (
                            <option key={d.id} value={d.id}>{d.name}</option>
                          ))}
                        </select>
                        <button
                          onClick={() => selectedDeviceId && startAttendance(selectedDeviceId)}
                          disabled={!selectedDeviceId}
                          className="btn-secondary py-2 px-4 text-sm w-full flex items-center justify-center gap-1.5 disabled:opacity-40"
                        >
                          <Monitor className="w-3.5 h-3.5" />
                          Send to Device
                        </button>
                      </>
                    )}
                    <a href="/admin/qr-devices" target="_blank" rel="noopener noreferrer" className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors block text-center">
                      ⚙ Manage devices
                    </a>
                  </div>
                )}
              </div>

              {attendees.length > 0 && (
                <p className="text-xs text-zinc-400">{attendees.length} already checked in this session</p>
              )}
            </div>
          ) : (
            <>
              {activeDeviceName && (
                <div className="space-y-3">
                  <div className="flex items-center gap-3 bg-violet-900/30 border border-violet-700/40 rounded-xl px-4 py-3">
                    <Monitor className="w-4 h-4 text-violet-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-violet-200">Displaying on {activeDeviceName}</p>
                    </div>
                    <a href={qrDisplayUrl} target="_blank" rel="noopener noreferrer" className="text-violet-400 hover:text-violet-300 flex-shrink-0" title="Open QR display">
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </div>
                  <p className="text-xs text-zinc-500 text-center">
                    Closing this window keeps the session running.
                  </p>
                </div>
              )}

              {!activeDeviceName && (
                <div className="flex flex-col items-center gap-3">
                  <div className="bg-zinc-900 rounded-xl border-2 border-white/10 p-3 shadow-sm">
                    <QRCodeSVG value={token} size={200} level="H" />
                  </div>
                  <div className="w-full space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1 text-zinc-400"><RefreshCw className="w-3 h-3" /> Refreshes in</span>
                      <span className={`font-bold tabular-nums ${countdown <= 5 ? 'text-rose-500' : 'text-zinc-300'}`}>{countdown}s</span>
                    </div>
                    <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-1000 ease-linear ${countdown <= 5 ? 'bg-rose-500' : 'bg-brand-500'}`}
                        style={{ width: `${pct * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
              )}

              <button onClick={handleStopAndClose} className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-rose-500 transition-colors mx-auto">
                <WifiOff className="w-3.5 h-3.5" /> Stop attendance
              </button>
            </>
          )}

          <div>
            <div className="flex items-center gap-2 mb-2">
              <Users className="w-4 h-4 text-zinc-400" />
              <p className="text-sm font-semibold text-zinc-300">
                Checked in <span className="text-brand-600 font-bold">{attendees.length}</span>
              </p>
            </div>
            {attendees.length === 0 ? (
              <p className="text-sm text-zinc-400 text-center py-4 bg-zinc-900/50 rounded-xl">
                {isActive ? 'Waiting for students to scan…' : 'No check-ins yet.'}
              </p>
            ) : (
              <div className="space-y-1 max-h-44 overflow-y-auto">
                {[...attendees]
                  .sort((a, b) => (a.checkedInAt?.toMillis?.() ?? 0) - (b.checkedInAt?.toMillis?.() ?? 0))
                  .map(a => (
                    <div key={a.studentId} className="flex items-center gap-3 px-3 py-2 bg-emerald-950/40 rounded-lg border border-emerald-800/50">
                      <div className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
                      <p className="text-sm text-zinc-200 font-medium flex-1">{a.displayName}</p>
                      <p className="text-xs text-zinc-400 tabular-nums">
                        {a.checkedInAt?.toDate?.()?.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
