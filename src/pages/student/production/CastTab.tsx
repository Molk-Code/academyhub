import { useState } from 'react'
import { doc, updateDoc, addDoc, deleteDoc, collection } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useCollection, orderBy } from '@/hooks/useFirestore'
import { cn } from '@/lib/utils'
import type { ProductionCastDoc, ProductionSceneDoc } from '@/types'
import { Plus, Trash2 } from 'lucide-react'

// Module-level to avoid focus loss from inner component definitions
function EditField({
  value,
  placeholder,
  canEdit,
  onChange,
  onBlur,
}: {
  value: string
  placeholder: string
  canEdit: boolean
  onChange: (v: string) => void
  onBlur: (v: string) => void
}) {
  return canEdit ? (
    <input
      className="bg-transparent w-full focus:bg-zinc-800/80 rounded px-2 py-1 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-brand-500/30"
      value={value}
      placeholder={placeholder}
      onChange={e => onChange(e.target.value)}
      onBlur={e => onBlur(e.target.value)}
    />
  ) : (
    <span className="text-sm text-zinc-200">{value || <span className="text-zinc-600">—</span>}</span>
  )
}

interface Props { productionId: string; canEdit: boolean }

export function CastTab({ productionId, canEdit }: Props) {
  const { data: cast } = useCollection<ProductionCastDoc>(
    `productions/${productionId}/cast`,
    [orderBy('castId', 'asc')],
  )
  const { data: scenes } = useCollection<ProductionSceneDoc>(
    `productions/${productionId}/scenes`,
    [orderBy('sceneNumber', 'asc')],
  )

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
    await updateDoc(doc(db, `productions/${productionId}/cast`, id), { [field]: value })
    setEdits(prev => {
      const next = { ...prev }
      if (next[id]) {
        const { [field]: _, ...rest } = next[id]
        Object.keys(rest).length === 0 ? delete next[id] : (next[id] = rest)
      }
      return next
    })
  }

  async function addMember() {
    const maxId = cast.reduce((m, c) => Math.max(m, c.castId), 0)
    await addDoc(collection(db, `productions/${productionId}/cast`), {
      castId: maxId + 1,
      characterName: '',
      actorName: '',
      scenes: [],
    })
  }

  async function deleteMember(id: string) {
    if (!confirm('Remove this cast member?')) return
    await deleteDoc(doc(db, `productions/${productionId}/cast`, id))
  }

  function scenesForCast(castId: number): number[] {
    return scenes
      .filter(s => (s.castIds ?? []).includes(castId))
      .map(s => s.sceneNumber)
      .sort((a, b) => a - b)
  }

  if (cast.length === 0) {
    return (
      <div className="space-y-4">
        <div className="text-center py-12 text-zinc-500">
          <span className="text-3xl block mb-3">🎭</span>
          <p className="text-sm">No cast members yet.</p>
        </div>
        {canEdit && (
          <button onClick={addMember} className="flex items-center gap-2 text-sm text-brand-400 hover:text-brand-300 transition-colors">
            <Plus className="w-4 h-4" /> Add Cast Member
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* ── Mobile card view (< md) ─────────────────────────────────── */}
      <div className="md:hidden space-y-3">
        {cast.map(member => {
          const memberScenes = scenesForCast(member.castId)
          return (
            <div key={member.id} className="bg-zinc-900 border border-white/10 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-lg font-bold text-brand-400 font-mono">#{member.castId}</span>
                {canEdit && (
                  <button
                    onClick={() => deleteMember(member.id)}
                    className="p-1.5 text-zinc-500 hover:text-rose-400 transition-colors rounded-lg"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
              <div className="space-y-2">
                <div>
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Character</p>
                  <EditField
                    value={get(member.id, 'characterName', member.characterName)}
                    placeholder="Character name"
                    canEdit={canEdit}
                    onChange={v => setLocal(member.id, 'characterName', v)}
                    onBlur={v => save(member.id, 'characterName', v)}
                  />
                </div>
                <div>
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Actor / Actress</p>
                  <EditField
                    value={get(member.id, 'actorName', member.actorName)}
                    placeholder="Actor name"
                    canEdit={canEdit}
                    onChange={v => setLocal(member.id, 'actorName', v)}
                    onBlur={v => save(member.id, 'actorName', v)}
                  />
                </div>
                <div>
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Scenes</p>
                  {memberScenes.length === 0 ? (
                    <span className="text-xs text-zinc-600">Not assigned to scenes</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {memberScenes.map(n => (
                        <span key={n} className="text-xs bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded font-mono">{n}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Desktop table view (>= md) ───────────────────────────────── */}
      <div className="hidden md:block bg-zinc-900 border border-white/10 rounded-2xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/10">
              {['ID', 'Character', 'Actor / Actress', 'Appears in scenes', ''].map(h => (
                <th key={h} className="text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider px-5 py-3 whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {cast.map(member => {
              const memberScenes = scenesForCast(member.castId)
              return (
                <tr key={member.id} className="group hover:bg-white/3 transition-colors">
                  <td className="px-5 py-3 w-12">
                    <span className="text-sm font-bold text-brand-400 font-mono">{member.castId}</span>
                  </td>
                  <td className="px-3 py-2">
                    <EditField
                      value={get(member.id, 'characterName', member.characterName)}
                      placeholder="Character name"
                      canEdit={canEdit}
                      onChange={v => setLocal(member.id, 'characterName', v)}
                      onBlur={v => save(member.id, 'characterName', v)}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <EditField
                      value={get(member.id, 'actorName', member.actorName)}
                      placeholder="Actor name"
                      canEdit={canEdit}
                      onChange={v => setLocal(member.id, 'actorName', v)}
                      onBlur={v => save(member.id, 'actorName', v)}
                    />
                  </td>
                  <td className="px-5 py-3">
                    {memberScenes.length === 0 ? (
                      <span className="text-xs text-zinc-600">Not assigned to scenes</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {memberScenes.map(n => (
                          <span key={n} className="text-xs bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded font-mono">{n}</span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 w-10">
                    {canEdit && (
                      <button
                        onClick={() => deleteMember(member.id)}
                        className="opacity-0 group-hover:opacity-100 p-1.5 text-zinc-500 hover:text-rose-400 transition-all rounded-lg"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {canEdit && (
        <button onClick={addMember} className="flex items-center gap-2 text-sm text-brand-400 hover:text-brand-300 transition-colors">
          <Plus className="w-4 h-4" /> Add Cast Member
        </button>
      )}
    </div>
  )
}
