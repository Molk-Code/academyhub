import { useState, useRef, useMemo, useEffect } from 'react'
import { collection, addDoc, updateDoc, doc, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useCollection } from '@/hooks/useFirestore'
import { optimizeImageUrl } from '@/lib/cloudinary'
import type { EquipmentDoc, EquipmentCategory, EquipmentCategoryDoc, CohortDoc } from '@/types'
import {
  Package, X, Check, AlertTriangle, Loader2, Upload, ToggleRight, ToggleLeft, ChevronLeft, ChevronRight,
} from 'lucide-react'
import { uploadEquipmentImage, inp, catColors, catStyle } from './adminEquipmentShared'
import { equipmentImages } from './ImageGallery'

interface FormState {
  name: string; category: EquipmentCategory; description: string; notes: string
  location: string; totalQuantity: string; linkUrl: string
  priceExclVat: string; priceInclVat: string; images: string[]
  included: string[]; accessoryIds: string[]; allowedCohortIds: string[]; requiresProduction: boolean; isActive: boolean
}

const EMPTY_FORM: FormState = {
  name: '', category: 'CAMERA', description: '', notes: '',
  location: '', totalQuantity: '1', linkUrl: '',
  priceExclVat: '', priceInclVat: '', images: [],
  included: [], accessoryIds: [], allowedCohortIds: [], requiresProduction: true, isActive: true,
}

const lbl: React.CSSProperties = { fontSize: '.75rem', color: '#8a8aab', fontWeight: 600, display: 'block', marginBottom: 4 }

export function ItemForm({ existing, onClose, categories }: { existing: EquipmentDoc | null; onClose: () => void; categories: EquipmentCategoryDoc[] }) {
  const { data: cohorts } = useCollection<CohortDoc>('cohorts')
  const sortedCohorts = useMemo(() => [...cohorts].sort((a, b) => a.name.localeCompare(b.name)), [cohorts])
  const { data: catalog } = useCollection<EquipmentDoc>('equipment')
  const catalogById = useMemo(() => new Map(catalog.map(e => [e.id, e])), [catalog])
  const [accessorySearch, setAccessorySearch] = useState('')

  const [form, setForm] = useState<FormState>(() => existing ? {
    name: existing.name, category: existing.category,
    description: existing.description ?? '', notes: existing.notes ?? '',
    location: existing.location ?? '', totalQuantity: String(existing.totalQuantity),
    linkUrl: existing.linkUrl ?? '',
    priceExclVat: existing.priceExclVat ? String(existing.priceExclVat) : '',
    priceInclVat: existing.priceInclVat ? String(existing.priceInclVat) : '',
    images: equipmentImages(existing), included: existing.included ?? [],
    accessoryIds: existing.accessoryIds ?? [],
    allowedCohortIds: existing.allowedCohortIds ?? (existing.filmYear2Only
      ? cohorts.filter(c => c.programYear === 2).map(c => c.id)
      : []),
    requiresProduction: existing.requiresProduction ?? true,
    isActive: existing.isActive ?? true,
  } : EMPTY_FORM)

  // A new item starts on the first real category, so what the list shows (and its colour) is what gets saved
  useEffect(() => {
    if (!existing && categories.length && !categories.some(c => c.name === form.category))
      setForm(f => ({ ...f, category: categories[0].name as EquipmentCategory }))
  }, [existing, categories, form.category])

  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadPct, setUploadPct] = useState(0)
  const [error, setError] = useState('')
  const [newIncluded, setNewIncluded] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  function set<K extends keyof FormState>(key: K, val: FormState[K]) {
    setForm(f => ({ ...f, [key]: val }))
    // Either price fills in the other (25% VAT); clearing one clears both
    if (key === 'priceExclVat' || key === 'priceInclVat') {
      const n = parseFloat(val as string)
      const other = isNaN(n) ? '' : (key === 'priceExclVat' ? n * 1.25 : n / 1.25).toFixed(2)
      setForm(f => ({ ...f, [key === 'priceExclVat' ? 'priceInclVat' : 'priceExclVat']: other }))
    }
  }

  // Uploads one at a time and appends; the first image is the main one
  async function handleImageFiles(files: FileList | File[]) {
    const list = [...files]
    if (list.some(f => !f.type.startsWith('image/'))) { setError('Please upload image files only'); return }
    if (list.length === 0) return
    setUploading(true); setError('')
    try {
      for (const file of list) {
        const url = await uploadEquipmentImage(file, p => setUploadPct(p))
        setForm(f => ({ ...f, images: [...f.images, url] }))
      }
    }
    catch (e: any) { setError(e?.message ?? 'Upload failed') }
    finally { setUploading(false); setUploadPct(0) }
  }

  function moveImage(i: number, dir: -1 | 1) {
    const j = i + dir
    if (j < 0 || j >= form.images.length) return
    const next = [...form.images];
    [next[i], next[j]] = [next[j], next[i]]
    set('images', next)
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
      linkUrl: form.linkUrl.trim(),
      available,
      priceExclVat: parseFloat(form.priceExclVat) || 0,
      priceInclVat: parseFloat(form.priceInclVat) || 0,
      imageUrl: form.images[0] ?? '', imageUrls: form.images, qrCode: form.name.trim(),
      included: form.included,
      accessoryIds: form.accessoryIds,
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
              {/* Shown in the category's colour, so a wrong pick stands out before saving */}
              <select style={{ ...inp, ...catStyle(form.category, categories), fontWeight: 700 }} value={form.category} onChange={e => set('category', e.target.value as EquipmentCategory)}>
                {categories.map(c => <option key={c.name} value={c.name} style={{ background: '#0e0e16', color: catColors(c.color).text }}>{c.name}</option>)}
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

          {/* Product link */}
          <div>
            <label style={lbl}>Product Link</label>
            <input style={inp} type="url" value={form.linkUrl} onChange={e => set('linkUrl', e.target.value)} placeholder="https://… — opens in a new tab from the item's info" />
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
              <label style={lbl}>Price incl. VAT (kr) — 25% VAT</label>
              <input style={inp} type="number" min={0} step="0.01" value={form.priceInclVat} onChange={e => set('priceInclVat', e.target.value)} placeholder="0.00" />
            </div>
          </div>

          {/* Images — the first is the main image on cards; all are shown in the info gallery */}
          <div>
            <label style={lbl}>Equipment Images</label>
            {form.images.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                {form.images.map((url, i) => (
                  <div key={url + i} style={{ position: 'relative', width: 84 }}>
                    <img src={optimizeImageUrl(url)} alt={`Image ${i + 1}`} style={{ width: 84, height: 84, objectFit: 'cover', borderRadius: 8, border: `2px solid ${i === 0 ? '#4cd964' : '#2a2a3a'}`, display: 'block' }} />
                    {i === 0 && (
                      <span style={{ position: 'absolute', top: 4, left: 4, fontSize: '.6rem', fontWeight: 700, background: '#4cd964', color: '#000', borderRadius: 6, padding: '1px 5px' }}>MAIN</span>
                    )}
                    <button
                      type="button"
                      aria-label="Remove image"
                      onClick={() => set('images', form.images.filter((_, j) => j !== i))}
                      style={{ position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,.7)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 }}
                    >
                      <X size={12} />
                    </button>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                      <button type="button" disabled={i === 0} onClick={() => moveImage(i, -1)} aria-label="Move left"
                        style={{ background: '#1a1a25', border: '1px solid #2a2a3a', borderRadius: 6, color: '#c0c0d5', cursor: 'pointer', padding: '1px 6px', opacity: i === 0 ? 0.3 : 1 }}><ChevronLeft size={12} /></button>
                      <button type="button" disabled={i === form.images.length - 1} onClick={() => moveImage(i, 1)} aria-label="Move right"
                        style={{ background: '#1a1a25', border: '1px solid #2a2a3a', borderRadius: 6, color: '#c0c0d5', cursor: 'pointer', padding: '1px 6px', opacity: i === form.images.length - 1 ? 0.3 : 1 }}><ChevronRight size={12} /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div
              style={{ border: `2px dashed ${dragOver ? '#4cd964' : '#2a2a3a'}`, borderRadius: 10, padding: '1rem', cursor: 'pointer', transition: 'border-color .2s', background: dragOver ? 'rgba(76,217,100,.05)' : 'transparent' }}
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); handleImageFiles(e.dataTransfer.files) }}
              onClick={() => !uploading && fileRef.current?.click()}
            >
              <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={e => { if (e.target.files) handleImageFiles(e.target.files); e.target.value = '' }} />
              <div style={{ textAlign: 'center', padding: '.5rem 0', color: '#4a4a60' }}>
                {uploading
                  ? <><Loader2 size={24} style={{ margin: '0 auto 8px', display: 'block', animation: 'spin 1s linear infinite' }} /><p style={{ fontSize: '.8rem' }}>{uploadPct === 0 ? 'Preparing…' : `${uploadPct}%`}</p></>
                  : <><Upload size={24} style={{ margin: '0 auto 8px', display: 'block' }} /><p style={{ fontSize: '.8rem' }}>{form.images.length ? 'Add more images — drag & drop or click' : 'Drag & drop or click to upload images'}</p></>
                }
              </div>
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

          {/* Suggested accessories — offered in a popup when this item is added to the cart */}
          <div>
            <label style={lbl}>Suggested Accessories</label>
            <p style={{ fontSize: '.7rem', color: '#4a4a60', marginBottom: 8 }}>
              Other catalog items to suggest when this is added to the cart (e.g. a DMX controller for a light set).
            </p>
            {form.accessoryIds.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                {form.accessoryIds.map(id => (
                  <span key={id} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '.75rem', background: 'rgba(242,100,25,.1)', border: '1px solid rgba(242,100,25,.3)', borderRadius: 20, padding: '4px 10px', color: '#f0c0a0' }}>
                    {catalogById.get(id)?.name ?? 'Removed item'}
                    <button onClick={() => set('accessoryIds', form.accessoryIds.filter(x => x !== id))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6a6a80', padding: 0, display: 'flex' }}><X size={12} /></button>
                  </span>
                ))}
              </div>
            )}
            <input
              style={{ ...inp, fontSize: '.8rem' }}
              value={accessorySearch}
              onChange={e => setAccessorySearch(e.target.value)}
              placeholder="Search the catalog to add an accessory…"
            />
            {accessorySearch.trim() && (() => {
              const q = accessorySearch.trim().toLowerCase()
              const matches = catalog
                .filter(e => e.id !== existing?.id && !form.accessoryIds.includes(e.id) && e.name.toLowerCase().includes(q))
                .sort((a, b) => a.name.localeCompare(b.name))
                .slice(0, 8)
              return (
                <div style={{ marginTop: 6, border: '1px solid #2a2a3a', borderRadius: 10, overflow: 'hidden' }}>
                  {matches.length === 0 && <p style={{ fontSize: '.78rem', color: '#4a4a60', padding: '8px 12px' }}>No matching items</p>}
                  {matches.map(e => (
                    <button
                      key={e.id}
                      onClick={() => { set('accessoryIds', [...form.accessoryIds, e.id]); setAccessorySearch('') }}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '7px 12px', background: '#12121a', border: 'none', borderBottom: '1px solid #1a1a25', color: '#f0f0f5', fontSize: '.8rem', cursor: 'pointer', textAlign: 'left' }}
                    >
                      {e.imageUrl
                        ? <img src={optimizeImageUrl(e.imageUrl)} alt="" style={{ width: 28, height: 28, objectFit: 'cover', borderRadius: 6 }} />
                        : <Package size={16} color="#4a4a60" />}
                      <span style={{ flex: 1 }}>{e.name}</span>
                      <span style={{ fontSize: '.65rem', color: '#6a6a80', fontWeight: 700 }}>{e.category}</span>
                    </button>
                  ))}
                </div>
              )
            })()}
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
