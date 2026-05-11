import { useEffect } from 'react'

export function useAppBadge(count: number) {
  useEffect(() => {
    if (!('setAppBadge' in navigator)) return
    if (count > 0) {
      navigator.setAppBadge(count).catch(() => {})
    } else {
      navigator.clearAppBadge().catch(() => {})
    }
  }, [count])
}
