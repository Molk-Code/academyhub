import { useState, useEffect } from 'react'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'

export default function OfflineBanner() {
  const isOnline = useOnlineStatus()
  const [showBackOnline, setShowBackOnline] = useState(false)
  const [wasOffline, setWasOffline] = useState(false)

  useEffect(() => {
    if (!isOnline) {
      setWasOffline(true)
    } else if (wasOffline) {
      setShowBackOnline(true)
      const t = setTimeout(() => setShowBackOnline(false), 3000)
      return () => clearTimeout(t)
    }
  }, [isOnline])

  if (isOnline && !showBackOnline) return null

  return (
    <div className={`fixed top-0 left-0 right-0 z-[9999] flex items-center justify-center py-2 px-4 text-sm font-medium ${
      isOnline
        ? 'bg-emerald-600 text-white'
        : 'bg-zinc-800 border-b border-white/10 text-gray-300'
    }`}>
      {isOnline
        ? <span>✓ Back online</span>
        : <span>📡 You're offline — some features may not work</span>
      }
    </div>
  )
}
