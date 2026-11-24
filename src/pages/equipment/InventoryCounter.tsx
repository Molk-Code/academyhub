import { STATUS_TONE } from '@/lib/statusTone'
import type { InventoryProjectDoc, InventoryItemDoc } from '@/types'
import { today, overdueDays } from './inventoryShared'

type Item = InventoryItemDoc & { projectId: string }

/** "Sony FX6 #3 · Rode NTG5 #1 · V-mount #4 #5": what a project still has out, by unit */
export function unitsSummary(items: Item[]): string {
  const byName = new Map<string, { units: number[]; count: number }>()
  for (const i of items) {
    const e = byName.get(i.equipmentName) ?? { units: [], count: 0 }
    e.count++
    if (typeof i.unit === 'number') e.units.push(i.unit)
    byName.set(i.equipmentName, e)
  }
  return [...byName].map(([name, { units, count }]) =>
    units.length === count ? `${name} ${units.sort((a, b) => a - b).map(u => `#${u}`).join(' ')}`
    : count > 1 ? `${count} × ${name}` : name,
  ).join(' · ')
}

// The counter on a phone: who brings gear back today (late first) and who picks up today
export default function InventoryCounter({ projects, allItems, onOpenProject }: {
  projects: InventoryProjectDoc[]
  allItems: Item[]
  onOpenProject: (id: string) => void
}) {
  const t = today()
  const dueBack = projects
    .filter(p => p.status === 'checked-out' && p.returnDate && p.returnDate <= t)
    .sort((a, b) => a.returnDate.localeCompare(b.returnDate))
  const pickingUp = projects.filter(p => p.status === 'active' && p.checkoutDate === t)
  if (dueBack.length === 0 && pickingUp.length === 0) return null

  const card: React.CSSProperties = { background: '#1c2026', border: '1px solid rgba(223,226,235,.08)', borderRadius: 16, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }
  const outItems = (id: string) => allItems.filter(i => i.projectId === id && i.status !== 'returned')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {dueBack.length > 0 && (
        <section aria-labelledby="due-back-today" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h2 id="due-back-today" style={{ margin: 0, fontSize: '.95rem', fontWeight: 700, color: '#dfe2eb' }}>Due back today</h2>
          {dueBack.map(p => {
            const late = overdueDays(p.returnDate)
            return (
              <article key={p.id} style={{ ...card, border: `1px solid ${late ? STATUS_TONE.overdue.border : 'rgba(223,226,235,.08)'}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <span style={{ fontWeight: 700, fontSize: '.95rem', color: '#dfe2eb' }}>{p.name}</span>
                    {p.borrowers?.length > 0 && <span style={{ fontSize: '.8rem', color: '#a9aeb8' }}>{p.borrowers.join(', ')}</span>}
                  </div>
                  <span style={{ fontSize: '.8rem', fontWeight: 700, whiteSpace: 'nowrap', color: late ? STATUS_TONE.overdue.fg : '#c8ccd5' }}>
                    {late ? `${late} ${late === 1 ? 'day' : 'days'} late` : 'Today'}
                  </span>
                </div>
                <p style={{ margin: 0, fontSize: '.875rem', color: '#c8ccd5', lineHeight: 1.5 }}>{unitsSummary(outItems(p.id)) || 'Nothing scanned out'}</p>
                <button type="button" className="secondary-btn" style={{ minHeight: 44, justifyContent: 'center' }} onClick={() => onOpenProject(p.id)}>
                  Check in
                </button>
              </article>
            )
          })}
        </section>
      )}
      {pickingUp.length > 0 && (
        <section aria-labelledby="picking-up-today" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h2 id="picking-up-today" style={{ margin: 0, fontSize: '.95rem', fontWeight: 700, color: '#dfe2eb' }}>Picking up today</h2>
          {pickingUp.map(p => {
            const unsigned = p.pendingSignatureUids?.length ?? 0
            return (
              <button key={p.id} type="button" onClick={() => onOpenProject(p.id)}
                style={{ ...card, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', textAlign: 'left', font: 'inherit', color: '#dfe2eb', minHeight: 56 }}>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontWeight: 650, fontSize: '.875rem' }}>{p.name}</span>
                  <span style={{ fontSize: '.8rem', color: unsigned ? STATUS_TONE.pending.fg : '#a9aeb8' }}>
                    {unsigned ? `Waiting for ${unsigned} ${unsigned === 1 ? 'signature' : 'signatures'}` : p.borrowers?.join(', ')}
                  </span>
                </span>
                <span style={{ fontSize: '.8rem', color: '#a9aeb8', whiteSpace: 'nowrap' }}>{outItems(p.id).length} items</span>
              </button>
            )
          })}
        </section>
      )}
    </div>
  )
}
