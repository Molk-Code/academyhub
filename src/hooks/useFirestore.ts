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
import { useSchool } from '@/contexts/SchoolContext'
import { collectionAllowed } from '@/lib/features'

// ─── Generic realtime collection hook ────────────────────────────────────────

export function useCollection<T extends { id: string }>(
  collectionPath: string,
  constraints: QueryConstraint[] = [],
  enabled = true,
  queryKey = '',
) {
  const [data,    setData]    = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<Error | null>(null)

  // A collection of a module the school has switched off: the rules would
  // refuse the query, so don't send it (legacy schools: always allowed)
  const { modules } = useSchool()
  const allowed = collectionAllowed(modules, collectionPath)

  useEffect(() => {
    if (!allowed) { setData([]); setLoading(false); return }
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
        console.error(`[useCollection] ${collectionPath} (key=${queryKey}):`, err)
        setError(err)
        setLoading(false)
      },
    )

    return unsub
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionPath, enabled, queryKey, allowed])

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
  const { modules } = useSchool()
  const allowed = collectionAllowed(modules, collectionPath, docId)

  useEffect(() => {
    if (!allowed) { setData(null); setLoading(false); return }
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
  }, [collectionPath, docId, allowed])

  return { data, loading, error }
}

// ─── Convenience hooks ────────────────────────────────────────────────────────

export { where, orderBy, Timestamp }
