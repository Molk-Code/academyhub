import { Link } from 'react-router-dom'
import { useLegal } from '@/lib/publicConfig'

// Provider details for the signed-out pages (login, contact, privacy).
// Lines whose value in src/config/legal.ts is still a placeholder are hidden.
function useProvider() {
  const legal = useLegal()
  const org = legal('orgNumber')
  const street = legal('streetAddress'), postal = legal('postalCode'), city = legal('city'), country = legal('country')
  const place = [postal, city].filter(Boolean).join(' ')
  return {
    name: legal('providerName'),
    org: org && (/sole trader/i.test(org) ? 'Sole trader' : `Org. no. ${org}`),
    vat: legal('vatNumber') && `VAT no. ${legal('vatNumber')}`,
    // Country alone isn't an address — show the line once street or city is set
    address: street || place ? [street, place, country].filter(Boolean).join(', ') : undefined,
    email: legal('contactEmail'),
  }
}

/**
 * block: one line each (contact page, privacy policy).
 * compact: a single line for the login footer: "Provider · Org. no. … · contact"
 */
export function ProviderDetails({ className = '', variant = 'block' }: { className?: string; variant?: 'block' | 'compact' }) {
  const p = useProvider()
  if (variant === 'compact') {
    const parts = [p.name, p.org].filter(Boolean) as string[]
    if (!parts.length && !p.email) return null
    return (
      <p className={`text-xs text-zinc-500 ${className}`}>
        {parts.join(' · ')}
        {p.email && <>{parts.length > 0 && ' · '}<a href={`mailto:${p.email}`} className="hover:text-zinc-300 transition-colors">{p.email}</a></>}
      </p>
    )
  }
  const lines = [p.name, p.org, p.vat, p.address].filter(Boolean) as string[]
  if (!lines.length && !p.email) return null
  return (
    <address className={`not-italic text-xs text-zinc-500 leading-relaxed ${className}`}>
      {lines.map(line => <div key={line}>{line}</div>)}
      {p.email && <a href={`mailto:${p.email}`} className="hover:text-zinc-300 transition-colors">{p.email}</a>}
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
      <ProviderDetails variant="compact" />
    </footer>
  )
}
