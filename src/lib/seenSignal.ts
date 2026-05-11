import { useState, useEffect } from 'react'

const EVENT = 'cineforge:seen-update'

export function emitSeenUpdate() {
  window.dispatchEvent(new Event(EVENT))
}

export function useSeenRevision(): number {
  const [rev, setRev] = useState(0)
  useEffect(() => {
    const handler = () => setRev(r => r + 1)
    window.addEventListener(EVENT, handler)
    return () => window.removeEventListener(EVENT, handler)
  }, [])
  return rev
}
