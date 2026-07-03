import { Link } from 'react-router-dom'

export default function UpgradePage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-8" style={{ background: 'var(--bg-primary)' }}>
      <div className="text-center max-w-md">
        <p className="text-5xl mb-6">🔒</p>
        <h1 className="text-2xl font-bold text-white mb-3">Feature not available</h1>
        <p className="text-zinc-400 mb-2">
          This feature is not included in your school's current subscription tier.
        </p>
        <p className="text-zinc-500 text-sm mb-8">
          Contact your school administrator or reach out to CineForge to upgrade.
        </p>
        <div className="flex gap-3 justify-center">
          <Link
            to="/dashboard"
            className="bg-brand-500 hover:bg-brand-600 text-white font-semibold px-6 py-2.5 rounded-xl transition-colors text-sm"
          >
            Go to Dashboard
          </Link>
          <a
            href="mailto:hello@cineforge.app"
            className="bg-white/10 hover:bg-white/15 text-white font-semibold px-6 py-2.5 rounded-xl transition-colors text-sm"
          >
            Contact us
          </a>
        </div>
      </div>
    </div>
  )
}
