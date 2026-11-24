import { useEffect, useMemo, useState } from 'react'
import { collection, onSnapshot } from 'firebase/firestore'
import { CheckCircle2, FileSignature } from 'lucide-react'
import { db } from '@/lib/firebase'
import { useCollection, where } from '@/hooks/useFirestore'
import { LEGAL_TEXT } from '@/lib/equipmentContract'
import { latestByUid, signatureState, signEquipmentContract, printSignedContract } from '@/lib/equipmentSigning'
import type { EquipmentSignatureDoc, InventoryProjectDoc, InventoryItemDoc } from '@/types'

// Shared by My Bookings and the borrower's home page

function fmtDate(d: string) {
  if (!d) return '—'
  try {
    return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return d }
}

/** Live items of the given projects (inventory_projects/{id}/items) */
export function useProjectItems(projectIds: string[]) {
  const [byProject, setByProject] = useState<Record<string, (InventoryItemDoc & { projectId: string })[]>>({})
  const key = projectIds.join(',')
  useEffect(() => {
    const ids = key ? key.split(',') : []
    setByProject(prev => Object.fromEntries(Object.entries(prev).filter(([id]) => ids.includes(id))))
    const unsubs = ids.map(projectId => onSnapshot(
      collection(db, 'inventory_projects', projectId, 'items'),
      snap => setByProject(prev => ({
        ...prev,
        [projectId]: snap.docs.map(d => ({ id: d.id, projectId, ...d.data() }) as InventoryItemDoc & { projectId: string }),
      })),
      err => console.warn('items listener failed', projectId, err),
    ))
    return () => unsubs.forEach(u => u())
  }, [key])
  return useMemo(() => Object.values(byProject).flat(), [byProject])
}

// ── Contract e-signing ───────────────────────────────────────────────────────
// Shown once staff send the contract for signing. The student reviews terms,
// dates and items, ticks "I accept" and types their name; the server records
// the evidence (see functions/src/equipment-signing.ts).

export default function ContractSignPanel({ project, items, uid, startOpen = false }: {
  project: InventoryProjectDoc
  items: InventoryItemDoc[]
  uid: string
  /** Open the terms straight away (the home page's "Read and sign") */
  startOpen?: boolean
}) {
  const { data: sigs } = useCollection<EquipmentSignatureDoc>(
    `inventory_projects/${project.id}/signatures`,
    [where('uid', '==', uid)],
    !!uid,
    uid,
  )
  const sig = latestByUid(sigs).get(uid)
  const state = signatureState(project, items, sig, uid)
  const [open, setOpen] = useState(startOpen)
  const [accepted, setAccepted] = useState(false)
  const [name, setName] = useState('')
  const [signing, setSigning] = useState(false)
  const [error, setError] = useState('')

  if (state === 'not-requested') return null

  if (state === 'signed' && !open) {
    return (
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <span className="flex items-center gap-1 text-emerald-300 font-medium">
          <CheckCircle2 className="w-3.5 h-3.5" /> Contract signed
          {sig?.signedAt && <span className="text-zinc-500 font-normal">· {sig.signedAt.toDate().toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' })}</span>}
        </span>
        <button onClick={() => printSignedContract(sig!)} className="text-ember-secondary hover:underline">View signed contract</button>
      </div>
    )
  }

  async function sign() {
    setSigning(true)
    setError('')
    try {
      await signEquipmentContract(project.id, name)
      setOpen(false)
      setAccepted(false)
      setName('')
    } catch (e: any) {
      setError(e?.message ?? 'Could not sign. Try again.')
    } finally {
      setSigning(false)
    }
  }

  return (
    <div className="rounded-lg border border-orange-500/30 bg-orange-500/[0.06] p-3 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="flex items-center gap-1.5 text-sm font-medium text-orange-200">
          <FileSignature className="w-4 h-4" />
          {state === 'changed' ? 'The contract changed — please sign again' : 'Please sign the equipment contract'}
        </p>
        {!open && (
          <button onClick={() => setOpen(true)} className="btn-primary min-h-[44px] text-sm">
            Review & sign
          </button>
        )}
      </div>

      {open && (
        <div className="space-y-3">
          <div className="rounded-lg bg-zinc-950/60 border border-white/10 p-3 space-y-2 text-xs text-zinc-300">
            <p><span className="text-zinc-500">Project:</span> {project.name}</p>
            <p><span className="text-zinc-500">Loan period:</span> {fmtDate(project.checkoutDate)} → {fmtDate(project.returnDate)}</p>
            <div>
              <p className="text-zinc-500 mb-1">Equipment ({items.length}):</p>
              {items.length > 0
                ? <ul className="list-disc pl-5 space-y-0.5">{items.map(i => <li key={i.id}>{i.equipmentName}{typeof i.unit === 'number' ? ` #${i.unit}` : ''}</li>)}</ul>
                : <p className="text-zinc-500">No items listed yet.</p>}
            </div>
            <p className="leading-relaxed text-zinc-400 pt-1 border-t border-white/5">{LEGAL_TEXT}</p>
          </div>

          <label className="flex items-start gap-2 text-sm text-zinc-200 cursor-pointer">
            <input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} className="mt-0.5 accent-orange-500" />
            I have read the terms and accept responsibility for the equipment listed above.
          </label>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Type your full name to sign</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              // Not the student's name: a greyed-out name read as already signed
              placeholder="Sign with your name"
              autoComplete="name"
              className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500/60"
            />
          </div>
          {error && <p className="text-xs text-rose-400">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={sign}
              disabled={!accepted || name.trim().length < 2 || signing}
              className="btn-primary min-h-[44px] disabled:opacity-40"
            >
              {signing ? 'Signing…' : 'Sign contract'}
            </button>
            <button onClick={() => { setOpen(false); setError('') }} className="btn-ghost min-h-[44px]">Cancel</button>
          </div>
          <p className="text-[11px] text-zinc-500">
            Your signature is recorded with your CineForge account, the time and the exact contract content.
          </p>
        </div>
      )}
    </div>
  )
}
