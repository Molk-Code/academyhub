import { useState, useEffect } from 'react'
import { doc, updateDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'

export default function WelcomeModal() {
  const { profile } = useAuth()
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (profile && !profile.hasSeenWelcome) {
      setShow(true)
    }
  }, [profile])

  const dismiss = async () => {
    setShow(false)
    if (profile?.uid) {
      await updateDoc(doc(db, 'users', profile.uid), { hasSeenWelcome: true })
    }
  }

  if (!show) return null

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-zinc-900 rounded-2xl border border-white/10 max-w-md w-full p-6">
        <div className="text-center mb-6">
          <div className="text-5xl mb-3">🎬</div>
          <h1 className="text-2xl font-bold text-white mb-2">
            Welcome to CineForge{profile?.displayName ? `, ${profile.displayName.split(' ')[0]}` : ''}!
          </h1>
          <p className="text-gray-400 text-sm">Your filmmaking education platform. Here's how to get started:</p>
        </div>

        <div className="space-y-3 mb-6">
          {[
            { icon: '📱', title: 'Install on your phone', desc: 'Tap Share → Add to Home Screen for the best experience and push notifications', href: null },
            { icon: '📅', title: 'Check your calendar', desc: 'See your upcoming lessons and deadlines', href: '/calendar' },
            { icon: '📖', title: 'Read the Production Bible', desc: 'Everything you need to know about your education', href: '/guide' },
          ].map((item, i) => (
            <div key={i} className="flex items-start gap-3 bg-white/5 rounded-xl p-3">
              <span className="text-2xl flex-shrink-0">{item.icon}</span>
              <div>
                <p className="font-semibold text-sm text-white">{item.title}</p>
                <p className="text-xs text-gray-400 mt-0.5">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={dismiss}
          className="w-full bg-brand-600 hover:bg-brand-500 text-white font-semibold py-3 rounded-xl transition-colors"
        >
          Let's go! 🚀
        </button>
      </div>
    </div>
  )
}
