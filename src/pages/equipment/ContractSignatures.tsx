import { useMemo, useState } from 'react'
import { documentId } from 'firebase/firestore'
import { useCollection, where } from '@/hooks/useFirestore'
import type { EquipmentSignatureDoc, InventoryItemDoc, InventoryProjectDoc, UserDoc } from '@/types'
import { PenLine, Send, Check, Clock, AlertTriangle, FileSignature } from 'lucide-react'
import {
  latestByUid, signatureState, requestEquipmentSignatures, printSignedContract, type SignatureState,
} from '@/lib/equipmentSigning'

const STATE_STYLE: Record<SignatureState, { label: string; color: string; bg: string }> = {
  'signed':        { label: 'Signed',            color: '#4cd964', bg: 'rgba(76,217,100,.12)' },
  'changed':       { label: 'Needs re-signing',  color: '#f5a623', bg: 'rgba(245,166,35,.12)' },
  'requested':     { label: 'Waiting',           color: '#a0a0b5', bg: 'rgba(160,160,181,.12)' },
  'not-requested': { label: 'Not sent',          color: '#6a6a80', bg: 'rgba(106,106,128,.12)' },
}

const STATE_ICON: Record<SignatureState, typeof Check> = {
  'signed': Check, 'changed': AlertTriangle, 'requested': Clock, 'not-requested': PenLine,
}

// Staff view: who has e-signed this project's equipment contract. Status only —
// checkout is never blocked on it.
export function ContractSignatures({ project, items }: { project: InventoryProjectDoc; items: InventoryItemDoc[] }) {
  const borrowerIds = (project.borrowerIds ?? []).filter(Boolean)
  const { data: sigs } = useCollection<EquipmentSignatureDoc>(`inventory_projects/${project.id}/signatures`)
  const { data: users } = useCollection<UserDoc & { id: string }>(
    'users',
    borrowerIds.length ? [where(documentId(), 'in', borrowerIds.slice(0, 30))] : [],
    borrowerIds.length > 0,
    borrowerIds.join(','),
  )
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState('')

  const latest = useMemo(() => latestByUid(sigs), [sigs])
  const rows = borrowerIds.map(uid => {
    const sig = latest.get(uid)
    const user = users.find(u => u.id === uid)
    return { uid, name: user?.displayName ?? sig?.accountName ?? 'Unknown student', sig, state: signatureState(project, items, sig) }
  })
  // Borrowers typed in by name only (no CineForge account) can't e-sign
  const accountNames = new Set(users.map(u => u.displayName))
  const paperOnly = (project.borrowers ?? []).filter(n => !accountNames.has(n) && !rows.some(r => r.name === n))
  const unsigned = rows.filter(r => r.state !== 'signed').length

  async function send() {
    setSending(true)
    setResult('')
    try {
      const { data } = await requestEquipmentSignatures(project.id)
      setResult(data.notified > 0
        ? `Sent to ${data.notified} borrower${data.notified === 1 ? '' : 's'}.`
        : 'Everyone has already signed.')
    } catch (e: any) {
      setResult(e?.message ?? 'Could not send.')
    } finally {
      setSending(false)
    }
  }

  if (borrowerIds.length === 0 && paperOnly.length === 0) return null

  return (
    <div style={{ background: '#13131c', border: '1px solid #2a2a3a', borderRadius: 12, padding: '1rem', marginBottom: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: '.75rem' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: '.9rem', color: '#f0f0f5' }}>
          <FileSignature size={16} color="#ff6b35" /> Contract signatures
          <span style={{ fontWeight: 500, fontSize: '.78rem', color: '#6a6a80' }}>
            {rows.length - unsigned}/{rows.length} signed
          </span>
        </span>
        {rows.length > 0 && unsigned > 0 && (
          <button className="secondary-btn" disabled={sending} onClick={send} style={{ padding: '.4rem .8rem', fontSize: '.8rem' }}>
            <Send size={14} /> {sending ? 'Sending…' : project.signatureRequest ? 'Send reminder' : 'Send for signing'}
          </button>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rows.map(r => {
          const st = STATE_STYLE[r.state]
          const Icon = STATE_ICON[r.state]
          return (
            <div key={r.uid} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '8px 10px', background: '#1a1a25', borderRadius: 8 }}>
              <span style={{ flex: 1, minWidth: 140, fontSize: '.85rem', color: '#f0f0f5' }}>{r.name}</span>
              {r.sig && (
                <span style={{ fontSize: '.72rem', color: '#6a6a80' }}>
                  {r.sig.signedAt?.toDate().toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' })}
                </span>
              )}
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '.72rem', fontWeight: 700, color: st.color, background: st.bg, padding: '3px 8px', borderRadius: 999 }}>
                <Icon size={12} /> {st.label}
              </span>
              {r.sig && (
                <button
                  onClick={() => printSignedContract(r.sig!)}
                  style={{ background: 'none', border: 'none', color: '#b4c5ff', fontSize: '.75rem', cursor: 'pointer', padding: 0 }}
                >
                  View signed
                </button>
              )}
            </div>
          )
        })}
        {paperOnly.map(n => (
          <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: '#1a1a25', borderRadius: 8 }}>
            <span style={{ flex: 1, fontSize: '.85rem', color: '#a0a0b5' }}>{n}</span>
            <span style={{ fontSize: '.72rem', color: '#6a6a80' }}>No CineForge account — sign on paper</span>
          </div>
        ))}
      </div>

      {rows.some(r => r.state === 'changed') && (
        <p style={{ fontSize: '.75rem', color: '#f5a623', marginTop: '.6rem' }}>
          Items or dates changed after signing — send a reminder to have them sign the updated contract.
        </p>
      )}
      {result && <p style={{ fontSize: '.75rem', color: '#a0a0b5', marginTop: '.6rem' }}>{result}</p>}
    </div>
  )
}
