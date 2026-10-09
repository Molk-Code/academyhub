import { useState, useEffect, useRef, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { StatsContent } from './InventoryStats'
import {
  collection, collectionGroup, addDoc, updateDoc, deleteDoc, doc, getDoc, getDocs,
  serverTimestamp, query, where, onSnapshot, increment, writeBatch,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useCollection } from '@/hooks/useFirestore'
import type { EquipmentDoc, InventoryProjectDoc, InventoryItemDoc, InventoryPresetDoc, InventoryPresetItem, UserDoc, EquipmentBookingDoc } from '@/types'
import {
  Package, Calendar, Users, Clock, AlertTriangle, Check, Trash2, Plus, Minus,
  ChevronDown, ChevronRight, ArrowLeft, Edit2, CheckCircle2, ArchiveRestore,
  Layers, Search, X, ZapOff, Scan, Smartphone, QrCode, ClipboardList, Pencil,
} from 'lucide-react'
import { EquipmentImg, today, isOverdue, formatDate, overdueDays, parseScanText, beep } from './inventoryShared'
import { EquipmentPicker } from './EquipmentPicker'
import { ProjectDetail } from './ProjectDetail'
import './molkom.css'

type InvTab = 'dashboard' | 'all-projects' | 'statistics' | 'presets'

// ── Project Card ──────────────────────────────────────────────────────────────

function ProjectCard({
  project,
  items = [],
  onClick,
  onDelete,
}: {
  project: InventoryProjectDoc
  items?: InventoryItemDoc[]
  onClick: () => void
  onDelete: () => Promise<void>
}) {
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const overdue = isOverdue(project.returnDate) && ['active', 'checked-out'].includes(project.status)
  const od = overdueDays(project.returnDate)

  const checkedOut = items.filter(i => i.status === 'checked-out').length
  const returned   = items.filter(i => i.status === 'returned').length
  const missing    = items.filter(i => i.status === 'missing').length
  const damaged    = items.filter(i => i.status === 'damaged').length
  const total      = items.length

  const statusClass =
    project.status === 'active' ? 'status-active' :
    project.status === 'checked-out' ? 'status-checkout' :
    project.status === 'returned' ? 'status-returned' : 'status-archived'

  return (
    <div className="project-card" onClick={onClick}>
      <div className="project-card-header">
        <Package size={16} />
        <span style={{ fontSize: '.75rem', fontWeight: 600, color: '#a0a0b5' }}>Project</span>
        <div className="project-card-badges">
          <span className={`project-status-badge ${statusClass}`}>{project.status}</span>
          {missing > 0 && <span className="project-status-badge" style={{ background: 'rgba(255,71,87,.15)', color: '#ff4757', borderColor: 'rgba(255,71,87,.3)' }}>⚠ {missing} missing</span>}
          {damaged > 0 && <span className="project-status-badge" style={{ background: 'rgba(255,165,2,.15)', color: '#ffa502', borderColor: 'rgba(255,165,2,.3)' }}>⚠ {damaged} damaged</span>}
        </div>
      </div>
      <div className="project-card-name">{project.name}</div>
      <div className="project-card-meta">
        {project.borrowers?.length > 0 && (
          <div className="project-card-meta-item">
            <Users size={13} />
            <span>{project.borrowers.slice(0, 3).join(', ')}{project.borrowers.length > 3 ? ` +${project.borrowers.length - 3}` : ''}</span>
          </div>
        )}
        <div className="project-card-meta-item">
          <Calendar size={13} />
          <span>{formatDate(project.checkoutDate)} – {formatDate(project.returnDate)}</span>
        </div>
        {project.equipmentManagerName && (
          <div className="project-card-meta-item">
            <Clock size={13} />
            <span>Manager: {project.equipmentManagerName}</span>
          </div>
        )}
      </div>
      {/* Item summary bar */}
      {total > 0 && (
        <div style={{ display: 'flex', gap: 8, marginTop: '.5rem', flexWrap: 'wrap' }}>
          {checkedOut > 0 && <span style={{ fontSize: '.7rem', fontWeight: 700, color: '#f97316' }}>📦 {checkedOut} out</span>}
          {returned   > 0 && <span style={{ fontSize: '.7rem', fontWeight: 600, color: '#4cd964' }}>✓ {returned} returned</span>}
          {missing    > 0 && <span style={{ fontSize: '.7rem', fontWeight: 700, color: '#ff4757' }}>? {missing} missing</span>}
          {damaged    > 0 && <span style={{ fontSize: '.7rem', fontWeight: 700, color: '#ffa502' }}>⚠ {damaged} damaged</span>}
        </div>
      )}
      <div className="project-card-footer" style={{ alignItems: 'center' }}>
        {overdue
          ? <span style={{ color: '#ff4757', fontWeight: 700, fontSize: '.75rem' }}>{od} day{od !== 1 ? 's' : ''} overdue</span>
          : <span style={{ fontSize: '.7rem', color: '#4a4a60' }}>{total} item{total !== 1 ? 's' : ''}</span>
        }
        {confirming ? (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }} onClick={e => e.stopPropagation()}>
            <span style={{ fontSize: '.7rem', color: '#ff4757' }}>Delete?</span>
            <button
              className="danger-btn"
              style={{ padding: '2px 8px', fontSize: '.7rem', borderRadius: 6 }}
              disabled={deleting}
              onClick={async () => { setDeleting(true); await onDelete() }}
            >
              {deleting ? '…' : 'Yes'}
            </button>
            <button
              className="secondary-btn"
              style={{ padding: '2px 8px', fontSize: '.7rem', borderRadius: 6 }}
              onClick={() => setConfirming(false)}
            >
              No
            </button>
          </div>
        ) : (
          <button
            title="Delete project"
            onClick={e => { e.stopPropagation(); setConfirming(true) }}
            style={{ background: 'none', border: 'none', color: '#6a6a80', cursor: 'pointer', padding: 4, display: 'flex' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#ff4757')}
            onMouseLeave={e => (e.currentTarget.style.color = '#6a6a80')}
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </div>
  )
}

// ── Create Project Form ────────────────────────────────────────────────────────

function CreateProjectForm({
  onBack,
  onCreate,
  fromBooking,
}: {
  onBack: () => void
  onCreate: (id: string) => void
  fromBooking?: EquipmentBookingDoc | null
}) {
  const { profile } = useAuth()
  const [name, setName] = useState(fromBooking?.projectName ?? '')
  const [checkoutDate, setCheckoutDate] = useState(fromBooking?.checkoutDate || today())
  const [returnDate, setReturnDate] = useState(fromBooking?.returnDate ?? '')
  const [borrowers, setBorrowers] = useState<string[]>(fromBooking?.studentName ? [fromBooking.studentName] : [])
  const [borrowerInput, setBorrowerInput] = useState('')
  const [manager, setManager] = useState(profile?.displayName ?? '')
  const [managerId, setManagerId] = useState(profile?.uid ?? '')
  const [students, setStudents] = useState<UserDoc[]>([])
  const [teachers, setTeachers] = useState<UserDoc[]>([])
  const [submitting, setSubmitting] = useState(false)

  const { data: presets } = useCollection<InventoryPresetDoc>('inventory_presets')
  const sortedPresets = useMemo(() => [...presets].sort((a, b) => a.name.localeCompare(b.name)), [presets])
  const [selectedPresetId, setSelectedPresetId] = useState('')
  const [presetItems, setPresetItems] = useState<InventoryPresetItem[]>(
    fromBooking?.items?.map(i => ({ ...i })) ?? [],
  )

  useEffect(() => {
    async function load() {
      const sq = await getDocs(query(collection(db, 'users'), where('roles', 'array-contains', 'student')))
      setStudents(
        sq.docs
          .map(d => ({ id: d.id, ...d.data() } as UserDoc))
          .sort((a, b) => (a.displayName ?? '').localeCompare(b.displayName ?? '')),
      )
      const tq = await getDocs(query(collection(db, 'users'), where('role', 'in', ['teacher', 'admin'])))
      setTeachers(tq.docs.map(d => ({ id: d.id, ...d.data() } as UserDoc)))
    }
    load()
  }, [])

  function addBorrower(n: string) {
    if (n.trim() && !borrowers.includes(n.trim())) {
      setBorrowers(prev => [...prev, n.trim()])
    }
    setBorrowerInput('')
  }

  function removeBorrower(n: string) {
    setBorrowers(prev => prev.filter(b => b !== n))
  }

  function applyPreset(presetId: string) {
    setSelectedPresetId(presetId)
    const preset = presets.find(p => p.id === presetId)
    if (!preset) { setPresetItems([]); return }
    setPresetItems(preset.items.map(i => ({ ...i })))
    if (!name.trim() || presets.some(p => p.name === name)) setName(preset.name)
  }

  function presetItemQty(equipmentId: string, delta: number) {
    setPresetItems(prev => prev
      .map(i => i.equipmentId === equipmentId ? { ...i, quantity: i.quantity + delta } : i)
      .filter(i => i.quantity > 0))
  }

  function removePresetItem(equipmentId: string) {
    setPresetItems(prev => prev.filter(i => i.equipmentId !== equipmentId))
  }

  async function handleCreate() {
    if (!name || !returnDate) return
    setSubmitting(true)
    try {
      const ref = await addDoc(collection(db, 'inventory_projects'), {
        name,
        borrowers,
        borrowerIds: students.filter(s => borrowers.includes(s.displayName)).map(s => s.id),
        equipmentManagerId: managerId,
        equipmentManagerName: manager,
        cohortId: profile?.cohortId ?? '',
        checkoutDate,
        returnDate,
        status: 'active',
        ...(fromBooking ? { bookingId: fromBooking.id } : {}),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      const checkoutTimestamp = new Date().toISOString()
      const assignedTo = borrowers[0] ?? ''
      for (const item of presetItems) {
        for (let i = 0; i < item.quantity; i++) {
          await addDoc(collection(db, `inventory_projects/${ref.id}/items`), {
            equipmentId: item.equipmentId,
            equipmentName: item.equipmentName,
            checkoutTimestamp,
            checkinTimestamp: '',
            status: 'checked-out',
            damageNotes: '',
            assignedTo,
          })
        }
        if (item.equipmentId && item.quantity > 0) {
          await updateDoc(doc(db, 'equipment', item.equipmentId), { available: increment(-item.quantity) })
        }
      }
      if (fromBooking) {
        await updateDoc(doc(db, 'equipment_bookings', fromBooking.id), {
          status: 'checked-out',
          linkedProjectId: ref.id,
        })
      }
      onCreate(ref.id)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="inv-form-page">
      <button className="back-btn" onClick={onBack}>← Back</button>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#f0f0f5', marginBottom: '1.5rem' }}>Create New Project</h2>

      {fromBooking && (
        <div style={{ background: 'rgba(76,217,100,.08)', border: '1px solid rgba(76,217,100,.25)', borderRadius: 10, padding: '10px 14px', marginBottom: '1.25rem', fontSize: '.85rem', color: '#c0c0d5' }}>
          Setting up from <strong style={{ color: '#4cd964' }}>{fromBooking.studentName}</strong>'s accepted booking request. Project name, dates and equipment have been preloaded below — fill in the rest to finish checkout.
        </div>
      )}

      <div className="inv-form">
        {sortedPresets.length > 0 && (
          <div className="form-group">
            <label>Start from Project Preset (optional)</label>
            <select
              className="form-select"
              value={selectedPresetId}
              onChange={e => applyPreset(e.target.value)}
            >
              <option value="">No preset — custom project</option>
              {sortedPresets.map(p => (
                <option key={p.id} value={p.id}>{p.name} ({p.items.length} item{p.items.length === 1 ? '' : 's'})</option>
              ))}
            </select>
          </div>
        )}

        <div className="form-group">
          <label>Project Name</label>
          <input type="text" className="form-input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Group A - Short Film" />
        </div>

        {presetItems.length > 0 && (
          <div className="form-group">
            <label>Preset Equipment ({presetItems.reduce((sum, i) => sum + i.quantity, 0)} items)</label>
            <div className="project-items-list">
              {presetItems.map(i => (
                <div key={i.equipmentId} className="project-item-row">
                  <span className="project-item-name">{i.equipmentName}</span>
                  <div className="qty-selector">
                    <button type="button" className="day-btn" onClick={() => presetItemQty(i.equipmentId, -1)}><Minus size={12} /></button>
                    <span className="day-count">{i.quantity}</span>
                    <button type="button" className="day-btn" onClick={() => presetItemQty(i.equipmentId, 1)}><Plus size={12} /></button>
                  </div>
                  <button type="button" className="item-remove-btn" onClick={() => removePresetItem(i.equipmentId)}><X size={14} /></button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="form-group">
          <label>Borrowers</label>
          <div className="borrower-chips">
            {borrowers.map(b => (
              <span className="borrower-chip" key={b}>
                {b}
                <button className="borrower-chip-x" onClick={() => removeBorrower(b)}><X size={12} /></button>
              </span>
            ))}
          </div>
          {students.length > 0 && (
            <select
              className="form-select borrower-dropdown"
              onChange={e => { if (e.target.value) addBorrower(e.target.value); e.target.value = '' }}
            >
              <option value="">Select student...</option>
              {students.map(s => (
                <option key={s.id} value={s.displayName}>{s.displayName}</option>
              ))}
            </select>
          )}
          <div className="borrower-manual-row">
            <input
              type="text"
              className="form-input"
              placeholder="Or type name and press Enter"
              value={borrowerInput}
              onChange={e => setBorrowerInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addBorrower(borrowerInput) }}
            />
            <button className="manual-add-btn" onClick={() => addBorrower(borrowerInput)}>Add</button>
          </div>
        </div>

        <div className="form-group">
          <label>Equipment Manager</label>
          <select
            className="form-select"
            value={managerId}
            onChange={e => {
              setManagerId(e.target.value)
              const t = teachers.find(t => t.id === e.target.value)
              if (t) setManager(t.displayName)
            }}
          >
            {teachers.map(t => (
              <option key={t.id} value={t.id}>{t.displayName}</option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label>Checkout Date</label>
          <input type="date" className="form-input" value={checkoutDate} onChange={e => setCheckoutDate(e.target.value)} />
        </div>

        <div className="form-group">
          <label>Return Date</label>
          <input type="date" className="form-input" value={returnDate} onChange={e => setReturnDate(e.target.value)} />
        </div>

        <button
          className="primary-btn"
          disabled={submitting || !name || !returnDate}
          onClick={handleCreate}
        >
          {submitting ? 'Creating...' : 'Create Project'}
        </button>
      </div>
    </div>
  )
}

// ── Project Presets ─────────────────────────────────────────────────────────────

function PresetsManager() {
  const { data: presets } = useCollection<InventoryPresetDoc>('inventory_presets')
  const sorted = useMemo(() => [...presets].sort((a, b) => a.name.localeCompare(b.name)), [presets])

  const [editingId, setEditingId] = useState<string | null>(null) // 'new' or a preset id
  const [name, setName] = useState('')
  const [items, setItems] = useState<InventoryPresetItem[]>([])
  const [showPicker, setShowPicker] = useState(false)
  const [saving, setSaving] = useState(false)

  function startNew() {
    setEditingId('new')
    setName('')
    setItems([])
  }

  function startEdit(p: InventoryPresetDoc) {
    setEditingId(p.id)
    setName(p.name)
    setItems(p.items.map(i => ({ ...i })))
  }

  function cancelEdit() {
    setEditingId(null)
    setName('')
    setItems([])
  }

  function addPickedItem(item: { id: string; name: string }) {
    setItems(prev => {
      const existing = prev.find(i => i.equipmentId === item.id)
      if (existing) {
        return prev.map(i => i.equipmentId === item.id ? { ...i, quantity: i.quantity + 1 } : i)
      }
      return [...prev, { equipmentId: item.id, equipmentName: item.name, quantity: 1 }]
    })
  }

  function updateQty(equipmentId: string, delta: number) {
    setItems(prev => prev
      .map(i => i.equipmentId === equipmentId ? { ...i, quantity: i.quantity + delta } : i)
      .filter(i => i.quantity > 0))
  }

  function removeItem(equipmentId: string) {
    setItems(prev => prev.filter(i => i.equipmentId !== equipmentId))
  }

  async function save() {
    if (!name.trim() || items.length === 0) return
    setSaving(true)
    try {
      if (editingId && editingId !== 'new') {
        await updateDoc(doc(db, 'inventory_presets', editingId), {
          name: name.trim(),
          items,
          updatedAt: serverTimestamp(),
        })
      } else {
        await addDoc(collection(db, 'inventory_presets'), {
          name: name.trim(),
          items,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      }
      cancelEdit()
    } finally {
      setSaving(false)
    }
  }

  async function removePreset(id: string) {
    await deleteDoc(doc(db, 'inventory_presets', id))
    if (editingId === id) cancelEdit()
  }

  const isEditing = editingId !== null

  return (
    <div className="inv-section">
      <div className="inv-section-title" style={{ justifyContent: 'space-between' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
          <ClipboardList size={18} /> Project Presets
        </span>
        {!isEditing && (
          <button className="primary-btn" onClick={startNew}>
            <Plus size={16} /> New Preset
          </button>
        )}
      </div>

      {isEditing && (
        <div className="inv-form" style={{ maxWidth: 600, marginBottom: '1.5rem' }}>
          {showPicker && (
            <EquipmentPicker
              onClose={() => setShowPicker(false)}
              onPick={item => { setShowPicker(false); addPickedItem(item) }}
              pickedCounts={Object.fromEntries(items.map(i => [i.equipmentId, i.quantity]))}
            />
          )}
          <div className="form-group">
            <label>Preset Name</label>
            <input
              type="text"
              className="form-input"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Sound Assignment"
            />
          </div>

          <div className="form-group">
            <label>Equipment ({items.reduce((sum, i) => sum + i.quantity, 0)} items)</label>
            {items.length > 0 && (
              <div className="project-items-list" style={{ marginBottom: '.5rem' }}>
                {items.map(i => (
                  <div key={i.equipmentId} className="project-item-row">
                    <span className="project-item-name">{i.equipmentName}</span>
                    <div className="qty-selector">
                      <button type="button" className="day-btn" onClick={() => updateQty(i.equipmentId, -1)}><Minus size={12} /></button>
                      <span className="day-count">{i.quantity}</span>
                      <button type="button" className="day-btn" onClick={() => updateQty(i.equipmentId, 1)}><Plus size={12} /></button>
                    </div>
                    <button type="button" className="item-remove-btn" onClick={() => removeItem(i.equipmentId)}><X size={14} /></button>
                  </div>
                ))}
              </div>
            )}
            <button type="button" className="equip-picker-open-btn" onClick={() => setShowPicker(true)}>
              <Plus size={16} /> Add Equipment
            </button>
          </div>

          <div className="checkout-buttons">
            <button className="secondary-btn" onClick={cancelEdit}>Cancel</button>
            <button
              className="primary-btn"
              disabled={saving || !name.trim() || items.length === 0}
              onClick={save}
            >
              {saving ? 'Saving...' : 'Save Preset'}
            </button>
          </div>
        </div>
      )}

      {sorted.length === 0 ? (
        <div className="inv-empty">No presets yet. Create one to speed up project setup.</div>
      ) : (
        <div className="project-grid">
          {sorted.map(p => (
            <div key={p.id} className="project-card" style={{ cursor: 'default' }}>
              <div className="project-card-header">
                <ClipboardList size={16} />
                <span style={{ fontWeight: 600 }}>{p.name}</span>
                <div className="project-card-badges">
                  <button className="item-damage-toggle-btn" onClick={() => startEdit(p)} title="Edit"><Pencil size={14} /></button>
                  <button className="item-remove-btn" onClick={() => removePreset(p.id)} title="Delete"><Trash2 size={14} /></button>
                </div>
              </div>
              <div className="project-card-meta">
                {p.items.map(i => (
                  <div key={i.equipmentId} className="project-card-meta-item">
                    <Package size={14} /> {i.equipmentName}{i.quantity > 1 ? ` ×${i.quantity}` : ''}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── useAllItems: collectionGroup query across all projects ────────────────────

function useAllItems() {
  const [items, setItems] = useState<(InventoryItemDoc & { projectId: string })[]>([])
  useEffect(() => {
    const unsub = onSnapshot(collectionGroup(db, 'items'), snap => {
      setItems(snap.docs.map(d => {
        const projectId = d.ref.parent.parent?.id ?? ''
        return { id: d.id, projectId, ...d.data() } as InventoryItemDoc & { projectId: string }
      }))
    })
    return unsub
  }, [])
  return items
}

// ── Main InventoryPage ─────────────────────────────────────────────────────────

export default function InventoryPage() {
  const { data: projects } = useCollection<InventoryProjectDoc>('inventory_projects')
  const { data: equipment } = useCollection<EquipmentDoc>('equipment')
  const allItems = useAllItems()

  const [tab, setTab] = useState<InvTab>('dashboard')
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [createProject, setCreateProject] = useState(false)
  const [archivedOpen, setArchivedOpen] = useState(false)

  // Handoff from an accepted equipment booking (see AdminEquipmentPage's Bookings tab)
  const [searchParams, setSearchParams] = useSearchParams()
  const [fromBooking, setFromBooking] = useState<EquipmentBookingDoc | null>(null)
  useEffect(() => {
    const bookingId = searchParams.get('fromBooking')
    const openProjectId = searchParams.get('openProject')
    if (bookingId) {
      getDoc(doc(db, 'equipment_bookings', bookingId)).then(snap => {
        if (snap.exists()) {
          setFromBooking({ id: snap.id, ...snap.data() } as EquipmentBookingDoc)
          setCreateProject(true)
        }
      })
    } else if (openProjectId) {
      setSelectedProjectId(openProjectId)
    }
    if (bookingId || openProjectId) {
      setSearchParams(prev => { prev.delete('fromBooking'); prev.delete('openProject'); return prev }, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const activeProjects = useMemo(
    () => projects.filter(p => ['active', 'checked-out'].includes(p.status))
      .sort((a, b) => (b.createdAt as any)?.seconds - (a.createdAt as any)?.seconds || 0),
    [projects],
  )
  const archivedProjects = useMemo(
    () => projects.filter(p => ['returned', 'archived'].includes(p.status))
      .sort((a, b) => (b.createdAt as any)?.seconds - (a.createdAt as any)?.seconds || 0),
    [projects],
  )
  const overdueProjects = activeProjects.filter(p => isOverdue(p.returnDate))

  // Items belonging to active projects only
  const activeProjectIds = useMemo(() => new Set(activeProjects.map(p => p.id)), [activeProjects])
  const activeItems = useMemo(() => allItems.filter(i => activeProjectIds.has(i.projectId)), [allItems, activeProjectIds])

  // Aggregate stats
  const stats = useMemo(() => ({
    itemsOut:     activeItems.filter(i => i.status === 'checked-out').length,
    returned:     activeItems.filter(i => i.status === 'returned').length,
    missing:      allItems.filter(i => i.status === 'missing').length,
    damaged:      allItems.filter(i => i.status === 'damaged').length,
    overdue:      overdueProjects.length,
  }), [activeItems, allItems, overdueProjects])

  async function updateProject(id: string, data: Partial<InventoryProjectDoc>) {
    await updateDoc(doc(db, 'inventory_projects', id), { ...data, updatedAt: serverTimestamp() })
  }

  async function deleteProjectFully(id: string) {
    const itemsSnap = await getDocs(collection(db, `inventory_projects/${id}/items`))
    await Promise.all(itemsSnap.docs.map(d => deleteDoc(d.ref)))
    await deleteDoc(doc(db, 'inventory_projects', id))
    if (selectedProjectId === id) setSelectedProjectId(null)
  }

  const selectedProject = selectedProjectId ? projects.find(p => p.id === selectedProjectId) : null

  if (createProject) {
    return (
      <div className="molkom-app" style={{ background: '#0a0a0f', minHeight: '100vh', padding: '1.5rem' }}>
        <CreateProjectForm
          fromBooking={fromBooking}
          onBack={() => { setCreateProject(false); setFromBooking(null) }}
          onCreate={id => { setCreateProject(false); setFromBooking(null); setSelectedProjectId(id) }}
        />
      </div>
    )
  }

  if (selectedProject) {
    return (
      <div className="molkom-app" style={{ background: '#0a0a0f', minHeight: '100vh', padding: '1.5rem' }}>
        <ProjectDetail
          project={selectedProject}
          onBack={() => setSelectedProjectId(null)}
          onUpdate={(data) => updateProject(selectedProject.id, data)}
          onDelete={() => deleteProjectFully(selectedProject.id)}
        />
      </div>
    )
  }

  return (
    <div className="molkom-app" style={{ background: '#0a0a0f', minHeight: '100vh' }}>
      <div className="inv-page">
        {/* Page title + new project button */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <div className="inv-page-title">
            <ArchiveRestore size={22} color="#4cd964" />
            Inventory
          </div>
          <button className="primary-btn" onClick={() => setCreateProject(true)}>
            <Plus size={16} /> New Project
          </button>
        </div>

        {/* Tabs */}
        <div className="inv-tabs">
          {([
            ['dashboard', 'Dashboard'],
            ['all-projects', 'All Projects'],
            ['statistics', 'Statistics'],
            ['presets', 'Project Presets'],
          ] as [InvTab, string][]).map(([id, label]) => (
            <button
              key={id}
              className={`inv-tab${tab === id ? ' active' : ''}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Dashboard tab */}
        {tab === 'dashboard' && (
          <>
            <div className="inv-stats-row">
              <div className="inv-stat-card">
                <Package size={20} />
                <div>
                  <span className="inv-stat-value">{activeProjects.length}</span>
                  <span className="inv-stat-label">Active Projects</span>
                </div>
              </div>
              <div className="inv-stat-card">
                <Layers size={20} />
                <div>
                  <span className="inv-stat-value">{stats.itemsOut}</span>
                  <span className="inv-stat-label">Items Out</span>
                </div>
              </div>
              <div className="inv-stat-card">
                <Check size={20} />
                <div>
                  <span className="inv-stat-value">{stats.returned}</span>
                  <span className="inv-stat-label">Returned</span>
                </div>
              </div>
              <div className={`inv-stat-card${stats.overdue > 0 ? ' warning' : ''}`}>
                <Clock size={20} />
                <div>
                  <span className="inv-stat-value">{stats.overdue}</span>
                  <span className="inv-stat-label">Overdue</span>
                </div>
              </div>
              <div className={`inv-stat-card${stats.missing > 0 ? ' danger' : ''}`}>
                <AlertTriangle size={20} />
                <div>
                  <span className="inv-stat-value">{stats.missing}</span>
                  <span className="inv-stat-label">Missing</span>
                </div>
              </div>
              <div className={`inv-stat-card${stats.damaged > 0 ? ' warning' : ''}`}>
                <AlertTriangle size={20} />
                <div>
                  <span className="inv-stat-value">{stats.damaged}</span>
                  <span className="inv-stat-label">Damaged</span>
                </div>
              </div>
            </div>

            <div className="inv-section">
              <div className="inv-section-title"><Package size={18} /> Active Projects</div>
              {activeProjects.length === 0 ? (
                <div className="inv-empty">No active projects</div>
              ) : (
                <div className="project-grid">
                  {activeProjects.map(p => {
                    const pItems = allItems.filter(i => i.projectId === p.id)
                    return <ProjectCard key={p.id} project={p} items={pItems} onClick={() => setSelectedProjectId(p.id)} onDelete={() => deleteProjectFully(p.id)} />
                  })}
                </div>
              )}
            </div>

            {archivedProjects.length > 0 && (
              <div className="inv-section">
                <button className="inv-section-toggle" onClick={() => setArchivedOpen(!archivedOpen)}>
                  {archivedOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  Archived / Returned ({archivedProjects.length})
                </button>
                {archivedOpen && (
                  <div className="project-grid">
                    {archivedProjects.map(p => {
                      const pItems = allItems.filter(i => i.projectId === p.id)
                      return <ProjectCard key={p.id} project={p} items={pItems} onClick={() => setSelectedProjectId(p.id)} onDelete={() => deleteProjectFully(p.id)} />
                    })}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* All Projects tab */}
        {tab === 'all-projects' && (
          <div className="inv-section">
            <div className="inv-section-title"><Layers size={18} /> All Projects</div>
            {projects.length === 0 ? (
              <div className="inv-empty">No projects yet</div>
            ) : (
              <div className="project-grid">
                {[...projects]
                  .sort((a, b) => (b.createdAt as any)?.seconds - (a.createdAt as any)?.seconds || 0)
                  .map(p => {
                    const pItems = allItems.filter(i => i.projectId === p.id)
                    return <ProjectCard key={p.id} project={p} items={pItems} onClick={() => setSelectedProjectId(p.id)} onDelete={() => deleteProjectFully(p.id)} />
                  })}
              </div>
            )}
          </div>
        )}

        {/* Statistics tab */}
        {tab === 'statistics' && <StatsContent equipment={equipment} projects={projects} allItems={allItems} onOpenProject={setSelectedProjectId} />}

        {/* Presets tab */}
        {tab === 'presets' && <PresetsManager />}
      </div>
    </div>
  )
}
