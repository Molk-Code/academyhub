import { useEffect, useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { legal, isPlaceholder, type LegalConfig } from '@/config/legal'

// public_config/main — the login page profile, readable before sign-in
// (SchoolContext needs a signed-in user). Every field is optional; with no
// document the login page keeps its built-in look.

export type FrontDoor = 'academy' | 'rental_inventory' | 'production'

export type PublicLegal = Partial<Pick<LegalConfig,
  'providerName' | 'orgNumber' | 'streetAddress' | 'postalCode' | 'city' | 'country' | 'contactEmail' | 'privacyContactEmail' | 'vatNumber'>>

export interface PublicConfig {
  name?: string
  shortName?: string
  logoUrl?: string
  primaryColor?: string
  tagline?: string
  frontDoor?: FrontDoor
  /** Provider details; each one set here replaces the value in src/config/legal.ts */
  legal?: PublicLegal
}

const CACHE_KEY = 'public_config_main'

function cached(): PublicConfig | null | undefined {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw === null ? undefined : JSON.parse(raw)
  } catch { return undefined }
}

let inflight: Promise<PublicConfig | null> | null = null
function fetchConfig(): Promise<PublicConfig | null> {
  inflight ??= getDoc(doc(db, 'public_config', 'main'))
    .then(snap => {
      const value = snap.exists() ? (snap.data() as PublicConfig) : null
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(value)) } catch {}
      return value
    })
    .catch(err => { console.warn('public_config not loaded', err); return null })
  return inflight
}

/**
 * The login page profile. `loading` is true only on a first visit with
 * nothing cached; later visits render the last known profile at once and
 * refresh it in the background.
 */
export function usePublicConfig(): { config: PublicConfig | null; loading: boolean } {
  const [config, setConfig] = useState<PublicConfig | null | undefined>(cached)
  useEffect(() => {
    let live = true
    fetchConfig().then(c => { if (live) setConfig(c) })
    return () => { live = false }
  }, [])
  return { config: config ?? null, loading: config === undefined }
}

/** Provider details: public_config/main.legal first, then src/config/legal.ts (placeholders hidden) */
export function useLegal(): (key: keyof PublicLegal) => string | undefined {
  const { config } = usePublicConfig()
  return key => {
    const fromConfig = config?.legal?.[key]?.trim()
    return fromConfig && !isPlaceholder(fromConfig) ? fromConfig : legal(key)
  }
}
