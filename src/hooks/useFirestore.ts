import { useEffect, useState } from 'react'
import {
  collection,
  doc,
  query,
  where,
  orderBy,
  onSnapshot,
  type Query,
  type DocumentData,
  type QueryConstraint,
  Timestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'

// ─── Generic realtime collection hook ────────────────────────────────────────

export function useCollection<T extends { id: string }>(
  collectionPath: string,
  constraints: QueryConstraint[] = [],
  enabled = true,
) {
  const [data,    setData]    = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<Error | null>(null)

  useEffect(() => {
    if (!enabled) { setLoading(false); return }

    const q: Query<DocumentData> = query(
      collection(db, collectionPath),
      ...constraints,
    )

    const unsub = onSnapshot(
      q,
      (snap) => {
        setData(snap.docs.map(d => ({ id: d.id, ...d.data() } as T)))
        setLoading(false)
      },
      (err) => {
        setError(err)
        setLoading(false)
      },
    )

    return unsub
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionPath, enabled])

  return { data, loading, error }
}

// ─── Generic realtime single document hook ───────────────────────────────────

export function useDocument<T extends { id: string }>(
  collectionPath: string,
  docId: string | null | undefined,
) {
  const [data,    setData]    = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<Error | null>(null)

  useEffect(() => {
    if (!docId) { setLoading(false); return }

    const unsub = onSnapshot(
      doc(db, collectionPath, docId),
      (snap) => {
        setData(snap.exists() ? ({ id: snap.id, ...snap.data() } as T) : null)
        setLoading(false)
      },
      (err) => {
        setError(err)
        setLoading(false)
      },
    )

    return unsub
  }, [collectionPath, docId])

  return { data, loading, error }
}

// ─── Convenience hooks ────────────────────────────────────────────────────────

export { where, orderBy, Timestamp }
