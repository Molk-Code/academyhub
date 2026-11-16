import { useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { ExternalLink, Lock, LockOpen, Store, Loader2, Copy, Check } from 'lucide-react'
import { functions } from '@/lib/firebase'
import { useSchool } from '@/contexts/SchoolContext'
import { usePublicConfig } from '@/lib/publicConfig'
import { publicShopOpen } from '@/lib/features'
import { cn } from '@/lib/utils'

// Equipment → Public shop: the school admin opens or closes the public rental
// shop (/shop) and sets its password (functions/src/shop.ts). The superadmin
// can override open/closed; then the switch is locked here.

const MIN_PASSWORD = 6

export function useShopState() {
  const school = useSchool()
  const { config } = usePublicConfig()
  const open = publicShopOpen(school)
  const domain = config?.shopDomain || null
  const url = domain ? `https://${domain}` : `${window.location.origin}/shop`
  return { open, override: school.publicShopOverride, adminOpen: school.publicShop === true, locked: school.shopLocked, url }
}

export default function PublicShopSettings() {
  const { open, override, adminOpen, locked, url } = useShopState()
  const [busy, setBusy] = useState<'open' | 'password' | 'remove' | null>(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const [password, setPassword] = useState('')
  const [copied, setCopied] = useState(false)

  async function save(kind: 'open' | 'password' | 'remove', data: Record<string, unknown>, done: string) {
    setBusy(kind); setError(''); setSaved('')
    try {
      await httpsCallable(functions, 'setShopSettings')(data)
      setSaved(done)
      if (kind === 'password') setPassword('')
    } catch (e: any) {
      setError(e?.message ?? 'Could not save.')
    } finally {
      setBusy(null)
    }
  }

  async function copy() {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* no clipboard */ }
  }

  return (
    <section aria-label="Public shop" className="rounded-2xl border border-white/10 bg-zinc-900 p-4 space-y-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="font-semibold text-zinc-100 flex items-center gap-2"><Store className="w-4 h-4 text-zinc-500" /> Public rental shop</h2>
          <p className="text-zinc-400 max-w-prose">
            Anyone with the link can browse the catalog and send a request, without an account. Requests arrive under
            Bookings, marked <span className="text-zinc-200">Rental shop</span>, and the customer gets emails as you answer.
          </p>
        </div>
        <span className={cn('text-xs px-2 py-0.5 rounded-full border', open ? 'bg-emerald-900/50 text-emerald-300 border-emerald-800/50' : 'bg-zinc-800 text-zinc-400 border-zinc-700')}>
          {open ? 'Open' : 'Closed'}
        </span>
      </div>

      {override ? (
        <p role="status" className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-200">
          Set by CineForge: the shop is kept {override === 'on' ? 'open' : 'closed'}. Contact CineForge to change this.
          {override === 'off' && adminOpen && ' Your setting (open) applies again when they lift it.'}
        </p>
      ) : (
        <label className="flex items-center gap-3 cursor-pointer w-fit">
          <input type="checkbox" className="h-4 w-4 accent-brand-500" checked={adminOpen} disabled={busy !== null}
            onChange={e => save('open', { open: e.target.checked }, e.target.checked ? 'The shop is open.' : 'The shop is closed.')} />
          <span className="text-zinc-200">Open the shop to the public</span>
          {busy === 'open' && <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />}
        </label>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <code className="rounded-lg bg-black/30 px-2 py-1 text-xs text-zinc-300 break-all">{url}</code>
        <button type="button" onClick={copy} className="text-xs text-zinc-400 hover:text-zinc-200 inline-flex items-center gap-1">
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} {copied ? 'Copied' : 'Copy'}
        </button>
        {open && (
          <a href={url} target="_blank" rel="noopener noreferrer" className="text-xs text-zinc-400 hover:text-zinc-200 inline-flex items-center gap-1">
            <ExternalLink className="w-3.5 h-3.5" /> Open
          </a>
        )}
      </div>

      <div className="space-y-2 border-t border-white/5 pt-3">
        <p className="text-zinc-300 flex items-center gap-2">
          {locked ? <Lock className="w-4 h-4 text-amber-300" /> : <LockOpen className="w-4 h-4 text-zinc-500" />}
          {locked ? 'Visitors need a password to see the shop.' : 'No password: anyone with the link can see it.'}
        </p>
        <form className="flex flex-wrap items-end gap-2"
          onSubmit={e => { e.preventDefault(); save('password', { password }, 'Password saved. Share it with the customers who should see the shop.') }}>
          <label className="space-y-1">
            <span className="block text-xs text-zinc-400">{locked ? 'New password' : 'Set a password'}</span>
            <input className="input w-56" type="password" autoComplete="new-password" minLength={MIN_PASSWORD} maxLength={100}
              value={password} onChange={e => setPassword(e.target.value)} placeholder={`At least ${MIN_PASSWORD} characters`} />
          </label>
          <button type="submit" className="btn-secondary py-2 px-3 text-sm" disabled={busy !== null || password.length < MIN_PASSWORD}>
            {busy === 'password' && <Loader2 className="w-4 h-4 animate-spin" />} Save password
          </button>
          {locked && (
            <button type="button" className="text-sm text-rose-300 hover:text-rose-200 px-2" disabled={busy !== null}
              onClick={() => save('remove', { password: null }, 'Password removed.')}>
              Remove password
            </button>
          )}
        </form>
      </div>

      {saved && <p role="status" className="text-emerald-400">{saved}</p>}
      {error && <p role="alert" className="text-rose-400">{error}</p>}
    </section>
  )
}
