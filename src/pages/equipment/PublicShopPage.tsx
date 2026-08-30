import { useState, useEffect, useMemo } from 'react'
import {
  collection, getDocs, addDoc, serverTimestamp, query, where, getDoc, doc,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { EquipmentDoc, EquipmentCategoryDoc } from '@/types'
import { ShoppingCart, X, Plus, Minus, Package, ChevronRight, CheckCircle2, Search } from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface CartItem {
  id: string
  name: string
  category: string
  priceInclVat: number
  qty: number
  imageUrl: string
}

interface CheckoutForm {
  name: string
  email: string
  phone: string
  project: string
  checkoutDate: string
  returnDate: string
  notes: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCurrency(n: number) {
  return new Intl.NumberFormat('sv-SE', { style: 'currency', currency: 'SEK', maximumFractionDigits: 0 }).format(n)
}

function daysBetween(from: string, to: string): number {
  const d1 = new Date(from)
  const d2 = new Date(to)
  const diff = Math.ceil((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24))
  return Math.max(1, diff + 1)
}

function todayStr() {
  return new Date().toISOString().split('T')[0]
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PublicShopPage() {
  // ── Password gate state ────────────────────────────────────────────────────
  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem('shop_unlocked') === '1')
  const [pin, setPin] = useState('')
  const [pinError, setPinError] = useState(false)
  const [shopPassword, setShopPassword] = useState<string | null>(null)
  const [shopName, setShopName] = useState('Equipment Shop')
  const [passwordLoading, setPasswordLoading] = useState(true)

  // ── Catalog state ──────────────────────────────────────────────────────────
  const [equipment, setEquipment] = useState<EquipmentDoc[]>([])
  const [categories, setCategories] = useState<EquipmentCategoryDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>('all')

  // ── Cart state ─────────────────────────────────────────────────────────────
  const [cart, setCart] = useState<CartItem[]>([])
  const [cartOpen, setCartOpen] = useState(false)

  // ── Checkout state ─────────────────────────────────────────────────────────
  const [view, setView] = useState<'catalog' | 'checkout' | 'success'>('catalog')
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState<CheckoutForm>({
    name: '', email: '', phone: '', project: '',
    checkoutDate: '', returnDate: '', notes: '',
  })
  const [formErrors, setFormErrors] = useState<Partial<Record<keyof CheckoutForm, string>>>({})

  // ── Load school doc for password ───────────────────────────────────────────
  useEffect(() => {
    getDoc(doc(db, 'schools', 'molkom')).then(snap => {
      if (snap.exists()) {
        const data = snap.data()
        setShopPassword(data.shopPassword ?? null)
        setShopName(data.name ?? 'Equipment Shop')
      }
      setPasswordLoading(false)
    }).catch(() => {
      setPasswordLoading(false)
    })
  }, [])

  // ── Load equipment + categories ────────────────────────────────────────────
  useEffect(() => {
    if (!unlocked && shopPassword !== null) return // wait until unlocked

    async function load() {
      setLoading(true)
      try {
        const [equipSnap, catSnap] = await Promise.all([
          getDocs(query(collection(db, 'equipment'), where('isActive', '==', true))),
          getDocs(collection(db, 'equipment_categories')),
        ])
        setEquipment(equipSnap.docs.map(d => ({ id: d.id, ...d.data() } as EquipmentDoc)))
        setCategories(catSnap.docs.map(d => ({ id: d.id, ...d.data() } as EquipmentCategoryDoc)).sort((a, b) => a.order - b.order))
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [unlocked, shopPassword])

  // ── PIN check ──────────────────────────────────────────────────────────────
  function checkPin() {
    if (pin === shopPassword) {
      sessionStorage.setItem('shop_unlocked', '1')
      setUnlocked(true)
      setPinError(false)
    } else {
      setPinError(true)
      setPin('')
    }
  }

  // ── Cart helpers ───────────────────────────────────────────────────────────
  function addToCart(item: EquipmentDoc) {
    setCart(prev => {
      const existing = prev.find(c => c.id === item.id)
      if (existing) {
        return prev.map(c => c.id === item.id ? { ...c, qty: c.qty + 1 } : c)
      }
      return [...prev, {
        id: item.id, name: item.name, category: item.category,
        priceInclVat: item.priceInclVat, qty: 1, imageUrl: item.imageUrl,
      }]
    })
  }

  function updateQty(id: string, delta: number) {
    setCart(prev => {
      const updated = prev.map(c => c.id === id ? { ...c, qty: Math.max(0, c.qty + delta) } : c)
      return updated.filter(c => c.qty > 0)
    })
  }

  function removeFromCart(id: string) {
    setCart(prev => prev.filter(c => c.id !== id))
  }

  const cartCount = cart.reduce((s, c) => s + c.qty, 0)
  const days = form.checkoutDate && form.returnDate ? daysBetween(form.checkoutDate, form.returnDate) : 1
  const cartTotal = cart.reduce((s, c) => s + c.qty * c.priceInclVat * days, 0)

  // ── Filtered equipment ─────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let items = equipment
    if (selectedCategory !== 'all') items = items.filter(e => e.category === selectedCategory)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      items = items.filter(e => e.name.toLowerCase().includes(q) || e.category.toLowerCase().includes(q))
    }
    return items
  }, [equipment, selectedCategory, searchQuery])

  // ── Form validation ────────────────────────────────────────────────────────
  function validateForm(): boolean {
    const errors: Partial<Record<keyof CheckoutForm, string>> = {}
    if (!form.name.trim()) errors.name = 'Required'
    if (!form.email.trim() || !form.email.includes('@')) errors.email = 'Valid email required'
    if (!form.project.trim()) errors.project = 'Required'
    if (!form.checkoutDate) errors.checkoutDate = 'Required'
    else if (form.checkoutDate < todayStr()) errors.checkoutDate = 'Cannot be in the past'
    if (!form.returnDate) errors.returnDate = 'Required'
    else if (form.returnDate < form.checkoutDate) errors.returnDate = 'Must be on or after checkout date'
    setFormErrors(errors)
    return Object.keys(errors).length === 0
  }

  // ── Submit ─────────────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validateForm()) return
    setSubmitting(true)
    try {
      await addDoc(collection(db, 'equipment_bookings'), {
        guestName: form.name.trim(),
        guestEmail: form.email.trim(),
        guestPhone: form.phone.trim(),
        projectName: form.project.trim(),
        items: cart.map(i => ({ equipmentId: i.id, equipmentName: i.name, quantity: i.qty })),
        checkoutDate: form.checkoutDate,
        returnDate: form.returnDate,
        teacherNotes: form.notes.trim(),
        status: 'pending',
        isGuest: true,
        // Required fields from EquipmentBookingDoc — empty strings for guest bookings
        studentId: '',
        studentName: form.name.trim(),
        studentEmail: form.email.trim(),
        cohortId: '',
        createdAt: serverTimestamp(),
      })
      setView('success')
      setCart([])
    } catch (err) {
      console.error('Booking submit error:', err)
    } finally {
      setSubmitting(false)
    }
  }

  // ── Password loading ───────────────────────────────────────────────────────
  if (passwordLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950">
        <div className="w-8 h-8 border-2 border-orange-500/30 border-t-orange-500 rounded-full animate-spin" />
      </div>
    )
  }

  // ── PIN gate ───────────────────────────────────────────────────────────────
  if (shopPassword && !unlocked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950">
        <div className="bg-zinc-900 rounded-2xl border border-white/10 p-8 max-w-sm w-full text-center space-y-4">
          <p className="text-4xl">🔒</p>
          <h1 className="text-xl font-bold text-white">{shopName}</h1>
          <p className="text-zinc-400 text-sm">Enter the access code to browse equipment</p>
          <input
            type="password"
            value={pin}
            onChange={e => { setPin(e.target.value); setPinError(false) }}
            onKeyDown={e => e.key === 'Enter' && checkPin()}
            placeholder="Access code"
            className="w-full bg-white/10 rounded-xl px-4 py-3 text-white text-center text-2xl tracking-widest border border-white/10 focus:border-orange-500 outline-none transition-colors"
            autoFocus
          />
          {pinError && <p className="text-rose-400 text-sm">Incorrect access code</p>}
          <button
            onClick={checkPin}
            className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold py-3 rounded-xl transition-colors"
          >
            Enter
          </button>
        </div>
      </div>
    )
  }

  // ── Success screen ─────────────────────────────────────────────────────────
  if (view === 'success') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950 px-4">
        <div className="bg-zinc-900 rounded-2xl border border-white/10 p-10 max-w-md w-full text-center space-y-4">
          <CheckCircle2 className="w-16 h-16 text-emerald-400 mx-auto" />
          <h1 className="text-2xl font-bold text-white">Request Submitted!</h1>
          <p className="text-zinc-400">
            Your equipment rental request has been received. We'll be in touch shortly to confirm your booking.
          </p>
          <button
            onClick={() => { setView('catalog'); setForm({ name: '', email: '', phone: '', project: '', checkoutDate: '', returnDate: '', notes: '' }) }}
            className="mt-4 bg-orange-500 hover:bg-orange-600 text-white font-semibold py-3 px-6 rounded-xl transition-colors"
          >
            Browse More Equipment
          </button>
        </div>
      </div>
    )
  }

  // ── Checkout view ──────────────────────────────────────────────────────────
  if (view === 'checkout') {
    return (
      <div className="min-h-screen bg-zinc-950 text-white">
        <header className="sticky top-0 z-10 bg-zinc-900/80 backdrop-blur border-b border-white/10 px-4 py-4 flex items-center gap-3">
          <button onClick={() => setView('catalog')} className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors">
            <X className="w-5 h-5" />
          </button>
          <h1 className="text-lg font-bold flex-1">{shopName} — Checkout</h1>
        </header>

        <div className="max-w-2xl mx-auto px-4 py-8">
          <form onSubmit={handleSubmit} className="space-y-6">

            {/* Renter info */}
            <div className="bg-zinc-900 rounded-2xl border border-white/10 p-6 space-y-4">
              <h2 className="text-base font-semibold text-white">Your Information</h2>

              <div className="space-y-1">
                <label className="text-sm text-zinc-400">Full Name <span className="text-rose-400">*</span></label>
                <input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Jane Doe"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder:text-zinc-600 focus:border-orange-500 outline-none transition-colors"
                />
                {formErrors.name && <p className="text-rose-400 text-xs">{formErrors.name}</p>}
              </div>

              <div className="space-y-1">
                <label className="text-sm text-zinc-400">Email <span className="text-rose-400">*</span></label>
                <input
                  type="email"
                  value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="jane@example.com"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder:text-zinc-600 focus:border-orange-500 outline-none transition-colors"
                />
                {formErrors.email && <p className="text-rose-400 text-xs">{formErrors.email}</p>}
              </div>

              <div className="space-y-1">
                <label className="text-sm text-zinc-400">Phone</label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                  placeholder="+46 70 000 0000"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder:text-zinc-600 focus:border-orange-500 outline-none transition-colors"
                />
              </div>

              <div className="space-y-1">
                <label className="text-sm text-zinc-400">Project / Purpose <span className="text-rose-400">*</span></label>
                <input
                  value={form.project}
                  onChange={e => setForm(f => ({ ...f, project: e.target.value }))}
                  placeholder="Short film, music video, event…"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder:text-zinc-600 focus:border-orange-500 outline-none transition-colors"
                />
                {formErrors.project && <p className="text-rose-400 text-xs">{formErrors.project}</p>}
              </div>
            </div>

            {/* Dates */}
            <div className="bg-zinc-900 rounded-2xl border border-white/10 p-6 space-y-4">
              <h2 className="text-base font-semibold text-white">Rental Period</h2>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-sm text-zinc-400">Checkout Date <span className="text-rose-400">*</span></label>
                  <input
                    type="date"
                    value={form.checkoutDate}
                    min={todayStr()}
                    onChange={e => setForm(f => ({ ...f, checkoutDate: e.target.value }))}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:border-orange-500 outline-none transition-colors"
                  />
                  {formErrors.checkoutDate && <p className="text-rose-400 text-xs">{formErrors.checkoutDate}</p>}
                </div>

                <div className="space-y-1">
                  <label className="text-sm text-zinc-400">Return Date <span className="text-rose-400">*</span></label>
                  <input
                    type="date"
                    value={form.returnDate}
                    min={form.checkoutDate || todayStr()}
                    onChange={e => setForm(f => ({ ...f, returnDate: e.target.value }))}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:border-orange-500 outline-none transition-colors"
                  />
                  {formErrors.returnDate && <p className="text-rose-400 text-xs">{formErrors.returnDate}</p>}
                </div>
              </div>

              {form.checkoutDate && form.returnDate && (
                <p className="text-sm text-zinc-400">
                  Rental duration: <span className="text-white font-medium">{days} day{days !== 1 ? 's' : ''}</span>
                </p>
              )}
            </div>

            {/* Notes */}
            <div className="bg-zinc-900 rounded-2xl border border-white/10 p-6 space-y-2">
              <label className="text-sm text-zinc-400">Additional Notes</label>
              <textarea
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Any special requests or information…"
                rows={3}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder:text-zinc-600 focus:border-orange-500 outline-none transition-colors resize-none"
              />
            </div>

            {/* Order summary */}
            <div className="bg-zinc-900 rounded-2xl border border-white/10 p-6 space-y-3">
              <h2 className="text-base font-semibold text-white">Order Summary</h2>
              {cart.map(item => (
                <div key={item.id} className="flex items-center justify-between text-sm">
                  <span className="text-zinc-300">{item.name} × {item.qty}</span>
                  <span className="text-white">{formatCurrency(item.qty * item.priceInclVat * days)}</span>
                </div>
              ))}
              <div className="border-t border-white/10 pt-3 flex items-center justify-between">
                <span className="text-zinc-400 text-sm">Total ({days} day{days !== 1 ? 's' : ''})</span>
                <span className="text-white font-bold text-lg">{formatCurrency(cartTotal)}</span>
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-semibold py-4 rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              {submitting ? (
                <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>Submit Request <ChevronRight className="w-5 h-5" /></>
              )}
            </button>
          </form>
        </div>
      </div>
    )
  }

  // ── Catalog view ───────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-zinc-900/80 backdrop-blur border-b border-white/10">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center gap-4">
          <div className="flex items-center gap-2.5 flex-1">
            <Package className="w-6 h-6 text-orange-500 flex-shrink-0" />
            <div>
              <h1 className="text-base font-bold text-white leading-tight">{shopName}</h1>
              <p className="text-[11px] text-zinc-500 leading-tight">Equipment Rental</p>
            </div>
          </div>
          <button
            onClick={() => setCartOpen(true)}
            className="relative flex items-center gap-2 px-3 py-2 bg-orange-500 hover:bg-orange-600 text-white font-medium text-sm rounded-xl transition-colors"
          >
            <ShoppingCart className="w-4 h-4" />
            <span>Cart</span>
            {cartCount > 0 && (
              <span className="ml-1 bg-white text-orange-600 text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center">
                {cartCount}
              </span>
            )}
          </button>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Search + category filters */}
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search equipment…"
              className="w-full bg-zinc-900 border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-white placeholder:text-zinc-600 focus:border-orange-500 outline-none transition-colors"
            />
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            <button
              onClick={() => setSelectedCategory('all')}
              className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                selectedCategory === 'all'
                  ? 'bg-orange-500 text-white'
                  : 'bg-zinc-900 text-zinc-400 hover:text-white border border-white/10'
              }`}
            >
              All
            </button>
            {categories.map(cat => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.name)}
                className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  selectedCategory === cat.name
                    ? 'bg-orange-500 text-white'
                    : 'bg-zinc-900 text-zinc-400 hover:text-white border border-white/10'
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>
        </div>

        {/* Equipment grid */}
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="bg-zinc-900 rounded-2xl border border-white/10 overflow-hidden animate-pulse">
                <div className="aspect-[4/3] bg-white/5" />
                <div className="p-4 space-y-2">
                  <div className="h-4 bg-white/10 rounded w-3/4" />
                  <div className="h-3 bg-white/5 rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-zinc-500">
            <Package className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>No equipment found</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {filtered.map(item => {
              const cartItem = cart.find(c => c.id === item.id)
              return (
                <div key={item.id} className="bg-zinc-900 rounded-2xl border border-white/10 overflow-hidden flex flex-col">
                  {/* Image */}
                  <div className="aspect-[4/3] bg-zinc-800 overflow-hidden">
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Package className="w-10 h-10 text-zinc-700" />
                      </div>
                    )}
                  </div>

                  <div className="p-3 flex flex-col gap-2 flex-1">
                    {/* Category badge */}
                    <span className="text-[10px] font-bold text-orange-400 uppercase tracking-wider">{item.category}</span>
                    {/* Name */}
                    <p className="text-sm font-semibold text-white leading-tight line-clamp-2">{item.name}</p>
                    {/* Price */}
                    <p className="text-xs text-zinc-400">
                      <span className="text-white font-medium">{formatCurrency(item.priceInclVat)}</span> / day
                    </p>

                    {/* Add to cart / qty */}
                    <div className="mt-auto pt-1">
                      {!cartItem ? (
                        <button
                          onClick={() => addToCart(item)}
                          className="w-full bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold py-2 rounded-lg transition-colors"
                        >
                          Add to Cart
                        </button>
                      ) : (
                        <div className="flex items-center justify-between gap-1">
                          <button onClick={() => updateQty(item.id, -1)} className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors">
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                          <span className="text-sm font-bold text-white">{cartItem.qty}</span>
                          <button onClick={() => updateQty(item.id, +1)} className="w-8 h-8 rounded-lg bg-orange-500 hover:bg-orange-600 flex items-center justify-center transition-colors">
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Cart sidebar overlay */}
      {cartOpen && (
        <div className="fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setCartOpen(false)} />
          <aside className="absolute right-0 top-0 bottom-0 w-full max-w-sm bg-zinc-900 border-l border-white/10 flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <h2 className="font-bold text-white">Your Cart ({cartCount})</h2>
              <button onClick={() => setCartOpen(false)} className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              {cart.length === 0 ? (
                <p className="text-zinc-500 text-sm text-center py-8">Your cart is empty</p>
              ) : cart.map(item => (
                <div key={item.id} className="flex items-center gap-3 bg-zinc-800 rounded-xl p-3">
                  <div className="w-12 h-12 rounded-lg bg-zinc-700 overflow-hidden flex-shrink-0">
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Package className="w-5 h-5 text-zinc-600" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{item.name}</p>
                    <p className="text-xs text-zinc-400">{formatCurrency(item.priceInclVat)} / day</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => updateQty(item.id, -1)} className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors">
                      <Minus className="w-3 h-3" />
                    </button>
                    <span className="text-sm font-bold w-5 text-center">{item.qty}</span>
                    <button onClick={() => updateQty(item.id, +1)} className="w-7 h-7 rounded-lg bg-orange-500 hover:bg-orange-600 flex items-center justify-center transition-colors">
                      <Plus className="w-3 h-3" />
                    </button>
                    <button onClick={() => removeFromCart(item.id)} className="w-7 h-7 rounded-lg bg-white/5 hover:bg-rose-500/20 hover:text-rose-400 flex items-center justify-center transition-colors ml-1">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {cart.length > 0 && (
              <div className="px-5 py-4 border-t border-white/10 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400 text-sm">Subtotal (per day)</span>
                  <span className="text-white font-medium">{formatCurrency(cart.reduce((s, c) => s + c.qty * c.priceInclVat, 0))}</span>
                </div>
                <button
                  onClick={() => { setCartOpen(false); setView('checkout') }}
                  className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
                >
                  Proceed to Checkout <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </aside>
        </div>
      )}

      {/* Floating cart button (mobile, when cart has items and sidebar is closed) */}
      {cartCount > 0 && !cartOpen && (
        <button
          onClick={() => setCartOpen(true)}
          className="fixed bottom-6 right-6 z-30 flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white font-semibold px-4 py-3 rounded-2xl shadow-xl transition-colors"
        >
          <ShoppingCart className="w-5 h-5" />
          <span>{cartCount} item{cartCount !== 1 ? 's' : ''}</span>
          <span className="text-orange-200 text-sm">{formatCurrency(cart.reduce((s, c) => s + c.qty * c.priceInclVat, 0))} / day</span>
        </button>
      )}
    </div>
  )
}
