import { useMemo, useState } from 'react'
import { collection, updateDoc, deleteField, doc, serverTimestamp, writeBatch } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useCollection, orderBy } from '@/hooks/useFirestore'
import type { EquipmentDoc, MaintenanceLogDoc, MaintenanceType } from '@/types'
import {
  serviceState, DUE_SOON_DAYS, suggestedNextService, sendToService, backFromService, serviceFields, type ServiceState,
} from '@/lib/maintenance'
import { Loader2, Wrench, X, Search } from 'lucide-react'
import { inp } from './adminEquipmentShared'

// Equipment → Maintenance: what needs service, and a log per item. Units sent
// for service (by number, #n as on the labels) can't be booked or checked out
// until they're back. Logging a service or inspection marks it done: the unit
// comes back and the next service date is set (or cleared).

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
            {(e.maintenanceUnits ?? 0) > 0 && (e.serviceUnits?.length
              ? `In service: ${e.serviceUnits.map(u => `#${u.unit}${u.note ? ` (${u.note})` : ''}`).join(', ')}`
              : `${e.maintenanceUnits} of ${e.totalQuantity} in service${e.maintenanceNote ? ` · ${e.maintenanceNote}` : ''}`)}
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

const DONE_TYPES: MaintenanceType[] = ['service', 'inspection']
const field: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 }
const sectionTitle: React.CSSProperties = { fontWeight: 700, color: '#f0f0f5', fontSize: '.88rem' }
const divider: React.CSSProperties = { borderTop: '1px solid #2a2a3a', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }

function ItemMaintenance({ item, onClose }: { item: EquipmentDoc; onClose: () => void }) {
  const { profile } = useAuth()
  const { data: log } = useCollection<MaintenanceLogDoc>(`equipment/${item.id}/maintenance`, [orderBy('date', 'desc')], true, item.id)
  const away = item.serviceUnits ?? []
  // An older count without unit numbers (before units were chosen by number)
  const unnumbered = away.length ? 0 : (item.maintenanceUnits ?? 0)
  const allUnits = Array.from({ length: Math.max(1, item.totalQuantity ?? 1) }, (_, i) => i + 1)
  const free = allUnits.filter(n => !away.some(u => u.unit === n))

  const [send, setSend] = useState({ unit: String(free[0] ?? ''), note: '' })
  const [schedule, setSchedule] = useState({ next: item.nextServiceDate ?? '', interval: item.serviceIntervalMonths ? String(item.serviceIntervalMonths) : '' })
  const blankEntry = (unit = '', type: MaintenanceType = 'service', date = today()) => ({
    date, type, unit, note: '', cost: '', performedBy: profile?.displayName ?? '',
    backInUse: true, next: DONE_TYPES.includes(type) ? suggestedNextService(item, date) : '',
  })
  const [entry, setEntry] = useState(() => blankEntry())
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  const ref = doc(db, 'equipment', item.id)
  const entryUnit = entry.unit === '' ? null : Number(entry.unit)
  // The unit (or, for the whole item, any unit) is away: logging can bring it back
  const canComeBack = entryUnit == null ? away.length > 0 || unnumbered > 0 : away.some(u => u.unit === entryUnit)
  const marksDone = DONE_TYPES.includes(entry.type)

  async function run(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key); setError(''); setDone('')
    try { await fn(); setDone(ok) } catch (e: any) { setError(e?.message ?? 'Save failed') } finally { setBusy(null) }
  }

  const sendUnit = () => run('send', async () => {
    const n = Number(send.unit)
    if (!allUnits.includes(n)) throw new Error('Choose a unit.')
    await updateDoc(ref, { ...serviceFields(sendToService(away, n, send.note, today())), maintenanceNote: deleteField(), updatedAt: serverTimestamp() })
    setSend({ unit: String(free.find(f => f !== n) ?? ''), note: '' })
  }, `#${send.unit} is in service: it can't be checked out until it's back.`)

  const backInUse = (unit: number | null) => run(`back-${unit ?? 'all'}`, async () => {
    await updateDoc(ref, { ...serviceFields(backFromService(away, unit)), ...(unit == null ? { maintenanceNote: deleteField() } : {}), updatedAt: serverTimestamp() })
  }, unit == null ? 'Back in use.' : `#${unit} is back in use.`)

  const saveSchedule = () => run('schedule', async () => {
    const interval = schedule.interval.trim() === '' ? null : Number(schedule.interval)
    if (interval !== null && (!Number.isInteger(interval) || interval < 1 || interval > 120)) throw new Error('Service interval: whole months, 1 to 120.')
    await updateDoc(ref, {
      nextServiceDate: schedule.next || deleteField(),
      serviceIntervalMonths: interval ?? deleteField(),
      updatedAt: serverTimestamp(),
    })
  }, 'Schedule saved.')

  const addEntry = () => run('entry', async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) throw new Error('Pick a date.')
    if (!entry.note.trim() && entry.type === 'other') throw new Error('Describe what was done.')
    const cost = entry.cost.trim() === '' ? null : Number(entry.cost.replace(',', '.'))
    if (cost !== null && (!Number.isFinite(cost) || cost < 0)) throw new Error('Cost must be a number.')
    const back = canComeBack && entry.backInUse
    const batch = writeBatch(db)
    batch.set(doc(collection(db, 'equipment', item.id, 'maintenance')), {
      date: entry.date, type: entry.type, note: entry.note.trim().slice(0, 2000), cost, unit: entryUnit,
      performedBy: entry.performedBy.trim().slice(0, 120), createdBy: profile?.uid ?? '', createdAt: serverTimestamp(),
      ...(back ? { backInUse: true } : {}),
      ...(marksDone ? { nextServiceDate: entry.next || null } : {}),
    })
    // A service or inspection marks it done: the next date replaces the one that was due
    const update: Record<string, unknown> = {}
    if (back) Object.assign(update, serviceFields(backFromService(away, entryUnit)), entryUnit == null ? { maintenanceNote: deleteField() } : {})
    if (marksDone) update.nextServiceDate = entry.next || deleteField()
    if (Object.keys(update).length) batch.update(ref, { ...update, updatedAt: serverTimestamp() })
    await batch.commit()
    if (marksDone) setSchedule(sc => ({ ...sc, next: entry.next }))
    setEntry(blankEntry())
  }, marksDone ? (entry.next ? `Logged. Next service ${entry.next}.` : 'Logged. No next service planned.') : 'Logged.')

  const unitLabel = (u: number | null | undefined) => u == null ? (allUnits.length > 1 ? 'whole item' : '') : `#${u}`

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.8)', padding: 16 }} onClick={onClose}>
      <div role="dialog" aria-label={`Maintenance: ${item.name}`} onClick={e => e.stopPropagation()}
        style={{ ...card, width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <p style={{ fontWeight: 700, color: '#f0f0f5' }}>{item.name} <span style={{ color: '#8a8aab', fontWeight: 400, fontSize: '.8rem' }}>· {item.totalQuantity} {item.totalQuantity === 1 ? 'unit' : 'units'}</span></p>
          <button className="close-btn" aria-label="Close" onClick={onClose} style={{ position: 'static', width: 28, height: 28 }}><X size={14} /></button>
        </div>

        {/* ── Units in service ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p style={sectionTitle}>In service</p>
          {!away.length && !unnumbered && <p style={{ color: '#6a6a80', fontSize: '.8rem' }}>No unit is away.</p>}
          {away.map(u => (
            <div key={u.unit} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '.85rem' }}>
              <span style={{ flex: 1, color: '#f0f0f5' }}>
                <b>#{u.unit}</b>{u.note && <span style={{ color: '#c0c0d5' }}> · {u.note}</span>}
                <span style={{ color: '#8a8aab' }}> · since {u.since}</span>
              </span>
              <button style={btn} disabled={busy !== null} onClick={() => setEntry(blankEntry(String(u.unit)))}>Log service</button>
              <button style={btn} disabled={busy !== null} onClick={() => backInUse(u.unit)}>Back in use</button>
            </div>
          ))}
          {unnumbered > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '.85rem' }}>
              <span style={{ flex: 1, color: '#f0f0f5' }}>{unnumbered} of {item.totalQuantity} in service, unit numbers not recorded{item.maintenanceNote ? ` · ${item.maintenanceNote}` : ''}</span>
              <button style={btn} disabled={busy !== null} onClick={() => backInUse(null)}>All back in use</button>
            </div>
          )}
          {free.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr auto', gap: 8, alignItems: 'end' }}>
              <label style={field}>
                <span style={label}>Unit</span>
                <select style={inp} value={send.unit} onChange={e => setSend(x => ({ ...x, unit: e.target.value }))} aria-label="Unit to send for service">
                  {free.map(n => <option key={n} value={n}>#{n}</option>)}
                </select>
              </label>
              <label style={field}>
                <span style={label}>Why it's away (optional)</span>
                <input style={inp} value={send.note} onChange={e => setSend(x => ({ ...x, note: e.target.value }))} placeholder="Sensor cleaning at the dealer" />
              </label>
              <button style={btn} disabled={busy !== null} onClick={sendUnit}>
                {busy === 'send' && <Loader2 size={14} className="animate-spin" />} Send to service
              </button>
            </div>
          )}
        </div>

        {/* ── Schedule ── */}
        <div style={divider}>
          <p style={sectionTitle}>Service schedule</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, alignItems: 'end' }}>
            <label style={field}>
              <span style={label}>Next service</span>
              <input style={inp} type="date" value={schedule.next} onChange={e => setSchedule(x => ({ ...x, next: e.target.value }))} />
            </label>
            <label style={field}>
              <span style={label}>Service every (months, optional)</span>
              <input style={inp} type="number" min={1} max={120} value={schedule.interval} onChange={e => setSchedule(x => ({ ...x, interval: e.target.value }))} placeholder="e.g. 12" />
            </label>
            <button style={btn} disabled={busy !== null} onClick={saveSchedule}>
              {busy === 'schedule' && <Loader2 size={14} className="animate-spin" />} Save
            </button>
          </div>
        </div>

        {/* ── Log ── */}
        <div style={divider}>
          <p style={sectionTitle}>Log maintenance</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label style={field}>
              <span style={label}>Unit</span>
              <select style={inp} value={entry.unit} onChange={e => setEntry(x => ({ ...x, unit: e.target.value }))}>
                <option value="">{allUnits.length > 1 ? 'Whole item (all units)' : '#1'}</option>
                {allUnits.length > 1 && allUnits.map(n => <option key={n} value={n}>#{n}{away.some(u => u.unit === n) ? ' (in service)' : ''}</option>)}
              </select>
            </label>
            <label style={field}>
              <span style={label}>Type</span>
              <select style={inp} value={entry.type} onChange={e => {
                const type = e.target.value as MaintenanceType
                setEntry(x => ({ ...x, type, next: DONE_TYPES.includes(type) ? (x.next || suggestedNextService(item, x.date)) : '' }))
              }}>
                {TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </label>
            <label style={field}>
              <span style={label}>Date</span>
              <input style={inp} type="date" value={entry.date} onChange={e => {
                const date = e.target.value
                setEntry(x => ({ ...x, date, next: DONE_TYPES.includes(x.type) && item.serviceIntervalMonths ? suggestedNextService(item, date) : x.next }))
              }} />
            </label>
            <label style={field}>
              <span style={label}>Done by</span>
              <input style={inp} value={entry.performedBy} onChange={e => setEntry(x => ({ ...x, performedBy: e.target.value }))} />
            </label>
            <label style={field}>
              <span style={label}>Cost (optional)</span>
              <input style={inp} inputMode="decimal" value={entry.cost} onChange={e => setEntry(x => ({ ...x, cost: e.target.value }))} />
            </label>
            {marksDone && (
              <label style={field}>
                <span style={label}>Next service after this</span>
                <input style={inp} type="date" value={entry.next} onChange={e => setEntry(x => ({ ...x, next: e.target.value }))} />
              </label>
            )}
            <label style={{ ...field, gridColumn: '1 / -1' }}>
              <span style={label}>Note</span>
              <textarea style={{ ...inp, minHeight: 60 }} value={entry.note} onChange={e => setEntry(x => ({ ...x, note: e.target.value }))} />
            </label>
          </div>
          {marksDone && (
            <p style={{ color: '#8a8aab', fontSize: '.75rem' }}>
              Logging a {entry.type} marks it done: {entry.next ? `the next service becomes ${entry.next}` : 'no next service is planned (the item leaves the overdue list)'}.
            </p>
          )}
          {canComeBack && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '.85rem', color: '#f0f0f5' }}>
              <input type="checkbox" checked={entry.backInUse} onChange={e => setEntry(x => ({ ...x, backInUse: e.target.checked }))} />
              {entryUnit == null ? 'Every unit in service is back in use' : `#${entryUnit} is back in use`}
            </label>
          )}
          <button style={{ ...btn, alignSelf: 'flex-start', background: '#4cd964', color: '#000', border: 'none' }} disabled={busy !== null} onClick={addEntry}>
            {busy === 'entry' && <Loader2 size={14} className="animate-spin" />} {marksDone ? 'Add to log and mark done' : 'Add to log'}
          </button>
        </div>

        {error && <p role="alert" style={{ color: '#ff4757', fontSize: '.8rem' }}>{error}</p>}
        {done && <p role="status" style={{ color: '#4cd964', fontSize: '.8rem' }}>{done}</p>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p style={sectionTitle}>History</p>
          {log.length === 0 ? <p style={{ color: '#6a6a80', fontSize: '.8rem' }}>Nothing logged yet.</p> : log.map(l => (
            <div key={l.id} style={{ fontSize: '.8rem', color: '#c0c0d5', borderLeft: '2px solid #2a2a3a', paddingLeft: 10 }}>
              <span style={{ color: '#f0f0f5', fontWeight: 600 }}>
                {l.date} · {TYPES.find(t => t.id === l.type)?.label ?? l.type}{unitLabel(l.unit) && ` · ${unitLabel(l.unit)}`}
              </span>
              {l.performedBy && <span style={{ color: '#8a8aab' }}> · {l.performedBy}</span>}
              {l.cost != null && <span style={{ color: '#8a8aab' }}> · cost {l.cost}</span>}
              {(l.backInUse || l.nextServiceDate !== undefined) && (
                <span style={{ color: '#4cd964' }}>
                  {' · '}{[l.backInUse && 'back in use', l.nextServiceDate !== undefined && (l.nextServiceDate ? `next service ${l.nextServiceDate}` : 'no next service')].filter(Boolean).join(', ')}
                </span>
              )}
              {l.note && <p style={{ marginTop: 2 }}>{l.note}</p>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
