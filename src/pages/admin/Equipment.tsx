import { useState, useRef, useMemo, useCallback } from 'react'
import {
  collection, addDoc, updateDoc, deleteDoc, doc, serverTimestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useCollection, orderBy, where } from '@/hooks/useFirestore'
import { useCurrency } from '@/hooks/useCurrency'
import { cn } from '@/lib/utils'
import { uploadFile } from '@/lib/cloudinary'
import type { EquipmentDoc, EquipmentCategory, EquipmentCategoryDoc, EquipmentBookingDoc } from '@/types'
import {
  Plus, X, Search, Pencil, Trash2, Package, QrCode, Printer,
  Upload, Camera, Loader2, ChevronDown, ChevronUp, AlertTriangle,
  ToggleLeft, ToggleRight, Check, Image as ImageIcon, Tag, GripVertical,
} from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import LoadingSpinner from '@/components/common/LoadingSpinner'

// ── Category helpers ──────────────────────────────────────────────────────────

const COLOR_STYLES: Record<string, string> = {
  blue:    'text-blue-300 bg-blue-900/30 border-blue-700/40',
  orange:  'text-orange-300 bg-orange-900/30 border-orange-700/40',
  yellow:  'text-yellow-300 bg-yellow-900/30 border-yellow-700/40',
  green:   'text-green-300 bg-green-900/30 border-green-700/40',
  purple:  'text-purple-300 bg-purple-900/30 border-purple-700/40',
  pink:    'text-pink-300 bg-pink-900/30 border-pink-700/40',
  red:     'text-red-300 bg-red-900/30 border-red-700/40',
  cyan:    'text-cyan-300 bg-cyan-900/30 border-cyan-700/40',
  emerald: 'text-emerald-300 bg-emerald-900/30 border-emerald-700/40',
  amber:   'text-amber-300 bg-amber-900/30 border-amber-700/40',
  indigo:  'text-indigo-300 bg-indigo-900/30 border-indigo-700/40',
  teal:    'text-teal-300 bg-teal-900/30 border-teal-700/40',
  zinc:    'text-zinc-300 bg-zinc-700/30 border-zinc-600/40',
}

const COLOR_OPTIONS = Object.keys(COLOR_STYLES)

const DEFAULT_CATEGORIES: Omit<EquipmentCategoryDoc, 'id'>[] = [
  { name: 'CAMERA',   color: 'blue',   order: 0 },
  { name: 'GRIP',     color: 'orange', order: 1 },
  { name: 'LIGHTS',   color: 'yellow', order: 2 },
  { name: 'SOUND',    color: 'green',  order: 3 },
  { name: 'LOCATION', color: 'purple', order: 4 },
  { name: 'BOOKS',    color: 'pink',   order: 5 },
  { name: 'OTHER',    color: 'zinc',   order: 6 },
]

function categoryStyle(cat: EquipmentCategory, cats: EquipmentCategoryDoc[]): string {
  const found = cats.find(c => c.name === cat)
  return COLOR_STYLES[found?.color ?? 'zinc'] ?? COLOR_STYLES.zinc
}

const BOOKING_STATUS_STYLE: Record<string, string> = {
  pending:    'text-amber-300 bg-amber-900/30 border-amber-700/40',
  confirmed:  'text-blue-300 bg-blue-900/30 border-blue-700/40',
  'checked-out': 'text-orange-300 bg-orange-900/30 border-orange-700/40',
  returned:   'text-green-300 bg-green-900/30 border-green-700/40',
  cancelled:  'text-zinc-400 bg-zinc-800/40 border-zinc-600/40',
}

const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME as string

// ── Image upload ─────────────────────────────────────────────────────────────

async function uploadEquipmentImage(
  file: File,
  onProgress: (p: number) => void,
): Promise<string> {
  const result = await uploadFile(file, onProgress)
  return result.secureUrl
}

// ── QR Print ─────────────────────────────────────────────────────────────────

function printQRLabel(name: string, id: string, category: string, container: HTMLDivElement | null) {
  if (!container) return
  const svg = container.querySelector('svg')
  if (!svg) return
  const svgData = new XMLSerializer().serializeToString(svg)
  const win = window.open('', '_blank', 'width=480,height=620')
  if (!win) return
  win.document.write(`
    <html>
    <head>
      <title>QR Label — ${name}</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Arial', sans-serif; text-align: center; padding: 32px 24px; background: #fff; }
        .qr-wrap { display: inline-block; padding: 12px; border: 2px solid #e5e7eb; border-radius: 8px; margin: 16px 0; }
        h1 { font-size: 22px; font-weight: 700; color: #111; margin-bottom: 4px; line-height: 1.2; }
        .cat { font-size: 13px; font-weight: 600; color: #6b7280; letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 2px; }
        .id  { font-size: 10px; color: #9ca3af; font-family: monospace; margin-top: 8px; }
        button { margin-top: 20px; padding: 10px 28px; background: #111; color: #fff; border: none; border-radius: 6px; font-size: 14px; cursor: pointer; }
        @media print { button { display: none; } }
      </style>
    </head>
    <body>
      <h1>${name}</h1>
      <p class="cat">${category}</p>
      <div class="qr-wrap">${svgData}</div>
      <p class="id">ID: ${id}</p>
      <button onclick="window.print();window.close()">🖨️ Print</button>
    </body>
    </html>
  `)
  win.document.close()
  win.focus()
  setTimeout(() => win.print(), 300)
}

// ── EquipmentForm ─────────────────────────────────────────────────────────────

interface FormState {
  name: string
  category: EquipmentCategory
  description: string
  notes: string
  location: string
  totalQuantity: string
  available: string
  priceExclVat: string
  priceInclVat: string
  imageUrl: string
  included: string[]
  filmYear2Only: boolean
  isActive: boolean
}

const EMPTY_FORM: FormState = {
  name: '', category: 'CAMERA', description: '', notes: '',
  location: '', totalQuantity: '1', available: '1',
  priceExclVat: '', priceInclVat: '', imageUrl: '',
  included: [], filmYear2Only: false, isActive: true,
}

function EquipmentForm({ existing, onClose, categories }: {
  existing: EquipmentDoc | null
  onClose: () => void
  categories: EquipmentCategoryDoc[]
}) {
  const [form, setForm] = useState<FormState>(() => existing ? {
    name: existing.name,
    category: existing.category,
    description: existing.description,
    notes: existing.notes,
    location: existing.location,
    totalQuantity: String(existing.totalQuantity),
    available: String(existing.available),
    priceExclVat: existing.priceExclVat ? String(existing.priceExclVat) : '',
    priceInclVat: existing.priceInclVat ? String(existing.priceInclVat) : '',
    imageUrl: existing.imageUrl ?? '',
    included: existing.included ?? [],
    filmYear2Only: existing.filmYear2Only ?? false,
    isActive: existing.isActive ?? true,
  } : EMPTY_FORM)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadPct, setUploadPct] = useState(0)
  const [newIncluded, setNewIncluded] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function set<K extends keyof FormState>(key: K, val: FormState[K]) {
    setForm(f => ({ ...f, [key]: val }))
    if (key === 'priceExclVat') {
      const num = parseFloat(val as string)
      if (!isNaN(num)) setForm(f => ({ ...f, priceExclVat: val as string, priceInclVat: (num * 1.25).toFixed(2) }))
    }
  }

  async function handleImageFile(file: File) {
    if (!file.type.startsWith('image/')) { setError('Please upload an image file'); return }
    setUploading(true); setError(null)
    try {
      const url = await uploadEquipmentImage(file, pct => setUploadPct(pct))
      set('imageUrl', url)
    } catch (e: any) {
      setError(e?.message ?? 'Image upload failed')
    } finally {
      setUploading(false); setUploadPct(0)
    }
  }

  async function handleSave() {
    if (!form.name.trim()) { setError('Name is required'); return }
    setSaving(true); setError(null)
    const payload = {
      name: form.name.trim(),
      category: form.category,
      description: form.description.trim(),
      notes: form.notes.trim(),
      location: form.location.trim(),
      totalQuantity: parseInt(form.totalQuantity) || 1,
      available: parseInt(form.available) || 0,
      priceExclVat: parseFloat(form.priceExclVat) || 0,
      priceInclVat: parseFloat(form.priceInclVat) || 0,
      imageUrl: form.imageUrl,
      qrCode: form.name.trim(),
      included: form.included,
      filmYear2Only: form.filmYear2Only,
      isActive: form.isActive,
      updatedAt: serverTimestamp(),
    }
    try {
      if (existing) {
        await updateDoc(doc(db, 'equipment', existing.id), payload)
      } else {
        await addDoc(collection(db, 'equipment'), { ...payload, createdAt: serverTimestamp() })
      }
      onClose()
    } catch (e: any) {
      setError(e?.message ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-zinc-900 border border-white/10 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-zinc-900 z-10 px-6 py-4 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Package className="w-4 h-4 text-brand-400" />
            <h2 className="font-semibold text-zinc-100">{existing ? 'Edit Equipment' : 'Add Equipment'}</h2>
          </div>
          <button onClick={onClose} className="p-1.5 text-zinc-500 hover:text-zinc-200 rounded-lg transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Name + Category */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="label">Name *</label>
              <input value={form.name} onChange={e => set('name', e.target.value)} className="input" placeholder="e.g. Sony FX3" />
            </div>
            <div>
              <label className="label">Category</label>
              <select value={form.category} onChange={e => set('category', e.target.value as EquipmentCategory)} className="input">
                {categories.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
              </select>
            </div>
          </div>

          {/* Description + Notes */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Description</label>
              <textarea value={form.description} onChange={e => set('description', e.target.value)} rows={3} className="input resize-none" placeholder="Short description…" />
            </div>
            <div>
              <label className="label">Special Instructions / Notes</label>
              <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={3} className="input resize-none" placeholder="Handling notes…" />
            </div>
          </div>

          {/* Quantities + Location */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label">Total Quantity</label>
              <input type="number" min={1} value={form.totalQuantity} onChange={e => set('totalQuantity', e.target.value)} className="input" />
            </div>
            <div>
              <label className="label">Available Now</label>
              <input type="number" min={0} value={form.available} onChange={e => set('available', e.target.value)} className="input" />
            </div>
            <div>
              <label className="label">Storage Location</label>
              <input value={form.location} onChange={e => set('location', e.target.value)} className="input" placeholder="e.g. Room 102 Cabinet A" />
            </div>
          </div>

          {/* Pricing */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Price excl. VAT (kr)</label>
              <input type="number" min={0} step="0.01" value={form.priceExclVat}
                onChange={e => set('priceExclVat', e.target.value)} className="input" placeholder="0.00" />
            </div>
            <div>
              <label className="label">Price incl. VAT (kr) <span className="text-zinc-500 font-normal">— auto 25% VAT</span></label>
              <input type="number" min={0} step="0.01" value={form.priceInclVat}
                onChange={e => set('priceInclVat', e.target.value)} className="input" placeholder="0.00" />
            </div>
          </div>

          {/* Image Upload */}
          <div>
            <label className="label">Equipment Image</label>
            <div
              className={cn(
                'border-2 border-dashed rounded-xl p-4 transition-colors cursor-pointer',
                dragOver ? 'border-brand-500 bg-brand-900/20' : 'border-white/10 hover:border-white/20',
              )}
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleImageFile(f) }}
              onClick={() => fileInputRef.current?.click()}
            >
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleImageFile(f) }} />
              {form.imageUrl ? (
                <div className="flex items-center gap-3">
                  <img src={form.imageUrl} alt="Preview" className="w-16 h-16 object-cover rounded-lg border border-white/10" />
                  <div>
                    <p className="text-sm text-zinc-200 font-medium">Image uploaded</p>
                    <p className="text-xs text-zinc-500">Click to replace</p>
                  </div>
                  {uploading && <Loader2 className="w-4 h-4 animate-spin text-brand-400 ml-auto" />}
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 py-4 text-zinc-500">
                  {uploading ? (
                    <>
                      <Loader2 className="w-6 h-6 animate-spin text-brand-400" />
                      <p className="text-sm">{uploadPct}%</p>
                    </>
                  ) : (
                    <>
                      <Upload className="w-6 h-6" />
                      <p className="text-sm">Drag & drop or click to upload image</p>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Included items */}
          <div>
            <label className="label">Included in Kit</label>
            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  value={newIncluded}
                  onChange={e => setNewIncluded(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && newIncluded.trim()) {
                      set('included', [...form.included, newIncluded.trim()])
                      setNewIncluded('')
                    }
                  }}
                  className="input flex-1 text-sm"
                  placeholder="Add accessory (press Enter)…"
                />
                <button
                  onClick={() => {
                    if (newIncluded.trim()) {
                      set('included', [...form.included, newIncluded.trim()])
                      setNewIncluded('')
                    }
                  }}
                  className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-xl text-sm text-zinc-300 transition-colors"
                >
                  Add
                </button>
              </div>
              {form.included.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {form.included.map((item, i) => (
                    <span key={i} className="flex items-center gap-1 text-xs bg-zinc-800 text-zinc-300 px-2.5 py-1 rounded-full">
                      {item}
                      <button onClick={() => set('included', form.included.filter((_, j) => j !== i))} className="text-zinc-500 hover:text-zinc-200 ml-0.5">
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Toggles */}
          <div className="flex items-center gap-6">
            <button
              onClick={() => set('filmYear2Only', !form.filmYear2Only)}
              className="flex items-center gap-2.5 text-sm text-zinc-300 hover:text-white transition-colors"
            >
              {form.filmYear2Only
                ? <ToggleRight className="w-5 h-5 text-brand-400" />
                : <ToggleLeft className="w-5 h-5 text-zinc-500" />}
              Year 2 only
            </button>
            <button
              onClick={() => set('isActive', !form.isActive)}
              className="flex items-center gap-2.5 text-sm text-zinc-300 hover:text-white transition-colors"
            >
              {form.isActive
                ? <ToggleRight className="w-5 h-5 text-green-400" />
                : <ToggleLeft className="w-5 h-5 text-zinc-500" />}
              Active in catalog
            </button>
          </div>
        </div>

        {error && (
          <div className="mx-6 mb-4 flex items-center gap-2 text-xs text-rose-400 bg-rose-950/40 border border-rose-800/50 rounded-xl px-3 py-2.5">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
            {error}
          </div>
        )}

        <div className="sticky bottom-0 bg-zinc-900 px-6 py-4 border-t border-white/10 flex items-center gap-2">
          <button
            onClick={handleSave}
            disabled={saving || uploading || !form.name.trim()}
            className="flex items-center gap-1.5 px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            {existing ? 'Save Changes' : 'Add Equipment'}
          </button>
          <button onClick={onClose} className="ml-auto text-sm text-zinc-500 hover:text-zinc-300 px-3 py-2 transition-colors">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// ── QRCodePanel ───────────────────────────────────────────────────────────────

function QRCodePanel({ equipment, onClose }: { equipment: EquipmentDoc; onClose: () => void }) {
  const qrContainerRef = useRef<HTMLDivElement>(null)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-zinc-900 border border-white/10 rounded-2xl w-full max-w-xs shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <QrCode className="w-4 h-4 text-brand-400" />
            <h3 className="font-semibold text-zinc-100 text-sm">QR Code</h3>
          </div>
          <button onClick={onClose} className="p-1.5 text-zinc-500 hover:text-zinc-200 rounded-lg transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 py-5 flex flex-col items-center gap-4">
          <p className="text-sm font-semibold text-zinc-100 text-center">{equipment.name}</p>
          <div ref={qrContainerRef} className="p-4 bg-white rounded-xl">
            <QRCodeSVG value={equipment.name} size={180} level="H" />
          </div>
          <p className="text-[10px] text-zinc-500 font-mono">{equipment.id}</p>
          <button
            onClick={() => printQRLabel(equipment.name, equipment.id, equipment.category, qrContainerRef.current)}
            className="flex items-center gap-2 w-full justify-center py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm font-medium transition-colors"
          >
            <Printer className="w-4 h-4" /> Print QR Label
          </button>
        </div>
      </div>
    </div>
  )
}

// ── EquipmentCard ─────────────────────────────────────────────────────────────

function EquipmentCard({ item, onEdit, onDelete, onQR, categories }: {
  item: EquipmentDoc
  onEdit: () => void
  onDelete: () => void
  onQR: () => void
  categories: EquipmentCategoryDoc[]
}) {
  const { symbol } = useCurrency()
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    if (!confirm(`Delete "${item.name}"? This cannot be undone.`)) return
    setDeleting(true)
    try { await deleteDoc(doc(db, 'equipment', item.id)) }
    finally { setDeleting(false) }
  }

  const availPct = item.totalQuantity > 0 ? (item.available / item.totalQuantity) * 100 : 0

  return (
    <div className={cn(
      'bg-zinc-900 border rounded-2xl overflow-hidden transition-all hover:border-white/20 group',
      item.isActive ? 'border-white/10' : 'border-white/5 opacity-60',
    )}>
      {/* Image */}
      <div className="relative h-40 bg-zinc-800 overflow-hidden">
        {item.imageUrl ? (
          <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <ImageIcon className="w-10 h-10 text-zinc-600" />
          </div>
        )}
        {/* Category badge */}
        <span className={cn(
          'absolute top-2 left-2 text-[10px] font-bold tracking-wider px-2 py-0.5 rounded-full border',
          categoryStyle(item.category, categories),
        )}>
          {item.category}
        </span>
        {item.filmYear2Only && (
          <span className="absolute top-2 right-2 text-[10px] font-bold text-amber-300 bg-amber-900/80 border border-amber-700/50 px-2 py-0.5 rounded-full">
            Y2 Only
          </span>
        )}
        {/* Hover actions */}
        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
          <button onClick={onQR} className="p-2 bg-zinc-800/90 hover:bg-zinc-700 text-zinc-200 rounded-lg transition-colors" title="Show QR">
            <QrCode className="w-4 h-4" />
          </button>
          <button onClick={onEdit} className="p-2 bg-zinc-800/90 hover:bg-zinc-700 text-zinc-200 rounded-lg transition-colors" title="Edit">
            <Pencil className="w-4 h-4" />
          </button>
          <button onClick={handleDelete} disabled={deleting} className="p-2 bg-rose-900/80 hover:bg-rose-800 text-rose-300 rounded-lg transition-colors" title="Delete">
            {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Info */}
      <div className="p-3 space-y-2">
        <p className="text-sm font-semibold text-zinc-100 leading-tight line-clamp-2">{item.name}</p>
        {item.description && (
          <p className="text-xs text-zinc-500 line-clamp-2">{item.description}</p>
        )}
        {/* Availability bar */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className={cn('font-medium', item.available === 0 ? 'text-rose-400' : item.available < item.totalQuantity ? 'text-amber-400' : 'text-green-400')}>
              {item.available} / {item.totalQuantity} available
            </span>
            {item.priceInclVat > 0 && (
              <span className="text-zinc-400">{item.priceInclVat.toFixed(0)} {symbol}</span>
            )}
          </div>
          <div className="h-1 bg-zinc-700 rounded-full overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all', item.available === 0 ? 'bg-rose-500' : item.available < item.totalQuantity ? 'bg-amber-500' : 'bg-green-500')}
              style={{ width: `${availPct}%` }}
            />
          </div>
        </div>
        {item.location && (
          <p className="text-[10px] text-zinc-600 truncate">📍 {item.location}</p>
        )}
      </div>
    </div>
  )
}

// ── CatalogTab ────────────────────────────────────────────────────────────────

function CatalogTab({ categories }: { categories: EquipmentCategoryDoc[] }) {
  const { data: equipment, loading } = useCollection<EquipmentDoc>('equipment', [orderBy('name', 'asc')])
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState<string>('ALL')
  const [editItem, setEditItem] = useState<EquipmentDoc | null | 'new'>('new' as never)
  const [showForm, setShowForm] = useState(false)
  const [qrItem, setQrItem] = useState<EquipmentDoc | null>(null)

  const sortedCats = useMemo(
    () => [...categories].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name)),
    [categories],
  )

  const filtered = useMemo(() => {
    return equipment.filter(e => {
      const matchCat = catFilter === 'ALL' || e.category === catFilter
      const matchSearch = !search || e.name.toLowerCase().includes(search.toLowerCase()) || e.description?.toLowerCase().includes(search.toLowerCase())
      return matchCat && matchSearch
    })
  }, [equipment, catFilter, search])

  if (loading) return <div className="flex justify-center py-16"><LoadingSpinner /></div>

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            className="input pl-9 text-sm" placeholder="Search equipment…"
          />
        </div>
        <button
          onClick={() => { setEditItem(null); setShowForm(true) }}
          className="flex items-center gap-1.5 px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium rounded-xl transition-colors flex-shrink-0"
        >
          <Plus className="w-4 h-4" /> Add Equipment
        </button>
      </div>

      {/* Category filters */}
      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => setCatFilter('ALL')}
          className={cn(
            'px-3 py-1 text-xs font-semibold rounded-full border transition-colors',
            catFilter === 'ALL' ? 'bg-brand-600 text-white border-brand-500' : 'text-zinc-300 bg-zinc-800 border-white/10 hover:bg-zinc-700',
          )}
        >
          ALL
        </button>
        {sortedCats.map(cat => (
          <button
            key={cat.name}
            onClick={() => setCatFilter(cat.name)}
            className={cn(
              'px-3 py-1 text-xs font-semibold rounded-full border transition-colors',
              catFilter === cat.name ? 'bg-brand-600 text-white border-brand-500' : cn(categoryStyle(cat.name, categories), 'hover:opacity-80'),
            )}
          >
            {cat.name}
          </button>
        ))}
        <span className="ml-auto text-xs text-zinc-500 self-center">{filtered.length} items</span>
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-zinc-500">
          <Package className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No equipment found</p>
          {search || catFilter !== 'ALL'
            ? <p className="text-xs mt-1">Try clearing your filters</p>
            : <p className="text-xs mt-1">Add your first item with the button above</p>}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {filtered.map(item => (
            <EquipmentCard
              key={item.id}
              item={item}
              onEdit={() => { setEditItem(item); setShowForm(true) }}
              onDelete={() => {}}
              onQR={() => setQrItem(item)}
              categories={categories}
            />
          ))}
        </div>
      )}

      {showForm && (
        <EquipmentForm
          existing={editItem as EquipmentDoc | null}
          onClose={() => setShowForm(false)}
          categories={categories}
        />
      )}
      {qrItem && <QRCodePanel equipment={qrItem} onClose={() => setQrItem(null)} />}
    </div>
  )
}

// ── InventoryTab ──────────────────────────────────────────────────────────────

function InventoryTab() {
  const { data: bookings, loading } = useCollection<EquipmentBookingDoc>(
    'equipment_bookings', [orderBy('createdAt', 'desc')],
  )
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'confirmed' | 'checked-out' | 'returned' | 'cancelled'>('all')

  const filtered = useMemo(() =>
    statusFilter === 'all' ? bookings : bookings.filter(b => b.status === statusFilter),
  [bookings, statusFilter])

  async function updateStatus(id: string, status: string, notes?: string) {
    const payload: Record<string, string> = { status }
    if (notes !== undefined) payload.teacherNotes = notes
    await updateDoc(doc(db, 'equipment_bookings', id), payload)
  }

  if (loading) return <div className="flex justify-center py-16"><LoadingSpinner /></div>

  return (
    <div className="space-y-4">
      {/* Status filters */}
      <div className="flex flex-wrap gap-1.5">
        {(['all', 'pending', 'confirmed', 'checked-out', 'returned', 'cancelled'] as const).map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={cn(
              'px-3 py-1 text-xs font-semibold rounded-full border transition-colors capitalize',
              statusFilter === s
                ? 'bg-brand-600 text-white border-brand-500'
                : s === 'all' ? 'text-zinc-300 bg-zinc-800 border-white/10 hover:bg-zinc-700'
                : cn('border', BOOKING_STATUS_STYLE[s], 'hover:opacity-80'),
            )}
          >
            {s === 'all' ? 'All' : s.replace('-', ' ')}
          </button>
        ))}
        <span className="ml-auto text-xs text-zinc-500 self-center">{filtered.length} bookings</span>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-zinc-500">
          <Package className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No bookings found</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(booking => (
            <div key={booking.id} className="bg-zinc-900 border border-white/8 rounded-2xl p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-zinc-100">{booking.projectName}</p>
                    <span className={cn('text-[10px] font-bold tracking-wider px-2 py-0.5 rounded-full border capitalize', BOOKING_STATUS_STYLE[booking.status])}>
                      {booking.status.replace('-', ' ')}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400 mt-0.5">{booking.studentName} · {booking.studentEmail}</p>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    {booking.checkoutDate} → {booking.returnDate}
                  </p>
                </div>
                {booking.status === 'pending' && (
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={() => updateStatus(booking.id, 'confirmed')}
                      className="text-xs px-3 py-1.5 bg-green-700 hover:bg-green-600 text-white rounded-lg transition-colors"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => updateStatus(booking.id, 'cancelled')}
                      className="text-xs px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded-lg transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                )}
                {booking.status === 'confirmed' && (
                  <button
                    onClick={() => updateStatus(booking.id, 'checked-out')}
                    className="text-xs px-3 py-1.5 bg-orange-700 hover:bg-orange-600 text-white rounded-lg transition-colors flex-shrink-0"
                  >
                    Mark Checked Out
                  </button>
                )}
                {booking.status === 'checked-out' && (
                  <button
                    onClick={() => updateStatus(booking.id, 'returned')}
                    className="text-xs px-3 py-1.5 bg-blue-700 hover:bg-blue-600 text-white rounded-lg transition-colors flex-shrink-0"
                  >
                    Mark Returned
                  </button>
                )}
              </div>
              {booking.items?.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {booking.items.map((item, i) => (
                    <span key={i} className="text-xs bg-zinc-800 text-zinc-300 px-2.5 py-1 rounded-full">
                      {item.quantity}× {item.equipmentName}
                    </span>
                  ))}
                </div>
              )}
              {booking.teacherNotes && (
                <p className="mt-2 text-xs text-zinc-500 italic">{booking.teacherNotes}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── CategoriesTab ─────────────────────────────────────────────────────────────

function CategoriesTab({ categories }: { categories: EquipmentCategoryDoc[] }) {
  const [newName, setNewName]   = useState('')
  const [newColor, setNewColor] = useState('blue')
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState<string | null>(null)

  const sorted = useMemo(
    () => [...categories].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name)),
    [categories],
  )

  async function handleAdd() {
    const name = newName.trim().toUpperCase()
    if (!name) { setError('Name is required'); return }
    if (categories.some(c => c.name === name)) { setError('Category already exists'); return }
    setSaving(true); setError(null)
    try {
      await addDoc(collection(db, 'equipment_categories'), {
        name,
        color: newColor,
        order: categories.length,
        createdAt: serverTimestamp(),
      })
      setNewName('')
    } catch (e: any) {
      setError(e?.message ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(cat: EquipmentCategoryDoc) {
    if (!confirm(`Delete category "${cat.name}"? Equipment items using this category will keep their value.`)) return
    await deleteDoc(doc(db, 'equipment_categories', cat.id))
  }

  async function handleColorChange(cat: EquipmentCategoryDoc, color: string) {
    await updateDoc(doc(db, 'equipment_categories', cat.id), { color })
  }

  return (
    <div className="space-y-5 max-w-xl">
      <div className="bg-zinc-900 border border-white/10 rounded-2xl p-5 space-y-4">
        <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
          <Tag className="w-4 h-4 text-brand-400" /> Add Category
        </h3>
        <div className="flex gap-2 flex-wrap">
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
            className="input flex-1 min-w-[150px] uppercase placeholder:normal-case"
            placeholder="e.g. DRONE"
          />
          <select
            value={newColor}
            onChange={e => setNewColor(e.target.value)}
            className={cn('input w-32 text-xs font-semibold capitalize', COLOR_STYLES[newColor])}
          >
            {COLOR_OPTIONS.map(c => (
              <option key={c} value={c} className="bg-zinc-900 text-zinc-100">{c}</option>
            ))}
          </select>
          <button
            onClick={handleAdd}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Add
          </button>
        </div>
        {error && <p className="text-xs text-rose-400">{error}</p>}
      </div>

      <div className="space-y-2">
        {sorted.map(cat => (
          <div key={cat.id} className="bg-zinc-900 border border-white/10 rounded-xl px-4 py-3 flex items-center gap-3">
            <span className={cn('text-xs font-bold tracking-wider px-2.5 py-1 rounded-full border min-w-[80px] text-center', categoryStyle(cat.name, categories))}>
              {cat.name}
            </span>
            <select
              value={cat.color}
              onChange={e => handleColorChange(cat, e.target.value)}
              className={cn('input text-xs font-semibold capitalize flex-1', COLOR_STYLES[cat.color])}
            >
              {COLOR_OPTIONS.map(c => (
                <option key={c} value={c} className="bg-zinc-900 text-zinc-100">{c}</option>
              ))}
            </select>
            <button
              onClick={() => handleDelete(cat)}
              className="p-2 text-zinc-500 hover:text-rose-400 transition-colors rounded-lg"
              title="Delete category"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
        {sorted.length === 0 && (
          <p className="text-sm text-zinc-500 text-center py-8">No categories yet. Add one above.</p>
        )}
      </div>
    </div>
  )
}

// ── Equipment page ─────────────────────────────────────────────────────────────

export default function EquipmentAdmin() {
  const [tab, setTab] = useState<'catalog' | 'inventory' | 'categories'>('catalog')
  const { data: categories, loading: catsLoading } = useCollection<EquipmentCategoryDoc>(
    'equipment_categories', [orderBy('order', 'asc')],
  )

  const resolvedCats = useMemo(() => {
    if (catsLoading) return []
    if (categories.length > 0) return categories
    return DEFAULT_CATEGORIES.map((c, i) => ({ ...c, id: `default-${i}` }))
  }, [categories, catsLoading])

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Package className="w-5 h-5 text-brand-400" />
        <h1 className="text-xl font-bold text-zinc-100">Equipment</h1>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-zinc-900 border border-white/10 rounded-xl p-1 w-fit">
        {([['catalog', 'Catalog'], ['inventory', 'Bookings'], ['categories', 'Categories']] as const).map(([id, label]) => (
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

      {tab === 'catalog'    && <CatalogTab categories={resolvedCats} />}
      {tab === 'inventory'  && <InventoryTab />}
      {tab === 'categories' && <CategoriesTab categories={categories} />}
    </div>
  )
}
