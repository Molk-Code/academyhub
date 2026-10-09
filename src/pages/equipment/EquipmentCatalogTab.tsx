import { useState, useMemo } from 'react'
import { deleteDoc, doc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useCollection } from '@/hooks/useFirestore'
import type { EquipmentDoc, EquipmentCategoryDoc, CohortDoc } from '@/types'
import {
  Search, X, Plus, Package, QrCode, Pencil, Trash2, Loader2, AlertTriangle,
} from 'lucide-react'
import { EquipmentImg, catStyle } from './adminEquipmentShared'
import { InfoModal } from './EquipmentInfoModal'
import { ItemForm } from './EquipmentItemForm'
import { QRModal } from './EquipmentQRModal'

export function CatalogTab({ categories, pricingEnabled }: { categories: EquipmentCategoryDoc[]; pricingEnabled: boolean }) {
  const { data: equipmentRaw } = useCollection<EquipmentDoc>('equipment')
  const { data: cohorts } = useCollection<CohortDoc>('cohorts')
  const equipment = useMemo(
    () => [...equipmentRaw].sort((a, b) => a.name.localeCompare(b.name)),
    [equipmentRaw],
  )
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<string>('ALL')
  const [editItem, setEditItem] = useState<EquipmentDoc | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [qrItem, setQrItem] = useState<EquipmentDoc | null>(null)
  const [infoItem, setInfoItem] = useState<EquipmentDoc | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const sortedCats = useMemo(
    () => [...categories].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [categories],
  )

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
          <button className={`category-btn${category === 'ALL' ? ' active' : ''}`} onClick={() => setCategory('ALL')}>ALL</button>
          {sortedCats.map(cat => (
            <button key={cat.name} className={`category-btn${category === cat.name ? ' active' : ''}`} onClick={() => setCategory(cat.name)}>
              {cat.name}
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
              <div className="product-image" style={{ position: 'relative', cursor: 'pointer' }} onClick={() => setInfoItem(item)}>
                <EquipmentImg
                  url={item.imageUrl}
                  name={item.name}
                  fallback={<div className="image-placeholder"><Package size={32} color="#3a3a4a" /></div>}
                />
                <span className="product-category-tag" style={catStyle(item.category, categories)}>{item.category}</span>
                {!item.isActive && (
                  <span style={{ position: 'absolute', top: 8, right: 8, fontSize: 9, fontWeight: 700, background: '#3a1a1a', color: '#f87171', border: '1px solid rgba(248,113,113,.3)', borderRadius: 20, padding: '2px 6px' }}>Inactive</span>
                )}
                {/* Hover actions */}
                <div
                  style={{
                    position: 'absolute', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex',
                    alignItems: 'center', justifyContent: 'center', gap: 8, opacity: 0, transition: 'opacity .2s',
                    borderRadius: 'inherit', pointerEvents: 'none',
                  }}
                  className="admin-card-overlay"
                >
                  <button onClick={e => { e.stopPropagation(); setQrItem(item) }} title="QR Code"
                    style={{ padding: 8, background: 'rgba(30,30,40,.9)', border: '1px solid #2a2a3a', borderRadius: 8, color: '#c0c0d5', cursor: 'pointer', pointerEvents: 'auto' }}>
                    <QrCode size={16} />
                  </button>
                  <button onClick={e => { e.stopPropagation(); setEditItem(item); setShowForm(true) }} title="Edit"
                    style={{ padding: 8, background: 'rgba(30,30,40,.9)', border: '1px solid #2a2a3a', borderRadius: 8, color: '#c0c0d5', cursor: 'pointer', pointerEvents: 'auto' }}>
                    <Pencil size={16} />
                  </button>
                  <button onClick={e => { e.stopPropagation(); handleDelete(item) }} disabled={deletingId === item.id} title="Delete"
                    style={{ padding: 8, background: 'rgba(60,10,10,.9)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 8, color: '#f87171', cursor: 'pointer', pointerEvents: 'auto' }}>
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
                {item.notes && (
                  <div className="product-notes"><AlertTriangle size={11} style={{ display: 'inline', verticalAlign: '-1px', marginRight: 3 }} />{item.notes}</div>
                )}
                {pricingEnabled && (
                  <div className="product-pricing">
                    {item.priceInclVat > 0
                      ? <span className="price-day">{item.priceInclVat} kr/day</span>
                      : <span className="price-free">Free</span>
                    }
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {infoItem && <InfoModal item={infoItem} cohorts={cohorts} pricingEnabled={pricingEnabled} onClose={() => setInfoItem(null)} />}

      {showForm && <ItemForm existing={editItem} onClose={() => { setShowForm(false); setEditItem(null) }} categories={categories} />}
      {qrItem && <QRModal item={qrItem} onClose={() => setQrItem(null)} />}
    </>
  )
}
