import { useState } from 'react'
import { Link } from 'react-router-dom'
import { doc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useCollection } from '@/hooks/useFirestore'
import type { SchoolDoc, SchoolStatus, SchoolTier, UserDoc, ProductionDoc, EquipmentDoc } from '@/types'
import type { ProductType } from '@/lib/features'
import { format } from 'date-fns'
import {
  Building2, Users, Clapperboard, Boxes, Plus, X, ChevronDown, ChevronUp,
  ExternalLink, CheckCircle2, Loader2, AlertCircle,
} from 'lucide-react'

const SUPER_ADMIN_EMAILS = ['fredrik.fridlund@gmail.com']

// ── Helpers ───────────────────────────────────────────────────────────────────

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32)
}

function fmtDate(ts: any) {
  try { return format(ts.toDate(), 'MMM d, yyyy') } catch { return '—' }
}

function fmtBytes(b: number): string {
  if (b >= 1e9) return `${(b / 1e9).toFixed(1)} GB`
  if (b >= 1e6) return `${(b / 1e6).toFixed(0)} MB`
  return `${Math.round(b / 1024)} KB`
}

const STATUS_PILL: Record<SchoolStatus, string> = {
  active:    'bg-emerald-900/50 text-emerald-400 border border-emerald-800/50',
  trial:     'bg-amber-900/50 text-amber-400 border border-amber-800/50',
  suspended: 'bg-rose-900/50 text-rose-400 border border-rose-800/50',
}

const TIER_PILL: Record<SchoolTier, string> = {
  studio:  'bg-violet-900/50 text-violet-400 border border-violet-800/50',
  academy: 'bg-sky-900/50 text-sky-400 border border-sky-800/50',
  campus:  'bg-orange-900/50 text-orange-400 border border-orange-800/50',
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ icon, label, value, color }: {
  icon: React.ReactNode; label: string; value: number; color: string
}) {
  return (
    <div className="bg-zinc-900 border border-white/10 rounded-2xl p-5 flex items-center gap-4">
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${color}`}>
        {icon}
      </div>
      <div>
        <p className="text-2xl font-bold text-zinc-100 leading-none">{value}</p>
        <p className="text-xs text-zinc-500 mt-1">{label}</p>
      </div>
    </div>
  )
}

// ── School row (expandable) ───────────────────────────────────────────────────

function SchoolRow({ school }: { school: SchoolDoc }) {
  const [open,      setOpen]      = useState(false)
  const [saving,    setSaving]    = useState(false)
  const [saved,     setSaved]     = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  // Local optimistic state — keeps UI responsive; reverts to prop if save fails
  const [localTier,        setLocalTier]        = useState<SchoolTier | null>(null)
  const [localStatus,      setLocalStatus]      = useState<SchoolStatus | null>(null)
  const [localProductType, setLocalProductType] = useState<ProductType | null>(null)

  async function patch(field: string, value: unknown) {
    setSaving(true)
    setSaved(false)
    setSaveError(null)
    try {
      await updateDoc(doc(db, 'schools', school.id), { [field]: value })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err: any) {
      setSaveError(err?.message ?? 'Save failed — check Firestore permissions.')
      // Revert optimistic state
      setLocalTier(null)
      setLocalStatus(null)
    } finally {
      setSaving(false)
    }
  }

  const status      = localStatus      ?? school.status      ?? 'trial'
  const tier        = localTier        ?? school.tier        ?? 'studio'
  const productType = localProductType ?? (school as any).productType ?? 'education'

  return (
    <>
      <tr
        className="border-b border-white/5 hover:bg-white/[0.03] transition-colors cursor-pointer select-none"
        onClick={() => setOpen(o => !o)}
      >
        <td className="px-5 py-4">
          <p className="text-sm font-semibold text-zinc-100">{school.name || '—'}</p>
          <p className="text-xs text-zinc-500 font-mono mt-0.5">{school.id}</p>
        </td>
        <td className="px-4 py-4">
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${STATUS_PILL[status] ?? 'bg-zinc-800 text-zinc-400 border border-zinc-700'}`}>
            {status}
          </span>
        </td>
        <td className="px-4 py-4">
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${TIER_PILL[tier] ?? 'bg-zinc-800 text-zinc-400 border border-zinc-700'}`}>
            {tier}
          </span>
        </td>
        <td className="px-4 py-4 hidden sm:table-cell">
          {school.isBeta
            ? <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-orange-900/50 text-orange-400 border border-orange-800/50">Beta</span>
            : <span className="text-xs text-zinc-600">—</span>}
        </td>
        <td className="px-4 py-4 hidden md:table-cell">
          <span className="text-xs text-zinc-400">{school.onboardingDate ? fmtDate(school.onboardingDate) : '—'}</span>
        </td>
        <td className="px-4 py-4 text-right pr-5">
          {open
            ? <ChevronUp   className="w-4 h-4 text-zinc-400 inline" />
            : <ChevronDown className="w-4 h-4 text-zinc-400 inline" />}
        </td>
      </tr>

      {open && (
        <tr className="border-b border-white/5 bg-zinc-950/60">
          <td colSpan={6} className="px-5 py-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">

              {/* Edit fields */}
              <div className="space-y-4">
                <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Edit</p>

                <div>
                  <label className="label">Status</label>
                  <select
                    value={status}
                    onChange={e => { setLocalStatus(e.target.value as SchoolStatus); patch('status', e.target.value) }}
                    className="input w-full"
                    onClick={e => e.stopPropagation()}
                  >
                    <option value="active">Active</option>
                    <option value="trial">Trial</option>
                    <option value="suspended">Suspended</option>
                  </select>
                </div>

                <div>
                  <label className="label">Tier</label>
                  <select
                    value={tier}
                    onChange={e => { setLocalTier(e.target.value as SchoolTier); patch('tier', e.target.value) }}
                    className="input w-full"
                    onClick={e => e.stopPropagation()}
                  >
                    <option value="studio">Studio</option>
                    <option value="academy">Academy</option>
                    <option value="campus">Campus</option>
                  </select>
                </div>

                <div className="flex items-center justify-between">
                  <span className="label mb-0">Beta access</span>
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); patch('isBeta', !school.isBeta) }}
                    className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 ${school.isBeta ? 'bg-brand-500' : 'bg-zinc-700'}`}
                  >
                    <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${school.isBeta ? 'translate-x-5' : 'translate-x-1'}`} />
                  </button>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <span className="label mb-0">CineRental</span>
                    <p className="text-xs text-zinc-500 mt-0.5">Rental platform mode</p>
                  </div>
                  <button
                    type="button"
                    onClick={e => {
                      e.stopPropagation()
                      const next: ProductType = productType === 'rental' ? 'education' : 'rental'
                      setLocalProductType(next)
                      patch('productType', next)
                    }}
                    className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 ${productType === 'rental' ? 'bg-brand-500' : 'bg-zinc-700'}`}
                  >
                    <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${productType === 'rental' ? 'translate-x-5' : 'translate-x-1'}`} />
                  </button>
                </div>

                <div>
                  <label className="label">Storage limit (GB)</label>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    defaultValue={school.storageQuotaGB ?? ''}
                    placeholder="Unlimited"
                    className="input w-full"
                    onClick={e => e.stopPropagation()}
                    onBlur={e => {
                      const val = e.target.value === '' ? null : Number(e.target.value)
                      patch('storageQuotaGB', val)
                    }}
                  />
                  <p className="text-xs text-zinc-500 mt-1">Leave blank for unlimited</p>
                </div>

                <div>
                  <label className="label">Room display URL</label>
                  <input
                    type="url"
                    defaultValue={school.roomDisplayUrl ?? ''}
                    placeholder={`${window.location.origin}/room-display`}
                    className="input w-full font-mono text-xs"
                    onClick={e => e.stopPropagation()}
                    onBlur={e => {
                      const val = e.target.value.trim() || null
                      patch('roomDisplayUrl', val)
                    }}
                  />
                  <p className="text-xs text-zinc-500 mt-1">Override the default room display URL</p>
                </div>

                <div className="min-h-5 flex items-center">
                  {saving    && <p className="text-xs text-amber-400 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Saving…</p>}
                  {saved     && <p className="text-xs text-emerald-400 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Saved</p>}
                  {saveError && <p className="text-xs text-rose-400 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> {saveError}</p>}
                </div>
              </div>

              {/* Details */}
              <div className="space-y-3">
                <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Details</p>
                <dl className="space-y-2.5">
                  {[
                    { label: 'Contact',        value: school.contactEmail ?? '—' },
                    { label: 'Onboarded',      value: school.onboardingDate ? fmtDate(school.onboardingDate) : '—' },
                    { label: 'Max students',   value: String(school.maxStudents ?? '—') },
                    { label: 'Sub. status',    value: school.subscriptionStatus ?? '—' },
                    { label: 'Storage used',   value: school.storageUsedBytes ? fmtBytes(school.storageUsedBytes) + (school.storageQuotaGB ? ` / ${school.storageQuotaGB} GB` : '') : '—' },
                  ].map(({ label, value }) => (
                    <div key={label}>
                      <dt className="text-xs text-zinc-500">{label}</dt>
                      <dd className="text-sm text-zinc-300">{value}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              {/* Admin links */}
              <div className="space-y-3">
                <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                  Manage <span className="normal-case font-normal text-zinc-600">(global data — single-tenant today)</span>
                </p>
                <div className="space-y-1.5">
                  {[
                    { to: '/admin/users',     label: 'Users' },
                    { to: '/admin/cohorts',   label: 'Cohorts' },
                    { to: '/admin/equipment', label: 'Equipment' },
                    { to: '/admin/inventory', label: 'Inventory' },
                    { to: '/admin/bookings',  label: 'Bookings' },
                    { to: '/admin/school-info', label: 'School settings' },
                  ].map(({ to, label }) => (
                    <Link
                      key={to}
                      to={to}
                      className="flex items-center gap-1.5 text-sm text-brand-400 hover:text-brand-300 transition-colors"
                      onClick={e => e.stopPropagation()}
                    >
                      <ExternalLink className="w-3.5 h-3.5 flex-shrink-0" /> {label}
                    </Link>
                  ))}
                </div>
              </div>

            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ── Add School form ───────────────────────────────────────────────────────────

interface AddForm {
  schoolId:     string
  name:         string
  contactEmail: string
  tier:         SchoolTier
}
const EMPTY_FORM: AddForm = { schoolId: '', name: '', contactEmail: '', tier: 'studio' }

function AddSchoolForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [form,        setForm]        = useState<AddForm>({ ...EMPTY_FORM })
  const [idEdited,    setIdEdited]    = useState(false)
  const [saving,      setSaving]      = useState(false)
  const [saveError,   setSaveError]   = useState<string | null>(null)

  function handleName(name: string) {
    setForm(f => ({ ...f, name, ...(!idEdited ? { schoolId: slugify(name) } : {}) }))
  }

  function handleId(raw: string) {
    setIdEdited(true)
    setForm(f => ({ ...f, schoolId: slugify(raw) }))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim() || !form.schoolId.trim()) return
    setSaving(true)
    setSaveError(null)
    try {
      await setDoc(doc(db, 'schools', form.schoolId), {
        schoolId:           form.schoolId,
        name:               form.name.trim(),
        contactEmail:       form.contactEmail.trim() || null,
        tier:               form.tier,
        status:             'trial' as SchoolStatus,
        isBeta:             true,
        onboardingDate:     serverTimestamp(),
        features:           {},
        maxStudents:        100,
        subscriptionStatus: 'free',
      })
      onDone()
    } catch (err: any) {
      setSaveError(err?.message ?? 'Failed to create school.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-zinc-900 border border-white/10 rounded-2xl p-5 space-y-4">
      <div className="flex items-start gap-3 bg-amber-950/30 border border-amber-800/40 rounded-xl p-3">
        <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-amber-300 leading-relaxed">
          Registering a school here does not yet isolate its data — full multi-tenancy data migration is a separate future step.
        </p>
      </div>

      <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="label">School name *</label>
          <input
            value={form.name}
            onChange={e => handleName(e.target.value)}
            className="input w-full"
            placeholder="e.g. Molkom Gymnasium"
            autoFocus
          />
        </div>
        <div>
          <label className="label">School ID *</label>
          <input
            value={form.schoolId}
            onChange={e => handleId(e.target.value)}
            className="input w-full font-mono"
            placeholder="e.g. molkom"
          />
          <p className="text-xs text-zinc-500 mt-1">Lowercase, letters/numbers/hyphens only. Permanent.</p>
        </div>
        <div>
          <label className="label">Contact email</label>
          <input
            type="email"
            value={form.contactEmail}
            onChange={e => setForm(f => ({ ...f, contactEmail: e.target.value }))}
            className="input w-full"
            placeholder="admin@school.se"
          />
        </div>
        <div>
          <label className="label">Tier</label>
          <select
            value={form.tier}
            onChange={e => setForm(f => ({ ...f, tier: e.target.value as SchoolTier }))}
            className="input w-full"
          >
            <option value="studio">Studio</option>
            <option value="academy">Academy</option>
            <option value="campus">Campus</option>
          </select>
        </div>

        {saveError && (
          <p className="col-span-full text-sm text-rose-400 bg-rose-950/30 border border-rose-800/40 rounded-xl px-3 py-2">
            {saveError}
          </p>
        )}

        <div className="col-span-full flex gap-2 pt-1">
          <button
            type="submit"
            disabled={saving || !form.name.trim() || !form.schoolId.trim()}
            className="btn-primary py-2 px-5 disabled:opacity-50"
          >
            {saving ? 'Creating…' : 'Create School'}
          </button>
          <button type="button" onClick={onCancel} className="btn-secondary py-2 px-4">Cancel</button>
        </div>
      </form>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SuperAdmin() {
  const { profile } = useAuth()
  const [showForm,  setShowForm]  = useState(false)
  const [createdMsg, setCreatedMsg] = useState(false)

  const isSuperAdmin = !!profile?.email && SUPER_ADMIN_EMAILS.includes(profile.email)

  const { data: schools,     loading: schoolsLoading } = useCollection<SchoolDoc>('schools',     [], isSuperAdmin)
  const { data: users }                                 = useCollection<UserDoc>('users',         [], isSuperAdmin)
  const { data: productions }                           = useCollection<ProductionDoc>('productions', [], isSuperAdmin)
  const { data: equipment }                             = useCollection<EquipmentDoc>('equipment', [], isSuperAdmin)

  if (!isSuperAdmin) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <p className="text-zinc-400">Access denied.</p>
      </div>
    )
  }

  function handleCreated() {
    setShowForm(false)
    setCreatedMsg(true)
    setTimeout(() => setCreatedMsg(false), 4000)
  }

  return (
    <div className="min-h-screen bg-black text-white p-6 sm:p-10 space-y-8 max-w-6xl mx-auto">

      {/* Header */}
      <div>
        <p className="text-xs font-semibold text-brand-400 uppercase tracking-widest mb-1">Platform</p>
        <h1 className="text-3xl font-bold text-zinc-100">Schools Registry</h1>
        <p className="text-zinc-500 text-sm mt-1">CineForge — multi-tenant platform management</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<Building2    className="w-5 h-5 text-brand-400" />}
          label="Schools registered"
          value={schools.length}
          color="bg-brand-900/50"
        />
        <StatCard
          icon={<Users        className="w-5 h-5 text-sky-400" />}
          label="Total users"
          value={users.length}
          color="bg-sky-900/50"
        />
        <StatCard
          icon={<Clapperboard className="w-5 h-5 text-violet-400" />}
          label="Productions"
          value={productions.length}
          color="bg-violet-900/50"
        />
        <StatCard
          icon={<Boxes        className="w-5 h-5 text-emerald-400" />}
          label="Equipment items"
          value={equipment.length}
          color="bg-emerald-900/50"
        />
      </div>

      {/* Schools section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-zinc-100">Schools</h2>
          <div className="flex items-center gap-3">
            {createdMsg && (
              <span className="text-sm text-emerald-400 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" /> School created
              </span>
            )}
            <button
              onClick={() => setShowForm(s => !s)}
              className="flex items-center gap-2 btn bg-brand-600 text-white hover:bg-brand-500 py-2 text-sm"
            >
              {showForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
              {showForm ? 'Cancel' : 'Add School'}
            </button>
          </div>
        </div>

        {showForm && (
          <AddSchoolForm
            onDone={handleCreated}
            onCancel={() => setShowForm(false)}
          />
        )}

        <div className="bg-zinc-900 border border-white/10 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[580px]">
              <thead>
                <tr className="border-b border-white/8">
                  <th className="text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider px-5 py-3">School</th>
                  <th className="text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider px-4 py-3">Status</th>
                  <th className="text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider px-4 py-3">Tier</th>
                  <th className="text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider px-4 py-3 hidden sm:table-cell">Beta</th>
                  <th className="text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider px-4 py-3 hidden md:table-cell">Onboarded</th>
                  <th className="w-8 px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {schoolsLoading ? (
                  <tr>
                    <td colSpan={6} className="text-center py-12">
                      <Loader2 className="w-5 h-5 animate-spin text-zinc-500 mx-auto" />
                    </td>
                  </tr>
                ) : schools.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-12 text-zinc-500 text-sm">
                      No schools registered yet.
                    </td>
                  </tr>
                ) : (
                  schools.map(s => <SchoolRow key={s.id} school={s} />)
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

    </div>
  )
}
