import { useState, useMemo } from 'react'
import { collection, addDoc, updateDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { EquipmentCategoryDoc } from '@/types'
import { Loader2, Plus, ChevronUp, ChevronDown, Trash2 } from 'lucide-react'
import { COLOR_OPTIONS, catColors, inp } from './adminEquipmentShared'

export function CategoriesTab({ categories }: { categories: EquipmentCategoryDoc[] }) {
  const [newName,  setNewName]  = useState('')
  const [newColor, setNewColor] = useState('blue')
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState('')

  const sorted = useMemo(
    () => [...categories].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name)),
    [categories],
  )

  async function handleAdd() {
    const name = newName.trim().toUpperCase()
    if (!name) { setError('Name is required'); return }
    if (categories.some(c => c.name === name)) { setError('Category already exists'); return }
    setSaving(true); setError('')
    try {
      await addDoc(collection(db, 'equipment_categories'), {
        name, color: newColor, order: categories.length, createdAt: serverTimestamp(),
      })
      setNewName('')
    } catch (e: any) { setError(e?.message ?? 'Save failed') }
    finally { setSaving(false) }
  }

  async function handleDelete(cat: EquipmentCategoryDoc) {
    if (!confirm(`Delete category "${cat.name}"? Equipment items keep their current value.`)) return
    await deleteDoc(doc(db, 'equipment_categories', cat.id))
  }

  async function handleColorChange(cat: EquipmentCategoryDoc, color: string) {
    await updateDoc(doc(db, 'equipment_categories', cat.id), { color })
  }

  async function handleReorder(index: number, dir: -1 | 1) {
    const next = index + dir
    if (next < 0 || next >= sorted.length) return
    const a = sorted[index], b = sorted[next]
    await Promise.all([
      updateDoc(doc(db, 'equipment_categories', a.id), { order: b.order ?? next }),
      updateDoc(doc(db, 'equipment_categories', b.id), { order: a.order ?? index }),
    ])
  }

  const newColors = catColors(newColor)

  return (
    <div style={{ maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Add form */}
      <div style={{ background: '#0e0e16', border: '1px solid #2a2a3a', borderRadius: 14, padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ fontWeight: 700, fontSize: '.9rem', color: '#f0f0f5' }}>Add Category</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
            placeholder="e.g. DRONE"
            style={{ ...inp, flex: 1, minWidth: 140, textTransform: 'uppercase' }}
          />
          <select
            value={newColor}
            onChange={e => setNewColor(e.target.value)}
            style={{ ...inp, width: 120, color: newColors.text, background: newColors.bg, border: `1px solid ${newColors.border}`, fontWeight: 700, fontSize: '.78rem', textTransform: 'capitalize' }}
          >
            {COLOR_OPTIONS.map(c => {
              const col = catColors(c)
              return <option key={c} value={c} style={{ background: '#0e0e16', color: col.text }}>{c}</option>
            })}
          </select>
          <button
            onClick={handleAdd}
            disabled={saving}
            className="primary-btn"
            style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}
          >
            {saving ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Plus size={14} />}
            Add
          </button>
        </div>
        {error && <p style={{ fontSize: '.78rem', color: '#f87171' }}>{error}</p>}
      </div>

      {/* Category list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {sorted.map((cat, idx) => {
          const c = catColors(cat.color)
          return (
            <div key={cat.id} style={{ background: '#0e0e16', border: '1px solid #2a2a3a', borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
              {/* Reorder buttons */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0 }}>
                <button
                  onClick={() => handleReorder(idx, -1)}
                  disabled={idx === 0}
                  title="Move up"
                  style={{ padding: 2, background: 'transparent', border: 'none', cursor: idx === 0 ? 'default' : 'pointer', color: idx === 0 ? '#2a2a3a' : '#6a6a80', display: 'flex', borderRadius: 4, transition: 'color .15s' }}
                  onMouseEnter={e => { if (idx > 0) e.currentTarget.style.color = '#4cd964' }}
                  onMouseLeave={e => { e.currentTarget.style.color = idx === 0 ? '#2a2a3a' : '#6a6a80' }}
                >
                  <ChevronUp size={13} />
                </button>
                <button
                  onClick={() => handleReorder(idx, 1)}
                  disabled={idx === sorted.length - 1}
                  title="Move down"
                  style={{ padding: 2, background: 'transparent', border: 'none', cursor: idx === sorted.length - 1 ? 'default' : 'pointer', color: idx === sorted.length - 1 ? '#2a2a3a' : '#6a6a80', display: 'flex', borderRadius: 4, transition: 'color .15s' }}
                  onMouseEnter={e => { if (idx < sorted.length - 1) e.currentTarget.style.color = '#4cd964' }}
                  onMouseLeave={e => { e.currentTarget.style.color = idx === sorted.length - 1 ? '#2a2a3a' : '#6a6a80' }}
                >
                  <ChevronDown size={13} />
                </button>
              </div>
              <span
                title={cat.name}
                style={{
                  fontSize: '.75rem', fontWeight: 700, letterSpacing: '.08em', padding: '3px 10px', borderRadius: 20,
                  width: 170, flexShrink: 0, textAlign: 'center', color: c.text, background: c.bg, border: `1px solid ${c.border}`,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}
              >
                {cat.name}
              </span>
              <select
                value={cat.color}
                onChange={e => handleColorChange(cat, e.target.value)}
                style={{ ...inp, flex: 1, color: c.text, background: c.bg, border: `1px solid ${c.border}`, fontWeight: 700, fontSize: '.78rem', textTransform: 'capitalize' }}
              >
                {COLOR_OPTIONS.map(col => {
                  const cc = catColors(col)
                  return <option key={col} value={col} style={{ background: '#0e0e16', color: cc.text }}>{col}</option>
                })}
              </select>
              <button
                onClick={() => handleDelete(cat)}
                title="Delete"
                style={{ padding: 7, background: 'transparent', border: 'none', cursor: 'pointer', color: '#4a4a60', display: 'flex', borderRadius: 7 }}
                onMouseEnter={e => (e.currentTarget.style.color = '#f87171')}
                onMouseLeave={e => (e.currentTarget.style.color = '#4a4a60')}
              >
                <Trash2 size={15} />
              </button>
            </div>
          )
        })}
        {sorted.length === 0 && (
          <p style={{ fontSize: '.85rem', color: '#4a4a60', textAlign: 'center', padding: '2rem 0' }}>
            No categories yet. Add one above.
          </p>
        )}
      </div>
    </div>
  )
}
