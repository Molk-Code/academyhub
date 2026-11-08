import { useSyncExternalStore } from 'react'
import { collection, onSnapshot } from 'firebase/firestore'
import { onAuthStateChanged } from 'firebase/auth'
import { auth, db } from '@/lib/firebase'
import type { UserDoc } from '@/types'

// The whole users list, shared by every screen that needs it. Before, each of
// those screens opened its own listener and re-downloaded every user on every
// visit; now there is one listener per session, kept for 5 minutes after the
// last screen using it closes, so moving between pages costs no extra reads.

interface State { data: UserDoc[]; loading: boolean; error: Error | null }

const EMPTY: State = { data: [], loading: true, error: null }
let state: State = EMPTY
const subscribers = new Set<() => void>()
let unsubscribe: (() => void) | null = null
let idleTimer: ReturnType<typeof setTimeout> | null = null
let listeningAs: string | null = null

const emit = () => subscribers.forEach(fn => fn())

function start() {
  if (unsubscribe || !auth.currentUser) return
  listeningAs = auth.currentUser.uid
  unsubscribe = onSnapshot(
    collection(db, 'users'),
    snap => {
      state = { data: snap.docs.map(d => ({ id: d.id, ...d.data() }) as UserDoc), loading: false, error: null }
      emit()
    },
    err => {
      console.error('[useAllUsers]', err)
      state = { ...state, loading: false, error: err }
      emit()
    },
  )
}

function stop() {
  unsubscribe?.()
  unsubscribe = null
  listeningAs = null
  state = EMPTY
}

// A different (or no) account: drop the old list and listen again if needed
onAuthStateChanged(auth, user => {
  if ((user?.uid ?? null) === listeningAs) return
  stop()
  if (user && subscribers.size) start()
  emit()
})

function subscribe(onChange: () => void) {
  subscribers.add(onChange)
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null }
  start()
  return () => {
    subscribers.delete(onChange)
    if (subscribers.size === 0) {
      idleTimer = setTimeout(() => { if (subscribers.size === 0) stop() }, 5 * 60_000)
    }
  }
}

export function useAllUsers(): State {
  return useSyncExternalStore(subscribe, () => state)
}
