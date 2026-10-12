import { useState, useMemo, useEffect } from 'react'
import { collection, addDoc, doc, serverTimestamp, getDoc, setDoc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '@/lib/firebase'
import { useCollection } from '@/hooks/useFirestore'
import type { EquipmentCategoryDoc, EquipmentBookingDoc } from '@/types'
import { Package, ToggleRight, ToggleLeft } from 'lucide-react'
import { TMP_EQUIPMENT_PRICES } from './tmpEquipmentPrices'
import { DEFAULT_CATEGORIES } from './adminEquipmentShared'
import { CatalogTab } from './EquipmentCatalogTab'
import { BookingsTab } from './EquipmentBookingsTab'
import { CategoriesTab } from './EquipmentCategoriesTab'
import './molkom.css'

type AdminTab = 'catalog' | 'bookings' | 'categories'

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AdminEquipmentPage() {
  const [tab, setTab] = useState<AdminTab>('catalog')
  const { data: bookings } = useCollection<EquipmentBookingDoc>('equipment_bookings')
  const { data: categoriesRaw, loading: catsLoading } = useCollection<EquipmentCategoryDoc>('equipment_categories')
  const pendingCount = useMemo(() => bookings.filter(b => b.status === 'pending').length, [bookings])

  const categories = useMemo(() => {
    if (catsLoading) return []
    if (categoriesRaw.length > 0) return [...categoriesRaw].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    return DEFAULT_CATEGORIES.map((c, i) => ({ ...c, id: `default-${i}` }))
  }, [categoriesRaw, catsLoading])

  // Auto-seed default categories into Firestore if the collection is empty
  useEffect(() => {
    if (catsLoading || categoriesRaw.length > 0) return
    Promise.all(
      DEFAULT_CATEGORIES.map(c =>
        addDoc(collection(db, 'equipment_categories'), { ...c, createdAt: serverTimestamp() })
      )
    )
  }, [catsLoading, categoriesRaw.length])

  const [requireProduction, setRequireProduction] = useState(true)
  useEffect(() => {
    getDoc(doc(db, 'settings', 'production')).then(snap => {
      if (snap.exists()) setRequireProduction(snap.data().requireProductionForBooking !== false)
    })
  }, [])
  async function toggleRequireProduction() {
    const next = !requireProduction
    setRequireProduction(next)
    await setDoc(doc(db, 'settings', 'production'), { requireProductionForBooking: next }, { merge: true })
  }

  const [pricingEnabled, setPricingEnabled] = useState(true)
  useEffect(() => {
    getDoc(doc(db, 'settings', 'equipment')).then(snap => {
      if (snap.exists()) setPricingEnabled(snap.data().pricingEnabled !== false)
    })
  }, [])
  async function togglePricing() {
    const next = !pricingEnabled
    setPricingEnabled(next)
    await setDoc(doc(db, 'settings', 'equipment'), { pricingEnabled: next }, { merge: true })
  }

  // TEMPORARY: one-off vendor price sync. Remove this + the button below +
  // tmpEquipmentPrices.ts + the tmpSyncEquipmentPrices callable after use.
  const [syncState, setSyncState] = useState<'idle' | 'running' | 'done'>('idle')
  const [syncResult, setSyncResult] = useState<any>(null)
  async function runPriceSync(dryRun: boolean) {
    setSyncState('running')
    try {
      const fn = httpsCallable(functions, 'tmpSyncEquipmentPrices')
      const res: any = await fn({ prices: TMP_EQUIPMENT_PRICES, dryRun })
      setSyncResult(res.data)
    } catch (err: any) {
      setSyncResult({ error: err.message })
    } finally {
      setSyncState('done')
    }
  }

  const tabs: { id: AdminTab; label: string; badge?: number }[] = [
    { id: 'catalog',    label: 'Catalog' },
    { id: 'bookings',   label: 'Bookings', badge: pendingCount },
    { id: 'categories', label: 'Categories' },
  ]

  return (
    <div className="molkom-app" style={{ background: '#0a0a0f', minHeight: '100vh' }}>
      <style>{`
        .admin-card-overlay { opacity: 0 !important; }
        .product-card:hover .admin-card-overlay { opacity: 1 !important; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>

      {/* Header */}
      <header className="header">
        <div className="header-inner">
          <div className="logo">
            <Package size={22} color="#4cd964" />
            <div>
              <div style={{ fontWeight: 700, fontSize: '1rem', lineHeight: 1.2 }}>Rental House</div>
              <div className="logo-subtitle">Admin Panel</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {tabs.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  padding: '6px 12px', borderRadius: 10, fontSize: '.82rem', fontWeight: 600,
                  cursor: 'pointer', border: 'none', position: 'relative',
                  background: tab === t.id ? 'rgba(76,217,100,.15)' : 'transparent',
                  color: tab === t.id ? '#4cd964' : '#6a6a80',
                  transition: 'all .2s',
                }}
              >
                {t.label}
                {(t.badge ?? 0) > 0 && (
                  <span style={{ position: 'absolute', top: 4, right: 4, minWidth: 16, height: 16, background: '#f59e0b', color: '#000', borderRadius: 8, fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px' }}>
                    {t.badge}
                  </span>
                )}
              </button>
            ))}
            <button
              onClick={toggleRequireProduction}
              title={requireProduction ? 'Production required — click to disable' : 'Production not required — click to enable'}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 10, background: 'transparent', border: '1px solid #2a2a3a', cursor: 'pointer', fontSize: '.75rem', fontWeight: 600, color: requireProduction ? '#f59e0b' : '#4a4a60', transition: 'all .2s', whiteSpace: 'nowrap' }}
            >
              {requireProduction ? <ToggleRight size={15} color="#f59e0b" /> : <ToggleLeft size={15} color="#4a4a60" />}
              <span className="hidden sm:inline">Require production</span>
              <span className="sm:hidden">Prod.</span>
            </button>
            <button
              onClick={togglePricing}
              title={pricingEnabled ? 'Prices shown — click to hide prices everywhere' : 'Prices hidden — click to show prices'}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 10, background: 'transparent', border: '1px solid #2a2a3a', cursor: 'pointer', fontSize: '.75rem', fontWeight: 600, color: pricingEnabled ? '#4cd964' : '#4a4a60', transition: 'all .2s', whiteSpace: 'nowrap' }}
            >
              {pricingEnabled ? <ToggleRight size={15} color="#4cd964" /> : <ToggleLeft size={15} color="#4a4a60" />}
              <span className="hidden sm:inline">Prices</span>
              <span className="sm:hidden">Kr</span>
            </button>
            <button
              onClick={() => runPriceSync(true)}
              disabled={syncState === 'running'}
              style={{ padding: '5px 10px', borderRadius: 10, background: 'rgba(251,191,36,.12)', border: '1px solid #b45309', cursor: 'pointer', fontSize: '.75rem', fontWeight: 600, color: '#fbbf24', whiteSpace: 'nowrap' }}
            >
              {syncState === 'running' ? 'Checking…' : 'Preview price sync'}
            </button>
            <button
              onClick={() => runPriceSync(false)}
              disabled={syncState === 'running'}
              style={{ padding: '5px 10px', borderRadius: 10, background: 'rgba(251,191,36,.2)', border: '1px solid #b45309', cursor: 'pointer', fontSize: '.75rem', fontWeight: 700, color: '#fbbf24', whiteSpace: 'nowrap' }}
            >
              Apply price sync
            </button>
          </div>
        </div>
        {syncResult && (
          <pre style={{ margin: '0 20px 12px', padding: 12, background: '#111118', border: '1px solid #2a2a3a', borderRadius: 10, fontSize: '.7rem', color: '#a0a0b0', maxHeight: 300, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
            {JSON.stringify(syncResult, null, 2)}
          </pre>
        )}
      </header>

      <div className="main">
        {tab === 'catalog'     && <CatalogTab categories={categories} pricingEnabled={pricingEnabled} />}
        {tab === 'bookings'    && <BookingsTab />}
        {tab === 'categories'  && <CategoriesTab categories={categoriesRaw} />}
      </div>
    </div>
  )
}
