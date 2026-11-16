import { createContext, useContext, useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { SCHOOL_ID } from '@/lib/school'
import type { SchoolTier } from '@/types'
import type { ProductType, ModuleFlags } from '@/lib/features'
import type { PlanSelection } from '@/config/pricing'

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
  productType: ProductType | null
  /** Absent on legacy schools — then tier decides */
  modules: ModuleFlags | null
  /** Public rental shop for signed-out visitors (module-based schools): the school admin's choice */
  publicShop: boolean | null
  /** The superadmin's override of it: 'on'/'off' wins, null leaves it to the school admin */
  publicShopOverride: 'on' | 'off' | null
  /** The shop has a password (checked by the shop functions) */
  shopLocked: boolean
  /** Plan per module; null: no plan limits or plan features apply (schools set up before plans) */
  planSelection: PlanSelection | null
  /** Limits as stored (null = unlimited); maxStudents above keeps its old default */
  limits: { assets: number | null; students: number | null }
  /** Counted by functions for schools with a plan */
  usage: { assets?: number; students?: number } | null
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
  productType: null,
  modules: null,
  publicShop: null,
  publicShopOverride: null,
  shopLocked: false,
  planSelection: null,
  limits: { assets: null, students: null },
  usage: null,
}

const SchoolContext = createContext<SchoolConfig>(defaultConfig)

export function SchoolProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<SchoolConfig>(defaultConfig)

  useEffect(() => {
    return onSnapshot(
      doc(db, 'schools', SCHOOL_ID),
      snap => {
        if (!snap.exists()) return
        const d = snap.data()
        setConfig({ ...defaultConfig, ...d, limits: { assets: d.maxAssets ?? null, students: d.maxStudents ?? null } } as SchoolConfig)
      },
      err  => { console.warn('School config listener error:', err) },
    )
  }, [])

  useEffect(() => {
    document.title = config.shortName
  }, [config.shortName])

  return <SchoolContext.Provider value={config}>{children}</SchoolContext.Provider>
}

export const useSchool = () => useContext(SchoolContext)
