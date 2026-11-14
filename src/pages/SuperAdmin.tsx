import { useState } from 'react'
import { Link } from 'react-router-dom'
import { doc, updateDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useCollection } from '@/hooks/useFirestore'
import type { SchoolDoc, SchoolStatus, SchoolTier, UserDoc, ProductionDoc, EquipmentDoc } from '@/types'
import { format } from 'date-fns'
import SchoolModulesPanel from '@/pages/superadmin/SchoolModulesPanel'
import DeleteSchoolDialog from '@/pages/superadmin/DeleteSchoolDialog'
import VerifyEmailNotice from '@/pages/superadmin/VerifyEmailNotice'
import CustomerOrders from '@/pages/superadmin/CustomerOrders'
import GoogleSessionGate from '@/pages/superadmin/GoogleSessionGate'
import { SCHOOL_ID } from '@/lib/school'
import { isSuperAdminEmail } from '@/lib/superadmin'
import {
  Building2, Users, Clapperboard, Boxes, ChevronDown, ChevronUp,
  ExternalLink, CheckCircle2, Loader2, AlertCircle, Trash2,
} from 'lucide-react'
import { clickableRow } from '@/lib/a11y'


// ── Helpers ───────────────────────────────────────────────────────────────────

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
  rental:  'bg-teal-900/50 text-teal-400 border border-teal-800/50',
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
  const [deleting,  setDeleting]  = useState(false)
  // Local optimistic state — keeps UI responsive; reverts to prop if save fails
  const [localTier,   setLocalTier]   = useState<SchoolTier | null>(null)
  const [localStatus, setLocalStatus] = useState<SchoolStatus | null>(null)

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

  const status = localStatus ?? school.status ?? 'trial'
  const tier   = localTier   ?? school.tier   ?? 'studio'

  return (
    <>
      <tr {...clickableRow}
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

                <div className="flex items-center justify-between">
                  <span className="label mb-0">Beta access</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={!!school.isBeta}
                    aria-label="Beta access"
                    onClick={e => { e.stopPropagation(); patch('isBeta', !school.isBeta) }}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${school.isBeta ? 'bg-brand-500' : 'bg-zinc-700'}`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${school.isBeta ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
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

            {/* Modules, plan limits and login page profile — saved through updateSchoolModules */}
            <div className="mt-8 pt-6 border-t border-white/10 max-w-3xl">
              <SchoolModulesPanel school={school} />
            </div>

            {/* Danger zone: three confirmations, then deleteSchool */}
            <div className="mt-8 pt-6 border-t border-rose-500/20 max-w-3xl">
              {school.id === SCHOOL_ID ? (
                <p className="text-xs text-zinc-500">
                  This is the school this deployment runs. It can't be deleted here: ending this customer means
                  shutting down the deployment (export on request, then delete the project within 90 days).
                </p>
              ) : (
                <button type="button" onClick={e => { e.stopPropagation(); setDeleting(true) }}
                  className="flex items-center gap-2 text-sm font-semibold text-rose-400 hover:text-rose-300 border border-rose-500/30 rounded-xl px-3 py-2">
                  <Trash2 className="w-4 h-4" aria-hidden="true" /> Delete school…
                </button>
              )}
              {deleting && <DeleteSchoolDialog school={school} onClose={() => setDeleting(false)} />}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SuperAdmin() {
  const { user, profile, loading: authLoading } = useAuth()
  const isSuperAdmin = isSuperAdminEmail(profile?.email)

  // Wait for the profile before deciding: it arrives after sign-in is restored,
  // and judging on the empty profile flashed "Access denied." on every load.
  if (!isSuperAdmin && (authLoading || (user && !profile))) {
    return <div className="min-h-screen bg-black" aria-busy="true" />
  }

  if (!isSuperAdmin) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <p className="text-zinc-400">Access denied.</p>
      </div>
    )
  }

  return <GoogleSessionGate><SuperAdminContent /></GoogleSessionGate>
}

function SuperAdminContent() {

  const { data: schools,     loading: schoolsLoading } = useCollection<SchoolDoc>('schools',     [])
  const { data: users }                                 = useCollection<UserDoc>('users',         [])
  const { data: productions }                           = useCollection<ProductionDoc>('productions', [])
  const { data: equipment }                             = useCollection<EquipmentDoc>('equipment', [])

  return (
    <div className="min-h-screen bg-black text-white p-6 sm:p-10 space-y-8 max-w-6xl mx-auto">

      {/* Header */}
      <div>
        <p className="text-xs font-semibold text-brand-400 uppercase tracking-widest mb-1">Platform</p>
        <h1 className="text-3xl font-bold text-zinc-100">Schools Registry</h1>
        <p className="text-zinc-500 text-sm mt-1">CineForge — multi-tenant platform management</p>
      </div>

      <VerifyEmailNotice />

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

      <CustomerOrders />

      {/* Schools section */}
      <div className="space-y-3">
        <div>
          <h2 className="text-base font-semibold text-zinc-100">Schools</h2>
          <p className="text-xs text-zinc-500">The schools in this installation. New customers come in under Customers and get their own installation.</p>
        </div>

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
