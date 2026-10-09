import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  collection, addDoc, deleteDoc, doc, serverTimestamp, increment, writeBatch,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useCollection, orderBy } from '@/hooks/useFirestore'
import type { EquipmentBookingDoc, EquipmentBookingMessageDoc } from '@/types'
import {
  Calendar, Check, X, Loader2, CheckCircle2, ArrowRight, ExternalLink, Send, Trash2,
} from 'lucide-react'
import { BOOKING_STATUSES, STATUS_COLOR, formatDate } from './adminEquipmentShared'

// ── Booking message thread ───────────────────────────────────────────────────

function BookingMessageThread({ bookingId }: { bookingId: string }) {
  const { profile } = useAuth()
  const { data: messages } = useCollection<EquipmentBookingMessageDoc>(
    `equipment_bookings/${bookingId}/messages`,
    [orderBy('createdAt', 'asc')],
  )
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)

  async function send() {
    if (!text.trim() || !profile) return
    setSending(true)
    try {
      await addDoc(collection(db, `equipment_bookings/${bookingId}/messages`), {
        senderId: profile.uid,
        senderName: profile.displayName ?? 'Staff',
        senderRole: 'staff',
        text: text.trim(),
        createdAt: serverTimestamp(),
      })
      setText('')
    } finally {
      setSending(false)
    }
  }

  return (
    <div style={{ marginBottom: 12 }}>
      {messages.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
          {messages.map(m => (
            <p
              key={m.id}
              style={{
                fontSize: '.78rem', padding: '6px 10px', borderRadius: 8, maxWidth: '85%', margin: 0,
                alignSelf: m.senderRole === 'staff' ? 'flex-end' : 'flex-start',
                background: m.senderRole === 'staff' ? 'rgba(76,217,100,.12)' : '#1a1a25',
                color: m.senderRole === 'staff' ? '#c8f0d0' : '#c0c0d5',
                fontStyle: m.senderRole === 'staff' ? 'normal' : 'italic',
              }}
            >
              {m.text}
            </p>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && send()}
          placeholder="Reply to student…"
          style={{ flex: 1, fontSize: '.78rem', background: '#1a1a25', border: '1px solid #2a2a3a', borderRadius: 8, padding: '7px 10px', color: '#f0f0f5' }}
        />
        <button
          disabled={sending || !text.trim()}
          onClick={send}
          style={{ padding: '7px 12px', borderRadius: 8, background: 'rgba(76,217,100,.15)', border: '1px solid rgba(76,217,100,.3)', color: '#4cd964', cursor: 'pointer', display: 'flex', alignItems: 'center', opacity: sending || !text.trim() ? 0.5 : 1 }}
        >
          <Send size={13} />
        </button>
      </div>
    </div>
  )
}

// ── Bookings Tab ──────────────────────────────────────────────────────────────

export function BookingsTab() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { data: bookings } = useCollection<EquipmentBookingDoc>('equipment_bookings')
  const sorted = useMemo(
    () => [...bookings].sort((a, b) => {
      const ta = (b.createdAt as any)?.toMillis?.() ?? 0
      const tb = (a.createdAt as any)?.toMillis?.() ?? 0
      return ta - tb
    }),
    [bookings],
  )
  const [statusFilter, setStatusFilter] = useState<'all' | typeof BOOKING_STATUSES[number]>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [actionModal, setActionModal] = useState<{ booking: EquipmentBookingDoc; action: 'confirmed' | 'denied' } | null>(null)
  const [actionMessage, setActionMessage] = useState('')

  const filtered = useMemo(
    () => statusFilter === 'all' ? sorted : sorted.filter(b => b.status === statusFilter),
    [sorted, statusFilter],
  )

  async function setStatus(id: string, newStatus: string, teacherNotes?: string) {
    setSavingId(id)
    try {
      const booking = bookings.find(b => b.id === id)
      const batch = writeBatch(db)
      batch.update(doc(db, 'equipment_bookings', id), {
        status: newStatus,
        ...(teacherNotes !== undefined ? { teacherNotes } : {}),
      })

      // Adjust available count when equipment physically moves
      if (booking?.items?.length) {
        const prevStatus = booking.status
        const delta =
          newStatus === 'checked-out' && prevStatus !== 'checked-out' ? -1 :
          prevStatus === 'checked-out' && (newStatus === 'returned' || newStatus === 'cancelled') ? 1 :
          0
        if (delta !== 0) {
          for (const item of booking.items) {
            batch.update(doc(db, 'equipment', item.equipmentId), {
              available: increment(delta * item.quantity),
            })
          }
        }
      }

      await batch.commit()
    } finally {
      setSavingId(null)
    }
  }

  async function confirmAction() {
    if (!actionModal) return
    const note = actionMessage.trim()
    await setStatus(actionModal.booking.id, actionModal.action, note)
    if (note && profile) {
      await addDoc(collection(db, `equipment_bookings/${actionModal.booking.id}/messages`), {
        senderId: profile.uid,
        senderName: profile.displayName ?? 'Staff',
        senderRole: 'staff',
        text: note,
        createdAt: serverTimestamp(),
      })
    }
    setActionModal(null)
    setActionMessage('')
  }

  async function deleteBooking(b: EquipmentBookingDoc) {
    const warning = b.linkedProjectId
      ? `Delete this booking request? Its linked inventory project will NOT be deleted — only the booking record itself.`
      : `Delete this booking request? This cannot be undone.`
    if (!confirm(warning)) return
    setSavingId(b.id)
    try {
      await deleteDoc(doc(db, 'equipment_bookings', b.id))
    } finally {
      setSavingId(null)
    }
  }

  const pendingCount = sorted.filter(b => b.status === 'pending').length

  return (
    <>
      {/* Status filters */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: '1rem' }}>
        {BOOKING_STATUSES.map(s => {
          const count = s === 'all' ? sorted.length : sorted.filter(b => b.status === s).length
          const active = statusFilter === s
          const col = s === 'all' ? '#4cd964' : STATUS_COLOR[s] ?? '#6b7280'
          return (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              style={{
                padding: '5px 14px', borderRadius: 20, fontSize: '.75rem', fontWeight: 700,
                textTransform: 'capitalize', cursor: 'pointer', letterSpacing: '.04em',
                background: active ? col + '25' : '#1a1a25',
                border: `1px solid ${active ? col + '80' : '#2a2a3a'}`,
                color: active ? col : '#6a6a80',
              }}
            >
              {s === 'all' ? 'All' : s.replace('-', ' ')}
              {s === 'pending' && pendingCount > 0 && (
                <span style={{ marginLeft: 4, background: '#f59e0b', color: '#000', borderRadius: 10, padding: '1px 5px', fontSize: 10 }}>{pendingCount}</span>
              )}
              {' '}({count})
            </button>
          )
        })}
      </div>

      {filtered.length === 0 ? (
        <div className="no-results">No bookings found</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map(b => {
            const expanded = expandedId === b.id
            const col = STATUS_COLOR[b.status] ?? '#6b7280'
            return (
              <div
                key={b.id}
                style={{ background: '#0e0e16', border: '1px solid #2a2a3a', borderRadius: 12, overflow: 'hidden', cursor: 'pointer' }}
                onClick={() => setExpandedId(expanded ? null : b.id)}
              >
                <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: col, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 120 }}>
                    <p style={{ fontWeight: 700, fontSize: '.9rem', color: '#f0f0f5', margin: 0 }}>{b.projectName}</p>
                    <p style={{ fontSize: '.75rem', color: '#6a6a80', margin: '2px 0 0' }}>{b.studentName}</p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '.75rem', color: '#8a8aab' }}>
                    <Calendar size={12} />
                    {formatDate(b.checkoutDate)} – {formatDate(b.returnDate)}
                  </div>
                  <span style={{ fontSize: '.7rem', fontWeight: 700, background: col + '20', color: col, border: `1px solid ${col}50`, borderRadius: 20, padding: '3px 10px', textTransform: 'capitalize' }}>
                    {b.status.replace('-', ' ')}
                  </span>
                </div>

                {expanded && (
                  <div style={{ borderTop: '1px solid #2a2a3a', padding: '14px 16px', background: '#0a0a0f' }} onClick={e => e.stopPropagation()}>
                    {/* Items */}
                    <div style={{ marginBottom: 12 }}>
                      <p style={{ fontSize: '.7rem', fontWeight: 700, color: '#4a4a60', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>Equipment</p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {b.items.map((it, i) => (
                          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.8rem', color: '#c0c0d5' }}>
                            <span>{it.equipmentName}</span>
                            <span style={{ color: '#6a6a80' }}>×{it.quantity}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <BookingMessageThread bookingId={b.id} />

                    {/* Actions */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {b.status === 'pending' && (
                        <>
                          <button
                            disabled={savingId === b.id}
                            onClick={() => { setActionModal({ booking: b, action: 'confirmed' }); setActionMessage('') }}
                            style={{ padding: '6px 14px', background: 'rgba(76,217,100,.15)', border: '1px solid rgba(76,217,100,.3)', borderRadius: 8, color: '#4cd964', fontSize: '.8rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                          >
                            {savingId === b.id ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Check size={12} />} Accept
                          </button>
                          <button
                            disabled={savingId === b.id}
                            onClick={() => { setActionModal({ booking: b, action: 'denied' }); setActionMessage('') }}
                            style={{ padding: '6px 14px', background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.2)', borderRadius: 8, color: '#f87171', fontSize: '.8rem', fontWeight: 600, cursor: 'pointer' }}
                          >
                            Deny
                          </button>
                        </>
                      )}
                      {b.status === 'confirmed' && !b.linkedProjectId && (
                        <>
                          <button
                            disabled={savingId === b.id}
                            title="Click to undo and move back to pending"
                            onClick={() => setStatus(b.id, 'pending')}
                            style={{ padding: '6px 14px', background: 'rgba(76,217,100,.15)', border: '1px solid rgba(76,217,100,.3)', borderRadius: 8, color: '#4cd964', fontSize: '.8rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                          >
                            <Check size={12} /> Accepted
                          </button>
                          <button
                            disabled={savingId === b.id}
                            onClick={() => navigate(`/admin/inventory?fromBooking=${b.id}`)}
                            style={{ padding: '6px 14px', background: 'rgba(249,115,22,.15)', border: '1px solid rgba(249,115,22,.3)', borderRadius: 8, color: '#f97316', fontSize: '.8rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                          >
                            Set Up in Inventory <ArrowRight size={12} />
                          </button>
                        </>
                      )}
                      {b.status === 'denied' && (
                        <button
                          disabled={savingId === b.id}
                          title="Click to undo and move back to pending"
                          onClick={() => setStatus(b.id, 'pending')}
                          style={{ padding: '6px 14px', background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.2)', borderRadius: 8, color: '#f87171', fontSize: '.8rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                        >
                          <X size={12} /> Denied
                        </button>
                      )}
                      {b.status === 'checked-out' && b.linkedProjectId && (
                        <button
                          disabled={savingId === b.id}
                          onClick={() => navigate(`/admin/inventory?openProject=${b.linkedProjectId}`)}
                          style={{ padding: '6px 14px', background: 'rgba(76,217,100,.1)', border: '1px solid rgba(76,217,100,.25)', borderRadius: 8, color: '#4cd964', fontSize: '.8rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                        >
                          View in Inventory <ExternalLink size={12} />
                        </button>
                      )}
                      {b.status === 'checked-out' && !b.linkedProjectId && (
                        <button
                          disabled={savingId === b.id}
                          onClick={() => setStatus(b.id, 'returned')}
                          style={{ padding: '6px 14px', background: 'rgba(76,217,100,.15)', border: '1px solid rgba(76,217,100,.3)', borderRadius: 8, color: '#4cd964', fontSize: '.8rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                        >
                          <CheckCircle2 size={12} /> Mark Returned
                        </button>
                      )}
                      {(b.status === 'returned' || b.status === 'cancelled') && !b.linkedProjectId && (
                        <button
                          disabled={savingId === b.id}
                          onClick={() => setStatus(b.id, 'pending')}
                          style={{ padding: '6px 14px', background: '#1a1a25', border: '1px solid #2a2a3a', borderRadius: 8, color: '#8a8aab', fontSize: '.8rem', fontWeight: 600, cursor: 'pointer' }}
                        >
                          Reopen
                        </button>
                      )}
                      <button
                        disabled={savingId === b.id}
                        onClick={() => deleteBooking(b)}
                        title="Delete this booking"
                        style={{ marginLeft: 'auto', padding: '6px 10px', background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.2)', borderRadius: 8, color: '#f87171', fontSize: '.8rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {actionModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }} onClick={() => setActionModal(null)}>
          <div style={{ background: '#0e0e16', border: '1px solid #2a2a3a', borderRadius: 16, width: '100%', maxWidth: 400, padding: '1.5rem' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#f0f0f5', marginBottom: 6 }}>
              {actionModal.action === 'confirmed' ? 'Accept booking' : 'Deny booking'}
            </h3>
            <p style={{ fontSize: '.82rem', color: '#8a8aab', marginBottom: 14 }}>
              "{actionModal.booking.projectName}" — {actionModal.booking.studentName}
            </p>
            <label style={{ fontSize: '.75rem', fontWeight: 600, color: '#6a6a80', display: 'block', marginBottom: 6 }}>
              Message to student <span style={{ fontWeight: 400 }}>(optional — sent as a push notification)</span>
            </label>
            <textarea
              autoFocus
              value={actionMessage}
              onChange={e => setActionMessage(e.target.value)}
              rows={3}
              placeholder={actionModal.action === 'confirmed' ? 'e.g. Pick up from the equipment room after 2pm' : 'e.g. Dates conflict with another booking'}
              style={{ width: '100%', background: '#1a1a25', border: '1px solid #2a2a3a', borderRadius: 10, padding: '10px 12px', color: '#f0f0f5', fontSize: '.85rem', resize: 'none', marginBottom: 14, fontFamily: 'inherit' }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                disabled={savingId === actionModal.booking.id}
                onClick={confirmAction}
                style={{
                  flex: 1, padding: '9px 16px', borderRadius: 10, fontSize: '.85rem', fontWeight: 700, cursor: 'pointer',
                  background: actionModal.action === 'confirmed' ? 'rgba(76,217,100,.15)' : 'rgba(239,68,68,.12)',
                  border: `1px solid ${actionModal.action === 'confirmed' ? 'rgba(76,217,100,.35)' : 'rgba(239,68,68,.3)'}`,
                  color: actionModal.action === 'confirmed' ? '#4cd964' : '#f87171',
                }}
              >
                {savingId === actionModal.booking.id ? 'Saving…' : actionModal.action === 'confirmed' ? 'Accept' : 'Deny'}
              </button>
              <button onClick={() => setActionModal(null)} style={{ padding: '9px 16px', borderRadius: 10, fontSize: '.85rem', fontWeight: 600, cursor: 'pointer', background: '#1a1a25', border: '1px solid #2a2a3a', color: '#8a8aab' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
