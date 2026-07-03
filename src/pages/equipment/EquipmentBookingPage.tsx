import { useState, useMemo, useEffect } from 'react'
import { collection, addDoc, serverTimestamp, query, where, orderBy, getDocs, getDoc, doc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useCollection, useDocument } from '@/hooks/useFirestore'
import type { EquipmentDoc, EquipmentBookingDoc, CohortDoc, ProductionDoc, ProductionSceneDoc, ProductionCrewAssignmentDoc, ProductionCastDoc, ProductionLocationDoc, ProductionShootingDayDoc } from '@/types'
import { Link } from 'react-router-dom'
import {
  ShoppingCart, X, Search, Package, Calendar, Check,
  AlertTriangle, ChevronDown, ChevronRight, CheckCircle2, Clock, Truck, RotateCcw, XCircle, Lock,
} from 'lucide-react'
import './molkom.css'

type EquipmentCategory = 'ALL' | 'CAMERA' | 'GRIP' | 'LIGHTS' | 'SOUND' | 'LOCATION' | 'BOOKS' | 'OTHER'
type ViewMode = 'browse' | 'checkout' | 'success' | 'my-bookings'

interface ProductionReadiness {
  isReady: boolean
  score: number
  missing: string[]
  hasBreakdown: boolean
  hasCrew: boolean
  hasCast: boolean
  hasLocations: boolean
  hasSchedule: boolean
}

function getProductionReadiness(
  scenes: ProductionSceneDoc[],
  crew: ProductionCrewAssignmentDoc[],
  cast: ProductionCastDoc[],
  locations: ProductionLocationDoc[],
  shootingDays: ProductionShootingDayDoc[],
): ProductionReadiness {
  const hasBreakdown = scenes.length >= 1
  const hasCrew = crew.some(c => c.assignedName && c.assignedName.trim() !== '')
  const hasCast = cast.length >= 1
  const hasLocations = locations.length >= 1
  const hasSchedule = shootingDays.some(d => (d.sceneIds?.length ?? 0) >= 1)
  const checks = [hasBreakdown, hasCrew, hasCast, hasLocations, hasSchedule]
  const score = Math.round((checks.filter(Boolean).length / checks.length) * 100)
  const missing: string[] = []
  if (!hasBreakdown) missing.push('Script breakdown (add at least 1 scene)')
  if (!hasCrew) missing.push('Crew (assign at least one crew role)')
  if (!hasCast) missing.push('Cast (add at least 1 cast member)')
  if (!hasLocations) missing.push('Locations (add at least 1 location)')
  if (!hasSchedule) missing.push('Schedule (assign scenes to at least 1 shooting day)')
  return { isReady: score === 100, score, missing, hasBreakdown, hasCrew, hasCast, hasLocations, hasSchedule }
}

interface CartEntry {
  item: EquipmentDoc
  quantity: number
}

function formatDate(d: string) {
  if (!d) return ''
  const dt = new Date(d + 'T12:00:00')
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function calcDays(from: string, to: string): number {
  if (!from || !to) return 1
  const a = new Date(from + 'T00:00:00')
  const b = new Date(to + 'T00:00:00')
  const diff = Math.round((b.getTime() - a.getTime()) / 86400000)
  return diff > 0 ? diff : 1
}

// Week discount: 5+ days → only charge 5 days per 7-day block (weekends free)
function billableDays(days: number): number {
  if (days < 5) return days
  return Math.ceil(days / 7) * 5
}

function weeklyRate(pricePerDay: number): number {
  return pricePerDay * 5
}

export default function EquipmentBookingPage() {
  const { profile, cohortId: ctxCohortId, previewCohortId } = useAuth()
  const cohortId = ctxCohortId ?? previewCohortId ?? profile?.cohortId ?? ''

  const { data: equipmentRaw } = useCollection<EquipmentDoc>('equipment')
  const { data: cohort } = useDocument<CohortDoc>('cohorts', cohortId || null)
  const { data: myBookings } = useCollection<EquipmentBookingDoc>(
    'equipment_bookings',
    profile?.uid ? [where('studentId', '==', profile.uid), orderBy('createdAt', 'desc')] : [],
    !!profile?.uid,
    profile?.uid ?? '',
  )

  // All productions in the cohort — same scope as the Production page
  const { data: userProductions } = useCollection<ProductionDoc>(
    'productions',
    cohortId ? [where('cohortId', '==', cohortId)] : [],
    !!cohortId,
    cohortId,
  )

  const [selectedProductionId, setSelectedProductionId] = useState<string | null>(null)
  const [productionReadiness, setProductionReadiness] = useState<Record<string, ProductionReadiness>>({})
  const [productionShootingDays, setProductionShootingDays] = useState<Record<string, ProductionShootingDayDoc[]>>({})
  const [productionCrew, setProductionCrew] = useState<Record<string, ProductionCrewAssignmentDoc[]>>({})
  const [crewRoles, setCrewRoles] = useState<Array<{ id: string; dayRate?: number }>>([])
  const [readinessLoading, setReadinessLoading] = useState(false)

  const selectedProduction = useMemo(
    () => userProductions.find(p => p.id === selectedProductionId) ?? null,
    [userProductions, selectedProductionId],
  )

  const equipment = useMemo(
    () => equipmentRaw.filter(e => e.isActive).sort((a, b) => a.name.localeCompare(b.name)),
    [equipmentRaw],
  )

  const [cart, setCart] = useState<Map<string, CartEntry>>(new Map())
  const [view, setView] = useState<ViewMode>('browse')
  const [cartOpen, setCartOpen] = useState(false)
  const [fromDate, setFromDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [toDate, setToDate] = useState('')
  const [requireProductionSetting, setRequireProductionSetting] = useState(true)
  useEffect(() => {
    getDoc(doc(db, 'settings', 'production')).then(snap => {
      if (snap.exists()) setRequireProductionSetting(snap.data().requireProductionForBooking !== false)
    })
  }, [])
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<EquipmentCategory>('ALL')
  const [modalItem, setModalItem] = useState<EquipmentDoc | null>(null)

  // Checkout form
  const [contactName, setContactName] = useState(profile?.displayName ?? '')
  const [projectName, setProjectName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  const rentalDays = calcDays(fromDate, toDate)

  // Category counts
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: 0 }
    for (const e of equipment) {
      counts.ALL = (counts.ALL || 0) + 1
      counts[e.category] = (counts[e.category] || 0) + 1
    }
    return counts
  }, [equipment])

  const filtered = useMemo(() => {
    let list = equipment
    if (category !== 'ALL') list = list.filter(e => e.category === category)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(e => e.name.toLowerCase().includes(q) || e.description?.toLowerCase().includes(q))
    }
    return list
  }, [equipment, category, search])

  const cartList = Array.from(cart.values())
  const cartCount = cartList.length
  const chargeableDays = billableDays(rentalDays)
  const weekDiscountActive = rentalDays >= 5
  const totalPrice = cartList.reduce((sum, { item, quantity }) => sum + item.priceInclVat * quantity * chargeableDays, 0)

  function addToCart(item: EquipmentDoc) {
    setCart(prev => {
      const next = new Map(prev)
      if (next.has(item.id)) {
        const entry = next.get(item.id)!
        next.set(item.id, { ...entry, quantity: entry.quantity + 1 })
      } else {
        next.set(item.id, { item, quantity: 1 })
      }
      return next
    })
  }

  function removeFromCart(id: string) {
    setCart(prev => {
      const next = new Map(prev)
      next.delete(id)
      return next
    })
  }

  function updateCartQty(id: string, delta: number) {
    setCart(prev => {
      const next = new Map(prev)
      const entry = next.get(id)
      if (!entry) return prev
      const newQty = entry.quantity + delta
      if (newQty <= 0) {
        next.delete(id)
      } else {
        next.set(id, { ...entry, quantity: newQty })
      }
      return next
    })
  }

  function isItemLocked(item: EquipmentDoc): boolean {
    if (item.allowedCohortIds && item.allowedCohortIds.length > 0) {
      return !cohortId || !item.allowedCohortIds.includes(cohortId)
    }
    // backward compat
    if (item.filmYear2Only) return cohort?.programYear !== 2
    return false
  }

  // ── Budget computations ──────────────────────────────────────────────────────
  const budgetInfo = useMemo(() => {
    if (!selectedProductionId || !selectedProduction?.budgetLimit) return null
    const limit       = selectedProduction.budgetLimit
    const crew        = productionCrew[selectedProductionId] ?? []
    const days        = productionShootingDays[selectedProductionId] ?? []
    const dayCount    = days.length
    const salaryCost  = crew
      .filter(a => a.assignedName?.trim())
      .reduce((sum, a) => {
        const role    = crewRoles.find(r => r.id === a.roleId)
        const rate    = (a as any).dayRateOverride ?? role?.dayRate ?? 0
        return sum + rate * dayCount
      }, 0)
    const equipmentBudget = Math.max(0, limit - salaryCost)
    return { limit, salaryCost, equipmentBudget, currency: 'SEK' }
  }, [selectedProductionId, selectedProduction, productionCrew, productionShootingDays, crewRoles])

  function isOverEquipmentBudget(item: EquipmentDoc): boolean {
    if (!budgetInfo) return false
    const addCost = item.priceInclVat * chargeableDays
    return totalPrice + addCost > budgetInfo.equipmentBudget
  }

  async function handleSubmit() {
    if (!fromDate || !toDate) return
    setSubmitting(true)
    setSubmitError('')
    try {
      const bookingData: Omit<EquipmentBookingDoc, 'id'> = {
        studentId: profile?.uid ?? '',
        studentName: contactName,
        studentEmail: profile?.email ?? '',
        cohortId: profile?.cohortId ?? '',
        projectName,
        productionId: selectedProductionId ?? undefined,
        productionTitle: selectedProduction?.title ?? undefined,
        productionReadiness: selectedProductionId && productionReadiness[selectedProductionId]
          ? (() => {
              const r = productionReadiness[selectedProductionId]
              return { score: r.score, hasBreakdown: r.hasBreakdown, hasCrew: r.hasCrew, hasCast: r.hasCast, hasLocations: r.hasLocations, hasSchedule: r.hasSchedule }
            })()
          : undefined,
        items: cartList.map(({ item, quantity }) => ({
          equipmentId: item.id,
          equipmentName: item.name,
          quantity,
        })),
        checkoutDate: fromDate,
        returnDate: toDate,
        status: 'pending',
        teacherNotes: `Cohort: ${cohort?.name ?? cohortId}`,
        createdAt: serverTimestamp() as any,
      }
      await addDoc(collection(db, 'equipment_bookings'), bookingData)
      setView('success')
      setCartOpen(false)
    } catch (err: any) {
      setSubmitError(err.message ?? 'Failed to submit booking')
    } finally {
      setSubmitting(false)
    }
  }

  function resetAll() {
    setCart(new Map())
    setView('browse')
    setFromDate(new Date().toISOString().slice(0, 10))
    setToDate('')
    setProjectName('')
    setContactName(profile?.displayName ?? '')
    setSubmitError('')
  }

  // Load crew roles once for salary calculations
  useEffect(() => {
    getDocs(collection(db, 'crew_roles')).then(snap =>
      setCrewRoles(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })))
    )
  }, [])

  // Load subcollections for all user productions and compute readiness
  useEffect(() => {
    if (userProductions.length === 0) return
    setReadinessLoading(true)
    Promise.all(userProductions.map(async prod => {
      const [scenesSnap, crewSnap, castSnap, locSnap, daysSnap] = await Promise.all([
        getDocs(collection(db, `productions/${prod.id}/scenes`)),
        getDocs(collection(db, `productions/${prod.id}/crew`)),
        getDocs(collection(db, `productions/${prod.id}/cast`)),
        getDocs(collection(db, `productions/${prod.id}/locations`)),
        getDocs(collection(db, `productions/${prod.id}/shootingDays`)),
      ])
      return {
        id: prod.id,
        scenes:   scenesSnap.docs.map(d => ({ id: d.id, ...d.data() } as ProductionSceneDoc)),
        crew:     crewSnap.docs.map(d => ({ id: d.id, ...d.data() } as ProductionCrewAssignmentDoc)),
        cast:     castSnap.docs.map(d => ({ id: d.id, ...d.data() } as ProductionCastDoc)),
        locations: locSnap.docs.map(d => ({ id: d.id, ...d.data() } as ProductionLocationDoc)),
        days:     daysSnap.docs.map(d => ({ id: d.id, ...d.data() } as ProductionShootingDayDoc)),
      }
    })).then(results => {
      const readiness: Record<string, ProductionReadiness> = {}
      const daysMap:   Record<string, ProductionShootingDayDoc[]> = {}
      const crewMap:   Record<string, ProductionCrewAssignmentDoc[]> = {}
      results.forEach(r => {
        readiness[r.id] = getProductionReadiness(r.scenes, r.crew, r.cast, r.locations, r.days)
        daysMap[r.id]   = r.days
        crewMap[r.id]   = r.crew
      })
      setProductionReadiness(readiness)
      setProductionShootingDays(daysMap)
      setProductionCrew(crewMap)
    }).finally(() => setReadinessLoading(false))
  }, [userProductions.map(p => p.id).join(',')])   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (view === 'checkout') window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [view])

  // Auto-fill dates from selected production's shooting schedule
  useEffect(() => {
    if (!selectedProductionId) return
    const days = productionShootingDays[selectedProductionId] ?? []
    const dates = days.map(d => d.date).filter(Boolean).sort()
    if (dates.length === 0) return
    setFromDate(dates[0])
    const last = new Date(dates[dates.length - 1] + 'T00:00:00')
    last.setDate(last.getDate() + 1)
    setToDate(last.toISOString().slice(0, 10))
  }, [selectedProductionId, productionShootingDays])

  const CATEGORIES: EquipmentCategory[] = ['ALL', 'CAMERA', 'GRIP', 'LIGHTS', 'SOUND', 'LOCATION', 'BOOKS', 'OTHER']

  return (
    <div className="molkom-app student-molkom-app" style={{ background: '#0a0a0f', minHeight: '100vh' }}>
      {/* Header */}
      <header className="header">
        <div className="header-inner">
          <div className="logo">
            <Package size={22} color="#4cd964" />
            <div>
              <div style={{ fontWeight: 700, fontSize: '1rem', lineHeight: 1.2 }}>Rental House</div>
              <div className="logo-subtitle">Booking System</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              className="secondary-btn"
              style={{ fontSize: '.78rem', padding: '6px 12px' }}
              onClick={() => setView('my-bookings')}
            >
              My Bookings
            </button>
            <button className="cart-button" onClick={() => setCartOpen(true)}>
              <ShoppingCart size={20} color="#a0a0b5" />
              {cartCount > 0 && <span className="cart-badge">{cartCount}</span>}
            </button>
          </div>
        </div>
      </header>

      {/* Cart overlay */}
      <div className={`cart-overlay${cartOpen ? ' open' : ''}`} onClick={() => setCartOpen(false)} />
      <div className={`cart-drawer${cartOpen ? ' open' : ''}`}>
        <div className="cart-header">
          <h2><ShoppingCart size={18} /> Cart ({cartCount})</h2>
          <button className="close-btn" onClick={() => setCartOpen(false)}><X size={18} /></button>
        </div>

        {cartCount === 0 ? (
          <div className="cart-empty">
            <ShoppingCart size={40} color="#3a3a4a" />
            <p>Your cart is empty</p>
            <span style={{ fontSize: '.85rem' }}>Add equipment to get started</span>
          </div>
        ) : (
          <>
            <div className="cart-items">
              {cartList.map(({ item, quantity }) => (
                <div className="cart-item" key={item.id}>
                  <div className="cart-item-info">
                    <h4>{item.name}</h4>
                    <div className="cart-item-category">{item.category}</div>
                    <div className="cart-item-days">
                      <button className="day-btn-sm" onClick={() => updateCartQty(item.id, -1)}>−</button>
                      <span>{quantity} × {chargeableDays} days{weekDiscountActive ? ` (of ${rentalDays})` : ''}</span>
                      <button className="day-btn-sm" onClick={() => updateCartQty(item.id, 1)}>+</button>
                    </div>
                  </div>
                  <div className="cart-item-right">
                    <span className="cart-item-price">
                      {item.priceInclVat > 0 ? `${(item.priceInclVat * quantity * chargeableDays).toFixed(0)} kr` : 'Free'}
                    </span>
                    <button className="remove-btn" onClick={() => removeFromCart(item.id)}><X size={14} /></button>
                  </div>
                </div>
              ))}

              <div className="cart-rental-period">
                <h4><Calendar size={14} /> Rental Period</h4>
                <div className="cart-date-row">
                  <div className="cart-date-field">
                    <label>From</label>
                    <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} />
                  </div>
                  <div className="cart-date-field">
                    <label>To</label>
                    <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} />
                  </div>
                </div>
                {selectedProductionId && (
                  <p style={{ fontSize: '.72rem', color: '#6a6a80', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                    📅 Dates auto-filled from your shooting schedule. Adjust if needed.
                  </p>
                )}
                {fromDate && toDate && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
                    <div className="cart-rental-days">{rentalDays} rental {rentalDays === 1 ? 'day' : 'days'}</div>
                    {weekDiscountActive && (
                      <span style={{ fontSize: '.7rem', fontWeight: 700, background: 'rgba(76,217,100,.15)', color: '#4cd964', border: '1px solid rgba(76,217,100,.3)', borderRadius: 5, padding: '2px 7px' }}>
                        Week discount — charged {chargeableDays} days
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="cart-footer">
              {(!fromDate || !toDate) && (
                <div className="cart-dates-hint">Select rental dates to proceed</div>
              )}
              {budgetInfo && (
                <div style={{ marginBottom: 8, padding: '8px 10px', borderRadius: 8, background: totalPrice > budgetInfo.equipmentBudget ? 'rgba(248,113,113,.1)' : 'rgba(52,211,153,.07)', border: `1px solid ${totalPrice > budgetInfo.equipmentBudget ? 'rgba(248,113,113,.3)' : 'rgba(52,211,153,.2)'}` }}>
                  <div style={{ fontSize: '.7rem', color: '#6a6a80', marginBottom: 2 }}>Equipment budget</div>
                  <div style={{ fontSize: '.85rem', fontWeight: 700, color: totalPrice > budgetInfo.equipmentBudget ? '#f87171' : '#34d399' }}>
                    {totalPrice.toLocaleString('sv-SE')} / {budgetInfo.equipmentBudget.toLocaleString('sv-SE')} SEK
                  </div>
                  {totalPrice > budgetInfo.equipmentBudget && (
                    <div style={{ fontSize: '.68rem', color: '#f87171', marginTop: 2 }}>⚠ Exceeds equipment budget</div>
                  )}
                </div>
              )}
              <div className="cart-total">
                <span>Total</span>
                <strong>{totalPrice > 0 ? `${totalPrice.toFixed(0)} kr` : 'Free'}</strong>
              </div>
              <button
                className="checkout-btn"
                disabled={!fromDate || !toDate || (budgetInfo != null && totalPrice > budgetInfo.equipmentBudget)}
                onClick={() => { setCartOpen(false); setView('checkout') }}
              >
                Proceed to Checkout
              </button>
            </div>
          </>
        )}
      </div>

      {/* Image modal */}
      {modalItem && (
        <div className="image-modal-overlay" onClick={() => setModalItem(null)}>
          <div className="image-modal" onClick={e => e.stopPropagation()}>
            <button className="image-modal-close" onClick={() => setModalItem(null)}><X size={16} /></button>
            {modalItem.imageUrl
              ? <img src={modalItem.imageUrl} alt={modalItem.name} />
              : <div style={{ width: 400, height: 300, background: '#1a1a25', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6a6a80' }}>No image</div>
            }
            <div className="image-modal-name">{modalItem.name}</div>
            {modalItem.included?.length > 0 && (
              <div className="image-modal-included">
                <h4>Included Accessories</h4>
                <ul>{modalItem.included.map((inc, i) => <li key={i}>{inc}</li>)}</ul>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="main">
        {/* Production selector — only shown when production is required */}
        {requireProductionSetting && (view === 'browse' || view === 'checkout') && (
          <div style={{ marginBottom: '1.5rem' }}>
            {!selectedProductionId ? (
              <div style={{ background: 'rgba(249,115,22,.08)', border: '1px solid rgba(249,115,22,.3)', borderRadius: 16, padding: '1.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
                  <span style={{ fontSize: '2rem', flexShrink: 0 }}>🎬</span>
                  <div style={{ flex: 1 }}>
                    <h2 style={{ fontWeight: 700, fontSize: '1rem', color: '#f0f0f5', marginBottom: 4 }}>Select a production to book equipment</h2>
                    <p style={{ fontSize: '.82rem', color: '#6a6a80', marginBottom: '1rem' }}>
                      Equipment can only be booked for a registered production with a completed plan.
                      Your production needs a script breakdown, crew, cast, locations and shooting schedule.
                    </p>
                    {readinessLoading ? (
                      <p style={{ fontSize: '.82rem', color: '#4a4a60' }}>Loading productions…</p>
                    ) : userProductions.length === 0 ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <p style={{ fontSize: '.82rem', color: '#4a4a60' }}>You have no productions yet.</p>
                        <Link to="/production" style={{ background: '#f97316', color: '#fff', fontWeight: 700, fontSize: '.8rem', padding: '7px 14px', borderRadius: 10, textDecoration: 'none' }}>
                          Go to Productions →
                        </Link>
                      </div>
                    ) : (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 10 }}>
                        {userProductions.map(prod => {
                          const r = productionReadiness[prod.id]
                          return (
                            <button
                              key={prod.id}
                              type="button"
                              onClick={() => r?.isReady ? setSelectedProductionId(prod.id) : undefined}
                              style={{
                                textAlign: 'left', padding: '14px', borderRadius: 12, cursor: r?.isReady ? 'pointer' : 'not-allowed',
                                transition: 'all .15s', opacity: r?.isReady ? 1 : 0.65,
                                background: r?.isReady ? 'rgba(16,185,129,.1)' : 'rgba(255,255,255,.04)',
                                border: `1px solid ${r?.isReady ? 'rgba(16,185,129,.4)' : 'rgba(255,255,255,.1)'}`,
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                                <p style={{ fontWeight: 600, fontSize: '.85rem', color: '#f0f0f5', margin: 0 }}>{prod.title}</p>
                                {r?.isReady
                                  ? <span style={{ fontSize: '.65rem', fontWeight: 700, background: 'rgba(16,185,129,.2)', color: '#34d399', border: '1px solid rgba(16,185,129,.3)', borderRadius: 20, padding: '2px 7px' }}>✓ Ready</span>
                                  : <span style={{ fontSize: '.65rem', fontWeight: 700, background: 'rgba(255,255,255,.08)', color: '#6a6a80', borderRadius: 20, padding: '2px 7px' }}>{r?.score ?? 0}%</span>
                                }
                              </div>
                              <div style={{ height: 3, background: 'rgba(255,255,255,.08)', borderRadius: 99, overflow: 'hidden', marginBottom: 6 }}>
                                <div style={{ height: '100%', borderRadius: 99, width: `${r?.score ?? 0}%`, background: r?.isReady ? '#10b981' : '#f97316', transition: 'width .4s' }} />
                              </div>
                              {!r?.isReady && (r?.missing ?? []).map((m, i) => (
                                <p key={i} style={{ fontSize: '.7rem', color: '#4a4a60', margin: '2px 0', display: 'flex', gap: 4 }}>
                                  <span style={{ color: '#f87171' }}>✕</span>{m}
                                </p>
                              ))}
                              {r?.isReady && <p style={{ fontSize: '.7rem', color: '#34d399', margin: 0 }}>Click to book equipment for this production</p>}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ background: 'rgba(16,185,129,.08)', border: '1px solid rgba(16,185,129,.3)', borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: '1.5rem' }}>🎬</span>
                    <div>
                      <p style={{ fontSize: '.65rem', color: '#34d399', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', margin: 0 }}>Booking for production</p>
                      <p style={{ fontWeight: 700, color: '#f0f0f5', margin: 0, fontSize: '.9rem' }}>{selectedProduction?.title}</p>
                    </div>
                  </div>
                  <button onClick={() => setSelectedProductionId(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '.75rem', color: '#4a4a60', textDecoration: 'underline' }}>
                    Change
                  </button>
                </div>
                {budgetInfo && (
                  <div style={{ background: '#0e0e16', border: '1px solid #2a2a3a', borderRadius: 12, padding: '12px 16px' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', marginBottom: 8 }}>
                      <div>
                        <p style={{ fontSize: '.6rem', color: '#6a6a80', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', margin: '0 0 2px' }}>Total budget</p>
                        <p style={{ fontSize: '.95rem', fontWeight: 700, color: '#f0f0f5', margin: 0 }}>{budgetInfo.limit.toLocaleString('sv-SE')} <span style={{ fontWeight: 400, color: '#6a6a80', fontSize: '.75rem' }}>SEK</span></p>
                      </div>
                      <div>
                        <p style={{ fontSize: '.6rem', color: '#6a6a80', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', margin: '0 0 2px' }}>Salaries</p>
                        <p style={{ fontSize: '.95rem', fontWeight: 700, color: '#60a5fa', margin: 0 }}>{budgetInfo.salaryCost.toLocaleString('sv-SE')} <span style={{ fontWeight: 400, color: '#6a6a80', fontSize: '.75rem' }}>/ {budgetInfo.limit.toLocaleString('sv-SE')} SEK</span></p>
                      </div>
                      <div>
                        <p style={{ fontSize: '.6rem', color: '#6a6a80', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', margin: '0 0 2px' }}>Equipment budget</p>
                        <p style={{ fontSize: '.95rem', fontWeight: 700, color: totalPrice > budgetInfo.equipmentBudget ? '#f87171' : '#34d399', margin: 0 }}>
                          {(budgetInfo.equipmentBudget - totalPrice).toLocaleString('sv-SE')} <span style={{ fontWeight: 400, color: '#6a6a80', fontSize: '.75rem' }}>/ {budgetInfo.equipmentBudget.toLocaleString('sv-SE')} SEK remaining</span>
                        </p>
                      </div>
                    </div>
                    {/* progress bar */}
                    <div style={{ height: 5, background: '#1e1e2e', borderRadius: 99, overflow: 'hidden', display: 'flex' }}>
                      <div style={{ height: '100%', background: '#3b82f6', transition: 'width .4s', width: `${Math.min((budgetInfo.salaryCost / budgetInfo.limit) * 100, 100)}%` }} />
                      <div style={{ height: '100%', background: '#10b981', transition: 'width .4s', width: `${Math.min((totalPrice / budgetInfo.limit) * 100, 100)}%` }} />
                    </div>
                    <div style={{ display: 'flex', gap: '1rem', marginTop: 5 }}>
                      <span style={{ fontSize: '.65rem', color: '#3b82f6' }}>■ Salaries</span>
                      <span style={{ fontSize: '.65rem', color: '#10b981' }}>■ Equipment in cart</span>
                      <span style={{ fontSize: '.65rem', color: '#3a3a4a' }}>■ Available</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Browse view */}
        {view === 'browse' && (
          <>
            <div className="toolbar">
              <div className="category-filter">
                {CATEGORIES.map(cat => (
                  <button
                    key={cat}
                    className={`category-btn${category === cat ? ' active' : ''}`}
                    onClick={() => setCategory(cat)}
                  >
                    {cat}
                    <span className="category-count">{categoryCounts[cat] ?? 0}</span>
                  </button>
                ))}
              </div>
              <div className="search-bar">
                <span className="search-icon"><Search size={16} /></span>
                <input
                  type="text"
                  placeholder="Search equipment..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
                {search && (
                  <button className="search-clear" onClick={() => setSearch('')}><X size={14} /></button>
                )}
              </div>
            </div>

            <div className="results-info">
              <span>{filtered.length} items</span>
              {category !== 'ALL' && <span className="active-filter">{category}</span>}
              {search && <span className="active-filter">"{search}"</span>}
            </div>

            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <span className="text-4xl block mb-3">📦</span>
                <p className="text-zinc-300 font-semibold text-sm">No equipment found</p>
                <p className="text-zinc-500 text-xs mt-1">Try adjusting your search or category filter.</p>
              </div>
            ) : (
              <div className="product-grid">
                {filtered.map(item => {
                  const inCart = cart.has(item.id)
                  const qty = cart.get(item.id)?.quantity ?? 1
                  const outOfStock = item.available <= 0
                  const locked = isItemLocked(item)
                  const budgetBlocked = !inCart && isOverEquipmentBudget(item)
                  const needsProduction = requireProductionSetting && item.requiresProduction !== false
                  const disabled = outOfStock || locked || budgetBlocked
                  return (
                    <div className={`product-card${inCart ? ' card-added' : ''}`} key={item.id}
                      style={{ opacity: locked || budgetBlocked ? 0.55 : 1 }}>
                      <div className="product-image" onClick={() => setModalItem(item)}>
                        {item.imageUrl
                          ? <img src={item.imageUrl} alt={item.name} />
                          : <div className="image-placeholder"><Package size={32} color="#3a3a4a" /><br />{item.name}</div>
                        }
                        <span className="product-category-tag">{item.category}</span>
                        {locked && (
                          <span className="film-year2-badge"><Lock size={10} /> Restricted</span>
                        )}
                      </div>
                      <div className="product-info">
                        <div className="product-name">{item.name}</div>
                        {locked
                          ? <div style={{ fontSize: '.7rem', color: '#f59e0b', fontWeight: 600 }}>Not available for your class</div>
                          : outOfStock
                            ? <div style={{ fontSize: '.7rem', color: '#ff4757', fontWeight: 600 }}>Out of stock</div>
                            : budgetBlocked
                              ? <div style={{ fontSize: '.7rem', color: '#f87171', fontWeight: 600 }}>💰 Over budget</div>
                              : <div className="product-available">{item.available} available</div>
                        }
                        {item.notes && <div className="product-notes">{item.notes}</div>}
                        {item.description && <div className="product-description">{item.description}</div>}
                        <div className="product-pricing">
                          {item.priceInclVat > 0
                            ? <>
                                <span className="price-day">{item.priceInclVat} kr/day</span>
                                <span className="price-week">{weeklyRate(item.priceInclVat).toFixed(0)} kr/week</span>
                              </>
                            : <span className="price-free">Free</span>
                          }
                        </div>
                        <div className="product-actions">
                          {!disabled && !inCart && (
                            <div className="qty-selector">
                              <button className="day-btn" onClick={() => {/* min 1 */}}>−</button>
                              <span className="day-count">{qty}</span>
                              <button className="day-btn">+</button>
                            </div>
                          )}
                          <button
                            className={`add-to-cart-btn${inCart ? ' in-cart' : ''}`}
                            disabled={disabled || (needsProduction && !selectedProductionId)}
                            title={needsProduction && !selectedProductionId ? 'Select a production first' : undefined}
                            onClick={() => inCart ? removeFromCart(item.id) : addToCart(item)}
                          >
                            {inCart ? <><Check size={14} /> In Cart</> : '+ Add'}
                          </button>
                        </div>
                        {inCart && (
                          <button
                            className="primary-btn"
                            style={{ width: '100%', marginTop: 8, fontSize: '.8rem', padding: '8px 12px' }}
                            onClick={() => { setCartOpen(false); fromDate && toDate ? setView('checkout') : setCartOpen(true) }}
                          >
                            Go to Checkout →
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}

        {/* Checkout view */}
        {view === 'checkout' && (
          <div className="checkout-page">
            <button className="back-btn" onClick={() => setView('browse')}>
              ← Back to Equipment
            </button>
            <h2>Booking Inquiry</h2>
            <div className="checkout-layout">
              <div className="checkout-form">
                <div className="checkout-dates-confirm">
                  <Calendar size={20} color="#4cd964" style={{ flexShrink: 0, marginTop: 2 }} />
                  <div style={{ flex: 1 }}>
                    <span className="dates-label">Rental Period</span>
                    <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 140 }}>
                        <label style={{ fontSize: '.7rem', color: '#6a6a80', fontWeight: 600 }}>From</label>
                        <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
                          style={{ background: '#1a1a28', border: '1px solid #2a2a3a', borderRadius: 8, color: '#f0f0f5', padding: '6px 10px', fontSize: '.85rem', width: '100%' }} />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 140 }}>
                        <label style={{ fontSize: '.7rem', color: '#6a6a80', fontWeight: 600 }}>To</label>
                        <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
                          style={{ background: '#1a1a28', border: '1px solid #2a2a3a', borderRadius: 8, color: '#f0f0f5', padding: '6px 10px', fontSize: '.85rem', width: '100%' }} />
                      </div>
                    </div>
                    {rentalDays > 0 && (
                      <p style={{ fontSize: '.75rem', color: '#6a6a80', marginTop: 6 }}>
                        {rentalDays} rental {rentalDays === 1 ? 'day' : 'days'}
                        {weekDiscountActive && ` · billed ${chargeableDays} days (week discount)`}
                      </p>
                    )}
                  </div>
                </div>

                <div className="form-group">
                  <label>Your Name</label>
                  <input type="text" value={contactName} onChange={e => setContactName(e.target.value)} placeholder="Full name" />
                </div>
                <div className="form-group">
                  <label>Project Name</label>
                  <input type="text" value={projectName} onChange={e => setProjectName(e.target.value)} placeholder="e.g. Short Film Title" />
                </div>

                {submitError && <div className="error-msg">{submitError}</div>}

                <div className="checkout-buttons">
                  {(!fromDate || !toDate) && (
                    <p style={{ fontSize: '.8rem', color: '#f59e0b', marginBottom: 8 }}>⚠ Set rental dates before sending</p>
                  )}
                  <button
                    className="primary-btn"
                    disabled={submitting || !contactName || !projectName || !fromDate || !toDate}
                    onClick={handleSubmit}
                  >
                    {submitting ? 'Sending...' : 'Send Booking'}
                  </button>
                  <button className="secondary-btn" onClick={() => setView('browse')}>Cancel</button>
                </div>
              </div>

              <div className="checkout-summary">
                <h3>Order Summary</h3>
                <div className="summary-items">
                  {cartList.map(({ item, quantity }) => (
                    <div className="summary-item" key={item.id}>
                      <div>
                        <span className="summary-name">{item.name}</span>
                        <span className="summary-days">×{quantity} · {chargeableDays} days{weekDiscountActive ? ` (of ${rentalDays})` : ''}</span>
                      </div>
                      <span className="summary-price">
                        {item.priceInclVat > 0 ? `${(item.priceInclVat * quantity * chargeableDays).toFixed(0)} kr` : 'Free'}
                      </span>
                    </div>
                  ))}
                  {weekDiscountActive && (
                    <div className="summary-item" style={{ borderTop: '1px solid rgba(76,217,100,.2)', paddingTop: '.5rem', marginTop: '.25rem' }}>
                      <span style={{ fontSize: '.8rem', color: '#4cd964', fontWeight: 600 }}>🎉 Week discount applied</span>
                      <span style={{ fontSize: '.8rem', color: '#4cd964', fontWeight: 600 }}>
                        −{((rentalDays - chargeableDays) * cartList.reduce((s, { item, quantity }) => s + item.priceInclVat * quantity, 0)).toFixed(0)} kr
                      </span>
                    </div>
                  )}
                </div>
                <div className="summary-total">
                  <span>Total</span>
                  <strong>{totalPrice > 0 ? `${totalPrice.toFixed(0)} kr` : 'Free'}</strong>
                </div>
                {budgetInfo && (
                  <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 8, background: '#0e0e16', border: '1px solid #2a2a3a', fontSize: '.78rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ color: '#6a6a80' }}>Salaries</span>
                      <span style={{ color: '#60a5fa', fontWeight: 600 }}>{budgetInfo.salaryCost.toLocaleString('sv-SE')} SEK</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ color: '#6a6a80' }}>Equipment (this booking)</span>
                      <span style={{ color: '#f0f0f5', fontWeight: 600 }}>{totalPrice.toFixed(0)} SEK</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #2a2a3a', paddingTop: 6 }}>
                      <span style={{ color: '#6a6a80' }}>Total budget used</span>
                      <span style={{ color: (budgetInfo.salaryCost + totalPrice) > budgetInfo.limit ? '#f87171' : '#34d399', fontWeight: 700 }}>
                        {(budgetInfo.salaryCost + totalPrice).toLocaleString('sv-SE')} / {budgetInfo.limit.toLocaleString('sv-SE')} SEK
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Success view */}
        {view === 'success' && (
          <div className="checkout-success">
            <div className="success-icon">
              <CheckCircle2 size={40} />
            </div>
            <h2>Booking Sent!</h2>
            <p>Your booking inquiry has been sent. You'll be contacted to confirm the details.</p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="primary-btn" onClick={resetAll}>Back to Equipment</button>
              <button className="secondary-btn" onClick={() => setView('my-bookings')}>View My Bookings</button>
            </div>
          </div>
        )}

        {/* My Bookings view */}
        {view === 'my-bookings' && (
          <div className="checkout-page">
            <button className="back-btn" onClick={() => setView('browse')}>← Back to Equipment</button>
            <h2>My Bookings</h2>
            {myBookings.length === 0 ? (
              <div className="no-results">You have no bookings yet.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {myBookings.map(b => {
                  const statusColors: Record<string, string> = {
                    pending: '#f59e0b', confirmed: '#3b82f6',
                    'checked-out': '#f97316', returned: '#4cd964', cancelled: '#6b7280',
                  }
                  const statusIcons: Record<string, React.ReactNode> = {
                    pending: <Clock size={13} />, confirmed: <Check size={13} />,
                    'checked-out': <Truck size={13} />, returned: <RotateCcw size={13} />,
                    cancelled: <XCircle size={13} />,
                  }
                  const color = statusColors[b.status] ?? '#8a8aab'
                  return (
                    <div key={b.id} style={{ background: '#1a1a25', border: '1px solid #2a2a3a', borderRadius: 12, padding: '1rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                        <span style={{ fontWeight: 700, fontSize: '.95rem', color: '#f0f0f5' }}>{b.projectName}</span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '.75rem', fontWeight: 700, color, background: `${color}18`, border: `1px solid ${color}40`, borderRadius: 20, padding: '3px 9px' }}>
                          {statusIcons[b.status]} {b.status.replace('-', ' ')}
                        </span>
                      </div>
                      <div style={{ fontSize: '.8rem', color: '#6a6a80', marginBottom: 6 }}>
                        <Calendar size={11} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                        {formatDate(b.checkoutDate)} – {formatDate(b.returnDate)}
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                        {b.items.map((it, i) => (
                          <span key={i} style={{ fontSize: '.72rem', background: '#0e0e16', border: '1px solid #2a2a3a', borderRadius: 20, padding: '2px 8px', color: '#c0c0d5' }}>
                            {it.quantity}× {it.equipmentName}
                          </span>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
