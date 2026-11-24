import { useState, useEffect } from 'react'
import { Bell, BellOff, CheckCircle2, X, AlertCircle } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { initFCM, fcmIsRegistered } from '@/lib/fcm'

const dismissedKey = (uid: string) => `notifBannerDismissed:${uid}`

export default function NotificationPermissionBanner() {
  const { profile } = useAuth()
  const uid = profile?.uid

  const [status, setStatus] = useState<'hidden' | 'idle' | 'asking' | 'ok' | 'error' | 'denied' | 'unsupported'>('hidden')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    if (!uid) return
    if (localStorage.getItem(dismissedKey(uid))) { setStatus('hidden'); return }
    if (!('Notification' in window)) { setStatus('unsupported'); return }
    if (Notification.permission === 'denied') { setStatus('denied'); return }
    if (fcmIsRegistered(uid)) { setStatus('ok'); return }
    setStatus('idle')
  }, [uid])

  if (status === 'hidden') return null
  if (status === 'unsupported') return null

  async function enable() {
    if (!uid) return
    setStatus('asking')
    const result = await initFCM(uid)
    if (result === 'ok') {
      setStatus('ok')
    } else if (result === 'denied') {
      setStatus('denied')
    } else {
      setStatus('error')
      setErrorMsg(result)
    }
  }

  function dismiss() {
    if (uid) localStorage.setItem(dismissedKey(uid), '1')
    setStatus('hidden')
  }

  // A quiet card, not a full-width orange bar: it sits above every page
  const shell = 'mx-4 mt-3 sm:mx-6 lg:mx-8 flex items-center gap-3 rounded-xl border px-3 py-2 text-sm'
  const close = (
    <button onClick={dismiss} aria-label="Dismiss" className="touch-target p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition-colors flex-shrink-0">
      <X className="w-4 h-4" />
    </button>
  )

  if (status === 'ok') {
    return (
      <div role="status" className={`${shell} border-white/[0.08] bg-[var(--bg-surface)] text-zinc-300`}>
        <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-emerald-300" aria-hidden="true" />
        <span className="flex-1">Push notifications are on for this device.</span>
        {close}
      </div>
    )
  }

  if (status === 'denied') {
    return (
      <div className={`${shell} border-white/[0.08] bg-[var(--bg-surface)] text-zinc-300`}>
        <BellOff className="w-4 h-4 flex-shrink-0 text-zinc-400" aria-hidden="true" />
        <span className="flex-1">Notifications are blocked. Allow them in your browser or device settings, then reload.</span>
        {close}
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div role="alert" className={`${shell} border-[rgba(255,180,171,0.35)] bg-[rgba(255,180,171,0.08)] text-zinc-200`}>
        <AlertCircle className="w-4 h-4 flex-shrink-0 text-[#ffb4ab]" aria-hidden="true" />
        <span className="flex-1">Couldn't turn on notifications: {errorMsg}</span>
        <button onClick={enable} className="btn-secondary min-h-[40px] text-sm flex-shrink-0">Try again</button>
        {close}
      </div>
    )
  }

  // Default: offer to turn them on (status === 'idle' or 'asking')
  return (
    <div className={`${shell} border-white/[0.08] bg-[var(--bg-surface)] text-zinc-300`}>
      <Bell className="w-4 h-4 flex-shrink-0 text-zinc-400" aria-hidden="true" />
      <span className="flex-1">Get a notification when bookings change or someone messages you.</span>
      <button
        onClick={enable}
        disabled={status === 'asking'}
        className="btn-secondary min-h-[40px] text-sm flex-shrink-0 disabled:opacity-60"
      >
        {status === 'asking' ? 'Turning on…' : 'Turn on'}
      </button>
      {close}
    </div>
  )
}
