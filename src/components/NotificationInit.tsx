import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { initFCM, onForegroundMessage } from '@/lib/fcm'
import { clearLocalBadgeState } from '@/hooks/useMarkAllRead'
import { notificationTarget } from '@/lib/notificationLinks'

export default function NotificationInit() {
  const { profile, role } = useAuth()
  const navigate = useNavigate()
  const prevReadAtRef = useRef(0)
  const roleRef = useRef(role)
  roleRef.current = role

  // A push notification was tapped while the app is open: the service worker
  // asks this window to go to the notification's page (and waits for the
  // answer, or it loads the page itself — see firebase-messaging-sw.js)
  useEffect(() => {
    const sw = navigator.serviceWorker
    if (!sw) return
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== 'notification-click') return
      event.ports[0]?.postMessage('ok')
      navigate(notificationTarget(event.data.url, roleRef.current))
    }
    sw.addEventListener('message', onMessage)
    sw.startMessages?.()   // deliver messages queued while the page was loading
    return () => sw.removeEventListener('message', onMessage)
  }, [navigate])

  useEffect(() => {
    if (!profile?.uid) return
    if (!('Notification' in window)) return
    if (Notification.permission === 'denied') return

    if (Notification.permission === 'granted') {
      const id = setTimeout(() => initFCM(profile.uid), 4000)
      return () => clearTimeout(id)
    }
  }, [profile?.uid])

  // Show system notifications when app is in foreground
  useEffect(() => {
    if (!profile?.uid) return
    let unsubscribe: (() => void) | null = null
    onForegroundMessage(payload => {
      const title = payload.data?.title ?? payload.notification?.title ?? 'CineForge'
      const body  = payload.data?.body  ?? payload.notification?.body  ?? ''
      const tag   = payload.data?.tag   ?? 'cineforge'
      if (Notification.permission !== 'granted') return
      navigator.serviceWorker.getRegistration('/firebase-messaging-sw.js').then(reg => {
        if (!reg) return
        reg.showNotification(title, {
          body,
          icon:  '/icons/icon-192.png',
          badge: '/icons/icon-192.png',
          tag,
          data:  payload.data ?? {},
        })
      })
    }).then(unsub => { unsubscribe = unsub })
    return () => { unsubscribe?.() }
  }, [profile?.uid])

  // Cross-device badge clearing: watch lastReadAt on the user doc.
  // When another device calls markAllRead(), lastReadAt increases here,
  // triggering a local clear without any extra user action.
  useEffect(() => {
    if (!profile?.uid) return
    const uid = profile.uid

    const unsub = onSnapshot(doc(db, 'users', uid), snap => {
      const lastReadAt = snap.data()?.lastReadAt?.toMillis?.() ?? 0
      if (lastReadAt > prevReadAtRef.current) {
        prevReadAtRef.current = lastReadAt
        clearLocalBadgeState(uid)
      }
    })
    return unsub
  }, [profile?.uid])

  return null
}
