import { useEffect, useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { functions } from '@/lib/firebase'
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react'
import type { Order } from './CustomerOrders'

// Removing a customer takes three deliberate steps, like deleting a school:
// confirm, type the school's exact name, then the final button after a
// countdown. The server (removeCustomer) checks the name again, then a job
// removes the address's DNS records and deletes the customer's project.

const removeCustomer = httpsCallable<{ orderId: string; confirmName: string }, { ok: true }>(functions, 'removeCustomer')
const COUNTDOWN_S = 5

export default function RemoveCustomerDialog({ order, onClose }: { order: Order; onClose: () => void }) {
  const name = order.school.name
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [typed, setTyped] = useState('')
  const [wait, setWait] = useState(COUNTDOWN_S)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (step !== 3 || wait <= 0) return
    const t = setTimeout(() => setWait(w => w - 1), 1000)
    return () => clearTimeout(t)
  }, [step, wait])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  async function remove() {
    setBusy(true); setError('')
    try {
      await removeCustomer({ orderId: order.id, confirmName: typed })
      onClose()
    } catch (e: any) {
      setError(e?.message ?? 'Could not remove the customer')
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={e => { e.stopPropagation(); if (!busy) onClose() }}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="remove-customer-title" aria-describedby="remove-customer-body"
        className="w-full max-w-md bg-zinc-900 border border-rose-500/40 rounded-2xl p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-6 h-6 text-rose-400 flex-shrink-0" aria-hidden="true" />
          <h2 id="remove-customer-title" className="text-lg font-semibold text-zinc-100">
            Remove {name}? <span className="text-sm font-normal text-zinc-500">Step {step} of 3</span>
          </h2>
        </div>

        <div id="remove-customer-body" className="text-sm text-zinc-300 space-y-3">
          {step === 1 && (
            <>
              <p>This shuts down <strong>{name}</strong> at <strong>{order.address}</strong>: its DNS records are removed and its project{order.provisioning.state?.projectId ? <> (<code>{order.provisioning.state.projectId}</code>)</> : null} is deleted, with all its users, data and files.</p>
              <p>Google keeps a deleted project for 30 days before it's gone for good. Export anything the customer wants first.</p>
              <p className="text-rose-300">The customer loses access immediately. The order and its history are kept here.</p>
            </>
          )}
          {step === 2 && (
            <>
              <label htmlFor="remove-customer-name" className="block">Type the school's name, <strong>{name}</strong>, to continue:</label>
              <input id="remove-customer-name" autoFocus className="input w-full" value={typed} autoComplete="off"
                onChange={e => setTyped(e.target.value)} />
            </>
          )}
          {step === 3 && (
            <p className="text-rose-300">Last warning. <strong>{name}</strong> and everything in it will be removed when you press the button below.</p>
          )}
          {error && <p role="alert" className="text-rose-400">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary py-2 px-4" onClick={onClose} disabled={busy}>Cancel</button>
          {step === 1 && (
            <button type="button" className="py-2 px-4 rounded-xl bg-rose-600/80 hover:bg-rose-600 text-white text-sm font-semibold" onClick={() => setStep(2)}>
              Continue
            </button>
          )}
          {step === 2 && (
            <button type="button" disabled={typed.trim() !== name.trim()}
              className="py-2 px-4 rounded-xl bg-rose-600/80 hover:bg-rose-600 text-white text-sm font-semibold disabled:opacity-40"
              onClick={() => { setWait(COUNTDOWN_S); setStep(3) }}>
              Continue
            </button>
          )}
          {step === 3 && (
            <button type="button" disabled={wait > 0 || busy}
              className="py-2 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold disabled:opacity-40 flex items-center gap-2"
              onClick={remove}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" aria-hidden="true" />}
              {wait > 0 ? `Remove customer (${wait})` : 'Remove customer'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
