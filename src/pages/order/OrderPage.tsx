import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { httpsCallable } from 'firebase/functions'
import { functions } from '@/lib/firebase'
import { LEGAL } from '@/config/legal'
import { ORDER_TERMS as T, TERMS_VERSION } from '@/config/orderTerms'
import { usePageMeta } from '@/lib/pageMeta'
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'
import { Decided } from './OrderLayout'
import PlanPicker from './PlanPicker'
import type { PlanSelection } from '@/config/pricing'

// /order: an organisation orders CineForge, paid by invoice. The order lands
// in Superadmin → Customers (submitCustomerOrder) and nothing is set up until
// the superadmin accepts it there.

type NameCheck = { ok: boolean; problem: string | null; address: string | null }

const EMPTY = {
  orgName: '', orgNumber: '', schoolName: '', shortName: '', adminName: '', adminEmail: '',
  billingEmail: '', billingReference: '', billingAddress: '',
  selection: {} as PlanSelection,
  acceptTerms: false, website: '',
}

function shortNameFrom(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^[0-9-]+/, '').slice(0, 30)
}

export default function OrderPage() {
  usePageMeta(`Order ${LEGAL.appName}`, `Order ${LEGAL.appName} for your school or organisation.`)
  const [f, setF] = useState({ ...EMPTY })
  const [shortEdited, setShortEdited] = useState(false)
  const [check, setCheck] = useState<NameCheck | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<{ address: string } | null>(null)
  const set = <K extends keyof typeof EMPTY>(k: K, v: (typeof EMPTY)[K]) => setF(p => ({ ...p, [k]: v }))

  useEffect(() => {
    if (!f.shortName) { setCheck(null); return }
    let live = true
    const t = setTimeout(() => {
      httpsCallable<{ shortName: string }, NameCheck>(functions, 'checkOrderShortName')({ shortName: f.shortName })
        .then(r => { if (live) setCheck(r.data) }).catch(() => { if (live) setCheck(null) })
    }, 400)
    return () => { live = false; clearTimeout(t) }
  }, [f.shortName])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      const r = await httpsCallable<Record<string, unknown>, { ok: true; address: string }>(functions, 'submitCustomerOrder')({
        organisation: { name: f.orgName, orgNumber: f.orgNumber },
        school: { name: f.schoolName, shortName: f.shortName },
        admin: { name: f.adminName, email: f.adminEmail },
        billing: { email: f.billingEmail, reference: f.billingReference, address: f.billingAddress },
        plan: { selection: f.selection },
        payment: { method: 'invoice' },
        startPolicy: 'after_payment',
        acceptTerms: f.acceptTerms,
        termsVersion: TERMS_VERSION,
        website: f.website,
      })
      setDone({ address: r.data.address })
    } catch (err: any) {
      setError(err?.message ?? 'The order could not be sent. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="text-center space-y-4 py-10">
        <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto" aria-hidden="true" />
        <h1 className="text-2xl font-bold text-white">Thank you for your order</h1>
        <p className="text-zinc-300 max-w-md mx-auto">
          We’ll review it and send the invoice to {f.billingEmail}. Once the order is accepted, {f.adminName} gets an
          invitation by email to <strong>{done.address}</strong>.
        </p>
      </div>
    )
  }

  const field = (label: string, k: keyof typeof EMPTY, opts: { type?: string; required?: boolean; hint?: string; autoComplete?: string } = {}) => (
    <label className="block space-y-1">
      <span className="text-sm text-zinc-300">{label}{opts.required && <span className="text-zinc-500"> (required)</span>}</span>
      <input className="input w-full" type={opts.type ?? 'text'} required={opts.required} autoComplete={opts.autoComplete}
        value={f[k] as string} onChange={e => set(k, e.target.value as never)} />
      {opts.hint && <span className="block text-xs text-zinc-500">{opts.hint}</span>}
    </label>
  )
  const noModule = !Object.keys(f.selection).length

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold text-white">Order {LEGAL.appName} for your school</h1>
        <p className="text-zinc-400">
          Your own {LEGAL.appName}, at your own address, with your data kept separate from other customers’. Paid by invoice.
        </p>
      </header>

      <form onSubmit={submit} className="space-y-8">
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-white">Modules</h2>
          <PlanPicker value={f.selection} onChange={v => set('selection', v)} />
        </section>

        <fieldset className="grid sm:grid-cols-2 gap-4">
          <legend className="text-lg font-semibold text-white mb-1">Your school</legend>
          {field('Organisation', 'orgName', { required: true, autoComplete: 'organization', hint: 'The school, municipality or company that signs the agreement' })}
          {field('Organisation number', 'orgNumber')}
          <label className="block space-y-1">
            <span className="text-sm text-zinc-300">School name <span className="text-zinc-500">(required)</span></span>
            <input className="input w-full" required value={f.schoolName}
              onChange={e => { const v = e.target.value; setF(p => ({ ...p, schoolName: v, ...(!shortEdited ? { shortName: shortNameFrom(v) } : {}) })) }} />
          </label>
          <label className="block space-y-1">
            <span className="text-sm text-zinc-300">Your address <span className="text-zinc-500">(required)</span></span>
            <span className="flex items-center gap-1">
              <input className="input w-full" required value={f.shortName} autoComplete="off" aria-describedby="order-address"
                onChange={e => { setShortEdited(true); set('shortName', e.target.value.toLowerCase()) }} />
              <span className="text-sm text-zinc-500 whitespace-nowrap">.{LEGAL.appDomain}</span>
            </span>
            <span id="order-address" className={`block text-xs ${check?.ok ? 'text-emerald-400' : 'text-rose-400'}`} aria-live="polite">
              {check ? (check.ok ? `${check.address} is free` : check.problem) : ''}
            </span>
          </label>
        </fieldset>

        <fieldset className="grid sm:grid-cols-2 gap-4">
          <legend className="text-lg font-semibold text-white mb-1">Administrator</legend>
          <p className="sm:col-span-2 text-sm text-zinc-400 -mt-1">The person who gets the first invitation and sets up teachers and students.</p>
          {field('Name', 'adminName', { required: true, autoComplete: 'name' })}
          {field('Email', 'adminEmail', { type: 'email', required: true, autoComplete: 'email' })}
        </fieldset>

        <fieldset className="grid sm:grid-cols-2 gap-4">
          <legend className="text-lg font-semibold text-white mb-1">Invoice</legend>
          {field('Invoice email', 'billingEmail', { type: 'email', required: true })}
          {field('Your reference', 'billingReference')}
          <label className="block space-y-1 sm:col-span-2">
            <span className="text-sm text-zinc-300">Invoice address</span>
            <textarea className="input w-full" rows={3} value={f.billingAddress} onChange={e => set('billingAddress', e.target.value)} />
          </label>
          <p className="sm:col-span-2 text-xs text-zinc-500">
            Payment term: <Decided value={T.paymentTermDays ? `${T.paymentTermDays} days` : ''} what="payment term" />.
            Agreement period: <Decided value={T.initialTerm} what="initial period" />.
          </p>
        </fieldset>

        {/* Honeypot: hidden from people, filled in by bots */}
        <div aria-hidden="true" className="absolute -left-[9999px] w-px h-px overflow-hidden">
          <label>Website<input tabIndex={-1} autoComplete="off" value={f.website} onChange={e => set('website', e.target.value)} /></label>
        </div>

        <label className="flex items-start gap-3 text-sm text-zinc-300">
          <input type="checkbox" className="mt-1" required checked={f.acceptTerms} onChange={e => set('acceptTerms', e.target.checked)} />
          <span>
            I accept the <Link to="/order/terms" target="_blank" className="text-brand-400 hover:underline">Terms of Service</Link> and
            the <Link to="/order/dpa" target="_blank" className="text-brand-400 hover:underline">data processing agreement</Link> on
            behalf of the organisation, and I’m authorised to do so.
          </span>
        </label>

        {error && <p role="alert" className="text-sm text-rose-400 flex items-center gap-1.5"><AlertCircle className="w-4 h-4" /> {error}</p>}

        <button type="submit" className="btn-primary py-3 px-6" disabled={busy || noModule || check?.ok === false || !f.acceptTerms}>
          {busy && <Loader2 className="w-4 h-4 animate-spin" />} Send order
        </button>
        {!busy && (noModule || check?.ok === false || !f.acceptTerms) && (
          <p className="text-xs text-zinc-400">
            {noModule ? 'Choose at least one module.' : check?.ok === false ? `Choose another address: ${check.problem}` : 'Accept the terms to send the order.'}
          </p>
        )}
        <p className="text-xs text-zinc-500">Nothing is charged now. We review the order and send an invoice.</p>
      </form>
    </div>
  )
}
