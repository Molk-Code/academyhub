import { useState, useRef, useMemo } from 'react'
import { collection, addDoc, updateDoc, doc, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useCollection } from '@/hooks/useFirestore'
import { optimizeImageUrl } from '@/lib/cloudinary'
import type { EquipmentDoc, EquipmentCategory, EquipmentCategoryDoc, CohortDoc } from '@/types'
import {
  Package, X, Check, AlertTriangle, Loader2, Upload, ToggleRight, ToggleLeft,
} from 'lucide-react'
import { uploadEquipmentImage, inp } from './adminEquipmentShared'

interface FormState {
  name: string; category: EquipmentCategory; description: string; notes: string
  location: string; totalQuantity: string
  priceExclVat: string; priceInclVat: string; imageUrl: string
  included: string[]; allowedCohortIds: string[]; requiresProduction: boolean; isActive: boolean
}

const EMPTY_FORM: FormState = {
  name: '', category: 'CAMERA', description: '', notes: '',
  location: '', totalQuantity: '1',
  priceExclVat: '', priceInclVat: '', imageUrl: '',
  included: [], allowedCohortIds: [], requiresProduction: true, isActive: true,
}

const lbl: React.CSSProperties = { fontSize: '.75rem', color: '#8a8aab', fontWeight: 600, display: 'block', marginBottom: 4 }

export function ItemForm({ existing, onClose, categories }: { existing: EquipmentDoc | null; onClose: () => void; categories: EquipmentCategoryDoc[] }) {
  const { data: cohorts } = useCollection<CohortDoc>('cohorts')
  const sortedCohorts = useMemo(() => [...cohorts].sort((a, b) => a.name.localeCompare(b.name)), [cohorts])

  const [form, setForm] = useState<FormState>(() => existing ? {
    name: existing.name, category: existing.category,
    description: existing.description ?? '', notes: existing.notes ?? '',
    location: existing.location ?? '', totalQuantity: String(existing.totalQuantity),
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
    const totalQuantity = parseInt(form.totalQuantity) || 1
    // "Available" isn't hand-entered — it's the total minus whatever's currently
    // checked out or missing. On create, nothing is out yet, so all units are
    // available. On edit, preserve however many are currently out and just apply
    // the total-quantity change on top of that.
    const available = existing
      ? Math.max(0, Math.min(totalQuantity, totalQuantity - (existing.totalQuantity - existing.available)))
      : totalQuantity
    const payload = {
      name: form.name.trim(), category: form.category,
      description: form.description.trim(), notes: form.notes.trim(),
      location: form.location.trim(), totalQuantity,
      available,
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
                {categories.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
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

          {/* Quantity + Location */}
          <div style={row2}>
            <div>
              <label style={lbl}>Total Quantity</label>
              <input style={inp} type="number" min={1} value={form.totalQuantity} onChange={e => set('totalQuantity', e.target.value)} />
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
                  <img src={optimizeImageUrl(form.imageUrl)} alt="Preview" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, border: '1px solid #2a2a3a' }} />
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
