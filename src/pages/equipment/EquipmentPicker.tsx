import { useState } from 'react'
import { useCollection } from '@/hooks/useFirestore'
import type { EquipmentDoc } from '@/types'
import { Search, X, Check } from 'lucide-react'
import { EquipmentImg } from './inventoryShared'

export function EquipmentPicker({
  onClose,
  onPick,
  pickedCounts,
}: {
  onClose: () => void
  onPick: (item: { id: string; name: string }) => void
  pickedCounts?: Record<string, number>
}) {
  const { data: equipment } = useCollection<EquipmentDoc>('equipment')
  const active = equipment.filter(e => e.isActive).sort((a, b) => a.name.localeCompare(b.name))
  const [search, setSearch] = useState('')
  const [cat, setCat] = useState('ALL')

  const cats = ['ALL', 'CAMERA', 'GRIP', 'LIGHTS', 'SOUND', 'LOCATION', 'BOOKS', 'OTHER']

  const filtered = active.filter(e => {
    if (cat !== 'ALL' && e.category !== cat) return false
    if (search && !e.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  return (
    <div className="equip-picker-overlay">
      <div className="equip-picker-modal">
        <div className="equip-picker-header">
          <h3>Add Equipment</h3>
          <button className="equip-picker-close" onClick={onClose}><X size={20} /></button>
        </div>
        <div className="equip-picker-search">
          <Search size={16} />
          <input
            autoFocus
            placeholder="Search equipment..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="equip-picker-categories">
          {cats.map(c => (
            <button
              key={c}
              className={`equip-picker-cat-btn${cat === c ? ' active' : ''}`}
              onClick={() => setCat(c)}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="equip-picker-grid">
          {filtered.map(e => {
            const pickedQty = pickedCounts?.[e.id] ?? 0
            return (
              <button
                key={e.id}
                className={`equip-picker-card${pickedQty > 0 ? ' picked' : ''}`}
                onClick={() => onPick({ id: e.id, name: e.name })}
              >
                <div className="equip-picker-img">
                  <EquipmentImg
                    url={e.imageUrl}
                    name={e.name}
                    fallback={<div className="equip-picker-placeholder">{e.name}</div>}
                  />
                  <span className="equip-picker-cat-tag">{e.category}</span>
                  {e.priceInclVat > 0 && (
                    <span className="equip-picker-price-tag">{e.priceInclVat} kr/day</span>
                  )}
                  {pickedQty > 0 && (
                    <span className="equip-picker-picked-badge"><Check size={12} /> {pickedQty > 1 ? `×${pickedQty}` : ''}</span>
                  )}
                </div>
                <div className="equip-picker-info">
                  <div className="equip-picker-name">{e.name}</div>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
