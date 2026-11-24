import { useState, useEffect, useMemo } from 'react'
import { collection, getDocs, query, where, doc, setDoc, serverTimestamp, type Timestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useDocument } from '@/hooks/useFirestore'
import {
  BarChart2, Package, TrendingUp, XCircle, AlertTriangle,
} from 'lucide-react'
import { calcRentalDays, billableDays } from '@/lib/productionBudget'
import { isDueThisWeek } from './inventoryShared'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { STATUS_TONE, toneChip, type StatusTone } from '@/lib/statusTone'
import type { EquipmentDoc, InventoryProjectDoc, InventoryItemDoc, UserDoc, CohortDoc } from '@/types'
import './molkom.css'
import { clickableRow } from '@/lib/a11y'

type Item = InventoryItemDoc & { projectId: string }

const TABS = [
  { id: 'overdue',          label: 'Overdue' },
  { id: 'due-this-week',    label: 'Due This Week' },
  { id: 'damaged',          label: 'Damaged' },
  { id: 'missing',          label: 'Missing' },
  { id: 'manual',           label: 'Manual Checkouts' },
  { id: 'most-borrowed',    label: 'Most Borrowed' },
  { id: 'borrowers',        label: 'Borrowers' },
  { id: 'projects',         label: 'Projects' },
  { id: 'budget',           label: 'Budget' },
]

function today() { return new Date().toISOString().slice(0, 10) }

function formatDate(d: string) {
  if (!d) return '—'
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// Compact checkout → return range: "13 Oct – 5 Nov", with years only where
// needed ("13 Oct – 5 Nov 2025", "20 Dec 2026 – 8 Jan 2027").
function formatRange(start: string, end: string) {
  if (!start) return '—'
  const a = new Date(start + 'T12:00:00')
  const b = end ? new Date(end + 'T12:00:00') : null
  // Fixed 3-letter months — en-GB locale data writes September as "Sept"
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const dm = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]}`
  const dmy = (d: Date) => `${dm(d)} ${d.getFullYear()}`
  if (!b) return dmy(a)
  if (a.getFullYear() !== b.getFullYear()) return `${dmy(a)} – ${dmy(b)}`
  const sameDay = start === end
  if (a.getFullYear() === new Date().getFullYear()) return sameDay ? dm(a) : `${dm(a)} – ${dm(b)}`
  return sameDay ? dmy(a) : `${dm(a)} – ${dmy(b)}`
}

function CohortBadge({ cohortId, cohorts }: { cohortId: string; cohorts: Record<string, string> }) {
  const name = cohorts[cohortId] ?? cohortId
  if (!name) return null
  return (
    <span style={{ fontSize: '.6875rem', fontWeight: 700, background: 'rgba(255,107,53,.12)', color: '#ff6b35', border: '1px solid rgba(255,107,53,.25)', borderRadius: 10, padding: '2px 7px' }}>
      {name}
    </span>
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
    <div style={{ background: '#1c2026', border: '1px solid #31353c', borderRadius: 12, padding: '0 1rem' }}>
      {sorted.map(([name, count], i) => (
        <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '10px 0', borderBottom: '1px solid #262a31' }}>
          <span style={{ fontSize: '.75rem', color: '#8c919b', width: 28, fontFamily: 'monospace' }}>#{i + 1}</span>
          <span style={{ flex: 1, fontSize: '.85rem', color: '#dfe2eb' }}>{name}</span>
          <div style={{ width: 144, height: 6, background: 'rgba(255,255,255,.08)', borderRadius: 99, overflow: 'hidden' }}>
            <div style={{ height: '100%', background: 'rgba(255,107,53,.6)', borderRadius: 99, width: `${(count / maxCount) * 100}%` }} />
          </div>
          <span style={{ fontSize: '.85rem', fontWeight: 700, color: '#ff6b35', width: 28, textAlign: 'right' }}>{count}×</span>
        </div>
      ))}
    </div>
  )
}

type StatusSortKey = 'name' | 'category' | 'status' | 'project'
const STATUS_SORTS: { key: StatusSortKey; label: string }[] = [
  { key: 'status',   label: 'Status' },
  { key: 'name',     label: 'A–Z' },
  { key: 'category', label: 'Category' },
  { key: 'project',  label: 'Project' },
]
// Table columns; the ones with a sort key sort when their header is clicked
const STATUS_COLUMNS: { header: string; sort?: StatusSortKey }[] = [
  { header: 'Equipment', sort: 'name' },
  { header: 'Units' },
  { header: 'Status', sort: 'status' },
  { header: 'Where', sort: 'project' },
]

type UnitState = 'Overdue' | 'Damaged' | 'Missing' | 'Pending Checkout' | 'Checked Out'
type StatusLabel = UnitState | 'Available'
// Most urgent first; also the sort order of the Status column
const STATUS_ORDER: StatusLabel[] = ['Missing', 'Overdue', 'Damaged', 'Pending Checkout', 'Checked Out', 'Available']

// The shared status tones (lib/statusTone.ts)
const LABEL_TONE: Record<StatusLabel, StatusTone> = {
  'Missing': 'missing', 'Overdue': 'overdue', 'Damaged': 'damaged',
  'Pending Checkout': 'pending', 'Checked Out': 'out', 'Available': 'shelf',
}
const STATUS_STYLE = Object.fromEntries(Object.entries(LABEL_TONE).map(([label, tone]) => {
  const t = STATUS_TONE[tone]
  return [label, { color: t.fg, bg: t.bg, solid: t.solid, chip: toneChip(tone) }]
})) as Record<StatusLabel, { color: string; bg: string; solid: string; chip: React.CSSProperties }>

type StatusFilter = 'all' | 'Missing' | 'Overdue' | 'Damaged' | 'Pending Checkout' | 'out' | 'available'
// Problems first, in the shared status colours; a problem filter only shows when something has that status
const STATUS_FILTERS: { key: StatusFilter; label: string; problem?: StatusLabel }[] = [
  { key: 'all', label: 'All' },
  { key: 'Missing', label: 'missing', problem: 'Missing' },
  { key: 'Overdue', label: 'overdue', problem: 'Overdue' },
  { key: 'Damaged', label: 'damaged', problem: 'Damaged' },
  { key: 'Pending Checkout', label: 'pending', problem: 'Pending Checkout' },
  { key: 'out', label: 'Out' },
  { key: 'available', label: 'On shelf' },
]

/** Status word for a row: the most urgent unit's state, counted ("2 overdue"), or Out / Available */
function statusText(worst: StatusLabel, n: number) {
  if (worst === 'Available') return 'Available'
  if (worst === 'Checked Out') return 'Out'
  if (worst === 'Pending Checkout') return `${n} pending`
  return `${n} ${worst.toLowerCase()}`
}

// Shape beside the status word, so status never rests on colour alone
function StatusIcon({ label }: { label: StatusLabel }) {
  const common = { width: 12, height: 12, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'aria-hidden': true as const }
  if (label === 'Overdue') return <svg {...common} strokeWidth={2.6}><path d="M12 8v5M12 17h.01" /><circle cx="12" cy="12" r="9" /></svg>
  if (label === 'Damaged') return <svg {...common} strokeWidth={2.4}><path d="M12 3 2 20h20zM12 10v4M12 17h.01" /></svg>
  if (label === 'Missing') return <svg {...common} strokeWidth={2.4}><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17h.01" /></svg>
  if (label === 'Available') return <svg {...common} strokeWidth={2.8}><path d="M20 6 9 17l-5-5" /></svg>
  return <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 99, background: 'currentColor', flexShrink: 0 }} />
}

const UNIT_BAR_MAX = 24

/** Every catalogue item with its units: Inventory's Units view */
export function EquipmentStatusTab({
  equipment, allItems, projectMap, onOpenProject,
}: {
  equipment: EquipmentDoc[]
  allItems: Item[]
  projectMap: Record<string, InventoryProjectDoc>
  onOpenProject: (id: string) => void
}) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [sort, setSort] = useState<{ key: StatusSortKey; dir: 1 | -1 }>({ key: 'status', dir: 1 })
  // Phones get one card per item instead of a table that scrolls sideways
  const narrow = useMediaQuery('(max-width: 640px)')
  const filtered = equipment.filter(e => e.name?.toLowerCase().includes(search.toLowerCase()))

  const allRows = useMemo(() => {
    const open = allItems.filter(i => i.status !== 'returned')
    // Old items saved without an id still match the catalog by name; items
    // typed by hand never do, so they don't count against a catalog item
    const catalogNames = new Set(equipment.map(e => e.name))
    const linksTo = (i: Item, e: EquipmentDoc) =>
      i.equipmentId ? i.equipmentId === e.id : !i.isManualEntry && i.equipmentName === e.name
    const rank = (l: StatusLabel) => STATUS_ORDER.indexOf(l)
    const stateOf = (i: Item) => getStatusDisplay(i, projectMap[i.projectId]).label as UnitState
    // Units of one item can be out on several projects: one chip per project
    // with its unit numbers (#1 #2), or a count when units weren't scanned
    const summarise = (matching: Item[], total: number) => {
      const units = matching.map(stateOf).sort((a, b) => rank(a) - rank(b))
      const worst: StatusLabel = units[0] ?? 'Available'
      const byProject = new Map<string, Item[]>()
      matching.forEach(i => byProject.set(i.projectId, [...(byProject.get(i.projectId) ?? []), i]))
      const projects = [...byProject]
        .map(([id, items]) => ({
          proj: projectMap[id],
          count: items.length,
          unitNos: items.map(i => i.unit).filter((u): u is number => typeof u === 'number').sort((a, b) => a - b),
          worst: items.map(stateOf).sort((a, b) => rank(a) - rank(b))[0],
        }))
        .filter((p): p is typeof p & { proj: InventoryProjectDoc } => !!p.proj)
        .sort((a, b) => rank(a.worst) - rank(b.worst) || a.proj.name.localeCompare(b.proj.name, 'sv'))
      return { units, total: Math.max(total, units.length), worst, worstCount: units.filter(u => u === worst).length, projects }
    }
    const catalogRows = filtered.map(e => ({
      key: e.id, name: e.name, category: e.category, manual: false, location: e.location ?? '',
      ...summarise(open.filter(i => linksTo(i, e)), e.totalQuantity ?? 1),
    }))
    // Hand-typed items carry no category: borrow one from a catalog item with
    // the same name (any case), and "(BOOK) …" titles count as books
    const categoryByName = new Map(equipment.map(e => [e.name.trim().toLowerCase(), e.category]))
    const guessCategory = (name: string) =>
      categoryByName.get(name.trim().toLowerCase())
      ?? (/^\(book\)/i.test(name.trim()) ? (equipment.find(e => /^books?$/i.test(e.category))?.category ?? 'BOOKS') : '')
    // Hand-typed items show only while they're out, then drop off the list
    const q = search.toLowerCase()
    const manualRows = open
      .filter(i => !i.equipmentId && (i.isManualEntry || !catalogNames.has(i.equipmentName)))
      .filter(i => i.equipmentName.toLowerCase().includes(q))
      .map(i => ({
        key: `manual-${i.projectId}-${i.id}`, name: i.equipmentName, category: guessCategory(i.equipmentName), manual: true, location: '',
        ...summarise([i], 1),
      }))
    return [...catalogRows, ...manualRows]
  }, [filtered, equipment, allItems, projectMap, search])

  const matches = (r: typeof allRows[number], f: StatusFilter) =>
    f === 'all' ? true
    : f === 'out' ? r.units.length > 0
    : f === 'available' ? r.units.length < r.total
    : r.units.includes(f)
  const filterCounts = Object.fromEntries(STATUS_FILTERS.map(f => [f.key, allRows.filter(r => matches(r, f.key)).length])) as Record<StatusFilter, number>

  const rows = useMemo(() => {
    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'sv')
    // Empty categories and projects sort last whichever way the column runs
    const byText = (x: string, y: string) => !x === !y ? x.localeCompare(y, 'sv') * sort.dir : x ? -1 : 1
    const rank = (l: StatusLabel) => STATUS_ORDER.indexOf(l)
    return allRows.filter(r => matches(r, filter)).sort((a, b) => {
      switch (sort.key) {
        case 'name':     return byName(a, b) * sort.dir
        case 'category': return byText(a.category, b.category) || byName(a, b)
        case 'project':  return byText(a.projects[0]?.proj.name ?? '', b.projects[0]?.proj.name ?? '') || byName(a, b)
        default:         return (rank(a.worst) - rank(b.worst)) * sort.dir || byName(a, b)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRows, filter, sort])

  const toggleSort = (key: StatusSortKey) =>
    setSort(s => s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 })

  type Row = typeof rows[number]
  const nameCell = ({ name, manual, category }: Row) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      <span style={{ color: '#f6f7f9', fontWeight: 600, overflowWrap: 'anywhere' }}>
        {name}
        {manual && (
          <span style={{ marginLeft: 8, fontSize: '.6875rem', fontWeight: 700, color: '#a9aeb8', border: '1px solid #454a52', borderRadius: 8, padding: '1px 6px', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>
            MANUAL
          </span>
        )}
      </span>
      {category && <span style={{ fontSize: '.75rem', fontWeight: 600, color: '#ff8a5c', letterSpacing: '.04em' }}>{category}</span>}
    </div>
  )
  const unitsCell = ({ units, total }: Row, width: number | string = 140) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width }}>
      <span style={{ color: '#f6f7f9', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{units.length} of {total} out</span>
      {total <= UNIT_BAR_MAX && (
        <div style={{ display: 'flex', gap: 3 }} aria-hidden="true">
          {Array.from({ length: total }, (_, i) => (
            <span key={i} style={{ flex: 1, height: 6, borderRadius: 3, background: units[i] ? STATUS_STYLE[units[i]].solid : STATUS_TONE.shelf.solid }} />
          ))}
        </div>
      )}
    </div>
  )
  const statusPill = ({ worst, worstCount }: Row) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 26, padding: '0 10px', borderRadius: 13, ...STATUS_STYLE[worst].chip, fontSize: '.75rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
      <StatusIcon label={worst} />{statusText(worst, worstCount)}
    </span>
  )
  const whereCell = ({ projects, manual, location, units, total }: Row) => projects.length === 0
    ? <span style={{ color: '#a9aeb8' }}>{location || '—'}</span>
    : (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {projects.map(({ proj: p, count, unitNos, worst: pw }) => {
          // Out on time stays neutral, so only problems carry colour
          const flagged = pw !== 'Checked Out'
          return (
            <button
              key={p.id}
              onClick={() => onOpenProject(p.id)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 32, padding: '0 10px', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                ...(flagged ? STATUS_STYLE[pw].chip : { background: '#262a31', color: '#dfe2eb', border: '1px solid transparent' }), fontSize: '.8rem', fontWeight: 500,
              }}
            >
              {flagged && <StatusIcon label={pw} />}
              {p.name}
              {(unitNos.length > 0 || count > 1) && (
                <span style={{ color: flagged ? 'inherit' : '#a9aeb8', fontWeight: 700 }}>
                  {unitNos.length === count ? unitNos.map(u => `#${u}`).join(' ') : `×${count}`}
                </span>
              )}
            </button>
          )
        })}
        {!manual && total - units.length > 0 && (
          <span style={{ display: 'inline-flex', alignItems: 'center', minHeight: 32, padding: '0 10px', borderRadius: 8, ...toneChip('shelf'), fontSize: '.8rem', fontWeight: 500 }}>
            {total - units.length} on shelf
          </span>
        )}
      </div>
    )

  const th: React.CSSProperties = { textAlign: 'left', padding: 0, fontSize: '.75rem', fontWeight: 600, color: '#a9aeb8', whiteSpace: 'nowrap' }
  const td: React.CSSProperties = { padding: '14px 16px', verticalAlign: 'top' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search equipment…"
          aria-label="Search equipment"
          className="manual-add-input"
          style={{ maxWidth: narrow ? 'none' : 320, flex: '1 1 200px', minHeight: 44 }}
        />
        {/* Desktop sorts by the column headers; phones have no headers */}
        {narrow && <select
          value={sort.key}
          onChange={e => setSort({ key: e.target.value as StatusSortKey, dir: 1 })}
          className="manual-add-input"
          style={{ width: 'auto', minHeight: 44 }}
          aria-label="Sort by"
        >
          {STATUS_SORTS.map(s => <option key={s.key} value={s.key}>Sort: {s.label}</option>)}
        </select>}
      </div>
      <div role="group" aria-label="Filter by status"
        style={narrow
          ? { display: 'flex', gap: 8, overflowX: 'auto', margin: '0 -1rem', padding: '0 1rem 2px', scrollbarWidth: 'none' }
          : { display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {STATUS_FILTERS.filter(f => !f.problem || filterCounts[f.key] > 0 || filter === f.key).map(f => {
          const on = filter === f.key
          const chip = f.problem ? STATUS_STYLE[f.problem].chip : { background: '#1c2026', color: '#c8ccd5', border: '1px solid rgba(223,226,235,.12)' }
          return (
            <button
              key={f.key}
              type="button"
              aria-pressed={on}
              onClick={() => setFilter(on && f.key !== 'all' ? 'all' : f.key)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                minHeight: 36, padding: '0 14px', borderRadius: 18, cursor: 'pointer', fontSize: '.8rem', fontWeight: on || f.problem ? 650 : 500, whiteSpace: 'nowrap', flexShrink: 0,
                ...chip,
                // The selected filter gets a ring in its own colour
                boxShadow: on ? `0 0 0 2px #10141a, 0 0 0 4px ${f.problem ? STATUS_STYLE[f.problem].solid : '#ff6b35'}` : undefined,
              }}
            >
              {f.problem && <StatusIcon label={f.problem} />}
              {f.problem ? `${filterCounts[f.key]} ${f.label}` : `${f.label} · ${filterCounts[f.key]}`}
            </button>
          )
        })}
      </div>
      {narrow ? (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map(r => (
            <li key={r.key} style={{ background: '#1c2026', border: '1px solid rgba(223,226,235,.08)', borderRadius: 16, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                {nameCell(r)}
                <span style={{ flexShrink: 0 }}>{statusPill(r)}</span>
              </div>
              {unitsCell(r, '100%')}
              {whereCell(r)}
            </li>
          ))}
          {rows.length === 0 && <li style={{ textAlign: 'center', padding: '2.5rem', color: '#a9aeb8', fontSize: '.85rem' }}>No equipment found</li>}
        </ul>
      ) : (
      <div style={{ background: '#1c2026', border: '1px solid rgba(223,226,235,.08)', borderRadius: 16, overflowX: 'auto' }}>
        <table style={{ width: '100%', minWidth: 720, borderCollapse: 'collapse', fontSize: '.875rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(223,226,235,.1)' }}>
              {STATUS_COLUMNS.map(({ header, sort: key }) => (
                <th key={header} scope="col" aria-sort={key && sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined} style={th}>
                  {key ? (
                    <button
                      onClick={() => toggleSort(key)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '12px 16px', font: 'inherit', color: sort.key === key ? '#ffb59d' : '#a9aeb8' }}
                    >
                      {header}{sort.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
                    </button>
                  ) : <span style={{ display: 'block', padding: '12px 16px' }}>{header}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.key} style={{ borderBottom: '1px solid rgba(223,226,235,.06)' }}>
                <td style={td}>{nameCell(r)}</td>
                <td style={td}>{unitsCell(r)}</td>
                <td style={td}>{statusPill(r)}</td>
                <td style={td}>{whereCell(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <div style={{ textAlign: 'center', padding: '2.5rem', color: '#a9aeb8', fontSize: '.85rem' }}>No equipment found</div>}
      </div>
      )}
      <p style={{ margin: 0, fontSize: '.8rem', color: '#a9aeb8' }}>
        Each block in the bar is one copy. Solid red: missing. Pink: overdue. Amber: damaged. Lavender: pending checkout. Blue: out. Dark: on the shelf.
      </p>
    </div>
  )
}

function getStatusDisplay(item?: Item, proj?: InventoryProjectDoc): { label: StatusLabel } {
  if (!item) return { label: 'Available' }
  if (item.status === 'damaged')     return { label: 'Damaged' }
  if (item.status === 'missing')     return { label: 'Missing' }
  if (item.status === 'pending')     return { label: 'Pending Checkout' }
  if (item.status === 'checked-out') {
    const overdue = proj && proj.returnDate < today()
    return { label: overdue ? 'Overdue' : 'Checked Out' }
  }
  return { label: 'Available' }
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
    <div style={{ background: '#1c2026', border: '1px solid #31353c', borderRadius: 12, overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.85rem' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #31353c' }}>
            {columns.map(h => (
              <th key={h} style={{ textAlign: 'left', padding: '.5rem .75rem', color: '#979ca7', fontWeight: 600, fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '.06em' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map(item => (
            <tr key={item.id} style={{ borderLeft: `3px solid ${borderColor}`, borderBottom: '1px solid #262a31' }}>
              {renderRow(item).map((cell, i) => (
                <td key={i} style={{ padding: '.5rem .75rem', color: '#c8ccd5' }}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

type BorrowerSortKey = 'name' | 'cohort' | 'projects' | 'active' | 'out' | 'returned' | 'missing' | 'damaged'
const BORROWER_COLUMNS: { key: BorrowerSortKey; header: string }[] = [
  { key: 'name', header: 'Borrower' }, { key: 'cohort', header: 'Class' }, { key: 'projects', header: 'Projects' },
  { key: 'active', header: 'Active' }, { key: 'out', header: 'Items Out' }, { key: 'returned', header: 'Returned' },
  { key: 'missing', header: 'Missing' }, { key: 'damaged', header: 'Damaged' },
]

function BorrowersTab({
  users, projects, allItems, cohortNames,
}: {
  users: UserDoc[]
  projects: InventoryProjectDoc[]
  allItems: Item[]
  cohortNames: Record<string, string>
}) {
  const [sort, setSort] = useState<{ key: BorrowerSortKey; dir: 1 | -1 }>({ key: 'projects', dir: -1 })
  const rows = useMemo(() => {
    const known = users.map(u => ({ id: u.id, displayName: u.displayName, cohortId: u.cohortId ?? '' }))
    const unknownNames = new Set<string>()
    projects.forEach(p => (p.borrowers ?? []).forEach(name => {
      if (name && !users.find(u => u.displayName === name)) unknownNames.add(name)
    }))
    const all = [...known, ...[...unknownNames].map(name => ({ id: '', displayName: name, cohortId: '' }))]

    return all.map(u => {
      const uProjects = projects.filter(p =>
        (u.id && p.borrowerIds?.includes(u.id)) || p.borrowers?.includes(u.displayName),
      )
      if (uProjects.length === 0) return null
      const active    = uProjects.filter(p => ['active', 'checked-out'].includes(p.status)).length
      const projIds   = new Set(uProjects.map(p => p.id))
      const uItems    = allItems.filter(i => projIds.has(i.projectId))
      return {
        name:     u.displayName,
        cohortId: u.cohortId,
        projects: uProjects.length,
        active,
        out:      uItems.filter(i => i.status === 'checked-out').length,
        returned: uItems.filter(i => i.status === 'returned').length,
        damaged:  uItems.filter(i => i.status === 'damaged').length,
        missing:  uItems.filter(i => i.status === 'missing').length,
      }
    }).filter(r => r !== null)
  }, [users, projects, allItems])

  const sorted = useMemo(() => {
    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'sv')
    const cohort = (r: { cohortId: string }) => cohortNames[r.cohortId] ?? r.cohortId
    return [...rows].sort((a, b) => {
      if (sort.key === 'name') return byName(a, b) * sort.dir
      if (sort.key === 'cohort') {
        // Borrowers without a class sort last either way
        const x = cohort(a), y = cohort(b)
        return (!x === !y ? x.localeCompare(y, 'sv') * sort.dir : x ? -1 : 1) || byName(a, b)
      }
      return (a[sort.key] - b[sort.key]) * sort.dir || byName(a, b)
    })
  }, [rows, sort, cohortNames])

  // Names and classes start A–Z, counts start highest first
  const toggleSort = (key: BorrowerSortKey) =>
    setSort(s => s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === 'name' || key === 'cohort' ? 1 : -1 })

  if (rows.length === 0) return <Empty msg="No borrower data" />

  return (
    <div style={{ background: '#1c2026', border: '1px solid #31353c', borderRadius: 12, overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.85rem' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #31353c' }}>
            {BORROWER_COLUMNS.map(({ key, header }) => (
              <th key={key} aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined} style={{ textAlign: 'left', padding: 0 }}>
                <button
                  onClick={() => toggleSort(key)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '.5rem .75rem', color: sort.key === key ? '#ff6b35' : '#979ca7', fontWeight: 600, fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '.06em', whiteSpace: 'nowrap' }}
                >
                  {header}{sort.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r: any, i: number) => (
            <tr key={i} style={{ borderBottom: '1px solid #262a31' }}>
              <td style={{ padding: '.5rem .75rem', color: '#dfe2eb', fontWeight: 600 }}>{r.name}</td>
              <td style={{ padding: '.5rem .75rem' }}><CohortBadge cohortId={r.cohortId} cohorts={cohortNames} /></td>
              <td style={{ padding: '.5rem .75rem', color: r.projects > 0 ? '#ff6b35' : '#979ca7', fontWeight: r.projects > 0 ? 700 : 400 }}>{r.projects}</td>
              <td style={{ padding: '.5rem .75rem', color: r.active > 0 ? '#4edea3' : '#979ca7' }}>{r.active || '—'}</td>
              <td style={{ padding: '.5rem .75rem', color: r.out > 0 ? STATUS_TONE.out.solid : '#979ca7' }}>{r.out || '—'}</td>
              <td style={{ padding: '.5rem .75rem', color: r.returned > 0 ? '#4edea3' : '#979ca7' }}>{r.returned || '—'}</td>
              <td style={{ padding: '.5rem .75rem', color: r.missing > 0 ? STATUS_TONE.missing.solid : '#979ca7', fontWeight: r.missing > 0 ? 700 : 400 }}>{r.missing || '—'}</td>
              <td style={{ padding: '.5rem .75rem', color: r.damaged > 0 ? STATUS_TONE.damaged.solid : '#979ca7', fontWeight: r.damaged > 0 ? 700 : 400 }}>{r.damaged || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ProjectsTab({
  projects, allItems, onOpenProject,
}: {
  projects: InventoryProjectDoc[]
  allItems: Item[]
  onOpenProject: (id: string) => void
}) {
  const active   = projects.filter(p => ['active', 'checked-out'].includes(p.status))
  const archived = projects.filter(p => !['active', 'checked-out'].includes(p.status))

  function ProjectRow({ p }: { p: InventoryProjectDoc }) {
    const pItems = allItems.filter(i => i.projectId === p.id)
    const out     = pItems.filter(i => i.status === 'checked-out').length
    const missing = pItems.filter(i => i.status === 'missing').length
    const damaged = pItems.filter(i => i.status === 'damaged').length
    const pending = pItems.filter(i => i.status === 'pending').length

    const statusColor =
      p.status === 'active'       ? '#4ade80' :
      p.status === 'checked-out'  ? '#ff6b35' :
      p.status === 'returned'     ? STATUS_TONE.out.solid : '#6b7280'

    return (
      <tr {...clickableRow} style={{ borderBottom: '1px solid #262a31', cursor: 'pointer' }} onClick={() => onOpenProject(p.id)}>
        <td style={{ padding: '.5rem .75rem', color: '#ff6b35', fontWeight: 600 }}>{p.name}</td>
        <td style={{ padding: '.5rem .75rem', color: '#979ca7', fontSize: '.78rem' }}>{(p.borrowers ?? []).slice(0, 3).join(', ')}{(p.borrowers?.length ?? 0) > 3 ? ` +${p.borrowers!.length - 3}` : ''}</td>
        <td style={{ padding: '.5rem .75rem', color: '#979ca7', fontSize: '.75rem', whiteSpace: 'nowrap' }}>{formatRange(p.checkoutDate, p.returnDate)}</td>
        <td style={{ padding: '.5rem .75rem' }}>
          <span style={{ fontSize: '.6875rem', fontWeight: 700, color: statusColor, background: statusColor + '18', border: `1px solid ${statusColor}40`, borderRadius: 10, padding: '2px 7px' }}>
            {p.status}
          </span>
        </td>
        <td style={{ padding: '.5rem .75rem', fontSize: '.75rem' }}>
          {pending > 0 && <span style={{ color: '#ff6b35', marginRight: 8 }}>{pending} pending</span>}
          {out > 0 && <span style={{ color: '#ff6b35', marginRight: 8 }}>{out} out</span>}
          {missing > 0 && <span style={{ color: STATUS_TONE.missing.solid, marginRight: 8 }}>{missing} missing</span>}
          {damaged > 0 && <span style={{ color: STATUS_TONE.damaged.solid }}>{damaged} damaged</span>}
        </td>
      </tr>
    )
  }

  const ProjectTable = ({ rows }: { rows: InventoryProjectDoc[] }) => (
    <div style={{ background: '#1c2026', border: '1px solid #31353c', borderRadius: 12, overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.85rem' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #31353c' }}>
            {['Project', 'Borrowers', 'Dates', 'Status', 'Items'].map(h => (
              <th key={h} style={{ textAlign: 'left', padding: '.5rem .75rem', color: '#979ca7', fontWeight: 600, fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '.06em' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{rows.map(p => <ProjectRow key={p.id} p={p} />)}</tbody>
      </table>
      {rows.length === 0 && <div style={{ textAlign: 'center', padding: '2rem', color: '#8c919b', fontSize: '.85rem' }}>None</div>}
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

function ProjectBudgetTab({
  projects, allItems, equipment, onOpenProject,
}: {
  projects: InventoryProjectDoc[]
  allItems: Item[]
  equipment: EquipmentDoc[]
  onOpenProject: (id: string) => void
}) {
  const equipmentById   = useMemo(() => Object.fromEntries(equipment.map(e => [e.id, e])), [equipment])
  const equipmentByName = useMemo(() => Object.fromEntries(equipment.map(e => [e.name, e])), [equipment])

  const rows = useMemo(() => {
    return projects.map(p => {
      const pItems = allItems.filter(i => i.projectId === p.id)
      const days = billableDays(calcRentalDays(p.checkoutDate, p.returnDate))
      const cost = pItems.reduce((sum, i) => {
        const eq = equipmentById[i.equipmentId] ?? equipmentByName[i.equipmentName]
        return sum + (eq?.priceInclVat ?? 0) * days
      }, 0)
      return { project: p, itemCount: pItems.length, cost }
    }).sort((a, b) => b.cost - a.cost)
  }, [projects, allItems, equipmentById, equipmentByName])

  const total = rows.reduce((sum, r) => sum + r.cost, 0)

  if (rows.length === 0) return <Empty msg="No projects yet" />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: '.85rem', color: '#979ca7' }}>
        Total across {rows.length} project{rows.length !== 1 ? 's' : ''}: <span style={{ color: '#dfe2eb', fontWeight: 700 }}>{total.toLocaleString('sv-SE')} kr</span>
      </div>
      <div style={{ background: '#1c2026', border: '1px solid #31353c', borderRadius: 12, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.85rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #31353c' }}>
              {['#', 'Project', 'Dates', 'Items', 'Cost'].map(h => (
                <th key={h} style={{ textAlign: h === 'Cost' || h === 'Items' ? 'right' : 'left', padding: '.5rem .75rem', color: '#979ca7', fontWeight: 600, fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '.06em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.project.id} style={{ borderBottom: '1px solid #262a31' }}>
                <td style={{ padding: '.5rem .75rem', color: '#8c919b', fontFamily: 'monospace' }}>#{i + 1}</td>
                <td style={{ padding: '.5rem .75rem' }}>
                  <button onClick={() => onOpenProject(r.project.id)} style={{ color: '#ff6b35', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 600, fontSize: 'inherit', textAlign: 'left' }}>
                    {r.project.name}
                  </button>
                </td>
                <td style={{ padding: '.5rem .75rem', color: '#979ca7', fontSize: '.75rem', whiteSpace: 'nowrap' }}>{formatRange(r.project.checkoutDate, r.project.returnDate)}</td>
                <td style={{ padding: '.5rem .75rem', color: '#979ca7', textAlign: 'right' }}>{r.itemCount}</td>
                <td style={{ padding: '.5rem .75rem', color: '#dfe2eb', fontWeight: 700, textAlign: 'right' }}>{r.cost > 0 ? `${r.cost.toLocaleString('sv-SE')} kr` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Empty({ msg }: { msg: string }) {
  return (
    <div className="inv-empty">{msg}</div>
  )
}

const CLEARABLE_TABS = new Set(['most-borrowed', 'overdue', 'damaged', 'missing', 'manual', 'borrowers'])

async function clearStatTab(tabId: string) {
  await setDoc(doc(db, 'settings', 'inventory_stats_resets'), { [tabId]: serverTimestamp() }, { merge: true })
}

function ClearStatButton({ tabId, label }: { tabId: string; label: string }) {
  const [clearing, setClearing] = useState(false)
  return (
    <button
      disabled={clearing}
      onClick={async () => {
        if (!window.confirm(`Clear ${label} history?\n\nThis only hides past entries from this stats view — it does not change any equipment status or project records.`)) return
        setClearing(true)
        try { await clearStatTab(tabId) } finally { setClearing(false) }
      }}
      style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', marginLeft: 'auto',
        background: 'rgba(255,255,255,.04)', border: '1px solid #31353c', borderRadius: 8,
        color: '#a9aeb8', fontSize: '.78rem', fontWeight: 600, cursor: clearing ? 'default' : 'pointer',
        opacity: clearing ? .6 : 1, flexShrink: 0,
      }}
    >
      {clearing ? 'Clearing…' : 'Clear'}
    </button>
  )
}

export function StatsContent({
  equipment,
  projects,
  allItems,
  onOpenProject,
  initialTab = 'most-borrowed',
  onOpenDashboard,
  onOpenUnits,
}: {
  equipment: EquipmentDoc[]
  projects: InventoryProjectDoc[]
  allItems: Item[]
  onOpenProject: (id: string) => void
  initialTab?: string
  onOpenDashboard?: () => void
  /** Inventory's Units view (every item and its units) */
  onOpenUnits?: () => void
}) {
  const [activeTab, setActiveTab] = useState(initialTab)
  const [users, setUsers] = useState<UserDoc[]>([])
  const [cohorts, setCohorts] = useState<CohortDoc[]>([])
  const { data: resets } = useDocument<{ id: string } & Record<string, Timestamp | undefined>>('settings', 'inventory_stats_resets')

  useEffect(() => {
    getDocs(query(collection(db, 'users'), where('role', 'in', ['student', 'teacher'])))
      .then(snap => setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() } as UserDoc))))
    getDocs(collection(db, 'cohorts'))
      .then(snap => setCohorts(snap.docs.map(d => ({ id: d.id, ...d.data() } as CohortDoc))))
  }, [])

  const projectMap = useMemo(() => {
    const m: Record<string, InventoryProjectDoc> = {}
    projects.forEach(p => { m[p.id] = p })
    return m
  }, [projects])

  const cohortNames = useMemo(() => {
    const map: Record<string, string> = {}
    cohorts.forEach(c => { map[c.id] = c.name })
    return map
  }, [cohorts])

  const cutoffMs = (tabId: string) => resets?.[tabId]?.toMillis?.() ?? 0
  const afterCutoff = (tabId: string, iso: string) => {
    const cutoff = cutoffMs(tabId)
    return !cutoff || (iso && new Date(iso).getTime() > cutoff)
  }

  const itemsCheckedOut = allItems.filter(i => i.status === 'checked-out').length
  const missingItems    = allItems.filter(i => i.status === 'missing').length
  const damagedItems    = allItems.filter(i => i.status === 'damaged').length

  const visibleMostBorrowedItems = useMemo(
    () => allItems.filter(i => afterCutoff('most-borrowed', i.checkoutTimestamp)),
    [allItems, resets],
  )

  const overdueItems = useMemo(() =>
    allItems.filter(i => {
      if (i.status !== 'checked-out') return false
      const proj = projectMap[i.projectId]
      return proj && proj.returnDate < today() && proj.returnDate
    }),
  [allItems, projectMap])
  const visibleOverdueItems = useMemo(
    () => overdueItems.filter(i => afterCutoff('overdue', i.checkoutTimestamp)),
    [overdueItems, resets],
  )

  const dueThisWeekItems = useMemo(() =>
    allItems.filter(i => {
      if (i.status !== 'checked-out') return false
      const proj = projectMap[i.projectId]
      return proj && ['active', 'checked-out'].includes(proj.status) && isDueThisWeek(proj.returnDate)
    }).sort((a, b) => (projectMap[a.projectId]?.returnDate ?? '').localeCompare(projectMap[b.projectId]?.returnDate ?? '')),
  [allItems, projectMap])

  const visibleDamagedItems = useMemo(
    () => allItems.filter(i => i.status === 'damaged' && afterCutoff('damaged', i.checkoutTimestamp)),
    [allItems, resets],
  )
  const visibleMissingItems = useMemo(
    () => allItems.filter(i => i.status === 'missing' && afterCutoff('missing', i.checkoutTimestamp)),
    [allItems, resets],
  )

  const manualItems = allItems.filter(i => i.isManualEntry)
  const visibleManualItems = useMemo(
    () => manualItems.filter(i => afterCutoff('manual', i.checkoutTimestamp)),
    [manualItems, resets],
  )

  const borrowersCutoff = cutoffMs('borrowers')
  const visibleBorrowerProjects = useMemo(
    () => !borrowersCutoff ? projects : projects.filter(p => ((p.createdAt as any)?.toMillis?.() ?? 0) > borrowersCutoff),
    [projects, borrowersCutoff],
  )

  const tabsWithCounts = TABS.map(t => ({
    ...t,
    count:
      t.id === 'overdue'  ? visibleOverdueItems.length :
      t.id === 'due-this-week' ? dueThisWeekItems.length :
      t.id === 'damaged'  ? visibleDamagedItems.length :
      t.id === 'missing'  ? visibleMissingItems.length :
      t.id === 'manual'   ? visibleManualItems.length :
      t.id === 'projects' ? projects.length :
      undefined,
  }))

  const statCards = [
    { label: 'Total Equipment', value: equipment.length,  icon: <Package size={18} />,       color: '#c8ccd5', open: onOpenUnits },
    { label: 'Currently Out',   value: itemsCheckedOut,    icon: <TrendingUp size={18} />,    color: STATUS_TONE.out.solid, open: onOpenUnits },
    { label: 'Total Projects',  value: projects.length,    icon: <BarChart2 size={18} />,     color: '#c8ccd5', open: onOpenDashboard },
    { label: 'Damaged Items',   value: damagedItems,       icon: <AlertTriangle size={18} />, color: STATUS_TONE.damaged.solid, open: () => setActiveTab('damaged') },
    { label: 'Missing Items',   value: missingItems,       icon: <XCircle size={18} />,       color: STATUS_TONE.missing.solid, open: () => setActiveTab('missing') },
  ]

  return (
    <>
      <div className="inv-stats-row" style={{ marginTop: '1rem' }}>
        {statCards.map(c => (
          <div
            key={c.label}
            className={`inv-stat-card${c.open ? ' clickable' : ''}`}
            {...(c.open && {
              role: 'button',
              tabIndex: 0,
              onClick: c.open,
              onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); c.open!() } },
            })}
          >
            <span style={{ color: c.color }}>{c.icon}</span>
            <div>
              <span className="inv-stat-value" style={{ color: '#dfe2eb' }}>{c.value}</span>
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
              color: activeTab === t.id ? '#ff6b35' : '#979ca7',
              borderBottom: activeTab === t.id ? '2px solid #ff6b35' : '2px solid transparent',
            }}
          >
            {t.label}{t.count !== undefined ? ` (${t.count})` : ''}
          </button>
        ))}
      </div>

      <div style={{ marginTop: '1.5rem' }}>
        {CLEARABLE_TABS.has(activeTab) && (
          <div style={{ display: 'flex', marginBottom: 12 }}>
            <ClearStatButton tabId={activeTab} label={TABS.find(t => t.id === activeTab)?.label ?? activeTab} />
          </div>
        )}
        {activeTab === 'most-borrowed' && <MostBorrowedTab allItems={visibleMostBorrowedItems} />}
        {activeTab === 'overdue' && <SimpleItemsTab
          items={visibleOverdueItems}
          projectMap={projectMap}
          columns={['Equipment', 'Project', 'Due Date', 'Days Overdue']}
          renderRow={item => {
            const proj = projectMap[item.projectId]
            const days = proj ? Math.floor((Date.now() - new Date(proj.returnDate).getTime()) / 86400000) : 0
            return [
              item.equipmentName,
              proj ? <button onClick={() => onOpenProject(proj.id)} style={{ color: '#ff6b35', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 'inherit' }}>{proj.name}</button> : '—',
              <span style={{ color: '#ff6b35' }}>{proj ? formatDate(proj.returnDate) : '—'}</span>,
              <span style={{ color: STATUS_TONE.missing.solid, fontWeight: 700 }}>{days} day{days !== 1 ? 's' : ''}</span>,
            ]
          }}
          emptyMsg="No overdue items"
          borderColor="#f87171"
        />}
        {activeTab === 'due-this-week' && <SimpleItemsTab
          items={dueThisWeekItems}
          projectMap={projectMap}
          columns={['Equipment', 'Project', 'Due Date', 'Due']}
          renderRow={item => {
            const proj = projectMap[item.projectId]
            const days = proj ? Math.round((new Date(proj.returnDate + 'T12:00:00').getTime() - new Date(today() + 'T12:00:00').getTime()) / 86400000) : 0
            return [
              item.equipmentName,
              proj ? <button onClick={() => onOpenProject(proj.id)} style={{ color: '#ff6b35', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 'inherit' }}>{proj.name}</button> : '—',
              <span style={{ color: '#ff6b35' }}>{proj ? formatDate(proj.returnDate) : '—'}</span>,
              <span style={{ color: days <= 1 ? STATUS_TONE.damaged.solid : '#a1a1aa', fontWeight: 700 }}>{days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days`}</span>,
            ]
          }}
          emptyMsg="Nothing due back this week"
          borderColor="#fbbf24"
        />}
        {activeTab === 'damaged' && <SimpleItemsTab
          items={visibleDamagedItems}
          projectMap={projectMap}
          columns={['Item Name', 'Project', 'Damage Notes']}
          renderRow={item => {
            const proj = projectMap[item.projectId]
            return [
              item.equipmentName,
              proj ? <button onClick={() => onOpenProject(proj.id)} style={{ color: '#ff6b35', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 'inherit' }}>{proj.name}</button> : '—',
              <span style={{ color: STATUS_TONE.damaged.solid, fontSize: '.8rem' }}>{item.damageNotes || '—'}</span>,
            ]
          }}
          emptyMsg="No damaged items"
          borderColor="#fbbf24"
        />}
        {activeTab === 'missing' && <SimpleItemsTab
          items={visibleMissingItems}
          projectMap={projectMap}
          columns={['Item Name', 'Project', 'Assigned To']}
          renderRow={item => {
            const proj = projectMap[item.projectId]
            return [
              item.equipmentName,
              proj ? <button onClick={() => onOpenProject(proj.id)} style={{ color: '#ff6b35', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 'inherit' }}>{proj.name}</button> : '—',
              item.assignedTo || '—',
            ]
          }}
          emptyMsg="No missing items"
          borderColor="#f87171"
        />}
        {activeTab === 'manual' && <SimpleItemsTab
          items={visibleManualItems}
          projectMap={projectMap}
          columns={['Item Name', 'Project', 'Checked Out', 'Assigned To']}
          renderRow={item => {
            const proj = projectMap[item.projectId]
            return [
              item.equipmentName,
              proj ? <button onClick={() => onOpenProject(proj.id)} style={{ color: '#ff6b35', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 'inherit' }}>{proj.name}</button> : '—',
              item.checkoutTimestamp ? new Date(item.checkoutTimestamp).toLocaleString() : '—',
              item.assignedTo || '—',
            ]
          }}
          emptyMsg="No manual checkouts"
          borderColor="#a78bfa"
        />}
        {activeTab === 'borrowers' && <BorrowersTab users={users} projects={visibleBorrowerProjects} allItems={allItems} cohortNames={cohortNames} />}
        {activeTab === 'projects'  && <ProjectsTab projects={projects} allItems={allItems} onOpenProject={onOpenProject} />}
        {activeTab === 'budget'    && <ProjectBudgetTab projects={projects} allItems={allItems} equipment={equipment} onOpenProject={onOpenProject} />}
      </div>
    </>
  )
}
