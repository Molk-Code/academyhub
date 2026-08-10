import { createContext, useContext, useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { SCHOOL_ID } from '@/lib/school'
import type { SchoolTier } from '@/types'

export type CurrencyCode = 'SEK' | 'EUR' | 'USD'

interface SchoolConfig {
  name: string
  shortName: string
  logoUrl: string | null
  primaryColor: string
  features: Record<string, boolean>
  maxStudents: number
  subscriptionStatus: string
  isBeta: boolean
  tier: SchoolTier | null
  storageQuotaGB: number | undefined
  storageUsedBytes: number | undefined
  currency: CurrencyCode
}

const defaultConfig: SchoolConfig = {
  name: 'CineForge',
  shortName: 'CineForge',
  logoUrl: null,
  primaryColor: '#f97316',
  features: {},
  maxStudents: 100,
  subscriptionStatus: 'active',
  isBeta: true,
  tier: null,
  storageQuotaGB: undefined,
  storageUsedBytes: undefined,
  currency: 'SEK',
}

const SchoolContext = createContext<SchoolConfig>(defaultConfig)

export function SchoolProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<SchoolConfig>(defaultConfig)

  useEffect(() => {
    return onSnapshot(
      doc(db, 'schools', SCHOOL_ID),
      snap => { if (snap.exists()) setConfig({ ...defaultConfig, ...snap.data() } as SchoolConfig) },
      err  => { console.warn('School config listener error:', err) },
    )
  }, [])

  useEffect(() => {
    document.title = config.shortName
  }, [config.shortName])

  return <SchoolContext.Provider value={config}>{children}</SchoolContext.Provider>
}

export const useSchool = () => useContext(SchoolContext)
