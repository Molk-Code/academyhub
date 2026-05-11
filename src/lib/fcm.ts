import { getApp } from 'firebase/app'
import { getMessaging, getToken, onMessage, isSupported } from 'firebase/messaging'
import { doc, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore'
import { db } from './firebase'

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined

const FCM_TOKEN_KEY     = (uid: string) => `fcmTokenOk:${uid}`
const FCM_TOKEN_VAL_KEY = (uid: string) => `fcmTokenVal:${uid}`

async function getMsg() {
  try {
    const ok = await isSupported()
    if (!ok) return null
    return getMessaging(getApp())
  } catch {
    return null
  }
}

/** Returns 'ok', 'unsupported', 'denied', 'no-vapid', or an error message string */
export async function initFCM(uid: string): Promise<string> {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    return 'unsupported'
  }
  if (Notification.permission === 'denied') return 'denied'
  if (!VAPID_KEY) return 'no-vapid'

  try {
    const permission = Notification.permission === 'granted'
      ? 'granted'
      : await Notification.requestPermission()
    if (permission !== 'granted') return 'denied'

    // Use root scope so iOS PWA push subscriptions work correctly
    const swReg = await navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/' })

    const messaging = await getMsg()
    if (!messaging) return 'unsupported'

    const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: swReg })
    if (!token) return 'no-token'

    // Replace the old token for this device to prevent duplicate notifications
    // when a user has registered from multiple contexts (Safari + PWA, scope change, etc.)
    const oldToken = localStorage.getItem(FCM_TOKEN_VAL_KEY(uid))
    if (oldToken && oldToken !== token) {
      await updateDoc(doc(db, 'users', uid), { fcmTokens: arrayRemove(oldToken) })
    }
    await updateDoc(doc(db, 'users', uid), { fcmTokens: arrayUnion(token) })
    localStorage.setItem(FCM_TOKEN_KEY(uid), '1')
    localStorage.setItem(FCM_TOKEN_VAL_KEY(uid), token)
    return 'ok'
  } catch (err: any) {
    console.warn('FCM init error:', err)
    return err?.message ?? 'error'
  }
}

export function fcmIsRegistered(uid: string): boolean {
  return localStorage.getItem(FCM_TOKEN_KEY(uid)) === '1'
}

type FcmPayload = {
  notification?: { title?: string; body?: string }
  data?: Record<string, string>
}

export async function onForegroundMessage(cb: (p: FcmPayload) => void): Promise<() => void> {
  const messaging = await getMsg()
  if (!messaging) return () => {}
  return onMessage(messaging, cb as any)
}

export async function removeFcmToken(uid: string, token: string): Promise<void> {
  await updateDoc(doc(db, 'users', uid), { fcmTokens: arrayRemove(token) })
}
