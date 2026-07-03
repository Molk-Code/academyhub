import { useState, useEffect, useMemo } from 'react'
import { collection, collectionGroup, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useSearchParams, useNavigate } from 'react-router-dom'
import {
  BarChart2, Package, TrendingUp, XCircle, AlertTriangle, Loader2, ArchiveRestore,
} from 'lucide-react'
import type { EquipmentDoc, InventoryProjectDoc, InventoryItemDoc, UserDoc } from '@/types'
import './molkom.css'

type Item = InventoryItemDoc & { projectId: string }

const TABS = [
  { id: 'most-borrowed',    label: 'Most Borrowed' },
  { id: 'equipment-status', label: 'Equipment Status' },
  { id: 'overdue',          label: 'Overdue' },
  { id: 'damaged',          label: 'Damaged' },
  { id: 'missing',          label: 'Missing' },
  { id: 'manual',           label: 'Manual Checkouts' },
  { id: 'borrowers',        label: 'Borrowers' },
  { id: 'projects',         label: 'Projects' },
]

function today() { return new Date().toISOString().slice(0, 10) }

function formatDate(d: string) {
  if (!d) return '—'
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function CohortBadge({ cohortId, cohorts }: { cohortId: string; cohorts: Record<string, string> }) {
  const name = cohorts[cohortId] ?? cohortId
  if (!name) return null
  return (
    <span style={{ fontSize: '.65rem', fontWeight: 700, background: 'rgba(249,115,22,.12)', color: '#f97316', border: '1px solid rgba(249,115,22,.25)', borderRadius: 10, padding: '2px 7px' }}>
      {name}
    </span>
  )
}

export default function InventoryStats() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const activeTab = searchParams.get('tab') || 'most-borrowed'
  const setTab = (t: string) => setSearchParams({ tab: t })

  const [equipment, setEquipment] = useState<EquipmentDoc[]>([])
  const [projects, setProjects]   = useState<InventoryProjectDoc[]>([])
  const [allItems, setAllItems]   = useState<Item[]>([])
  const [users, setUsers]         = useState<UserDoc[]>([])
  const [loading, setLoading]     = useState(true)

  useEffect(() => {
    Promise.all([
      getDocs(collection(db, 'equipment')),
      getDocs(collection(db, 'inventory_projects')),
      getDocs(collectionGroup(db, 'items')),
      getDocs(query(collection(db, 'users'), where('role', 'in', ['student', 'teacher']))),
    ]).then(([eSnap, pSnap, iSnap, uSnap]) => {
      setEquipment(eSnap.docs.map(d => ({ id: d.id, ...d.data() } as EquipmentDoc)))
      setProjects(pSnap.docs.map(d => ({ id: d.id, ...d.data() } as InventoryProjectDoc)))
      setAllItems(iSnap.docs.map(d => ({
        id: d.id,
        projectId: d.ref.parent.parent?.id ?? '',
        ...d.data(),
      } as Item)))
      setUsers(uSnap.docs.map(d => ({ id: d.id, ...d.data() } as UserDoc)))
      setLoading(false)
    })
  }, [])

  const cohortNames = useMemo(() => {
    const map: Record<string, string> = {}
    users.forEach(u => { if (u.cohortId) map[u.cohortId] = u.cohortId })
    return map
  }, [users])

  const projectMap = useMemo(() => {
    const m: Record<string, InventoryProjectDoc> = {}
    projects.forEach(p => { m[p.id] = p })
    return m
  }, [projects])

  const itemsCheckedOut = allItems.filter(i => i.status === 'checked-out').length
  const missingItems    = allItems.filter(i => i.status === 'missing').length
  const damagedItems    = allItems.filter(i => i.status === 'damaged').length

  const overdueItems = useMemo(() =>
    allItems.filter(i => {
      if (i.status !== 'checked-out') return false
      const proj = projectMap[i.projectId]
      return proj && proj.returnDate < today() && proj.returnDate
    }),
  [allItems, projectMap])

  const overdueCount  = overdueItems.length
  const manualItems   = allItems.filter(i => i.addonSessionId)

  const tabsWithCounts = TABS.map(t => ({
    ...t,
    count:
      t.id === 'overdue'  ? overdueCount :
      t.id === 'damaged'  ? damagedItems :
      t.id === 'missing'  ? missingItems :
      t.id === 'manual'   ? manualItems.length :
      t.id === 'projects' ? projects.length :
      undefined,
  }))

  const statCards = [
    { label: 'Total Equipment', value: equipment.length,    icon: <Package size={18} />,       color: '#60a5fa' },
    { label: 'Currently Out',   value: itemsCheckedOut,      icon: <TrendingUp size={18} />,    color: '#f97316' },
    { label: 'Total Projects',  value: projects.length,      icon: <BarChart2 size={18} />,     color: '#a78bfa' },
    { label: 'Missing Items',   value: missingItems,         icon: <XCircle size={18} />,       color: '#f87171' },
    { label: 'Damaged Items',   value: damagedItems,         icon: <AlertTriangle size={18} />, color: '#fbbf24' },
  ]

  return (
    <div className="molkom-app" style={{ background: '#0a0a0f', minHeight: '100vh' }}>
      <div className="inv-page">
        {/* Page title */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <div className="inv-page-title">
            <BarChart2 size={22} color="#f97316" />
            Statistics
          </div>
        </div>

        {/* Inventory nav tabs (mirrors InventoryPage) */}
        <div className="inv-tabs">
          {['Dashboard', 'All Projects', 'Equipment Status', 'Borrower Stats'].map(label => (
            <button key={label} className="inv-tab" onClick={() => navigate('/admin/inventory')}>
              {label}
            </button>
          ))}
          <button className="inv-tab active">Statistics</button>
        </div>

        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4rem', gap: 12, color: '#6a6a80' }}>
            <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} />
            Loading statistics…
          </div>
        )}

        {!loading && (
          <>
            {/* Stat cards */}
            <div className="inv-stats-row" style={{ marginTop: '1.5rem' }}>
              {statCards.map(c => (
                <div key={c.label} className="inv-stat-card">
                  <span style={{ color: c.color }}>{c.icon}</span>
                  <div>
                    <span className="inv-stat-value" style={{ color: '#f0f0f5' }}>{c.value}</span>
                    <span className="inv-stat-label">{c.label}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Sub-tabs */}
            <div style={{ display: 'flex', gap: 0, overflowX: 'auto', borderBottom: '1px solid rgba(255,255,255,.06)', marginTop: '1.5rem' }}>
              {tabsWithCounts.map(t => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  style={{
                    padding: '10px 16px', fontSize: '.8rem', fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0,
                    background: 'transparent', border: 'none', cursor: 'pointer', transition: 'all .15s',
                    color: activeTab === t.id ? '#f97316' : '#6a6a80',
                    borderBottom: activeTab === t.id ? '2px solid #f97316' : '2px solid transparent',
                  }}
                >
                  {t.label}{t.count !== undefined ? ` (${t.count})` : ''}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div style={{ marginTop: '1.5rem' }}>
              {activeTab === 'most-borrowed' && <MostBorrowedTab allItems={allItems} />}
              {activeTab === 'equipment-status' && <EquipmentStatusTab equipment={equipment} allItems={allItems} projectMap={projectMap} navigate={navigate} />}

        {/* Overdue */}
        {activeTab === 'overdue' && <SimpleItemsTab
          items={overdueItems}
          projectMap={projectMap}
          columns={['Equipment', 'Project', 'Due Date', 'Days Overdue']}
          renderRow={item => {
            const proj = projectMap[item.projectId]
            const days = proj ? Math.floor((Date.now() - new Date(proj.returnDate).getTime()) / 86400000) : 0
            return [
              item.equipmentName,
              proj ? <button onClick={() => navigate('/admin/inventory')} style={{ color: '#f97316', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 'inherit' }}>{proj.name}</button> : '—',
              <span style={{ color: '#f97316' }}>{proj ? formatDate(proj.returnDate) : '—'}</span>,
              <span style={{ color: '#f87171', fontWeight: 700 }}>{days} day{days !== 1 ? 's' : ''}</span>,
            ]
          }}
          emptyMsg="No overdue items"
          borderColor="#f87171"
        />}

        {/* Damaged */}
        {activeTab === 'damaged' && <SimpleItemsTab
          items={allItems.filter(i => i.status === 'damaged')}
          projectMap={projectMap}
          columns={['Item Name', 'Project', 'Damage Notes']}
          renderRow={item => {
            const proj = projectMap[item.projectId]
            return [
              item.equipmentName,
              proj ? <button onClick={() => navigate('/admin/inventory')} style={{ color: '#f97316', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 'inherit' }}>{proj.name}</button> : '—',
              <span style={{ color: '#fbbf24', fontSize: '.8rem' }}>{item.damageNotes || '—'}</span>,
            ]
          }}
          emptyMsg="No damaged items"
          borderColor="#fbbf24"
        />}

        {/* Missing */}
        {activeTab === 'missing' && <SimpleItemsTab
          items={allItems.filter(i => i.status === 'missing')}
          projectMap={projectMap}
          columns={['Item Name', 'Project', 'Assigned To']}
          renderRow={item => {
            const proj = projectMap[item.projectId]
            return [
              item.equipmentName,
              proj ? <button onClick={() => navigate('/admin/inventory')} style={{ color: '#f97316', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 'inherit' }}>{proj.name}</button> : '—',
              item.assignedTo || '—',
            ]
          }}
          emptyMsg="No missing items"
          borderColor="#f87171"
        />}

        {/* Manual Checkouts */}
        {activeTab === 'manual' && <SimpleItemsTab
          items={manualItems}
          projectMap={projectMap}
          columns={['Item Name', 'Project', 'Added By', 'Date', 'Collected By']}
          renderRow={item => {
            const proj = projectMap[item.projectId]
            return [
              item.equipmentName,
              proj ? <button onClick={() => navigate('/admin/inventory')} style={{ color: '#f97316', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 'inherit' }}>{proj.name}</button> : '—',
              item.addonManager || '—',
              item.addonDate ? formatDate(item.addonDate) : '—',
              item.addonCollectedBy || '—',
            ]
          }}
          emptyMsg="No manual checkouts"
          borderColor="#a78bfa"
        />}

              {activeTab === 'borrowers' && <BorrowersTab users={users} projects={projects} allItems={allItems} cohortNames={cohortNames} />}
              {activeTab === 'projects' && <ProjectsTab projects={projects} allItems={allItems} navigate={navigate} />}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function MostBorrowedTab({ allItems }: { allItems: Item[] }) {
  const sorted = useMemo(() => {
    const counts: Record<string, number> = {}
    allItems.forEach(i => { counts[i.equipmentName] = (counts[i.equipmentName] || 0) + 1 })
    return Object.entries(counts).sort((a, b) => b[1] - a[1])
  }, [allItems])
  const maxCount = sorted[0]?.[1] || 1

  if (sorted.length === 0) return <Empty msg="No borrowing history yet" />

  return (
    <div style={{ background: '#0e0e16', border: '1px solid #2a2a3a', borderRadius: 12, padding: '0 1rem' }}>
      {sorted.map(([name, count], i) => (
        <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '10px 0', borderBottom: '1px solid #1a1a25' }}>
          <span style={{ fontSize: '.75rem', color: '#4a4a60', width: 28, fontFamily: 'monospace' }}>#{i + 1}</span>
          <span style={{ flex: 1, fontSize: '.85rem', color: '#f0f0f5' }}>{name}</span>
          <div style={{ width: 144, height: 6, background: 'rgba(255,255,255,.08)', borderRadius: 99, overflow: 'hidden' }}>
            <div style={{ height: '100%', background: 'rgba(249,115,22,.6)', borderRadius: 99, width: `${(count / maxCount) * 100}%` }} />
          </div>
          <span style={{ fontSize: '.85rem', fontWeight: 700, color: '#f97316', width: 28, textAlign: 'right' }}>{count}×</span>
        </div>
      ))}
    </div>
  )
}

function EquipmentStatusTab({
  equipment, allItems, projectMap, navigate,
}: {
  equipment: EquipmentDoc[]
  allItems: Item[]
  projectMap: Record<string, InventoryProjectDoc>
  navigate: (path: string) => void
}) {
  const [search, setSearch] = useState('')
  const filtered = equipment.filter(e => e.name?.toLowerCase().includes(search.toLowerCase()))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search equipment…"
        className="manual-add-input"
        style={{ maxWidth: 320 }}
      />
      <div style={{ background: '#0e0e16', border: '1px solid #2a2a3a', borderRadius: 12, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.85rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #2a2a3a' }}>
              {['Equipment', 'Category', 'Status', 'Project'].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '.5rem .75rem', color: '#6a6a80', fontWeight: 600, fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '.06em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(e => {
              const activeItem = allItems.find(i => (i.equipmentId === e.id || i.equipmentName === e.name) && i.status !== 'returned')
              const proj = activeItem ? projectMap[activeItem.projectId] : undefined
              const { dot, label, color } = getStatusDisplay(activeItem, proj)
              return (
                <tr key={e.id} style={{ borderBottom: '1px solid #1a1a25' }}>
                  <td style={{ padding: '.5rem .75rem', color: '#f0f0f5', fontWeight: 600 }}>{e.name}</td>
                  <td style={{ padding: '.5rem .75rem', color: '#f97316', fontSize: '.7rem', fontWeight: 700 }}>{e.category}</td>
                  <td style={{ padding: '.5rem .75rem' }}><span style={{ color }}>{dot} {label}</span></td>
                  <td style={{ padding: '.5rem .75rem', color: '#6a6a80' }}>
                    {proj
                      ? <button onClick={() => navigate('/admin/inventory')} style={{ color: '#f97316', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>{proj.name}</button>
                      : '—'
                    }
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {filtered.length === 0 && <div style={{ textAlign: 'center', padding: '2.5rem', color: '#4a4a60', fontSize: '.85rem' }}>No equipment found</div>}
      </div>
    </div>
  )
}

function getStatusDisplay(item?: Item, proj?: InventoryProjectDoc) {
  if (!item) return { dot: '🟢', label: 'Available', color: '#4ade80' }
  if (item.status === 'damaged')     return { dot: '🟠', label: 'Damaged',    color: '#fbbf24' }
  if (item.status === 'missing')     return { dot: '⚫', label: 'Missing',    color: '#a1a1aa' }
  if (item.status === 'checked-out') {
    const overdue = proj && proj.returnDate < today()
    if (overdue) return { dot: '🔴', label: 'Overdue',     color: '#f87171' }
    return           { dot: '🔵', label: 'Checked Out',  color: '#60a5fa' }
  }
  return { dot: '🟢', label: 'Available', color: '#4ade80' }
}

function SimpleItemsTab({
  items, projectMap, columns, renderRow, emptyMsg, borderColor,
}: {
  items: Item[]
  projectMap: Record<string, InventoryProjectDoc>
  columns: string[]
  renderRow: (item: Item) => React.ReactNode[]
  emptyMsg: string
  borderColor: string
}) {
  if (items.length === 0) return <Empty msg={emptyMsg} />
  return (
    <div style={{ background: '#0e0e16', border: '1px solid #2a2a3a', borderRadius: 12, overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.85rem' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #2a2a3a' }}>
            {columns.map(h => (
              <th key={h} style={{ textAlign: 'left', padding: '.5rem .75rem', color: '#6a6a80', fontWeight: 600, fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '.06em' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map(item => (
            <tr key={item.id} style={{ borderLeft: `3px solid ${borderColor}`, borderBottom: '1px solid #1a1a25' }}>
              {renderRow(item).map((cell, i) => (
                <td key={i} style={{ padding: '.5rem .75rem', color: '#c0c0d5' }}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function BorrowersTab({
  users, projects, allItems, cohortNames,
}: {
  users: UserDoc[]
  projects: InventoryProjectDoc[]
  allItems: Item[]
  cohortNames: Record<string, string>
}) {
  const rows = useMemo(() => {
    return users.map(u => {
      const uProjects = projects.filter(p =>
        (u.id && p.borrowerIds?.includes(u.id)) || p.borrowers?.includes(u.displayName),
      )
      if (uProjects.length === 0) return null
      const projIds   = new Set(uProjects.map(p => p.id))
      const uItems    = allItems.filter(i => projIds.has(i.projectId))
      return {
        name:    u.displayName,
        cohortId: u.cohortId ?? '',
        projects: uProjects.length,
        damaged: uItems.filter(i => i.status === 'damaged').length,
        missing: uItems.filter(i => i.status === 'missing').length,
      }
    }).filter(Boolean).sort((a, b) => b!.projects - a!.projects) as NonNullable<ReturnType<typeof users.map>[0]>[]
  }, [users, projects, allItems])

  if (rows.length === 0) return <Empty msg="No borrower data" />

  return (
    <div style={{ background: '#0e0e16', border: '1px solid #2a2a3a', borderRadius: 12, overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.85rem' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #2a2a3a' }}>
            {['Name', 'Class', 'Projects', 'Damaged', 'Missing'].map(h => (
              <th key={h} style={{ textAlign: 'left', padding: '.5rem .75rem', color: '#6a6a80', fontWeight: 600, fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '.06em' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r: any, i: number) => (
            <tr key={i} style={{ borderBottom: '1px solid #1a1a25' }}>
              <td style={{ padding: '.5rem .75rem', color: '#f0f0f5', fontWeight: 600 }}>{r.name}</td>
              <td style={{ padding: '.5rem .75rem' }}><CohortBadge cohortId={r.cohortId} cohorts={cohortNames} /></td>
              <td style={{ padding: '.5rem .75rem', color: r.projects > 0 ? '#f97316' : '#6a6a80', fontWeight: r.projects > 0 ? 700 : 400 }}>{r.projects}</td>
              <td style={{ padding: '.5rem .75rem', color: r.damaged > 0 ? '#fbbf24' : '#6a6a80', fontWeight: r.damaged > 0 ? 700 : 400 }}>{r.damaged || '—'}</td>
              <td style={{ padding: '.5rem .75rem', color: r.missing > 0 ? '#f87171' : '#6a6a80', fontWeight: r.missing > 0 ? 700 : 400 }}>{r.missing || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ProjectsTab({
  projects, allItems, navigate,
}: {
  projects: InventoryProjectDoc[]
  allItems: Item[]
  navigate: (path: string) => void
}) {
  const active   = projects.filter(p => ['active', 'checked-out'].includes(p.status))
  const archived = projects.filter(p => !['active', 'checked-out'].includes(p.status))

  function ProjectRow({ p }: { p: InventoryProjectDoc }) {
    const pItems = allItems.filter(i => i.projectId === p.id)
    const out     = pItems.filter(i => i.status === 'checked-out').length
    const missing = pItems.filter(i => i.status === 'missing').length
    const damaged = pItems.filter(i => i.status === 'damaged').length

    const statusColor =
      p.status === 'active'       ? '#4ade80' :
      p.status === 'checked-out'  ? '#f97316' :
      p.status === 'returned'     ? '#60a5fa' : '#6b7280'

    return (
      <tr style={{ borderBottom: '1px solid #1a1a25', cursor: 'pointer' }} onClick={() => navigate('/admin/inventory')}>
        <td style={{ padding: '.5rem .75rem', color: '#f97316', fontWeight: 600 }}>{p.name}</td>
        <td style={{ padding: '.5rem .75rem', color: '#6a6a80', fontSize: '.78rem' }}>{(p.borrowers ?? []).slice(0, 3).join(', ')}{(p.borrowers?.length ?? 0) > 3 ? ` +${p.borrowers!.length - 3}` : ''}</td>
        <td style={{ padding: '.5rem .75rem', color: '#4a4a60', fontSize: '.75rem' }}>{p.checkoutDate ? `${p.checkoutDate} → ${p.returnDate}` : '—'}</td>
        <td style={{ padding: '.5rem .75rem' }}>
          <span style={{ fontSize: '.65rem', fontWeight: 700, color: statusColor, background: statusColor + '18', border: `1px solid ${statusColor}40`, borderRadius: 10, padding: '2px 7px' }}>
            {p.status}
          </span>
        </td>
        <td style={{ padding: '.5rem .75rem', fontSize: '.75rem' }}>
          {out > 0 && <span style={{ color: '#f97316', marginRight: 8 }}>{out} out</span>}
          {missing > 0 && <span style={{ color: '#f87171', marginRight: 8 }}>{missing} missing</span>}
          {damaged > 0 && <span style={{ color: '#fbbf24' }}>{damaged} damaged</span>}
        </td>
      </tr>
    )
  }

  const ProjectTable = ({ rows }: { rows: InventoryProjectDoc[] }) => (
    <div style={{ background: '#0e0e16', border: '1px solid #2a2a3a', borderRadius: 12, overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.85rem' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #2a2a3a' }}>
            {['Project', 'Borrowers', 'Dates', 'Status', 'Items'].map(h => (
              <th key={h} style={{ textAlign: 'left', padding: '.5rem .75rem', color: '#6a6a80', fontWeight: 600, fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '.06em' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{rows.map(p => <ProjectRow key={p.id} p={p} />)}</tbody>
      </table>
      {rows.length === 0 && <div style={{ textAlign: 'center', padding: '2rem', color: '#4a4a60', fontSize: '.85rem' }}>None</div>}
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <div className="inv-section-title" style={{ marginBottom: 12 }}>Active ({active.length})</div>
        <ProjectTable rows={active} />
      </div>
      {archived.length > 0 && (
        <div>
          <div className="inv-section-title" style={{ marginBottom: 12 }}>Archived / Returned ({archived.length})</div>
          <ProjectTable rows={archived} />
        </div>
      )}
    </div>
  )
}

function Empty({ msg }: { msg: string }) {
  return (
    <div className="inv-empty">{msg}</div>
  )
}

export function StatsContent({
  equipment,
  projects,
  allItems,
}: {
  equipment: EquipmentDoc[]
  projects: InventoryProjectDoc[]
  allItems: Item[]
}) {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('most-borrowed')
  const [users, setUsers] = useState<UserDoc[]>([])

  useEffect(() => {
    getDocs(query(collection(db, 'users'), where('role', 'in', ['student', 'teacher'])))
      .then(snap => setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() } as UserDoc))))
  }, [])

  const projectMap = useMemo(() => {
    const m: Record<string, InventoryProjectDoc> = {}
    projects.forEach(p => { m[p.id] = p })
    return m
  }, [projects])

  const cohortNames = useMemo(() => {
    const map: Record<string, string> = {}
    users.forEach(u => { if (u.cohortId) map[u.cohortId] = u.cohortId })
    return map
  }, [users])

  const itemsCheckedOut = allItems.filter(i => i.status === 'checked-out').length
  const missingItems    = allItems.filter(i => i.status === 'missing').length
  const damagedItems    = allItems.filter(i => i.status === 'damaged').length

  const overdueItems = useMemo(() =>
    allItems.filter(i => {
      if (i.status !== 'checked-out') return false
      const proj = projectMap[i.projectId]
      return proj && proj.returnDate < today() && proj.returnDate
    }),
  [allItems, projectMap])

  const overdueCount = overdueItems.length
  const manualItems  = allItems.filter(i => i.addonSessionId)

  const tabsWithCounts = TABS.map(t => ({
    ...t,
    count:
      t.id === 'overdue'  ? overdueCount :
      t.id === 'damaged'  ? damagedItems :
      t.id === 'missing'  ? missingItems :
      t.id === 'manual'   ? manualItems.length :
      t.id === 'projects' ? projects.length :
      undefined,
  }))

  const statCards = [
    { label: 'Total Equipment', value: equipment.length,  icon: <Package size={18} />,       color: '#60a5fa' },
    { label: 'Currently Out',   value: itemsCheckedOut,    icon: <TrendingUp size={18} />,    color: '#f97316' },
    { label: 'Total Projects',  value: projects.length,    icon: <BarChart2 size={18} />,     color: '#a78bfa' },
    { label: 'Missing Items',   value: missingItems,       icon: <XCircle size={18} />,       color: '#f87171' },
    { label: 'Damaged Items',   value: damagedItems,       icon: <AlertTriangle size={18} />, color: '#fbbf24' },
  ]

  return (
    <>
      <div className="inv-stats-row" style={{ marginTop: '1rem' }}>
        {statCards.map(c => (
          <div key={c.label} className="inv-stat-card">
            <span style={{ color: c.color }}>{c.icon}</span>
            <div>
              <span className="inv-stat-value" style={{ color: '#f0f0f5' }}>{c.value}</span>
              <span className="inv-stat-label">{c.label}</span>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 0, overflowX: 'auto', borderBottom: '1px solid rgba(255,255,255,.06)', marginTop: '1.5rem' }}>
        {tabsWithCounts.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            style={{
              padding: '10px 16px', fontSize: '.8rem', fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0,
              background: 'transparent', border: 'none', cursor: 'pointer', transition: 'all .15s',
              color: activeTab === t.id ? '#f97316' : '#6a6a80',
              borderBottom: activeTab === t.id ? '2px solid #f97316' : '2px solid transparent',
            }}
          >
            {t.label}{t.count !== undefined ? ` (${t.count})` : ''}
          </button>
        ))}
      </div>

      <div style={{ marginTop: '1.5rem' }}>
        {activeTab === 'most-borrowed' && <MostBorrowedTab allItems={allItems} />}
        {activeTab === 'equipment-status' && <EquipmentStatusTab equipment={equipment} allItems={allItems} projectMap={projectMap} navigate={navigate} />}
        {activeTab === 'overdue' && <SimpleItemsTab
          items={overdueItems}
          projectMap={projectMap}
          columns={['Equipment', 'Project', 'Due Date', 'Days Overdue']}
          renderRow={item => {
            const proj = projectMap[item.projectId]
            const days = proj ? Math.floor((Date.now() - new Date(proj.returnDate).getTime()) / 86400000) : 0
            return [
              item.equipmentName,
              proj ? <button onClick={() => navigate('/admin/inventory')} style={{ color: '#f97316', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 'inherit' }}>{proj.name}</button> : '—',
              <span style={{ color: '#f97316' }}>{proj ? formatDate(proj.returnDate) : '—'}</span>,
              <span style={{ color: '#f87171', fontWeight: 700 }}>{days} day{days !== 1 ? 's' : ''}</span>,
            ]
          }}
          emptyMsg="No overdue items"
          borderColor="#f87171"
        />}
        {activeTab === 'damaged' && <SimpleItemsTab
          items={allItems.filter(i => i.status === 'damaged')}
          projectMap={projectMap}
          columns={['Item Name', 'Project', 'Damage Notes']}
          renderRow={item => {
            const proj = projectMap[item.projectId]
            return [
              item.equipmentName,
              proj ? <button onClick={() => navigate('/admin/inventory')} style={{ color: '#f97316', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 'inherit' }}>{proj.name}</button> : '—',
              <span style={{ color: '#fbbf24', fontSize: '.8rem' }}>{item.damageNotes || '—'}</span>,
            ]
          }}
          emptyMsg="No damaged items"
          borderColor="#fbbf24"
        />}
        {activeTab === 'missing' && <SimpleItemsTab
          items={allItems.filter(i => i.status === 'missing')}
          projectMap={projectMap}
          columns={['Item Name', 'Project', 'Assigned To']}
          renderRow={item => {
            const proj = projectMap[item.projectId]
            return [
              item.equipmentName,
              proj ? <button onClick={() => navigate('/admin/inventory')} style={{ color: '#f97316', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 'inherit' }}>{proj.name}</button> : '—',
              item.assignedTo || '—',
            ]
          }}
          emptyMsg="No missing items"
          borderColor="#f87171"
        />}
        {activeTab === 'manual' && <SimpleItemsTab
          items={manualItems}
          projectMap={projectMap}
          columns={['Item Name', 'Project', 'Added By', 'Date', 'Collected By']}
          renderRow={item => {
            const proj = projectMap[item.projectId]
            return [
              item.equipmentName,
              proj ? <button onClick={() => navigate('/admin/inventory')} style={{ color: '#f97316', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 'inherit' }}>{proj.name}</button> : '—',
              item.addonManager || '—',
              item.addonDate ? formatDate(item.addonDate) : '—',
              item.addonCollectedBy || '—',
            ]
          }}
          emptyMsg="No manual checkouts"
          borderColor="#a78bfa"
        />}
        {activeTab === 'borrowers' && <BorrowersTab users={users} projects={projects} allItems={allItems} cohortNames={cohortNames} />}
        {activeTab === 'projects'  && <ProjectsTab projects={projects} allItems={allItems} navigate={navigate} />}
      </div>
    </>
  )
}
