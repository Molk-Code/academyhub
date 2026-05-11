import { useEffect, useRef } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { initFCM, onForegroundMessage } from '@/lib/fcm'
import { clearLocalBadgeState } from '@/hooks/useMarkAllRead'

export default function NotificationInit() {
  const { profile } = useAuth()
  const prevReadAtRef = useRef(0)

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
