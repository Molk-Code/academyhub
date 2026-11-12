import { useEffect, useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { limit } from 'firebase/firestore'
import { AlertTriangle, CheckCircle2, Loader2, AlertCircle, Upload, History } from 'lucide-react'
import { functions } from '@/lib/firebase'
import { SCHOOL_ID } from '@/lib/school'
import { useCollection, useDocument, orderBy } from '@/hooks/useFirestore'
import { MODULE_INFO } from '@/config/modules'
import { effectiveModules, publicShopOpen, tierFromModules, MODULE_FLAG, MODULE_IDS, type ModuleFlags } from '@/lib/features'
import type { PublicConfig, FrontDoor } from '@/lib/publicConfig'
import type { SchoolDoc } from '@/types'
import { format } from 'date-fns'
import { contrastRatio, readableTextOn } from '@/lib/contrast'

type ProfileForm = Required<Pick<PublicConfig, 'name' | 'shortName' | 'tagline' | 'primaryColor' | 'logoUrl'>> & { frontDoor: FrontDoor | '' }

interface AuditEntry {
  id: string
  schoolId: string
  by: { email: string }
  at?: { toDate(): Date }
  before: { school: Record<string, unknown> }
  after: { school: Record<string, unknown> }
}

const updateSchoolModules = httpsCallable<Record<string, unknown>, { ok: true }>(functions, 'updateSchoolModules')
const uploadSchoolLogo = httpsCallable<{ contentType: string; base64: string }, { url: string }>(functions, 'uploadSchoolLogo')

// Combinations that work but lose an integration — shown, never blocked
function warningsFor(m: ModuleFlags): string[] {
  const w: string[] = []
  if (!m.academy && !m.production && !m.rentalInventory) w.push('No module on — users get only the core (chat, calendar, FAQ, profile).')
  if (m.production && !m.rentalInventory) w.push('Production without Rental & Inventory: equipment links and equipment costs inside Production are hidden.')
  if (m.academy && !m.rentalInventory) w.push('Academy without Rental & Inventory: students and teachers cannot book equipment (Rental House is hidden).')
  if (m.rentalInventory && !m.academy && !m.production) w.push('Rental & Inventory only: the admin area switches to the rental layout (Equipment and Inventory).')
  return w
}

function Toggle({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={e => { e.stopPropagation(); onChange(!on) }}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-40 ${on ? 'bg-brand-500' : 'bg-zinc-700'}`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${on ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  )
}

export default function SchoolModulesPanel({ school }: { school: SchoolDoc }) {
  const ownSchool = school.id === SCHOOL_ID
  const { data: savedProfile } = useDocument<PublicConfig & { id: string }>('public_config', ownSchool ? 'main' : null)
  const { data: audit } = useCollection<AuditEntry>('school_audit', [orderBy('at', 'desc'), limit(20)], true, 'superadmin-audit')

  // Start from what the school gets today, so an untouched save changes nothing
  const [modules, setModules]       = useState<ModuleFlags>(() => effectiveModules(school))
  const [publicShop, setPublicShop] = useState(() => publicShopOpen(school))
  const [planName, setPlanName]     = useState(school.planName ?? '')
  const [maxStudents, setMaxStudents] = useState(school.maxStudents != null ? String(school.maxStudents) : '')
  const [storageQuota, setStorageQuota] = useState(school.storageQuotaGB != null ? String(school.storageQuotaGB) : '')
  const [profile, setProfile] = useState<ProfileForm>({ name: '', shortName: '', tagline: '', primaryColor: '', logoUrl: '', frontDoor: '' })
  const [profileTouched, setProfileTouched] = useState(false)
  const [busy, setBusy]       = useState<'save' | 'logo' | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    if (!savedProfile || profileTouched) return
    setProfile({
      name: savedProfile.name ?? '', shortName: savedProfile.shortName ?? '', tagline: savedProfile.tagline ?? '',
      primaryColor: savedProfile.primaryColor ?? '', logoUrl: savedProfile.logoUrl ?? '', frontDoor: savedProfile.frontDoor ?? '',
    })
  }, [savedProfile, profileTouched])

  const setProfileField = (k: keyof ProfileForm, v: string) => { setProfileTouched(true); setProfile(p => ({ ...p, [k]: v })) }
  const setModule = (flag: keyof ModuleFlags, on: boolean) => {
    setModules(m => ({ ...m, [flag]: on }))
    if (flag === 'rentalInventory' && !on) setPublicShop(false)
  }

  const closestTier = tierFromModules(modules)
  const warnings = warningsFor(modules)

  async function handleLogo(file: File) {
    setBusy('logo'); setMessage(null)
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
        r.onerror = () => reject(r.error)
        r.readAsDataURL(file)
      })
      const { data } = await uploadSchoolLogo({ contentType: file.type, base64 })
      setProfileField('logoUrl', data.url)
    } catch (err: any) {
      setMessage({ ok: false, text: err?.message ?? 'Logo upload failed.' })
    } finally { setBusy(null) }
  }

  async function save() {
    setBusy('save'); setMessage(null)
    try {
      const num = (s: string) => (s.trim() === '' ? null : Number(s))
      await updateSchoolModules({
        schoolId: school.id,
        modules,
        publicShop: modules.rentalInventory && publicShop,
        planName: planName.trim() || null,
        maxStudents: num(maxStudents),
        storageQuotaGB: num(storageQuota),
        ...(ownSchool && profileTouched ? { profile } : {}),
      })
      setProfileTouched(false)
      setMessage({ ok: true, text: 'Saved.' })
    } catch (err: any) {
      setMessage({ ok: false, text: err?.message ?? 'Save failed.' })
    } finally { setBusy(null) }
  }

  const entries = audit.filter(a => a.schoolId === school.id).slice(0, 5)

  return (
    <div className="space-y-6" onClick={e => e.stopPropagation()}>
      {/* ── Modules ── */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Modules</p>
          <p className="text-[11px] text-zinc-500">
            {school.modules ? 'Set explicitly' : `Legacy — derived from tier "${school.tier ?? 'none'}" until saved`}
          </p>
        </div>
        {MODULE_IDS.map(id => {
          const flag = MODULE_FLAG[id]
          return (
            <div key={id} className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm text-zinc-100 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: MODULE_INFO[id].accent }} />
                  {MODULE_INFO[id].name}
                </p>
                <p className="text-xs text-zinc-500">{MODULE_INFO[id].tagline}</p>
              </div>
              <Toggle on={modules[flag]} onChange={v => setModule(flag, v)} label={MODULE_INFO[id].name} />
            </div>
          )
        })}
        <div className="flex items-start justify-between gap-3 pl-4 border-l border-white/10">
          <div>
            <p className="text-sm text-zinc-100">Public rental shop</p>
            <p className="text-xs text-zinc-500">Signed-out visitors can browse equipment and send booking requests at /shop. Off by default.</p>
          </div>
          <Toggle on={modules.rentalInventory && publicShop} onChange={setPublicShop} disabled={!modules.rentalInventory} label="Public rental shop" />
        </div>
        {warnings.length > 0 && (
          <ul className="space-y-1.5">
            {warnings.map(w => (
              <li key={w} className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 flex gap-2">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> {w}
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-zinc-500">
          Stored tier: <span className="text-zinc-300">{school.tier ?? 'none'}</span> · Closest tier for these modules:{' '}
          <span className="text-zinc-300">{closestTier ?? 'none (modules only)'}</span>
          <span className="block text-zinc-600 mt-0.5">Once modules are saved they decide features; the stored tier is kept for older screens and is not changed here.</span>
        </p>
      </section>

      {/* ── Plan ── */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="label">Plan name</label>
          <input className="input w-full" maxLength={60} value={planName} onChange={e => setPlanName(e.target.value)} placeholder="e.g. Academy + Production" />
        </div>
        <div>
          <label className="label">Student / seat limit</label>
          <input className="input w-full" type="number" min={0} step={1} value={maxStudents} onChange={e => setMaxStudents(e.target.value)} placeholder="No limit" />
        </div>
        <div>
          <label className="label">Storage quota (GB)</label>
          <input className="input w-full" type="number" min={0} step={1} value={storageQuota} onChange={e => setStorageQuota(e.target.value)} placeholder="Unlimited" />
        </div>
      </section>

      {/* ── Login page profile ── */}
      <section className="space-y-3">
        <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Login page profile</p>
        {!ownSchool ? (
          <p className="text-xs text-zinc-500">The login page profile belongs to this deployment's school ({SCHOOL_ID}).</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Name</label>
              <input className="input w-full" maxLength={80} value={profile.name} onChange={e => setProfileField('name', e.target.value)} placeholder="Shown on the login page" />
            </div>
            <div>
              <label className="label">Short name</label>
              <input className="input w-full" maxLength={40} value={profile.shortName} onChange={e => setProfileField('shortName', e.target.value)} placeholder="Used when space is tight" />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Tagline</label>
              <input className="input w-full" maxLength={120} value={profile.tagline} onChange={e => setProfileField('tagline', e.target.value)}
                placeholder={profile.frontDoor ? `${MODULE_INFO[profile.frontDoor as keyof typeof MODULE_INFO].loginTagline} (default for this front door)` : 'None shown without a front door'} />
            </div>
            <div>
              <label className="label">Accent colour</label>
              <div className="flex gap-2">
                <input type="color" className="h-10 w-12 rounded-lg bg-transparent border border-white/10" value={profile.primaryColor || '#ff6b35'} onChange={e => setProfileField('primaryColor', e.target.value)} />
                <input className="input w-full font-mono" maxLength={7} value={profile.primaryColor} onChange={e => setProfileField('primaryColor', e.target.value)} placeholder="#ff6b35" />
              </div>
              {/^#[0-9a-fA-F]{6}$/.test(profile.primaryColor) && (() => {
                // Button text is picked automatically; still flag colours that read poorly on the dark page
                const onPage = contrastRatio(profile.primaryColor, '#1c2026')
                const onButton = contrastRatio(readableTextOn(profile.primaryColor), profile.primaryColor)
                return onPage < 3 || onButton < 4.5
                  ? <p className="text-xs text-amber-300 mt-1">Low contrast (button text {onButton.toFixed(1)}:1, on page {onPage.toFixed(1)}:1) — pick a lighter or more saturated colour.</p>
                  : <p className="text-xs text-zinc-500 mt-1">Contrast OK (button text {onButton.toFixed(1)}:1).</p>
              })()}
            </div>
            <div>
              <label className="label">Front door</label>
              <select className="input w-full" value={profile.frontDoor} onChange={e => setProfileField('frontDoor', e.target.value)}>
                <option value="">Default (current wording)</option>
                <option value="academy">Academy — invite only</option>
                <option value="rental_inventory">Rental — browse equipment</option>
                <option value="production">Production — staff sign-in only</option>
              </select>
            </div>
            <div className="sm:col-span-2 flex items-center gap-3">
              {profile.logoUrl
                ? <img src={profile.logoUrl} alt="" className="w-12 h-12 object-contain rounded-lg bg-zinc-900 border border-white/10" />
                : <div className="w-12 h-12 rounded-lg bg-zinc-900 border border-white/10" />}
              <label className="btn-secondary text-sm cursor-pointer inline-flex items-center gap-1.5">
                {busy === 'logo' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} Upload logo
                <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleLogo(f); e.target.value = '' }} />
              </label>
              {profile.logoUrl && <button type="button" className="text-xs text-zinc-400 hover:text-zinc-200" onClick={() => setProfileField('logoUrl', '')}>Remove</button>}
              <span className="text-[11px] text-zinc-500">PNG, JPEG, WebP or SVG, max 1 MB</span>
            </div>
          </div>
        )}
      </section>

      <div className="flex items-center gap-3">
        <button type="button" onClick={save} disabled={busy !== null} className="btn-primary text-sm py-2 px-4 disabled:opacity-50">
          {busy === 'save' ? 'Saving…' : 'Save modules & profile'}
        </button>
        {message && (
          <p className={`text-xs flex items-center gap-1 ${message.ok ? 'text-emerald-400' : 'text-rose-400'}`}>
            {message.ok ? <CheckCircle2 className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />} {message.text}
          </p>
        )}
      </div>

      {entries.length > 0 && (
        <section className="space-y-1.5">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5"><History className="w-3.5 h-3.5" /> Recent changes</p>
          {entries.map(a => {
            const b = a.before.school.modules as ModuleFlags | null, n = a.after.school.modules as ModuleFlags
            const changed = MODULE_IDS.filter(id => (b?.[MODULE_FLAG[id]] ?? null) !== n?.[MODULE_FLAG[id]])
              .map(id => `${MODULE_INFO[id].name} ${n[MODULE_FLAG[id]] ? 'on' : 'off'}`)
            return (
              <p key={a.id} className="text-xs text-zinc-500">
                {a.at ? format(a.at.toDate(), 'd MMM yyyy HH:mm') : 'just now'} · {a.by?.email} · {changed.join(', ') || 'settings / profile'}
              </p>
            )
          })}
        </section>
      )}
    </div>
  )
}
