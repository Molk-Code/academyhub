import { useMemo, useRef, useState } from 'react'
import { collection, addDoc, updateDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore'
import { QRCodeSVG } from 'qrcode.react'
import { db } from '@/lib/firebase'
import { useCollection } from '@/hooks/useFirestore'
import type { EquipmentDoc, KitDoc } from '@/types'
import { kitCode, kitCounts } from '@/lib/kits'
import { Loader2, Plus, Trash2, Pencil, QrCode, Printer, X, Minus } from 'lucide-react'
import { inp, printQRLabel } from './adminEquipmentShared'

// Equipment → Kits: named sets of catalog items (e.g. "FX6 camera kit"),
// booked and checked out as one line. Each kit gets a label: scanning it
// checks out every item in it.

const EMPTY = { name: '', notes: '', imageUrl: '', counts: new Map<string, number>() }

export function KitsTab() {
  const { data: kits, loading } = useCollection<KitDoc>('kits')
  const { data: equipment } = useCollection<EquipmentDoc>('equipment')
  const byId = useMemo(() => new Map(equipment.map(e => [e.id, e])), [equipment])
  const sortedEquipment = useMemo(() => equipment.filter(e => e.isActive !== false).sort((a, b) => a.name.localeCompare(b.name)), [equipment])
  const sortedKits = useMemo(() => [...kits].sort((a, b) => a.name.localeCompare(b.name)), [kits])

  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [form, setForm] = useState({ ...EMPTY })
  const [pick, setPick] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [labelFor, setLabelFor] = useState<KitDoc | null>(null)

  function startNew() { setForm({ ...EMPTY, counts: new Map() }); setEditing('new'); setError('') }
  function startEdit(k: KitDoc) {
    setForm({ name: k.name, notes: k.notes ?? '', imageUrl: k.imageUrl ?? '', counts: kitCounts(k) })
    setEditing(k.id); setError('')
  }
  function setCount(id: string, n: number) {
    setForm(f => {
      const counts = new Map(f.counts)
      if (n <= 0) counts.delete(id); else counts.set(id, Math.min(n, 99))
      return { ...f, counts }
    })
  }

  async function save() {
    const name = form.name.trim()
    if (!name) { setError('Give the kit a name.'); return }
    if (!form.counts.size) { setError('Add at least one item.'); return }
    const imageUrl = form.imageUrl.trim()
    if (imageUrl && !/^https:\/\//.test(imageUrl)) { setError('The image must be an https:// link.'); return }
    const itemIds = [...form.counts].flatMap(([id, n]) => Array.from({ length: n }, () => id))
    const data = { name: name.slice(0, 120), itemIds, notes: form.notes.trim().slice(0, 1000), imageUrl, updatedAt: serverTimestamp() }
    setSaving(true); setError('')
    try {
      if (editing === 'new') await addDoc(collection(db, 'kits'), { ...data, createdAt: serverTimestamp() })
      else if (editing) await updateDoc(doc(db, 'kits', editing), data)
      setEditing(null)
    } catch (e: any) { setError(e?.message ?? 'Save failed') }
    finally { setSaving(false) }
  }

  async function remove(k: KitDoc) {
    if (!confirm(`Delete the kit "${k.name}"? Its items stay in the catalog; bookings already made keep their items.`)) return
    await deleteDoc(doc(db, 'kits', k.id))
  }

  const card: React.CSSProperties = { background: '#1c2026', border: '1px solid #31353c', borderRadius: 14, padding: '1rem 1.25rem' }
  const btn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 10, border: '1px solid #31353c', background: '#262a31', color: '#dfe2eb', fontSize: '.8rem', fontWeight: 600, cursor: 'pointer' }

  return (
    <div style={{ maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <p style={{ color: '#a9aeb8', fontSize: '.85rem' }}>A kit is booked and checked out as one line. It's only free when every item in it is.</p>
        {editing === null && <button style={{ ...btn, background: '#4edea3', color: '#000', border: 'none', whiteSpace: 'nowrap', flexShrink: 0 }} onClick={startNew}><Plus size={14} /> New kit</button>}
      </div>

      {editing !== null && (
        <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ fontWeight: 700, color: '#dfe2eb' }}>{editing === 'new' ? 'New kit' : 'Edit kit'}</p>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: '.75rem', color: '#a9aeb8' }}>Name</span>
            <input style={inp} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="FX6 camera kit" />
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: '.75rem', color: '#a9aeb8' }}>Items</span>
            {[...form.counts].map(([id, n]) => (
              <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '.85rem', color: '#dfe2eb' }}>
                <span style={{ flex: 1 }}>{byId.get(id)?.name ?? <em style={{ color: '#ff5449' }}>Removed from the catalog</em>}</span>
                <button aria-label="One less" style={{ ...btn, padding: 6 }} onClick={() => setCount(id, n - 1)}><Minus size={12} /></button>
                <span style={{ minWidth: 20, textAlign: 'center' }}>{n}</span>
                <button aria-label="One more" style={{ ...btn, padding: 6 }} onClick={() => setCount(id, n + 1)}><Plus size={12} /></button>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8 }}>
              <select style={{ ...inp, flex: 1 }} value={pick} onChange={e => setPick(e.target.value)} aria-label="Item to add">
                <option value="">Choose an item…</option>
                {sortedEquipment.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
              <button style={btn} disabled={!pick} onClick={() => { setCount(pick, (form.counts.get(pick) ?? 0) + 1); setPick('') }}><Plus size={14} /> Add</button>
            </div>
          </div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: '.75rem', color: '#a9aeb8' }}>Notes (optional)</span>
            <textarea style={{ ...inp, minHeight: 60 }} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: '.75rem', color: '#a9aeb8' }}>Image link (optional)</span>
            <input style={inp} value={form.imageUrl} onChange={e => setForm(f => ({ ...f, imageUrl: e.target.value }))} placeholder="https://…" />
          </label>
          {error && <p role="alert" style={{ color: '#ff5449', fontSize: '.8rem' }}>{error}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={{ ...btn, background: '#4edea3', color: '#000', border: 'none' }} disabled={saving} onClick={save}>
              {saving && <Loader2 size={14} className="animate-spin" />} Save kit
            </button>
            <button style={btn} onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div>
      )}

      {loading ? <Loader2 className="animate-spin" size={18} color="#979ca7" /> : sortedKits.length === 0 && editing === null ? (
        <p style={{ color: '#979ca7', fontSize: '.85rem' }}>No kits yet.</p>
      ) : sortedKits.map(k => (
        <div key={k.id} style={{ ...card, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          {k.imageUrl && <img src={k.imageUrl} alt="" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8 }} />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontWeight: 700, color: '#dfe2eb' }}>{k.name}</p>
            <p style={{ fontSize: '.78rem', color: '#a9aeb8', marginTop: 2 }}>
              {[...kitCounts(k)].map(([id, n]) => `${n > 1 ? `${n}× ` : ''}${byId.get(id)?.name ?? 'removed item'}`).join(' · ')}
            </p>
            {k.notes && <p style={{ fontSize: '.75rem', color: '#979ca7', marginTop: 4 }}>{k.notes}</p>}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button style={btn} aria-label={`Label for ${k.name}`} onClick={() => setLabelFor(k)}><QrCode size={14} /></button>
            <button style={btn} aria-label={`Edit ${k.name}`} onClick={() => startEdit(k)}><Pencil size={14} /></button>
            <button style={{ ...btn, color: '#ff5449' }} aria-label={`Delete ${k.name}`} onClick={() => remove(k)}><Trash2 size={14} /></button>
          </div>
        </div>
      ))}

      {labelFor && <KitLabel kit={labelFor} onClose={() => setLabelFor(null)} />}
    </div>
  )
}

function KitLabel({ kit, onClose }: { kit: KitDoc; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const value = kitCode(kit.id)
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.8)' }} onClick={onClose}>
      <div role="dialog" aria-label={`Label for ${kit.name}`} style={{ background: '#1c2026', border: '1px solid #31353c', borderRadius: 16, width: 320, padding: '1.5rem', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <span style={{ fontWeight: 700, color: '#dfe2eb' }}>Kit label</span>
          <button className="close-btn" aria-label="Close" onClick={onClose} style={{ position: 'static', width: 28, height: 28 }}><X size={14} /></button>
        </div>
        <p style={{ fontWeight: 600, color: '#dfe2eb', marginBottom: '.75rem' }}>{kit.name}</p>
        <div ref={ref} style={{ background: '#fff', borderRadius: 10, padding: 12, display: 'inline-block', marginBottom: '.75rem' }}>
          <QRCodeSVG value={value} size={180} level="H" />
        </div>
        <p style={{ fontSize: '.75rem', color: '#a9aeb8', marginBottom: '1rem' }}>Scanning this checks out every item in the kit.</p>
        <button onClick={() => printQRLabel(kit.name, value, 'KIT', ref.current)}
          style={{ width: '100%', padding: 10, background: '#262a31', border: '1px solid #31353c', borderRadius: 10, color: '#dfe2eb', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <Printer size={14} /> Print label
        </button>
      </div>
    </div>
  )
}
