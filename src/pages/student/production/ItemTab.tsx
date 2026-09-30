import { useState } from 'react'
import { addDoc, collection, deleteDoc, doc, updateDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useCollection, orderBy } from '@/hooks/useFirestore'
import { cn } from '@/lib/utils'
import type { ProductionCostumeDoc, ProductionCastDoc, ProductionSceneDoc } from '@/types'
import { Plus, Trash2, Download } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

function InlineInput({
  value, placeholder, canEdit, onChange, onBlur, className = '', list,
}: {
  value: string; placeholder: string; canEdit: boolean
  onChange: (v: string) => void; onBlur: (v: string) => void; className?: string; list?: string
}) {
  return canEdit ? (
    <input
      list={list}
      className={cn(
        'bg-transparent w-full focus:bg-zinc-800/80 rounded px-2 py-1 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-brand-500/30',
        className,
      )}
      value={value}
      placeholder={placeholder}
      onChange={e => onChange(e.target.value)}
      onBlur={e => onBlur(e.target.value)}
    />
  ) : (
    <span className={cn('text-sm text-zinc-200 px-2', className)}>
      {value || <span className="text-zinc-600">—</span>}
    </span>
  )
}

interface ItemTabProps {
  productionId: string
  productionTitle: string
  canEdit: boolean
  collectionName: string          // 'costumes' | 'makeup' | 'props'
  sceneField: keyof Pick<ProductionSceneDoc, 'costumeIds' | 'makeupIds' | 'propsIds'>
  icon: LucideIcon
  deptLabel: string                 // "Costume" / "Make-up" / "Props" — used on the exported PDF
  nameLabel: string                // column header — "Character" or "Item"
  namePlaceholder: string
  addLabel: string                 // "Add Costume" / "Add Make-up" / "Add Prop"
  emptyTitle: string                // "No costumes yet"
  useCharacterDatalist: boolean     // offer cast character names as autocomplete
}

export function ItemTab({
  productionId, productionTitle, canEdit, collectionName, sceneField, icon: Icon,
  deptLabel, nameLabel, namePlaceholder, addLabel, emptyTitle, useCharacterDatalist,
}: ItemTabProps) {
  const { data: items } = useCollection<ProductionCostumeDoc>(
    `productions/${productionId}/${collectionName}`,
    [orderBy('order', 'asc')],
  )
  const { data: cast } = useCollection<ProductionCastDoc>(
    `productions/${productionId}/cast`,
    [orderBy('castId', 'asc')],
  )
  const { data: scenes } = useCollection<ProductionSceneDoc>(
    `productions/${productionId}/scenes`,
    [orderBy('sceneNumber', 'asc')],
  )
  const characterNames = useCharacterDatalist ? cast.map(c => c.characterName).filter(Boolean) : []

  const [edits, setEdits] = useState<Record<string, Record<string, string>>>({})

  function get(id: string, field: string, fallback: string) {
    return edits[id]?.[field] ?? fallback
  }

  function setLocal(id: string, field: string, value: string) {
    if (!canEdit) return
    setEdits(prev => ({ ...prev, [id]: { ...(prev[id] ?? {}), [field]: value } }))
  }

  async function save(id: string, field: string, value: string) {
    if (!canEdit) return
    await updateDoc(doc(db, `productions/${productionId}/${collectionName}`, id), { [field]: value })
  }

  async function addItem() {
    if (!canEdit) return
    const next: Omit<ProductionCostumeDoc, 'id'> = {
      order: items.length,
      characterName: '',
      description: '',
      responsible: '',
      notes: '',
    }
    await addDoc(collection(db, `productions/${productionId}/${collectionName}`), next)
  }

  async function remove(id: string) {
    if (!canEdit) return
    await deleteDoc(doc(db, `productions/${productionId}/${collectionName}`, id))
  }

  function scenesFor(itemId: string): number[] {
    return scenes
      .filter(s => ((s[sceneField] as string[] | undefined) ?? []).includes(itemId))
      .map(s => s.sceneNumber)
      .sort((a, b) => a - b)
  }

  async function exportPDF() {
    const { default: jsPDF }   = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')

    const docPdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const PW = 297, M = 14, CW = PW - M * 2

    docPdf.setFillColor(15, 23, 42)
    docPdf.rect(0, 0, PW, 22, 'F')
    docPdf.setTextColor(255, 255, 255)
    docPdf.setFontSize(13).setFont('helvetica', 'bold')
    docPdf.text('CineForge', M, 14)
    docPdf.setFontSize(8).setFont('helvetica', 'normal')
    docPdf.setTextColor(148, 163, 184)
    docPdf.text(`${deptLabel} Breakdown`, M + 30, 14)

    docPdf.setFillColor(249, 115, 22)
    docPdf.rect(0, 22, PW, 1.2, 'F')

    let y = 32
    docPdf.setTextColor(15, 23, 42)
    docPdf.setFontSize(16).setFont('helvetica', 'bold')
    docPdf.text(productionTitle, M, y)
    y += 7
    docPdf.setFontSize(9).setFont('helvetica', 'normal')
    docPdf.setTextColor(100, 116, 139)
    docPdf.text(`${deptLabel}  ·  ${items.length} item${items.length !== 1 ? 's' : ''}`, M, y)
    y += 8

    const rows = items.map(it => [
      it.characterName || '—',
      it.description || '',
      scenesFor(it.id).join(', ') || '—',
      it.responsible || '',
      it.notes || '',
    ])

    autoTable(docPdf, {
      startY: y,
      head: [[nameLabel, 'Description', 'Scenes', 'Responsible', 'Notes']],
      body: rows,
      styles: { fontSize: 9, cellPadding: 3, font: 'helvetica' },
      headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: 'bold', fontSize: 9 },
      columnStyles: {
        0: { cellWidth: 44 },
        1: { cellWidth: 70 },
        2: { cellWidth: 30 },
        3: { cellWidth: 44 },
        4: { cellWidth: CW - 188 },
      },
      alternateRowStyles: { fillColor: [248, 250, 252] },
    })

    docPdf.save(`${productionTitle.replace(/[^a-z0-9]/gi, '_')}_${deptLabel.replace(/[^a-z0-9]/gi, '_')}.pdf`)
  }

  if (items.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex justify-end gap-2">
          <button onClick={exportPDF} className="flex items-center gap-2 py-2 px-4 text-sm rounded-xl border border-white/10 text-zinc-300 hover:bg-white/5 transition-colors">
            <Download className="w-4 h-4" /> Export PDF
          </button>
          {canEdit && (
            <button onClick={addItem} className="btn-primary flex items-center gap-2 py-2 px-4 text-sm">
              <Plus className="w-4 h-4" /> {addLabel}
            </button>
          )}
        </div>
        <div className="text-center py-16 bg-zinc-900 border border-white/10 rounded-2xl">
          <Icon className="w-10 h-10 text-zinc-600 mx-auto mb-3" />
          <p className="text-zinc-400 text-sm font-medium">{emptyTitle}</p>
          {canEdit && (
            <button onClick={addItem} className="mt-4 btn-primary py-2 px-5 text-sm">
              {addLabel}
            </button>
          )}
        </div>
      </div>
    )
  }

  const listId = `${collectionName}-chars-${productionId}`

  return (
    <div className="space-y-4">
      {characterNames.length > 0 && (
        <datalist id={listId}>
          {characterNames.map(name => <option key={name} value={name} />)}
        </datalist>
      )}

      <div className="flex justify-end gap-2">
        <button onClick={exportPDF} className="flex items-center gap-2 py-2 px-4 text-sm rounded-xl border border-white/10 text-zinc-300 hover:bg-white/5 transition-colors">
          <Download className="w-4 h-4" /> Export PDF
        </button>
        {canEdit && (
          <button onClick={addItem} className="btn-primary flex items-center gap-2 py-2 px-4 text-sm">
            <Plus className="w-4 h-4" /> {addLabel}
          </button>
        )}
      </div>

      <div className="bg-zinc-900 border border-white/10 rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10">
              <th className="px-3 py-3 text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider w-36">{nameLabel}</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider">Description</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider w-32">Appears in scenes</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider w-32">Responsible</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider">Notes</th>
              {canEdit && <th className="w-10" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {items.map(it => {
              const itemScenes = scenesFor(it.id)
              return (
                <tr key={it.id} className="hover:bg-white/3 transition-colors align-middle">
                  <td className="px-1 py-2">
                    <InlineInput
                      list={characterNames.length > 0 ? listId : undefined}
                      value={get(it.id, 'characterName', it.characterName)}
                      placeholder={namePlaceholder}
                      canEdit={canEdit}
                      onChange={v => setLocal(it.id, 'characterName', v)}
                      onBlur={v => save(it.id, 'characterName', v)}
                    />
                  </td>
                  <td className="px-1 py-2">
                    <InlineInput
                      value={get(it.id, 'description', it.description)}
                      placeholder="Describe…"
                      canEdit={canEdit}
                      onChange={v => setLocal(it.id, 'description', v)}
                      onBlur={v => save(it.id, 'description', v)}
                    />
                  </td>
                  <td className="px-3 py-2">
                    {itemScenes.length === 0 ? (
                      <span className="text-xs text-zinc-600">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {itemScenes.map(n => (
                          <span key={n} className="text-xs bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded font-mono">{n}</span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-1 py-2">
                    <InlineInput
                      value={get(it.id, 'responsible', it.responsible)}
                      placeholder="Who's responsible"
                      canEdit={canEdit}
                      onChange={v => setLocal(it.id, 'responsible', v)}
                      onBlur={v => save(it.id, 'responsible', v)}
                    />
                  </td>
                  <td className="px-1 py-2">
                    <InlineInput
                      value={get(it.id, 'notes', it.notes)}
                      placeholder="Notes…"
                      canEdit={canEdit}
                      onChange={v => setLocal(it.id, 'notes', v)}
                      onBlur={v => save(it.id, 'notes', v)}
                    />
                  </td>
                  {canEdit && (
                    <td className="px-2 py-2">
                      <button
                        onClick={() => remove(it.id)}
                        className="p-1.5 text-zinc-600 hover:text-rose-400 transition-colors rounded"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
