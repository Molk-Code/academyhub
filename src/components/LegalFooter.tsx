import { Link } from 'react-router-dom'
import { useLegal } from '@/lib/publicConfig'

// Provider details for the signed-out pages (login, contact, privacy).
// Lines whose value in src/config/legal.ts is still a placeholder are hidden.
export function ProviderDetails({ className = '' }: { className?: string }) {
  const legal = useLegal()
  const name    = legal('providerName')
  const org     = legal('orgNumber')
  const street  = legal('streetAddress')
  const postal  = legal('postalCode')
  const city    = legal('city')
  const country = legal('country')
  const email   = legal('contactEmail')
  const place   = [postal, city].filter(Boolean).join(' ')
  const lines = [
    name,
    org && (/sole trader/i.test(org) ? 'Sole trader' : `Org. no. ${org}`),
    // Country alone isn't an address — show the line once street or city is set
    street || place ? [street, place, country].filter(Boolean).join(', ') : undefined,
  ].filter(Boolean)

  if (!lines.length && !email) return null
  return (
    <address className={`not-italic text-xs text-zinc-500 leading-relaxed ${className}`}>
      {lines.map(line => <div key={line}>{line}</div>)}
      {email && <a href={`mailto:${email}`} className="hover:text-zinc-300 transition-colors">{email}</a>}
    </address>
  )
}

export default function LegalFooter() {
  return (
    <footer className="mt-6 text-center space-y-3">
      <nav className="flex items-center justify-center gap-4 text-xs text-zinc-500">
        <Link to="/contact" className="hover:text-zinc-300 transition-colors">Contact</Link>
        <span aria-hidden className="text-zinc-500">·</span>
        <a href="/privacy" target="_blank" rel="noopener noreferrer" className="hover:text-zinc-300 transition-colors">Privacy policy</a>
      </nav>
      <ProviderDetails />
    </footer>
  )
}
