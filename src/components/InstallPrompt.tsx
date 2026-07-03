import { useState, useEffect } from 'react'
import { usePwaInstall } from '@/hooks/usePwaInstall'

export default function InstallPrompt() {
  const { canInstall, install, isInstalled } = usePwaInstall()
  const [isIOS,               setIsIOS]               = useState(false)
  const [dismissed,           setDismissed]           = useState(false)
  const [showIOSInstructions, setShowIOSInstructions] = useState(false)

  useEffect(() => {
    if (sessionStorage.getItem('installDismissed')) {
      setDismissed(true)
      return
    }
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent)
    setIsIOS(ios)
  }, [])

  function handleDismiss() {
    sessionStorage.setItem('installDismissed', 'true')
    setDismissed(true)
    setShowIOSInstructions(false)
  }

  async function handleInstall() {
    await install()
  }

  if (isInstalled || dismissed) return null
  if (!isIOS && !canInstall) return null

  return (
    <div className="mx-4 mb-4 rounded-2xl overflow-hidden border border-brand-500/30 bg-gradient-to-r from-brand-950/60 to-zinc-900/80">
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 rounded-2xl bg-brand-600 flex items-center justify-center flex-shrink-0 text-2xl">
            🎬
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-white text-sm">Install CineForge</p>
            <p className="text-xs text-zinc-400 mt-0.5">
              Get push notifications and the best mobile experience
            </p>
          </div>
          <button
            onClick={handleDismiss}
            className="text-zinc-500 hover:text-zinc-300 text-xl leading-none flex-shrink-0 mt-0.5 transition-colors"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>

        {/* Android / Desktop — one-tap install */}
        {!isIOS && canInstall && (
          <button
            onClick={handleInstall}
            className="mt-3 w-full bg-brand-600 hover:bg-brand-500 active:bg-brand-700 text-white font-semibold text-sm py-2.5 rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            <span>⬇️</span>
            Add to Home Screen
          </button>
        )}

        {/* iOS — expand instructions */}
        {isIOS && !showIOSInstructions && (
          <button
            onClick={() => setShowIOSInstructions(true)}
            className="mt-3 w-full bg-brand-600 hover:bg-brand-500 text-white font-semibold text-sm py-2.5 rounded-xl transition-colors"
          >
            How to install on iPhone →
          </button>
        )}

        {/* iOS step-by-step */}
        {isIOS && showIOSInstructions && (
          <div className="mt-3 bg-white/5 rounded-xl p-3 space-y-2">
            <p className="text-xs font-semibold text-brand-400 uppercase tracking-wide">
              Add to Home Screen
            </p>
            <div className="flex items-center gap-2 text-xs text-zinc-300">
              <span className="w-5 h-5 rounded-full bg-brand-500/20 text-brand-400 flex items-center justify-center font-bold flex-shrink-0">1</span>
              <span>Tap the <strong className="text-white">Share</strong> button <span className="text-base">⬆️</span> at the bottom of Safari</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-zinc-300">
              <span className="w-5 h-5 rounded-full bg-brand-500/20 text-brand-400 flex items-center justify-center font-bold flex-shrink-0">2</span>
              <span>Scroll down and tap <strong className="text-white">Add to Home Screen</strong></span>
            </div>
            <div className="flex items-center gap-2 text-xs text-zinc-300">
              <span className="w-5 h-5 rounded-full bg-brand-500/20 text-brand-400 flex items-center justify-center font-bold flex-shrink-0">3</span>
              <span>Tap <strong className="text-white">Add</strong> — done! Open from your home screen</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
