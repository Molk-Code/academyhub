import { useState, useMemo, useRef, useEffect } from 'react'
import {
  collection, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, getDoc, setDoc,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useCollection } from '@/hooks/useFirestore'
import { uploadFile } from '@/lib/cloudinary'
import type { EquipmentDoc, EquipmentCategory, EquipmentBookingDoc, CohortDoc } from '@/types'
import { QRCodeSVG } from 'qrcode.react'
import {
  ShoppingCart, X, Search, Package, Calendar, Check,
  AlertTriangle, CheckCircle2, Pencil, Trash2, QrCode,
  Printer, Upload, Loader2, Plus, ToggleRight, ToggleLeft,
} from 'lucide-react'
import './molkom.css'

// ── Types & constants ─────────────────────────────────────────────────────────

type AdminTab = 'catalog' | 'bookings' | 'add'

const CATEGORIES: EquipmentCategory[] = ['CAMERA', 'GRIP', 'LIGHTS', 'SOUND', 'LOCATION', 'BOOKS', 'OTHER']
const ALL_CATEGORIES: ('ALL' | EquipmentCategory)[] = ['ALL', ...CATEGORIES]
const BOOKING_STATUSES = ['all', 'pending', 'confirmed', 'checked-out', 'returned', 'cancelled'] as const

const STATUS_COLOR: Record<string, string> = {
  pending:       '#f59e0b',
  confirmed:     '#3b82f6',
  'checked-out': '#f97316',
  returned:      '#4cd964',
  cancelled:     '#6b7280',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(d: string) {
  if (!d) return ''
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

async function uploadEquipmentImage(file: File, onProgress: (p: number) => void): Promise<string> {
  const result = await uploadFile(file, onProgress)
  return result.secureUrl
}

function printQRLabel(name: string, id: string, category: string, container: HTMLDivElement | null) {
  if (!container) return
  const svg = container.querySelector('svg')
  if (!svg) return
  const svgData = new XMLSerializer().serializeToString(svg)
  const win = window.open('', '_blank', 'width=400,height=400')
  if (!win) return
  win.document.write(`<html><head><title>QR — ${name}</title>
    <style>
      *{box-sizing:border-box;margin:0;padding:0}
      @page{size:100mm 100mm;margin:0}
      html,body{width:100mm;height:100mm;background:#fff}
      body{font-family:Arial,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:6mm}
      .wrap{padding:6px;border:1.5px solid #e5e7eb;border-radius:6px;display:inline-block;line-height:0}
      .wrap svg{width:70mm;height:70mm}
      h1{font-size:13px;font-weight:700;color:#111;text-align:center;line-height:1.2;max-width:88mm;word-break:break-word}
      .cat{font-size:9px;font-weight:700;color:#6b7280;letter-spacing:.1em;text-transform:uppercase}
      button{margin-top:10px;padding:8px 20px;background:#111;color:#fff;border:none;border-radius:5px;font-size:12px;cursor:pointer}
      @media print{button{display:none}}
    </style></head>
    <body>
    <h1>${name}</h1>
    <p class="cat">${category}</p>
    <div class="wrap">${svgData}</div>
    <button onclick="window.print();window.close()">🖨️ Print</button>
    </body></html>`)
  win.document.close()
  win.focus()
  setTimeout(() => win.print(), 300)
}

// ── QR Modal ──────────────────────────────────────────────────────────────────

function QRModal({ item, onClose }: { item: EquipmentDoc; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.8)', backdropFilter: 'blur(8px)' }} onClick={onClose}>
      <div style={{ background: '#0e0e16', border: '1px solid #2a2a3a', borderRadius: 16, width: 320, padding: '1.5rem', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <span style={{ fontWeight: 700, fontSize: '.95rem', color: '#f0f0f5', display: 'flex', alignItems: 'center', gap: 6 }}>
            <QrCode size={16} color="#4cd964" /> QR Code
          </span>
          <button className="close-btn" onClick={onClose} style={{ position: 'static', width: 28, height: 28 }}><X size={14} /></button>
        </div>
        <p style={{ fontWeight: 600, fontSize: '.9rem', color: '#f0f0f5', marginBottom: '.75rem' }}>{item.name}</p>
        <div ref={ref} style={{ background: '#fff', borderRadius: 10, padding: 12, display: 'inline-block', marginBottom: '.75rem' }}>
          <QRCodeSVG value={item.id} size={180} level="H" />
        </div>
        <p style={{ fontSize: 10, color: '#4a4a60', fontFamily: 'monospace', marginBottom: '1rem' }}>{item.id}</p>
        <button
          onClick={() => printQRLabel(item.name, item.id, item.category, ref.current)}
          style={{ width: '100%', padding: '10px', background: '#1a1a25', border: '1px solid #2a2a3a', borderRadius: 10, color: '#f0f0f5', fontSize: '.85rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
        >
          <Printer size={14} /> Print QR Label
        </button>
      </div>
    </div>
  )
}

// ── Item Form ─────────────────────────────────────────────────────────────────

interface FormState {
  name: string; category: EquipmentCategory; description: string; notes: string
  location: string; totalQuantity: string; available: string
  priceExclVat: string; priceInclVat: string; imageUrl: string
  included: string[]; allowedCohortIds: string[]; requiresProduction: boolean; isActive: boolean
}

const EMPTY_FORM: FormState = {
  name: '', category: 'CAMERA', description: '', notes: '',
  location: '', totalQuantity: '1', available: '1',
  priceExclVat: '', priceInclVat: '', imageUrl: '',
  included: [], allowedCohortIds: [], requiresProduction: true, isActive: true,
}

const inp: React.CSSProperties = {
  width: '100%', padding: '10px 12px', background: '#0e0e16',
  border: '1px solid #2a2a3a', borderRadius: 10, color: '#f0f0f5',
  fontSize: '.875rem', outline: 'none',
}
const lbl: React.CSSProperties = { fontSize: '.75rem', color: '#8a8aab', fontWeight: 600, display: 'block', marginBottom: 4 }

function ItemForm({ existing, onClose }: { existing: EquipmentDoc | null; onClose: () => void }) {
  const { data: cohorts } = useCollection<CohortDoc>('cohorts')
  const sortedCohorts = useMemo(() => [...cohorts].sort((a, b) => a.name.localeCompare(b.name)), [cohorts])

  const [form, setForm] = useState<FormState>(() => existing ? {
    name: existing.name, category: existing.category,
    description: existing.description ?? '', notes: existing.notes ?? '',
    location: existing.location ?? '', totalQuantity: String(existing.totalQuantity),
    available: String(existing.available),
    priceExclVat: existing.priceExclVat ? String(existing.priceExclVat) : '',
    priceInclVat: existing.priceInclVat ? String(existing.priceInclVat) : '',
    imageUrl: existing.imageUrl ?? '', included: existing.included ?? [],
    allowedCohortIds: existing.allowedCohortIds ?? (existing.filmYear2Only
      ? cohorts.filter(c => c.programYear === 2).map(c => c.id)
      : []),
    requiresProduction: existing.requiresProduction ?? true,
    isActive: existing.isActive ?? true,
  } : EMPTY_FORM)

  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadPct, setUploadPct] = useState(0)
  const [error, setError] = useState('')
  const [newIncluded, setNewIncluded] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  function set<K extends keyof FormState>(key: K, val: FormState[K]) {
    setForm(f => ({ ...f, [key]: val }))
    if (key === 'priceExclVat') {
      const n = parseFloat(val as string)
      if (!isNaN(n)) setForm(f => ({ ...f, priceExclVat: val as string, priceInclVat: (n * 1.25).toFixed(2) }))
    }
  }

  async function handleImageFile(file: File) {
    if (!file.type.startsWith('image/')) { setError('Please upload an image file'); return }
    setUploading(true); setError('')
    try { set('imageUrl', await uploadEquipmentImage(file, p => setUploadPct(p))) }
    catch (e: any) { setError(e?.message ?? 'Upload failed') }
    finally { setUploading(false); setUploadPct(0) }
  }

  async function handleSave() {
    if (!form.name.trim()) { setError('Name is required'); return }
    setSaving(true); setError('')
    const payload = {
      name: form.name.trim(), category: form.category,
      description: form.description.trim(), notes: form.notes.trim(),
      location: form.location.trim(), totalQuantity: parseInt(form.totalQuantity) || 1,
      available: parseInt(form.available) || 0,
      priceExclVat: parseFloat(form.priceExclVat) || 0,
      priceInclVat: parseFloat(form.priceInclVat) || 0,
      imageUrl: form.imageUrl, qrCode: form.name.trim(),
      included: form.included,
      allowedCohortIds: form.allowedCohortIds,
      requiresProduction: form.requiresProduction,
      filmYear2Only: false,
      isActive: form.isActive, updatedAt: serverTimestamp(),
    }
    try {
      if (existing) await updateDoc(doc(db, 'equipment', existing.id), payload)
      else await addDoc(collection(db, 'equipment'), { ...payload, createdAt: serverTimestamp() })
      onClose()
    } catch (e: any) { setError(e?.message ?? 'Save failed') }
    finally { setSaving(false) }
  }

  function addIncluded() {
    if (newIncluded.trim()) { set('included', [...form.included, newIncluded.trim()]); setNewIncluded('') }
  }

  const row2: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }
  const row3: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.8)', backdropFilter: 'blur(8px)', padding: 16 }} onClick={onClose}>
      <div style={{ background: '#0e0e16', border: '1px solid #2a2a3a', borderRadius: 16, width: '100%', maxWidth: 640, maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ position: 'sticky', top: 0, background: '#0e0e16', borderBottom: '1px solid #2a2a3a', padding: '1rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 10 }}>
          <span style={{ fontWeight: 700, fontSize: '1rem', color: '#f0f0f5', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Package size={16} color="#4cd964" />
            {existing ? 'Edit Item' : 'Add Item'}
          </span>
          <button className="close-btn" onClick={onClose} style={{ position: 'static', width: 32, height: 32 }}><X size={16} /></button>
        </div>

        <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Name + Category */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
            <div>
              <label style={lbl}>Name *</label>
              <input style={inp} value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Sony FX3" />
            </div>
            <div>
              <label style={lbl}>Category</label>
              <select style={inp} value={form.category} onChange={e => set('category', e.target.value as EquipmentCategory)}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {/* Description + Notes */}
          <div style={row2}>
            <div>
              <label style={lbl}>Description</label>
              <textarea style={{ ...inp, resize: 'none' }} rows={3} value={form.description} onChange={e => set('description', e.target.value)} placeholder="Short description…" />
            </div>
            <div>
              <label style={lbl}>Special Instructions / Notes</label>
              <textarea style={{ ...inp, resize: 'none' }} rows={3} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Handling notes…" />
            </div>
          </div>

          {/* Quantities + Location */}
          <div style={row3}>
            <div>
              <label style={lbl}>Total Quantity</label>
              <input style={inp} type="number" min={1} value={form.totalQuantity} onChange={e => set('totalQuantity', e.target.value)} />
            </div>
            <div>
              <label style={lbl}>Available Now</label>
              <input style={inp} type="number" min={0} value={form.available} onChange={e => set('available', e.target.value)} />
            </div>
            <div>
              <label style={lbl}>Storage Location</label>
              <input style={inp} value={form.location} onChange={e => set('location', e.target.value)} placeholder="e.g. Cabinet A" />
            </div>
          </div>

          {/* Pricing */}
          <div style={row2}>
            <div>
              <label style={lbl}>Price excl. VAT (kr)</label>
              <input style={inp} type="number" min={0} step="0.01" value={form.priceExclVat} onChange={e => set('priceExclVat', e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <label style={lbl}>Price incl. VAT (kr) — auto 25%</label>
              <input style={inp} type="number" min={0} step="0.01" value={form.priceInclVat} onChange={e => set('priceInclVat', e.target.value)} placeholder="0.00" />
            </div>
          </div>

          {/* Image Upload */}
          <div>
            <label style={lbl}>Equipment Image</label>
            <div
              style={{ border: `2px dashed ${dragOver ? '#4cd964' : '#2a2a3a'}`, borderRadius: 10, padding: '1rem', cursor: 'pointer', transition: 'border-color .2s', background: dragOver ? 'rgba(76,217,100,.05)' : 'transparent' }}
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleImageFile(f) }}
              onClick={() => fileRef.current?.click()}
            >
              <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handleImageFile(f) }} />
              {form.imageUrl ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <img src={form.imageUrl} alt="Preview" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, border: '1px solid #2a2a3a' }} />
                  <div>
                    <p style={{ fontSize: '.85rem', color: '#f0f0f5', fontWeight: 600 }}>Image uploaded</p>
                    <p style={{ fontSize: '.75rem', color: '#6a6a80' }}>Click to replace</p>
                  </div>
                  {uploading && <Loader2 size={16} color="#4cd964" style={{ marginLeft: 'auto', animation: 'spin 1s linear infinite' }} />}
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '1rem 0', color: '#4a4a60' }}>
                  {uploading
                    ? <><Loader2 size={24} style={{ margin: '0 auto 8px', display: 'block', animation: 'spin 1s linear infinite' }} /><p style={{ fontSize: '.8rem' }}>{uploadPct}%</p></>
                    : <><Upload size={24} style={{ margin: '0 auto 8px', display: 'block' }} /><p style={{ fontSize: '.8rem' }}>Drag & drop or click to upload image</p></>
                  }
                </div>
              )}
            </div>
          </div>

          {/* Included in kit */}
          <div>
            <label style={lbl}>Included in Kit</label>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <input
                style={{ ...inp, flex: 1, fontSize: '.8rem' }}
                value={newIncluded}
                onChange={e => setNewIncluded(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addIncluded() } }}
                placeholder="Add accessory (press Enter)…"
              />
              <button onClick={addIncluded} style={{ padding: '8px 14px', background: '#1a1a25', border: '1px solid #2a2a3a', borderRadius: 10, color: '#f0f0f5', fontSize: '.8rem', cursor: 'pointer' }}>Add</button>
            </div>
            {form.included.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {form.included.map((item, i) => (
                  <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '.75rem', background: '#1a1a25', border: '1px solid #2a2a3a', borderRadius: 20, padding: '4px 10px', color: '#c0c0d5' }}>
                    {item}
                    <button onClick={() => set('included', form.included.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6a6a80', padding: 0, display: 'flex' }}><X size={12} /></button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Available for classes */}
          <div>
            <label style={lbl}>Available For Classes</label>
            <p style={{ fontSize: '.7rem', color: '#4a4a60', marginBottom: 8 }}>
              Leave all unchecked to allow all classes. Check one or more to restrict access.
            </p>
            {sortedCohorts.length === 0 ? (
              <p style={{ fontSize: '.8rem', color: '#4a4a60' }}>No classes found</p>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {sortedCohorts.map(cohort => {
                  const checked = form.allowedCohortIds.includes(cohort.id)
                  return (
                    <button
                      key={cohort.id}
                      type="button"
                      onClick={() => set('allowedCohortIds', checked
                        ? form.allowedCohortIds.filter(id => id !== cohort.id)
                        : [...form.allowedCohortIds, cohort.id]
                      )}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        padding: '6px 12px', borderRadius: 20, fontSize: '.78rem', fontWeight: 600,
                        cursor: 'pointer', transition: 'all .15s',
                        background: checked ? 'rgba(76,217,100,.15)' : '#0e0e16',
                        border: `1px solid ${checked ? 'rgba(76,217,100,.4)' : '#2a2a3a'}`,
                        color: checked ? '#4cd964' : '#8a8aab',
                      }}
                    >
                      {checked && <Check size={11} />}
                      {cohort.name}
                      <span style={{ fontSize: '.65rem', opacity: .6 }}>
                        (Year {cohort.programYear})
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Production required toggle */}
          <div>
            <button onClick={() => set('requiresProduction', !form.requiresProduction)} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', color: '#c0c0d5', fontSize: '.85rem' }}>
              {form.requiresProduction ? <ToggleRight size={20} color="#f59e0b" /> : <ToggleLeft size={20} color="#4a4a60" />}
              <span>
                Requires active production to book
                <span style={{ marginLeft: 6, fontSize: '.7rem', color: '#4a4a60' }}>
                  {form.requiresProduction ? '(students must select a production)' : '(bookable without a production)'}
                </span>
              </span>
            </button>
          </div>

          {/* Active toggle */}
          <div>
            <button onClick={() => set('isActive', !form.isActive)} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', color: '#c0c0d5', fontSize: '.85rem' }}>
              {form.isActive ? <ToggleRight size={20} color="#4cd964" /> : <ToggleLeft size={20} color="#4a4a60" />}
              Active in catalog
            </button>
          </div>
        </div>

        {error && (
          <div style={{ margin: '0 1.5rem', display: 'flex', alignItems: 'center', gap: 6, fontSize: '.8rem', color: '#f87171', background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 8, padding: '8px 12px', marginBottom: 8 }}>
            <AlertTriangle size={13} />{error}
          </div>
        )}

        {/* Footer */}
        <div style={{ position: 'sticky', bottom: 0, background: '#0e0e16', borderTop: '1px solid #2a2a3a', padding: '1rem 1.5rem', display: 'flex', gap: 8 }}>
          <button
            onClick={handleSave}
            disabled={saving || uploading || !form.name.trim()}
            className="primary-btn"
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            {saving ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Check size={14} />}
            {existing ? 'Save Changes' : 'Add Equipment'}
          </button>
          <button onClick={onClose} className="secondary-btn">Cancel</button>
        </div>
      </div>
    </div>
  )
}

// ── Catalog Tab ───────────────────────────────────────────────────────────────

function CatalogTab() {
  const { data: equipmentRaw } = useCollection<EquipmentDoc>('equipment')
  const { data: cohorts } = useCollection<CohortDoc>('cohorts')
  const equipment = useMemo(
    () => [...equipmentRaw].sort((a, b) => a.name.localeCompare(b.name)),
    [equipmentRaw],
  )
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<'ALL' | EquipmentCategory>('ALL')
  const [editItem, setEditItem] = useState<EquipmentDoc | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [qrItem, setQrItem] = useState<EquipmentDoc | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const filtered = useMemo(() => {
    let list = equipment
    if (category !== 'ALL') list = list.filter(e => e.category === category)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(e => e.name.toLowerCase().includes(q) || e.description?.toLowerCase().includes(q))
    }
    return list
  }, [equipment, category, search])

  async function handleDelete(item: EquipmentDoc) {
    if (!confirm(`Delete "${item.name}"? This cannot be undone.`)) return
    setDeletingId(item.id)
    try { await deleteDoc(doc(db, 'equipment', item.id)) }
    finally { setDeletingId(null) }
  }

  return (
    <>
      <div className="toolbar" style={{ marginBottom: 0 }}>
        <div className="category-filter" style={{ flexWrap: 'wrap' }}>
          {ALL_CATEGORIES.map(cat => (
            <button key={cat} className={`category-btn${category === cat ? ' active' : ''}`} onClick={() => setCategory(cat)}>
              {cat}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div className="search-bar" style={{ flex: 1, minWidth: 180 }}>
            <span className="search-icon"><Search size={16} /></span>
            <input type="text" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} />
            {search && <button className="search-clear" onClick={() => setSearch('')}><X size={14} /></button>}
          </div>
          <button
            className="primary-btn"
            onClick={() => { setEditItem(null); setShowForm(true) }}
            style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}
          >
            <Plus size={14} /> Add Item
          </button>
        </div>
      </div>

      <div className="results-info">
        <span>{filtered.length} items</span>
        {category !== 'ALL' && <span className="active-filter">{category}</span>}
      </div>

      {filtered.length === 0 ? (
        <div className="no-results">
          {equipmentRaw.length === 0 ? 'No items yet — click "Add Item" to get started' : 'No equipment found'}
        </div>
      ) : (
        <div className="product-grid">
          {filtered.map(item => (
            <div
              key={item.id}
              className="product-card"
              style={{ opacity: item.isActive ? 1 : 0.55, position: 'relative' }}
            >
              {/* Admin hover overlay */}
              <div className="product-image" style={{ position: 'relative' }}>
                {item.imageUrl
                  ? <img src={item.imageUrl} alt={item.name} />
                  : <div className="image-placeholder"><Package size={32} color="#3a3a4a" /></div>
                }
                <span className="product-category-tag">{item.category}</span>
                {!item.isActive && (
                  <span style={{ position: 'absolute', top: 8, right: 8, fontSize: 9, fontWeight: 700, background: '#3a1a1a', color: '#f87171', border: '1px solid rgba(248,113,113,.3)', borderRadius: 20, padding: '2px 6px' }}>Inactive</span>
                )}
                {/* Hover actions */}
                <div style={{
                  position: 'absolute', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex',
                  alignItems: 'center', justifyContent: 'center', gap: 8, opacity: 0, transition: 'opacity .2s',
                  borderRadius: 'inherit',
                }}
                  className="admin-card-overlay"
                >
                  <button onClick={() => setQrItem(item)} title="QR Code"
                    style={{ padding: 8, background: 'rgba(30,30,40,.9)', border: '1px solid #2a2a3a', borderRadius: 8, color: '#c0c0d5', cursor: 'pointer' }}>
                    <QrCode size={16} />
                  </button>
                  <button onClick={() => { setEditItem(item); setShowForm(true) }} title="Edit"
                    style={{ padding: 8, background: 'rgba(30,30,40,.9)', border: '1px solid #2a2a3a', borderRadius: 8, color: '#c0c0d5', cursor: 'pointer' }}>
                    <Pencil size={16} />
                  </button>
                  <button onClick={() => handleDelete(item)} disabled={deletingId === item.id} title="Delete"
                    style={{ padding: 8, background: 'rgba(60,10,10,.9)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 8, color: '#f87171', cursor: 'pointer' }}>
                    {deletingId === item.id ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Trash2 size={16} />}
                  </button>
                </div>
              </div>
              <div className="product-info">
                <div className="product-name">{item.name}</div>
                <div style={{ fontSize: '.7rem', color: item.available === 0 ? '#ff4757' : '#4cd964', fontWeight: 600, marginBottom: 2 }}>
                  {item.available}/{item.totalQuantity} available
                </div>
                {item.allowedCohortIds && item.allowedCohortIds.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 4 }}>
                    {item.allowedCohortIds.map(id => {
                      const c = cohorts.find(x => x.id === id)
                      return c ? (
                        <span key={id} style={{ fontSize: '.65rem', fontWeight: 700, background: 'rgba(251,191,36,.1)', color: '#fbbf24', border: '1px solid rgba(251,191,36,.25)', borderRadius: 10, padding: '1px 6px' }}>
                          {c.name}
                        </span>
                      ) : null
                    })}
                  </div>
                )}
                {item.description && <div className="product-description">{item.description}</div>}
                <div className="product-pricing">
                  {item.priceInclVat > 0
                    ? <span className="price-day">{item.priceInclVat} kr/day</span>
                    : <span className="price-free">Free</span>
                  }
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && <ItemForm existing={editItem} onClose={() => { setShowForm(false); setEditItem(null) }} />}
      {qrItem && <QRModal item={qrItem} onClose={() => setQrItem(null)} />}
    </>
  )
}

// ── Bookings Tab ──────────────────────────────────────────────────────────────

function BookingsTab() {
  const { data: bookings } = useCollection<EquipmentBookingDoc>('equipment_bookings')
  const sorted = useMemo(
    () => [...bookings].sort((a, b) => {
      const ta = (b.createdAt as any)?.toMillis?.() ?? 0
      const tb = (a.createdAt as any)?.toMillis?.() ?? 0
      return ta - tb
    }),
    [bookings],
  )
  const [statusFilter, setStatusFilter] = useState<'all' | typeof BOOKING_STATUSES[number]>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)

  const filtered = useMemo(
    () => statusFilter === 'all' ? sorted : sorted.filter(b => b.status === statusFilter),
    [sorted, statusFilter],
  )

  async function setStatus(id: string, status: string) {
    setSavingId(id)
    try { await updateDoc(doc(db, 'equipment_bookings', id), { status }) }
    finally { setSavingId(null) }
  }

  const pendingCount = sorted.filter(b => b.status === 'pending').length

  return (
    <>
      {/* Status filters */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: '1rem' }}>
        {BOOKING_STATUSES.map(s => {
          const count = s === 'all' ? sorted.length : sorted.filter(b => b.status === s).length
          const active = statusFilter === s
          const col = s === 'all' ? '#4cd964' : STATUS_COLOR[s] ?? '#6b7280'
          return (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              style={{
                padding: '5px 14px', borderRadius: 20, fontSize: '.75rem', fontWeight: 700,
                textTransform: 'capitalize', cursor: 'pointer', letterSpacing: '.04em',
                background: active ? col + '25' : '#1a1a25',
                border: `1px solid ${active ? col + '80' : '#2a2a3a'}`,
                color: active ? col : '#6a6a80',
              }}
            >
              {s === 'all' ? 'All' : s.replace('-', ' ')}
              {s === 'pending' && pendingCount > 0 && (
                <span style={{ marginLeft: 4, background: '#f59e0b', color: '#000', borderRadius: 10, padding: '1px 5px', fontSize: 10 }}>{pendingCount}</span>
              )}
              {' '}({count})
            </button>
          )
        })}
      </div>

      {filtered.length === 0 ? (
        <div className="no-results">No bookings found</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map(b => {
            const expanded = expandedId === b.id
            const col = STATUS_COLOR[b.status] ?? '#6b7280'
            return (
              <div
                key={b.id}
                style={{ background: '#0e0e16', border: '1px solid #2a2a3a', borderRadius: 12, overflow: 'hidden', cursor: 'pointer' }}
                onClick={() => setExpandedId(expanded ? null : b.id)}
              >
                <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: col, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 120 }}>
                    <p style={{ fontWeight: 700, fontSize: '.9rem', color: '#f0f0f5', margin: 0 }}>{b.projectName}</p>
                    <p style={{ fontSize: '.75rem', color: '#6a6a80', margin: '2px 0 0' }}>{b.studentName}</p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '.75rem', color: '#8a8aab' }}>
                    <Calendar size={12} />
                    {formatDate(b.checkoutDate)} – {formatDate(b.returnDate)}
                  </div>
                  <span style={{ fontSize: '.7rem', fontWeight: 700, background: col + '20', color: col, border: `1px solid ${col}50`, borderRadius: 20, padding: '3px 10px', textTransform: 'capitalize' }}>
                    {b.status.replace('-', ' ')}
                  </span>
                </div>

                {expanded && (
                  <div style={{ borderTop: '1px solid #2a2a3a', padding: '14px 16px', background: '#0a0a0f' }} onClick={e => e.stopPropagation()}>
                    {/* Items */}
                    <div style={{ marginBottom: 12 }}>
                      <p style={{ fontSize: '.7rem', fontWeight: 700, color: '#4a4a60', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>Equipment</p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {b.items.map((it, i) => (
                          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.8rem', color: '#c0c0d5' }}>
                            <span>{it.equipmentName}</span>
                            <span style={{ color: '#6a6a80' }}>×{it.quantity}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {b.teacherNotes && (
                      <p style={{ fontSize: '.8rem', color: '#8a8aab', marginBottom: 12 }}>📝 {b.teacherNotes}</p>
                    )}

                    {/* Actions */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {b.status === 'pending' && (
                        <>
                          <button
                            disabled={savingId === b.id}
                            onClick={() => setStatus(b.id, 'confirmed')}
                            style={{ padding: '6px 14px', background: 'rgba(76,217,100,.15)', border: '1px solid rgba(76,217,100,.3)', borderRadius: 8, color: '#4cd964', fontSize: '.8rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                          >
                            {savingId === b.id ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Check size={12} />} Confirm
                          </button>
                          <button
                            disabled={savingId === b.id}
                            onClick={() => setStatus(b.id, 'cancelled')}
                            style={{ padding: '6px 14px', background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.2)', borderRadius: 8, color: '#f87171', fontSize: '.8rem', fontWeight: 600, cursor: 'pointer' }}
                          >
                            Cancel
                          </button>
                        </>
                      )}
                      {b.status === 'confirmed' && (
                        <button
                          disabled={savingId === b.id}
                          onClick={() => setStatus(b.id, 'checked-out')}
                          style={{ padding: '6px 14px', background: 'rgba(249,115,22,.15)', border: '1px solid rgba(249,115,22,.3)', borderRadius: 8, color: '#f97316', fontSize: '.8rem', fontWeight: 600, cursor: 'pointer' }}
                        >
                          Mark Checked Out
                        </button>
                      )}
                      {b.status === 'checked-out' && (
                        <button
                          disabled={savingId === b.id}
                          onClick={() => setStatus(b.id, 'returned')}
                          style={{ padding: '6px 14px', background: 'rgba(76,217,100,.15)', border: '1px solid rgba(76,217,100,.3)', borderRadius: 8, color: '#4cd964', fontSize: '.8rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                        >
                          <CheckCircle2 size={12} /> Mark Returned
                        </button>
                      )}
                      {(b.status === 'returned' || b.status === 'cancelled') && (
                        <button
                          disabled={savingId === b.id}
                          onClick={() => setStatus(b.id, 'pending')}
                          style={{ padding: '6px 14px', background: '#1a1a25', border: '1px solid #2a2a3a', borderRadius: 8, color: '#8a8aab', fontSize: '.8rem', fontWeight: 600, cursor: 'pointer' }}
                        >
                          Reopen
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AdminEquipmentPage() {
  const [tab, setTab] = useState<AdminTab>('catalog')
  const { data: bookings } = useCollection<EquipmentBookingDoc>('equipment_bookings')
  const pendingCount = useMemo(() => bookings.filter(b => b.status === 'pending').length, [bookings])

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

  const tabs: { id: AdminTab; label: string; badge?: number }[] = [
    { id: 'catalog',  label: 'Catalog' },
    { id: 'bookings', label: 'Bookings', badge: pendingCount },
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
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            {tabs.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  padding: '7px 16px', borderRadius: 10, fontSize: '.85rem', fontWeight: 600,
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
            <div style={{ width: 1, height: 24, background: '#2a2a3a', margin: '0 4px' }} />
            <button
              onClick={toggleRequireProduction}
              title={requireProduction ? 'Production required — click to disable' : 'Production not required — click to enable'}
              style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 12px', borderRadius: 10, background: 'transparent', border: '1px solid #2a2a3a', cursor: 'pointer', fontSize: '.78rem', fontWeight: 600, color: requireProduction ? '#f59e0b' : '#4a4a60', transition: 'all .2s' }}
            >
              {requireProduction ? <ToggleRight size={16} color="#f59e0b" /> : <ToggleLeft size={16} color="#4a4a60" />}
              Require production
            </button>
          </div>
        </div>
      </header>

      <div className="main">
        {tab === 'catalog'  && <CatalogTab />}
        {tab === 'bookings' && <BookingsTab />}
      </div>
    </div>
  )
}
