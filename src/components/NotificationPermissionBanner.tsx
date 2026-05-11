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

  if (status === 'ok') {
    return (
      <div className="flex items-center gap-3 bg-emerald-600 text-white px-4 py-2 text-sm">
        <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
        <span className="flex-1 text-xs">Push notifications active on this device.</span>
        <button onClick={dismiss} className="p-1 hover:bg-white/20 rounded-lg transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>
    )
  }

  if (status === 'denied') {
    return (
      <div className="flex items-center gap-3 bg-slate-600 text-white px-4 py-2 text-sm">
        <BellOff className="w-4 h-4 flex-shrink-0" />
        <span className="flex-1 text-xs">Notifications blocked. Enable them in your browser/device settings, then reload.</span>
        <button onClick={dismiss} className="p-1 hover:bg-white/20 rounded-lg transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="flex items-center gap-3 bg-rose-600 text-white px-4 py-2 text-sm">
        <AlertCircle className="w-4 h-4 flex-shrink-0" />
        <span className="flex-1 text-xs">Push setup failed: {errorMsg}. Try reloading.</span>
        <button onClick={enable} className="bg-zinc-900 text-rose-700 font-semibold text-xs px-3 py-1 rounded-lg hover:bg-rose-50 flex-shrink-0">
          Retry
        </button>
        <button onClick={dismiss} className="p-1 hover:bg-white/20 rounded-lg transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>
    )
  }

  // Default: ask to enable (status === 'idle' or 'asking')
  return (
    <div className="flex items-center gap-3 bg-brand-600 text-white px-4 py-2.5 text-sm">
      <Bell className="w-4 h-4 flex-shrink-0" />
      <span className="flex-1 text-xs">Enable push notifications to get booking and chat updates.</span>
      <button
        onClick={enable}
        disabled={status === 'asking'}
        className="bg-zinc-900 text-brand-700 font-semibold text-xs px-3 py-1 rounded-lg hover:bg-brand-50 transition-colors disabled:opacity-60 flex-shrink-0"
      >
        {status === 'asking' ? 'Enabling…' : 'Enable'}
      </button>
      <button onClick={dismiss} className="p-1 hover:bg-white/20 rounded-lg transition-colors flex-shrink-0">
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}
