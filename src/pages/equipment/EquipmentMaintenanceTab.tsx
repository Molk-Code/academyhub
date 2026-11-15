import { useMemo, useState } from 'react'
import { collection, addDoc, updateDoc, deleteField, doc, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useCollection, orderBy } from '@/hooks/useFirestore'
import type { EquipmentDoc, MaintenanceLogDoc, MaintenanceType } from '@/types'
import { serviceState, DUE_SOON_DAYS, type ServiceState } from '@/lib/maintenance'
import { Loader2, Wrench, X, Search } from 'lucide-react'
import { inp } from './adminEquipmentShared'

// Equipment → Maintenance: what needs service, and a log per item. Units sent
// for service can't be booked or checked out (the server leaves them out of
// what's free) until they're back.

const TYPES: { id: MaintenanceType; label: string }[] = [
  { id: 'service', label: 'Service' }, { id: 'repair', label: 'Repair' }, { id: 'inspection', label: 'Inspection' },
  { id: 'cleaning', label: 'Cleaning' }, { id: 'other', label: 'Other' },
]
const STATE_LABEL: Record<ServiceState, { text: string; color: string }> = {
  'in-service': { text: 'In service', color: '#f59e0b' },
  overdue: { text: 'Service overdue', color: '#ff4757' },
  'due-soon': { text: 'Service due soon', color: '#a0a0b5' },
}
const today = () => new Date().toISOString().slice(0, 10)

const card: React.CSSProperties = { background: '#0e0e16', border: '1px solid #2a2a3a', borderRadius: 14, padding: '1rem 1.25rem' }
const btn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 10, border: '1px solid #2a2a3a', background: '#1a1a25', color: '#f0f0f5', fontSize: '.8rem', fontWeight: 600, cursor: 'pointer' }
const label: React.CSSProperties = { fontSize: '.75rem', color: '#8a8aab' }

export function MaintenanceTab() {
  const { data: equipment, loading } = useCollection<EquipmentDoc>('equipment')
  const [openId, setOpenId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const now = today()

  const active = useMemo(() => equipment.filter(e => e.isActive !== false), [equipment])
  const groups = useMemo(() => {
    const by = (s: ServiceState) => active.filter(e => serviceState(e, now) === s).sort((a, b) => (a.nextServiceDate ?? '').localeCompare(b.nextServiceDate ?? '') || a.name.localeCompare(b.name))
    return { inService: by('in-service'), overdue: by('overdue'), dueSoon: by('due-soon') }
  }, [active, now])
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? active.filter(e => e.name.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 20) : []
  }, [active, search])
  const open = equipment.find(e => e.id === openId) ?? null

  const row = (e: EquipmentDoc) => {
    const st = serviceState(e, now)
    return (
      <button key={e.id} type="button" onClick={() => setOpenId(e.id)}
        style={{ ...card, padding: '.75rem 1rem', display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', cursor: 'pointer' }}>
        <Wrench size={16} color={st ? STATE_LABEL[st].color : '#6a6a80'} aria-hidden="true" />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontWeight: 600, color: '#f0f0f5', fontSize: '.88rem' }}>{e.name}</span>
          <span style={{ display: 'block', fontSize: '.75rem', color: '#8a8aab' }}>
            {(e.maintenanceUnits ?? 0) > 0 && `${e.maintenanceUnits} of ${e.totalQuantity} in service${e.maintenanceNote ? ` · ${e.maintenanceNote}` : ''}`}
            {(e.maintenanceUnits ?? 0) === 0 && e.nextServiceDate && `Next service ${e.nextServiceDate}`}
            {(e.maintenanceUnits ?? 0) === 0 && !e.nextServiceDate && 'No service date set'}
          </span>
        </span>
        {st && <span style={{ fontSize: '.72rem', fontWeight: 700, color: STATE_LABEL[st].color }}>{STATE_LABEL[st].text}</span>}
      </button>
    )
  }
  const section = (title: string, list: EquipmentDoc[], empty: string) => (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h3 style={{ fontSize: '.8rem', fontWeight: 700, color: '#a0a0b5', textTransform: 'uppercase', letterSpacing: '.08em' }}>{title} ({list.length})</h3>
      {list.length ? list.map(row) : <p style={{ color: '#6a6a80', fontSize: '.85rem' }}>{empty}</p>}
    </section>
  )

  if (loading) return <Loader2 className="animate-spin" size={18} color="#6a6a80" />

  return (
    <div style={{ maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <p style={{ color: '#8a8aab', fontSize: '.85rem' }}>Units in service can't be booked or checked out until they're back.</p>
      {section('In service', groups.inService, 'Nothing is away for service.')}
      {section('Service overdue', groups.overdue, 'Nothing is overdue.')}
      {section(`Due within ${DUE_SOON_DAYS} days`, groups.dueSoon, 'Nothing is due soon.')}

      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h3 style={{ fontSize: '.8rem', fontWeight: 700, color: '#a0a0b5', textTransform: 'uppercase', letterSpacing: '.08em' }}>Any item</h3>
        <label style={{ position: 'relative' }}>
          <Search size={14} color="#6a6a80" style={{ position: 'absolute', left: 10, top: 11 }} aria-hidden="true" />
          <input style={{ ...inp, paddingLeft: 30, width: '100%' }} placeholder="Find an item to log maintenance…" value={search} onChange={e => setSearch(e.target.value)} aria-label="Find an item" />
        </label>
        {matches.map(row)}
      </section>

      {open && <ItemMaintenance item={open} onClose={() => setOpenId(null)} />}
    </div>
  )
}

function ItemMaintenance({ item, onClose }: { item: EquipmentDoc; onClose: () => void }) {
  const { profile } = useAuth()
  const { data: log } = useCollection<MaintenanceLogDoc>(`equipment/${item.id}/maintenance`, [orderBy('date', 'desc')], true, item.id)
  const [units, setUnits] = useState(String(item.maintenanceUnits ?? 0))
  const [note, setNote] = useState(item.maintenanceNote ?? '')
  const [next, setNext] = useState(item.nextServiceDate ?? '')
  const [entry, setEntry] = useState({ date: today(), type: 'service' as MaintenanceType, note: '', cost: '', performedBy: profile?.displayName ?? '' })
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key); setError('')
    try { await fn() } catch (e: any) { setError(e?.message ?? 'Save failed') } finally { setBusy(null) }
  }

  const saveStatus = () => run('status', async () => {
    const n = Number(units)
    if (!Number.isInteger(n) || n < 0 || n > (item.totalQuantity ?? 0)) throw new Error(`Units in service: a whole number from 0 to ${item.totalQuantity}.`)
    await updateDoc(doc(db, 'equipment', item.id), {
      maintenanceUnits: n,
      maintenanceNote: n > 0 && note.trim() ? note.trim().slice(0, 300) : deleteField(),
      nextServiceDate: next || deleteField(),
      updatedAt: serverTimestamp(),
    })
  })

  const addEntry = () => run('entry', async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) throw new Error('Pick a date.')
    if (!entry.note.trim() && entry.type === 'other') throw new Error('Describe what was done.')
    const cost = entry.cost.trim() === '' ? null : Number(entry.cost.replace(',', '.'))
    if (cost !== null && (!Number.isFinite(cost) || cost < 0)) throw new Error('Cost must be a number.')
    await addDoc(collection(db, 'equipment', item.id, 'maintenance'), {
      date: entry.date, type: entry.type, note: entry.note.trim().slice(0, 2000), cost,
      performedBy: entry.performedBy.trim().slice(0, 120), createdBy: profile?.uid ?? '', createdAt: serverTimestamp(),
    })
    setEntry(e => ({ ...e, note: '', cost: '' }))
  })

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.8)', padding: 16 }} onClick={onClose}>
      <div role="dialog" aria-label={`Maintenance: ${item.name}`} onClick={e => e.stopPropagation()}
        style={{ ...card, width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <p style={{ fontWeight: 700, color: '#f0f0f5' }}>{item.name}</p>
          <button className="close-btn" aria-label="Close" onClick={onClose} style={{ position: 'static', width: 28, height: 28 }}><X size={14} /></button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={label}>Units in service (of {item.totalQuantity})</span>
            <input style={inp} type="number" min={0} max={item.totalQuantity} value={units} onChange={e => setUnits(e.target.value)} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={label}>Next service</span>
            <input style={inp} type="date" value={next} onChange={e => setNext(e.target.value)} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, gridColumn: '1 / -1' }}>
            <span style={label}>Why it's away (optional)</span>
            <input style={inp} value={note} onChange={e => setNote(e.target.value)} placeholder="Sensor cleaning at the dealer" />
          </label>
        </div>
        <button style={{ ...btn, alignSelf: 'flex-start' }} disabled={busy !== null} onClick={saveStatus}>
          {busy === 'status' && <Loader2 size={14} className="animate-spin" />} Save
        </button>

        <div style={{ borderTop: '1px solid #2a2a3a', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p style={{ fontWeight: 700, color: '#f0f0f5', fontSize: '.88rem' }}>Log maintenance</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={label}>Date</span>
              <input style={inp} type="date" value={entry.date} onChange={e => setEntry(x => ({ ...x, date: e.target.value }))} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={label}>Type</span>
              <select style={inp} value={entry.type} onChange={e => setEntry(x => ({ ...x, type: e.target.value as MaintenanceType }))}>
                {TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={label}>Done by</span>
              <input style={inp} value={entry.performedBy} onChange={e => setEntry(x => ({ ...x, performedBy: e.target.value }))} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={label}>Cost (optional)</span>
              <input style={inp} inputMode="decimal" value={entry.cost} onChange={e => setEntry(x => ({ ...x, cost: e.target.value }))} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, gridColumn: '1 / -1' }}>
              <span style={label}>Note</span>
              <textarea style={{ ...inp, minHeight: 60 }} value={entry.note} onChange={e => setEntry(x => ({ ...x, note: e.target.value }))} />
            </label>
          </div>
          <button style={{ ...btn, alignSelf: 'flex-start', background: '#4cd964', color: '#000', border: 'none' }} disabled={busy !== null} onClick={addEntry}>
            {busy === 'entry' && <Loader2 size={14} className="animate-spin" />} Add to log
          </button>
        </div>

        {error && <p role="alert" style={{ color: '#ff4757', fontSize: '.8rem' }}>{error}</p>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p style={{ fontWeight: 700, color: '#f0f0f5', fontSize: '.88rem' }}>History</p>
          {log.length === 0 ? <p style={{ color: '#6a6a80', fontSize: '.8rem' }}>Nothing logged yet.</p> : log.map(l => (
            <div key={l.id} style={{ fontSize: '.8rem', color: '#c0c0d5', borderLeft: '2px solid #2a2a3a', paddingLeft: 10 }}>
              <span style={{ color: '#f0f0f5', fontWeight: 600 }}>{l.date} · {TYPES.find(t => t.id === l.type)?.label ?? l.type}</span>
              {l.performedBy && <span style={{ color: '#8a8aab' }}> · {l.performedBy}</span>}
              {l.cost != null && <span style={{ color: '#8a8aab' }}> · cost {l.cost}</span>}
              {l.note && <p style={{ marginTop: 2 }}>{l.note}</p>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
