import { useState } from 'react'
import { collection, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useCollection, orderBy } from '@/hooks/useFirestore'
import { MapPin, Plus, Pencil, Trash2, Check, X } from 'lucide-react'
import type { ProductionLocationDoc } from '@/types'
import LoadingSpinner from '@/components/common/LoadingSpinner'

interface Props { productionId: string; canEdit: boolean }

interface LocForm {
  name: string; address: string; zipCode: string; state: string; notes: string
}
const empty: LocForm = { name: '', address: '', zipCode: '', state: '', notes: '' }

function AddressFields({ form, setForm }: {
  form: LocForm; setForm: (f: LocForm) => void
}) {
  return (
    <>
      <input
        className="w-full bg-zinc-800 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-brand-500/30"
        value={form.address} onChange={e => setForm({ ...form, address: e.target.value })}
        placeholder="Street address…"
      />
      <div className="flex gap-2">
        <input
          className="w-28 bg-zinc-800 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-brand-500/30"
          value={form.zipCode} onChange={e => setForm({ ...form, zipCode: e.target.value })}
          placeholder="Zip code"
        />
        <input
          className="flex-1 bg-zinc-800 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-brand-500/30"
          value={form.state} onChange={e => setForm({ ...form, state: e.target.value })}
          placeholder="City / State"
        />
      </div>
      <input
        className="w-full bg-zinc-800 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-brand-500/30"
        value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
        placeholder="Notes (optional)…"
      />
    </>
  )
}

function fullAddress(loc: ProductionLocationDoc) {
  return [loc.address, loc.zipCode, loc.state].filter(Boolean).join(', ')
}

export function LocationsTab({ productionId, canEdit }: Props) {
  const { data: locations, loading } = useCollection<ProductionLocationDoc>(
    `productions/${productionId}/locations`, [orderBy('name', 'asc')],
  )

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm,  setEditForm]  = useState<LocForm>(empty)
  const [adding,    setAdding]    = useState(false)
  const [newForm,   setNewForm]   = useState<LocForm>(empty)

  async function addLocation() {
    if (!newForm.name.trim()) return
    await addDoc(collection(db, `productions/${productionId}/locations`), {
      name: newForm.name.trim(),
      address: newForm.address.trim(),
      zipCode: newForm.zipCode.trim(),
      state:   newForm.state.trim(),
      notes:   newForm.notes.trim(),
    })
    setNewForm(empty)
    setAdding(false)
  }

  async function saveEdit(id: string) {
    if (!editForm.name.trim()) return
    await updateDoc(doc(db, `productions/${productionId}/locations`, id), {
      name:    editForm.name.trim(),
      address: editForm.address.trim(),
      zipCode: editForm.zipCode.trim(),
      state:   editForm.state.trim(),
      notes:   editForm.notes.trim(),
    })
    setEditingId(null)
  }

  async function deleteLocation(id: string) {
    if (!confirm('Delete this location? Scenes linked to it will keep the name but lose the address.')) return
    await deleteDoc(doc(db, `productions/${productionId}/locations`, id))
  }

  if (loading) return <LoadingSpinner />

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-zinc-100 font-semibold text-base mb-1">Filming Locations</h2>
        <p className="text-zinc-500 text-sm">
          Define locations with addresses. Link them to scenes in Script Breakdown. Addresses are used for sunrise/sunset and weather data in the schedule.
        </p>
      </div>

      <div className="bg-zinc-900 border border-white/10 rounded-2xl overflow-hidden">
        {locations.length === 0 && !adding && (
          <div className="px-5 py-10 text-center text-zinc-500 text-sm">
            No locations defined yet. Add one below.
          </div>
        )}

        <div className="divide-y divide-white/8">
          {locations.map(loc => (
            editingId === loc.id ? (
              <div key={loc.id} className="p-4 space-y-2">
                <input
                  autoFocus
                  className="w-full bg-zinc-800 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-brand-500/30"
                  value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                  placeholder="Location name…"
                  onKeyDown={e => { if (e.key === 'Escape') setEditingId(null) }}
                />
                <AddressFields form={editForm} setForm={setEditForm} />
                <div className="flex gap-2 pt-1">
                  <button onClick={() => saveEdit(loc.id)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-emerald-400 hover:text-emerald-300 transition-colors">
                    <Check className="w-3.5 h-3.5" /> Save
                  </button>
                  <button onClick={() => setEditingId(null)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
                    <X className="w-3.5 h-3.5" /> Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div key={loc.id} className="flex items-start gap-3 px-5 py-3.5 group">
                <MapPin className="w-4 h-4 text-brand-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-zinc-200 font-medium">{loc.name}</p>
                  {fullAddress(loc) && <p className="text-xs text-zinc-400 mt-0.5">{fullAddress(loc)}</p>}
                  {loc.notes && <p className="text-xs text-zinc-500 italic mt-0.5">{loc.notes}</p>}
                </div>
                {canEdit && (
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                    <button
                      onClick={() => {
                        setEditingId(loc.id)
                        setEditForm({
                          name:    loc.name,
                          address: loc.address ?? '',
                          zipCode: loc.zipCode ?? '',
                          state:   loc.state   ?? '',
                          notes:   loc.notes   ?? '',
                        })
                      }}
                      className="p-1.5 text-zinc-500 hover:text-zinc-300 transition-colors rounded-lg hover:bg-white/5"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => deleteLocation(loc.id)}
                      className="p-1.5 text-zinc-500 hover:text-rose-400 transition-colors rounded-lg hover:bg-white/5"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            )
          ))}

          {adding && (
            <div className="p-4 space-y-2">
              <input
                autoFocus
                className="w-full bg-zinc-800 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-brand-500/30"
                value={newForm.name} onChange={e => setNewForm({ ...newForm, name: e.target.value })}
                placeholder="Location name…"
                onKeyDown={e => {
                  if (e.key === 'Escape') { setAdding(false); setNewForm(empty) }
                }}
              />
              <AddressFields form={newForm} setForm={setNewForm} />
              <div className="flex gap-2 pt-1">
                <button onClick={addLocation} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-emerald-400 hover:text-emerald-300 transition-colors">
                  <Check className="w-3.5 h-3.5" /> Add location
                </button>
                <button onClick={() => { setAdding(false); setNewForm(empty) }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
                  <X className="w-3.5 h-3.5" /> Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {canEdit && !adding && (
        <button onClick={() => setAdding(true)} className="flex items-center gap-2 text-sm text-brand-400 hover:text-brand-300 transition-colors">
          <Plus className="w-4 h-4" /> Add location
        </button>
      )}
    </div>
  )
}
