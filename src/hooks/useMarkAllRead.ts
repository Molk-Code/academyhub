import { doc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { emitSeenUpdate } from '@/lib/seenSignal'

function clearLocalBadgeState(uid: string) {
  const now = String(Date.now())
  localStorage.setItem(`chatAllClearedAt:${uid}`, now)
  localStorage.setItem(`foodBoxSeenAt:${uid}`, now)
  localStorage.setItem(`minivanSeenAt:${uid}`, now)
  emitSeenUpdate()
  if ('clearAppBadge' in navigator) navigator.clearAppBadge().catch(() => {})
  navigator.serviceWorker?.controller?.postMessage({ type: 'CLEAR_NOTIFICATIONS' })
}

export function useMarkAllRead() {
  const { profile } = useAuth()

  return async function markAllRead() {
    const uid = profile?.uid
    if (!uid) return
    clearLocalBadgeState(uid)
    await updateDoc(doc(db, 'users', uid), { lastReadAt: serverTimestamp() })
  }
}

export { clearLocalBadgeState }
