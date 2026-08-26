import { useState } from 'react'
import { addDoc, collection, deleteDoc, doc, updateDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useCollection, orderBy } from '@/hooks/useFirestore'
import { cn } from '@/lib/utils'
import type { ProductionCostumeDoc, ProductionCastDoc } from '@/types'
import { Plus, Trash2, Shirt } from 'lucide-react'

const STATUS_OPTIONS: { value: ProductionCostumeDoc['status']; label: string; color: string }[] = [
  { value: 'planned',  label: 'Planned',  color: 'bg-zinc-700 text-zinc-300' },
  { value: 'sourced',  label: 'Sourced',  color: 'bg-amber-900/40 text-amber-400' },
  { value: 'ready',    label: 'Ready',    color: 'bg-emerald-900/40 text-emerald-400' },
  { value: 'on_set',   label: 'On Set',   color: 'bg-brand-900/40 text-brand-400' },
]

function InlineInput({
  value, placeholder, canEdit, onChange, onBlur, className = '',
}: {
  value: string; placeholder: string; canEdit: boolean
  onChange: (v: string) => void; onBlur: (v: string) => void; className?: string
}) {
  return canEdit ? (
    <input
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

interface Props { productionId: string; canEdit: boolean }

export function CostumeTab({ productionId, canEdit }: Props) {
  const { data: costumes } = useCollection<ProductionCostumeDoc>(
    `productions/${productionId}/costumes`,
    [orderBy('order', 'asc')],
  )
  const { data: cast } = useCollection<ProductionCastDoc>(
    `productions/${productionId}/cast`,
    [orderBy('castId', 'asc')],
  )
  const characterNames = cast.map(c => c.characterName).filter(Boolean)

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
    await updateDoc(doc(db, `productions/${productionId}/costumes`, id), { [field]: value })
  }

  async function addCostume() {
    if (!canEdit) return
    const next: Omit<ProductionCostumeDoc, 'id'> = {
      order: costumes.length,
      characterName: '',
      description: '',
      scenes: '',
      status: 'planned',
      responsible: '',
      notes: '',
    }
    await addDoc(collection(db, `productions/${productionId}/costumes`), next)
  }

  async function remove(id: string) {
    if (!canEdit) return
    await deleteDoc(doc(db, `productions/${productionId}/costumes`, id))
  }

  async function setStatus(id: string, status: ProductionCostumeDoc['status']) {
    if (!canEdit) return
    await updateDoc(doc(db, `productions/${productionId}/costumes`, id), { status })
  }

  if (costumes.length === 0) {
    return (
      <div className="space-y-4">
        {canEdit && (
          <div className="flex justify-end">
            <button onClick={addCostume} className="btn-primary flex items-center gap-2 py-2 px-4 text-sm">
              <Plus className="w-4 h-4" /> Add Costume
            </button>
          </div>
        )}
        <div className="text-center py-16 bg-zinc-900 border border-white/10 rounded-2xl">
          <Shirt className="w-10 h-10 text-zinc-600 mx-auto mb-3" />
          <p className="text-zinc-400 text-sm font-medium">No costumes yet</p>
          {canEdit && (
            <button onClick={addCostume} className="mt-4 btn-primary py-2 px-5 text-sm">
              Add First Costume
            </button>
          )}
        </div>
      </div>
    )
  }

  const listId = `costume-chars-${productionId}`

  return (
    <div className="space-y-4">
      {characterNames.length > 0 && (
        <datalist id={listId}>
          {characterNames.map(name => <option key={name} value={name} />)}
        </datalist>
      )}

      {canEdit && (
        <div className="flex justify-end">
          <button onClick={addCostume} className="btn-primary flex items-center gap-2 py-2 px-4 text-sm">
            <Plus className="w-4 h-4" /> Add Costume
          </button>
        </div>
      )}

      <div className="bg-zinc-900 border border-white/10 rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10">
              <th className="px-3 py-3 text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider w-36">Character</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider">Description</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider w-24">Scenes</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider w-28">Status</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider w-32">Responsible</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider">Notes</th>
              {canEdit && <th className="w-10" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {costumes.map(c => {
              const statusCfg = STATUS_OPTIONS.find(s => s.value === c.status) ?? STATUS_OPTIONS[0]
              return (
                <tr key={c.id} className="hover:bg-white/3 transition-colors align-middle">
                  <td className="px-1 py-2">
                    {canEdit ? (
                      <input
                        list={characterNames.length > 0 ? listId : undefined}
                        className="bg-transparent w-full focus:bg-zinc-800/80 rounded px-2 py-1 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-brand-500/30"
                        value={get(c.id, 'characterName', c.characterName)}
                        placeholder="Character"
                        onChange={e => setLocal(c.id, 'characterName', e.target.value)}
                        onBlur={e => save(c.id, 'characterName', e.target.value)}
                      />
                    ) : (
                      <span className="text-sm text-zinc-200 px-2">
                        {c.characterName || <span className="text-zinc-600">—</span>}
                      </span>
                    )}
                  </td>
                  <td className="px-1 py-2">
                    <InlineInput
                      value={get(c.id, 'description', c.description)}
                      placeholder="Describe the costume…"
                      canEdit={canEdit}
                      onChange={v => setLocal(c.id, 'description', v)}
                      onBlur={v => save(c.id, 'description', v)}
                    />
                  </td>
                  <td className="px-1 py-2">
                    <InlineInput
                      value={get(c.id, 'scenes', c.scenes)}
                      placeholder="1, 3, 5"
                      canEdit={canEdit}
                      onChange={v => setLocal(c.id, 'scenes', v)}
                      onBlur={v => save(c.id, 'scenes', v)}
                    />
                  </td>
                  <td className="px-2 py-2">
                    {canEdit ? (
                      <select
                        value={c.status}
                        onChange={e => setStatus(c.id, e.target.value as ProductionCostumeDoc['status'])}
                        className="bg-zinc-800 border border-white/10 rounded-lg px-2 py-1 text-xs text-zinc-200 focus:outline-none w-full"
                      >
                        {STATUS_OPTIONS.map(o => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    ) : (
                      <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', statusCfg.color)}>
                        {statusCfg.label}
                      </span>
                    )}
                  </td>
                  <td className="px-1 py-2">
                    <InlineInput
                      value={get(c.id, 'responsible', c.responsible)}
                      placeholder="Who's responsible"
                      canEdit={canEdit}
                      onChange={v => setLocal(c.id, 'responsible', v)}
                      onBlur={v => save(c.id, 'responsible', v)}
                    />
                  </td>
                  <td className="px-1 py-2">
                    <InlineInput
                      value={get(c.id, 'notes', c.notes)}
                      placeholder="Notes…"
                      canEdit={canEdit}
                      onChange={v => setLocal(c.id, 'notes', v)}
                      onBlur={v => save(c.id, 'notes', v)}
                    />
                  </td>
                  {canEdit && (
                    <td className="px-2 py-2">
                      <button
                        onClick={() => remove(c.id)}
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
