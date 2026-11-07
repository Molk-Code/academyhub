import { useCallback, useRef } from 'react'

// Runs an async action at most once at a time: taps that arrive while it is
// still running are ignored. Rapid taps on "Add" buttons used to create several
// blank rows with the same number, because each tap read the same stale list.
// Failures are reported instead of becoming unhandled promise rejections.
export function useSingleFlight(failMessage = 'Could not save — check your connection and try again.') {
  const busy = useRef(false)
  return useCallback(async (fn: () => Promise<unknown>) => {
    if (busy.current) return
    busy.current = true
    try {
      await fn()
    } catch (err) {
      console.error(err)
      alert(failMessage)
    } finally {
      busy.current = false
    }
  }, [failMessage])
}
