import { useState, useMemo, useRef } from 'react'
import { addDoc, collection, serverTimestamp, updateDoc, doc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useCollection, useDocument, orderBy, where } from '@/hooks/useFirestore'
import { cn } from '@/lib/utils'
import type {
  EquipmentDoc, EquipmentCategory, EquipmentBookingDoc, EquipmentBookingItem, CohortDoc,
} from '@/types'
import {
  Package, Search, ShoppingCart, X, Plus, Minus, ChevronRight,
  Lock, Calendar, CheckCircle, Clock, Truck, RotateCcw, XCircle, Image as ImageIcon,
} from 'lucide-react'
import LoadingSpinner from '@/components/common/LoadingSpinner'

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORIES: EquipmentCategory[] = ['CAMERA', 'GRIP', 'LIGHTS', 'SOUND', 'LOCATION', 'BOOKS', 'OTHER']

const CATEGORY_STYLE: Record<EquipmentCategory, string> = {
  CAMERA:   'text-blue-300 bg-blue-900/30 border-blue-700/40',
  GRIP:     'text-orange-300 bg-orange-900/30 border-orange-700/40',
  LIGHTS:   'text-yellow-300 bg-yellow-900/30 border-yellow-700/40',
  SOUND:    'text-green-300 bg-green-900/30 border-green-700/40',
  LOCATION: 'text-purple-300 bg-purple-900/30 border-purple-700/40',
  BOOKS:    'text-pink-300 bg-pink-900/30 border-pink-700/40',
  OTHER:    'text-zinc-300 bg-zinc-700/30 border-zinc-600/40',
}

const STATUS_CONFIG: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; style: string }> = {
  pending:      { label: 'Pending',     icon: Clock,        style: 'text-amber-300 bg-amber-900/30 border-amber-700/40'   },
  confirmed:    { label: 'Confirmed',   icon: CheckCircle,  style: 'text-blue-300 bg-blue-900/30 border-blue-700/40'      },
  'checked-out':{ label: 'Checked Out', icon: Truck,        style: 'text-orange-300 bg-orange-900/30 border-orange-700/40' },
  returned:     { label: 'Returned',    icon: RotateCcw,    style: 'text-green-300 bg-green-900/30 border-green-700/40'   },
  cancelled:    { label: 'Cancelled',   icon: XCircle,      style: 'text-zinc-400 bg-zinc-800/40 border-zinc-600/40'      },
}

// ── Cart types ────────────────────────────────────────────────────────────────

interface CartItem {
  equipment: EquipmentDoc
  quantity: number
}

// ── Equipment Card ────────────────────────────────────────────────────────────

function EquipmentCard({ item, cartQty, isYear2, onAdd, onRemove }: {
  item: EquipmentDoc
  cartQty: number
  isYear2: boolean
  onAdd: () => void
  onRemove: () => void
}) {
  const locked   = item.filmYear2Only && !isYear2
  const soldOut  = item.available === 0
  const disabled = locked || soldOut

  return (
    <div className={cn(
      'bg-zinc-900 border rounded-2xl overflow-hidden flex flex-col transition-all',
      disabled ? 'border-white/5 opacity-60' : 'border-white/10 hover:border-white/20',
    )}>
      {/* Image */}
      <div className="relative h-44 bg-zinc-800 overflow-hidden flex-shrink-0">
        {item.imageUrl ? (
          <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <ImageIcon className="w-10 h-10 text-zinc-600" />
          </div>
        )}
        <span className={cn(
          'absolute top-2 left-2 text-[10px] font-bold tracking-wider px-2 py-0.5 rounded-full border',
          CATEGORY_STYLE[item.category],
        )}>
          {item.category}
        </span>
        {locked && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <div className="flex flex-col items-center gap-1">
              <Lock className="w-5 h-5 text-amber-400" />
              <span className="text-[10px] font-bold text-amber-300">Year 2 Only</span>
            </div>
          </div>
        )}
        {soldOut && !locked && (
          <div className="absolute bottom-2 right-2">
            <span className="text-[10px] font-bold text-rose-300 bg-rose-900/80 border border-rose-700/50 px-2 py-0.5 rounded-full">
              Unavailable
            </span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-3 flex flex-col flex-1 gap-2">
        <div className="flex-1">
          <p className="text-sm font-semibold text-zinc-100 leading-tight line-clamp-2">{item.name}</p>
          {item.description && (
            <p className="text-xs text-zinc-500 mt-1 line-clamp-2">{item.description}</p>
          )}
        </div>

        <div className="flex items-center justify-between text-xs">
          <span className={cn('font-medium', item.available === 0 ? 'text-rose-400' : 'text-green-400')}>
            {item.available} available
          </span>
          {item.priceInclVat > 0 && (
            <span className="text-zinc-400">{item.priceInclVat.toFixed(0)} kr</span>
          )}
        </div>

        {/* Cart controls */}
        {cartQty > 0 ? (
          <div className="flex items-center gap-2">
            <button
              onClick={onRemove}
              className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <span className="flex-1 text-center text-sm font-semibold text-white">{cartQty}</span>
            <button
              onClick={onAdd}
              disabled={cartQty >= item.available}
              className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-lg bg-brand-600 hover:bg-brand-500 text-white transition-colors disabled:opacity-40"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <button
            onClick={onAdd}
            disabled={disabled}
            className="w-full py-2 rounded-xl text-sm font-medium transition-colors disabled:opacity-40 bg-brand-600 hover:bg-brand-500 text-white disabled:bg-zinc-800 disabled:text-zinc-500"
          >
            {locked ? 'Year 2 Only' : soldOut ? 'Unavailable' : 'Add to Cart'}
          </button>
        )}
      </div>
    </div>
  )
}

// ── CartDrawer ────────────────────────────────────────────────────────────────

function CartDrawer({ items, onQtyChange, onRemove, onCheckout, onClose }: {
  items: CartItem[]
  onQtyChange: (id: string, qty: number) => void
  onRemove: (id: string) => void
  onCheckout: () => void
  onClose: () => void
}) {
  const total = items.reduce((sum, i) => sum + i.equipment.priceInclVat * i.quantity, 0)

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-sm bg-zinc-900 border-l border-white/10 flex flex-col shadow-2xl">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/10">
          <ShoppingCart className="w-4 h-4 text-brand-400" />
          <h2 className="font-semibold text-zinc-100 flex-1">Cart ({items.length} item{items.length !== 1 ? 's' : ''})</h2>
          <button onClick={onClose} className="p-1.5 text-zinc-500 hover:text-zinc-200 rounded-lg transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {items.length === 0 ? (
            <div className="text-center py-12 text-zinc-500">
              <ShoppingCart className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">Your cart is empty</p>
            </div>
          ) : (
            items.map(item => (
              <div key={item.equipment.id} className="flex items-start gap-3 bg-zinc-800/50 rounded-xl p-3">
                {item.equipment.imageUrl ? (
                  <img src={item.equipment.imageUrl} alt={item.equipment.name} className="w-12 h-12 object-cover rounded-lg flex-shrink-0" />
                ) : (
                  <div className="w-12 h-12 bg-zinc-700 rounded-lg flex-shrink-0 flex items-center justify-center">
                    <Package className="w-5 h-5 text-zinc-500" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-zinc-100 truncate">{item.equipment.name}</p>
                  {item.equipment.priceInclVat > 0 && (
                    <p className="text-xs text-zinc-400">{(item.equipment.priceInclVat * item.quantity).toFixed(0)} kr</p>
                  )}
                  <div className="flex items-center gap-2 mt-2">
                    <button
                      onClick={() => item.quantity > 1 ? onQtyChange(item.equipment.id, item.quantity - 1) : onRemove(item.equipment.id)}
                      className="w-6 h-6 flex items-center justify-center rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-300 transition-colors"
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                    <span className="text-sm font-semibold text-white w-5 text-center">{item.quantity}</span>
                    <button
                      onClick={() => onQtyChange(item.equipment.id, item.quantity + 1)}
                      disabled={item.quantity >= item.equipment.available}
                      className="w-6 h-6 flex items-center justify-center rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-300 transition-colors disabled:opacity-40"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                </div>
                <button onClick={() => onRemove(item.equipment.id)} className="p-1 text-zinc-600 hover:text-rose-400 transition-colors flex-shrink-0">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))
          )}
        </div>

        {items.length > 0 && (
          <div className="px-5 py-4 border-t border-white/10 space-y-3">
            {total > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-400">Total</span>
                <span className="font-semibold text-zinc-100">{total.toFixed(0)} kr</span>
              </div>
            )}
            <button
              onClick={onCheckout}
              className="w-full py-3 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-semibold flex items-center justify-center gap-2 transition-colors"
            >
              Checkout <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </>
  )
}

// ── CheckoutForm ──────────────────────────────────────────────────────────────

function CheckoutForm({ items, profile, cohortId, onSuccess, onBack }: {
  items: CartItem[]
  profile: { uid: string; displayName: string; email: string } | null
  cohortId: string | null
  onSuccess: () => void
  onBack: () => void
}) {
  const [projectName, setProjectName] = useState('')
  const [checkoutDate, setCheckoutDate] = useState('')
  const [returnDate, setReturnDate] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    if (!projectName.trim() || !checkoutDate || !returnDate) {
      setError('Please fill in all required fields')
      return
    }
    if (!profile?.uid) { setError('Not authenticated'); return }
    setSubmitting(true); setError(null)
    try {
      const bookingItems: EquipmentBookingItem[] = items.map(i => ({
        equipmentId: i.equipment.id,
        equipmentName: i.equipment.name,
        quantity: i.quantity,
      }))
      await addDoc(collection(db, 'equipment_bookings'), {
        studentId: profile.uid,
        studentName: profile.displayName ?? '',
        studentEmail: profile.email ?? '',
        cohortId: cohortId ?? '',
        projectName: projectName.trim(),
        items: bookingItems,
        checkoutDate,
        returnDate,
        teacherNotes: notes.trim(),
        status: 'pending',
        createdAt: serverTimestamp(),
      })
      onSuccess()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to submit booking')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-lg mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-zinc-500 hover:text-zinc-200 transition-colors">
          <ChevronRight className="w-4 h-4 rotate-180" />
        </button>
        <h2 className="text-lg font-bold text-zinc-100">Checkout</h2>
      </div>

      {/* Items summary */}
      <div className="bg-zinc-900 border border-white/10 rounded-2xl p-4 space-y-2">
        <p className="text-xs text-zinc-500 uppercase tracking-wider font-semibold mb-3">Items ({items.length})</p>
        {items.map(item => (
          <div key={item.equipment.id} className="flex items-center justify-between text-sm">
            <span className="text-zinc-300">{item.equipment.name}</span>
            <span className="text-zinc-500">×{item.quantity}</span>
          </div>
        ))}
      </div>

      {/* Form */}
      <div className="space-y-4">
        <div>
          <label className="label">Project Name *</label>
          <input
            value={projectName} onChange={e => setProjectName(e.target.value)}
            className="input" placeholder="e.g. Short Film — Spring 2026"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Checkout Date *</label>
            <input type="date" value={checkoutDate} onChange={e => setCheckoutDate(e.target.value)} className="input [color-scheme:dark]" />
          </div>
          <div>
            <label className="label">Return Date *</label>
            <input type="date" value={returnDate} onChange={e => setReturnDate(e.target.value)} className="input [color-scheme:dark]" />
          </div>
        </div>
        <div>
          <label className="label">Student <span className="text-zinc-500 font-normal">(pre-filled)</span></label>
          <input value={profile?.displayName ?? ''} disabled className="input opacity-60 cursor-not-allowed" />
        </div>
        <div>
          <label className="label">Notes <span className="text-zinc-500 font-normal">(optional)</span></label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} className="input resize-none" placeholder="Any special requests or notes…" />
        </div>
      </div>

      {error && (
        <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-800/50 rounded-xl px-3 py-2.5">
          {error}
        </div>
      )}

      <button
        onClick={handleSubmit}
        disabled={submitting || !projectName.trim() || !checkoutDate || !returnDate}
        className="w-full py-3 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-semibold transition-colors disabled:opacity-50"
      >
        {submitting ? 'Submitting…' : 'Submit Booking Request'}
      </button>
    </div>
  )
}

// ── Confirmation screen ───────────────────────────────────────────────────────

function ConfirmationScreen({ onDone }: { onDone: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
      <div className="w-16 h-16 rounded-full bg-green-900/40 border-2 border-green-600/50 flex items-center justify-center">
        <CheckCircle className="w-8 h-8 text-green-400" />
      </div>
      <div>
        <h2 className="text-xl font-bold text-zinc-100">Booking request sent!</h2>
        <p className="text-sm text-zinc-400 mt-1">Your teacher will confirm it soon.</p>
      </div>
      <button
        onClick={onDone}
        className="mt-4 px-6 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-medium transition-colors"
      >
        View my bookings
      </button>
    </div>
  )
}

// ── My Bookings tab ───────────────────────────────────────────────────────────

function MyBookingsTab({ uid }: { uid: string }) {
  const { data: bookingsRaw, loading } = useCollection<EquipmentBookingDoc>(
    'equipment_bookings',
    [where('studentId', '==', uid)],
    !!uid,
    uid,
  )
  const bookings = useMemo(
    () => [...bookingsRaw].sort((a, b) => {
      const ta = (b.createdAt as any)?.toMillis?.() ?? 0
      const tb = (a.createdAt as any)?.toMillis?.() ?? 0
      return ta - tb
    }),
    [bookingsRaw],
  )

  if (loading) return <div className="flex justify-center py-16"><LoadingSpinner /></div>

  if (bookings.length === 0) {
    return (
      <div className="text-center py-16 text-zinc-500">
        <Package className="w-10 h-10 mx-auto mb-3 opacity-30" />
        <p className="text-sm">No equipment bookings yet</p>
        <p className="text-xs mt-1">Browse the catalog and add items to cart</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {bookings.map(booking => {
        const cfg = STATUS_CONFIG[booking.status]
        const Icon = cfg?.icon ?? Clock
        return (
          <div key={booking.id} className="bg-zinc-900 border border-white/8 rounded-2xl p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-zinc-100">{booking.projectName}</p>
                <p className="text-xs text-zinc-500 mt-0.5">
                  {booking.checkoutDate} → {booking.returnDate}
                </p>
              </div>
              <span className={cn('flex items-center gap-1.5 text-[10px] font-bold tracking-wider px-2.5 py-1 rounded-full border flex-shrink-0', cfg?.style)}>
                <Icon className="w-3 h-3" />
                {cfg?.label}
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {booking.items?.map((item, i) => (
                <span key={i} className="text-xs bg-zinc-800 text-zinc-300 px-2.5 py-1 rounded-full">
                  {item.quantity}× {item.equipmentName}
                </span>
              ))}
            </div>

            {booking.teacherNotes && (
              <p className="text-xs text-zinc-500 italic border-l-2 border-brand-500/30 pl-2">{booking.teacherNotes}</p>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

type View = 'browse' | 'checkout' | 'confirmed'

export default function EquipmentBooking() {
  const { profile } = useAuth()
  const uid = profile?.uid ?? ''
  const cohortId = profile?.cohortId ?? null

  const { data: cohort } = useDocument<CohortDoc>('cohorts', cohortId ?? '')
  const isYear2 = cohort?.programYear === 2

  const { data: equipmentRaw, loading } = useCollection<EquipmentDoc>('equipment')
  const equipment = useMemo(
    () => equipmentRaw.filter(e => e.isActive).sort((a, b) => a.name.localeCompare(b.name)),
    [equipmentRaw],
  )

  const [tab, setTab] = useState<'browse' | 'myBookings'>('browse')
  const [view, setView] = useState<View>('browse')
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState<'ALL' | EquipmentCategory>('ALL')
  const [cart, setCart] = useState<Map<string, CartItem>>(new Map())
  const [cartOpen, setCartOpen] = useState(false)

  const cartCount = Array.from(cart.values()).reduce((s, i) => s + i.quantity, 0)
  const cartItems = Array.from(cart.values())

  const filtered = useMemo(() => equipment.filter(e => {
    if (catFilter !== 'ALL' && e.category !== catFilter) return false
    if (search && !e.name.toLowerCase().includes(search.toLowerCase()) && !e.description?.toLowerCase().includes(search.toLowerCase())) return false
    return true
  }), [equipment, catFilter, search])

  function addToCart(item: EquipmentDoc) {
    setCart(prev => {
      const next = new Map(prev)
      const existing = next.get(item.id)
      if (existing) {
        if (existing.quantity < item.available) {
          next.set(item.id, { ...existing, quantity: existing.quantity + 1 })
        }
      } else {
        next.set(item.id, { equipment: item, quantity: 1 })
      }
      return next
    })
  }

  function removeFromCart(id: string) {
    setCart(prev => { const next = new Map(prev); next.delete(id); return next })
  }

  function setCartQty(id: string, qty: number) {
    setCart(prev => {
      const next = new Map(prev)
      const existing = next.get(id)
      if (existing) next.set(id, { ...existing, quantity: qty })
      return next
    })
  }

  function handleDecrease(item: EquipmentDoc) {
    const existing = cart.get(item.id)
    if (!existing) return
    if (existing.quantity <= 1) removeFromCart(item.id)
    else setCartQty(item.id, existing.quantity - 1)
  }

  if (view === 'confirmed') {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        <ConfirmationScreen onDone={() => { setView('browse'); setTab('myBookings'); setCart(new Map()) }} />
      </div>
    )
  }

  if (view === 'checkout') {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        <CheckoutForm
          items={cartItems}
          profile={profile ? { uid, displayName: profile.displayName, email: profile.email ?? '' } : null}
          cohortId={cohortId}
          onSuccess={() => setView('confirmed')}
          onBack={() => setView('browse')}
        />
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Package className="w-5 h-5 text-brand-400" />
          <h1 className="text-xl font-bold text-zinc-100">Equipment</h1>
        </div>
        {/* Cart button */}
        <button
          onClick={() => setCartOpen(true)}
          className="relative flex items-center gap-2 px-3 py-2 rounded-xl bg-zinc-900 border border-white/10 hover:border-white/20 text-zinc-300 transition-colors"
        >
          <ShoppingCart className="w-4 h-4" />
          <span className="text-sm font-medium hidden sm:block">Cart</span>
          {cartCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 flex items-center justify-center rounded-full bg-brand-600 text-white text-[10px] font-bold px-1">
              {cartCount}
            </span>
          )}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-zinc-900 border border-white/10 rounded-xl p-1 w-fit">
        {([['browse', 'Browse'], ['myBookings', 'My Bookings']] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              'px-4 py-1.5 text-sm font-medium rounded-lg transition-colors',
              tab === id ? 'bg-brand-600 text-white' : 'text-zinc-400 hover:text-zinc-200',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'myBookings' && <MyBookingsTab uid={uid} />}

      {tab === 'browse' && (
        <>
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              className="input pl-9" placeholder="Search equipment…"
            />
          </div>

          {/* Category filters */}
          <div className="flex flex-wrap gap-1.5">
            {(['ALL', ...CATEGORIES] as const).map(cat => (
              <button
                key={cat}
                onClick={() => setCatFilter(cat)}
                className={cn(
                  'px-3 py-1 text-xs font-semibold rounded-full border transition-colors',
                  catFilter === cat
                    ? 'bg-brand-600 text-white border-brand-500'
                    : cat === 'ALL' ? 'text-zinc-300 bg-zinc-800 border-white/10 hover:bg-zinc-700'
                    : cn('border', CATEGORY_STYLE[cat as EquipmentCategory], 'hover:opacity-80'),
                )}
              >
                {cat}
              </button>
            ))}
            <span className="ml-auto text-xs text-zinc-500 self-center">{filtered.length} items</span>
          </div>

          {/* Grid */}
          {loading ? (
            <div className="flex justify-center py-16"><LoadingSpinner /></div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 text-zinc-500">
              <Package className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">{search || catFilter !== 'ALL' ? 'No results — try clearing your filters' : 'No equipment available'}</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {filtered.map(item => (
                <EquipmentCard
                  key={item.id}
                  item={item}
                  cartQty={cart.get(item.id)?.quantity ?? 0}
                  isYear2={isYear2 ?? false}
                  onAdd={() => addToCart(item)}
                  onRemove={() => handleDecrease(item)}
                />
              ))}
            </div>
          )}

          {/* Floating checkout bar when cart has items */}
          {cartCount > 0 && (
            <div className="fixed bottom-20 sm:bottom-6 left-1/2 -translate-x-1/2 z-30">
              <button
                onClick={() => setView('checkout')}
                className="flex items-center gap-3 px-6 py-3 rounded-2xl bg-brand-600 hover:bg-brand-500 text-white font-semibold shadow-2xl shadow-brand-900/50 transition-colors"
              >
                <ShoppingCart className="w-4 h-4" />
                Checkout ({cartCount} item{cartCount !== 1 ? 's' : ''})
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </>
      )}

      {/* Cart drawer */}
      {cartOpen && (
        <CartDrawer
          items={cartItems}
          onQtyChange={setCartQty}
          onRemove={removeFromCart}
          onCheckout={() => { setCartOpen(false); setView('checkout') }}
          onClose={() => setCartOpen(false)}
        />
      )}
    </div>
  )
}
