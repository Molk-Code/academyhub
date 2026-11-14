import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { httpsCallable } from 'firebase/functions'
import { functions } from '@/lib/firebase'
import { useCollection, orderBy } from '@/hooks/useFirestore'
import { MODULE_INFO } from '@/config/modules'
import { MODULE_FLAG, MODULE_IDS } from '@/lib/features'
import { format } from 'date-fns'
import { Plus, X, ChevronDown, ChevronUp, Loader2, CheckCircle2, AlertCircle, Circle, CircleDot, XCircle } from 'lucide-react'

// Superadmin → Customers: new customers come in as orders (functions/src/
// onboarding.ts). Paid by invoice for now: mark the invoice paid, or start the
// setup before payment. Setup then runs on its own and its steps show here.

type Status = 'awaiting_payment' | 'queued' | 'provisioning' | 'live' | 'failed' | 'cancelled'
type StepStatus = 'pending' | 'running' | 'done' | 'failed'

interface Order {
  id: string
  status: Status
  source: 'superadmin' | 'self_service'
  address: string
  organisation: { name: string; orgNumber: string | null }
  school: { name: string; shortName: string }
  admin: { name: string; email: string }
  billing: { email: string; reference: string | null; address: string | null }
  plan: { planName: string | null; modules: Record<string, boolean>; maxStudents: number | null; storageQuotaGB: number | null }
  payment: { method: 'invoice' | 'card'; status: 'pending' | 'paid'; invoiceNumber: string | null }
  startPolicy: 'after_payment' | 'immediately'
  provisioning: { steps: Record<string, { status: StepStatus; error?: string }>; error: string | null; note: string | null; attempts: number }
  notes: string | null
  preview?: boolean
  createdAt?: { toDate(): Date }
}

interface OrderEvent { id: string; at?: { toDate(): Date }; by: Record<string, string>; action: string }

// Same order as PROVISIONING_STEPS in functions/src/onboarding.ts
const STEPS: [string, string][] = [
  ['project', 'Create the Firebase project (EU)'],
  ['services', 'Database, sign-in and storage'],
  ['deploy', 'Install the app, rules and functions'],
  ['school', 'School record and login page profile'],
  ['domain', 'Address and DNS'],
  ['signin_domain', 'Allow sign-in on the address'],
  ['invite', 'Invite the school admin'],
]

const STATUS: Record<Status, { label: string; pill: string }> = {
  awaiting_payment: { label: 'Awaiting payment', pill: 'bg-amber-900/50 text-amber-300 border-amber-800/50' },
  queued:           { label: 'Queued',           pill: 'bg-sky-900/50 text-sky-300 border-sky-800/50' },
  provisioning:     { label: 'Setting up',       pill: 'bg-violet-900/50 text-violet-300 border-violet-800/50' },
  live:             { label: 'Live',             pill: 'bg-emerald-900/50 text-emerald-300 border-emerald-800/50' },
  failed:           { label: 'Setup failed',     pill: 'bg-rose-900/50 text-rose-300 border-rose-800/50' },
  cancelled:        { label: 'Cancelled',        pill: 'bg-zinc-800 text-zinc-400 border-zinc-700' },
}

const EVENT_LABEL: Record<string, string> = {
  created: 'Order created', payment_confirmed: 'Payment recorded', started_before_payment: 'Setup started before payment',
  invoice_number: 'Invoice number set', cancelled: 'Cancelled', retry: 'Setup retried', setup_failed: 'Setup failed', live: 'Live',
}

function call<T = unknown>(name: string, data: Record<string, unknown>) {
  return httpsCallable<Record<string, unknown>, T>(functions, name)(data).then(r => r.data)
}

const who = (by: Record<string, string>) => by.email ?? by.provider ?? (by.system === 'self_service' ? 'customer' : by.system) ?? '—'

// ── New customer form ─────────────────────────────────────────────────────────

const EMPTY = {
  orgName: '', orgNumber: '', schoolName: '', shortName: '', adminName: '', adminEmail: '',
  billingEmail: '', billingReference: '', billingAddress: '', maxStudents: '', storageGB: '',
  modules: { academy: true, production: true, rentalInventory: true } as Record<string, boolean>,
  startPolicy: 'after_payment' as 'after_payment' | 'immediately', notes: '',
}

function shortNameFrom(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^[0-9-]+/, '').slice(0, 30)
}

function NewCustomerForm({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ ...EMPTY })
  const [shortEdited, setShortEdited] = useState(false)
  const [check, setCheck] = useState<{ ok: boolean; problem: string | null; address: string | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = <K extends keyof typeof EMPTY>(k: K, v: (typeof EMPTY)[K]) => setF(p => ({ ...p, [k]: v }))

  useEffect(() => {
    if (!f.shortName) { setCheck(null); return }
    let live = true
    const t = setTimeout(() => {
      call<{ ok: boolean; problem: string | null; address: string | null }>('checkCustomerShortName', { shortName: f.shortName })
        .then(r => { if (live) setCheck(r) }).catch(() => { if (live) setCheck(null) })
    }, 350)
    return () => { live = false; clearTimeout(t) }
  }, [f.shortName])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError('')
    const num = (s: string) => (s.trim() === '' ? null : Number(s))
    try {
      await call('createCustomerOrder', {
        organisation: { name: f.orgName, orgNumber: f.orgNumber },
        school: { name: f.schoolName, shortName: f.shortName },
        admin: { name: f.adminName, email: f.adminEmail },
        billing: { email: f.billingEmail, reference: f.billingReference, address: f.billingAddress },
        plan: { planName: null, modules: f.modules, maxStudents: num(f.maxStudents), storageQuotaGB: num(f.storageGB) },
        payment: { method: 'invoice' },
        startPolicy: f.startPolicy,
        notes: f.notes,
      })
      onDone()
    } catch (err: any) {
      setError(err?.message ?? 'Could not create the order.')
    } finally {
      setBusy(false)
    }
  }

  const field = (label: string, k: keyof typeof EMPTY, opts: { type?: string; required?: boolean; placeholder?: string } = {}) => (
    <label className="block space-y-1">
      <span className="text-xs text-zinc-400">{label}{opts.required && ' *'}</span>
      <input className="input w-full" type={opts.type ?? 'text'} required={opts.required} placeholder={opts.placeholder}
        value={f[k] as string} onChange={e => set(k, e.target.value as never)} />
    </label>
  )

  return (
    <form onSubmit={submit} className="bg-zinc-900 border border-white/10 rounded-2xl p-5 space-y-5">
      <fieldset className="grid sm:grid-cols-2 gap-3">
        <legend className="text-sm font-semibold text-zinc-200 mb-2">Customer</legend>
        {field('Organisation (who is invoiced)', 'orgName', { required: true })}
        {field('Organisation number', 'orgNumber')}
        <label className="block space-y-1">
          <span className="text-xs text-zinc-400">School name *</span>
          <input className="input w-full" required value={f.schoolName}
            onChange={e => { const v = e.target.value; setF(p => ({ ...p, schoolName: v, ...(!shortEdited ? { shortName: shortNameFrom(v) } : {}) })) }} />
        </label>
        <label className="block space-y-1">
          <span className="text-xs text-zinc-400">Short name (address) *</span>
          <input className="input w-full" required value={f.shortName} autoComplete="off"
            onChange={e => { setShortEdited(true); set('shortName', e.target.value.toLowerCase()) }} />
          <span className={`text-[11px] ${check?.ok ? 'text-emerald-400' : 'text-rose-400'}`} aria-live="polite">
            {check ? (check.ok ? check.address : check.problem) : ''}
          </span>
        </label>
        {field('School admin name', 'adminName', { required: true })}
        {field('School admin email', 'adminEmail', { type: 'email', required: true })}
      </fieldset>

      <fieldset className="grid sm:grid-cols-2 gap-3">
        <legend className="text-sm font-semibold text-zinc-200 mb-2">Invoice</legend>
        {field('Invoice email', 'billingEmail', { type: 'email', required: true })}
        {field('Their reference', 'billingReference')}
        <label className="block space-y-1 sm:col-span-2">
          <span className="text-xs text-zinc-400">Invoice address</span>
          <textarea className="input w-full" rows={2} value={f.billingAddress} onChange={e => set('billingAddress', e.target.value)} />
        </label>
      </fieldset>

      <fieldset className="grid sm:grid-cols-2 gap-3">
        <legend className="text-sm font-semibold text-zinc-200 mb-2">Plan</legend>
        {field('Student limit', 'maxStudents', { type: 'number' })}
        {field('Storage (GB)', 'storageGB', { type: 'number' })}
        <div className="sm:col-span-2 flex flex-wrap gap-4">
          {MODULE_IDS.map(id => (
            <label key={id} className="flex items-center gap-2 text-sm text-zinc-300">
              <input type="checkbox" checked={!!f.modules[MODULE_FLAG[id]]}
                onChange={e => set('modules', { ...f.modules, [MODULE_FLAG[id]]: e.target.checked })} />
              {MODULE_INFO[id].name}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold text-zinc-200 mb-2">When to set up</legend>
        <label className="flex items-start gap-2 text-sm text-zinc-300">
          <input type="radio" name="startPolicy" className="mt-1" checked={f.startPolicy === 'after_payment'} onChange={() => set('startPolicy', 'after_payment')} />
          <span>When the invoice is paid <span className="text-zinc-500">(you mark it paid here)</span></span>
        </label>
        <label className="flex items-start gap-2 text-sm text-zinc-300">
          <input type="radio" name="startPolicy" className="mt-1" checked={f.startPolicy === 'immediately'} onChange={() => set('startPolicy', 'immediately')} />
          <span>Right away <span className="text-zinc-500">(the invoice is paid later)</span></span>
        </label>
      </fieldset>

      <label className="block space-y-1">
        <span className="text-xs text-zinc-400">Internal notes</span>
        <textarea className="input w-full" rows={2} value={f.notes} onChange={e => set('notes', e.target.value)} />
      </label>

      {error && <p role="alert" className="text-sm text-rose-400 flex items-center gap-1.5"><AlertCircle className="w-4 h-4" /> {error}</p>}
      <button type="submit" className="btn-primary py-2 px-4 text-sm" disabled={busy || check?.ok === false}>
        {busy && <Loader2 className="w-4 h-4 animate-spin" />} Create order
      </button>
    </form>
  )
}

// ── One order ─────────────────────────────────────────────────────────────────

function StepIcon({ status }: { status: StepStatus }) {
  if (status === 'done') return <CheckCircle2 className="w-4 h-4 text-emerald-400" aria-label="Done" />
  if (status === 'running') return <Loader2 className="w-4 h-4 text-violet-300 animate-spin" aria-label="Running" />
  if (status === 'failed') return <XCircle className="w-4 h-4 text-rose-400" aria-label="Failed" />
  return <Circle className="w-4 h-4 text-zinc-600" aria-label="Not started" />
}

function OrderDetails({ order }: { order: Order }) {
  const { data: events } = useCollection<OrderEvent>(`customer_orders/${order.id}/events`, [orderBy('at', 'desc')], true, `order-events-${order.id}`)
  const [invoiceNumber, setInvoiceNumber] = useState(order.payment.invoiceNumber ?? '')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [confirmCancel, setConfirmCancel] = useState(false)

  async function act(name: string, data: Record<string, unknown> = {}) {
    setBusy(name); setError('')
    try { await call(name, { orderId: order.id, ...data }) }
    catch (e: any) { setError(e?.message ?? 'Something went wrong.') }
    finally { setBusy(null); setConfirmCancel(false) }
  }

  const modules = MODULE_IDS.filter(id => order.plan.modules[MODULE_FLAG[id]]).map(id => MODULE_INFO[id].name).join(', ')
  const unpaid = order.payment.status !== 'paid' && order.status !== 'cancelled'
  const cancellable = ['awaiting_payment', 'queued', 'failed'].includes(order.status)

  return (
    <div className="px-5 pb-5 pt-1 grid lg:grid-cols-2 gap-6 text-sm">
      <div className="space-y-3">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-zinc-300">
          <dt className="text-zinc-500">Address</dt><dd>{order.address}</dd>
          <dt className="text-zinc-500">Organisation</dt><dd>{order.organisation.name}{order.organisation.orgNumber && ` (${order.organisation.orgNumber})`}</dd>
          <dt className="text-zinc-500">School admin</dt><dd>{order.admin.name} · {order.admin.email}</dd>
          <dt className="text-zinc-500">Invoice to</dt><dd>{order.billing.email}{order.billing.reference && ` · ref ${order.billing.reference}`}</dd>
          {order.billing.address && (<><dt className="text-zinc-500">Invoice address</dt><dd className="whitespace-pre-line">{order.billing.address}</dd></>)}
          <dt className="text-zinc-500">Plan</dt><dd>{[order.plan.planName, modules].filter(Boolean).join(' · ')}</dd>
          {(order.plan.maxStudents !== null || order.plan.storageQuotaGB !== null) && (
            <><dt className="text-zinc-500">Limits</dt><dd>{[order.plan.maxStudents !== null && `${order.plan.maxStudents} students`, order.plan.storageQuotaGB !== null && `${order.plan.storageQuotaGB} GB`].filter(Boolean).join(' · ')}</dd></>
          )}
          <dt className="text-zinc-500">Payment</dt>
          <dd>Invoice · {order.payment.status === 'paid' ? <span className="text-emerald-400">paid</span> : 'not paid'}{order.payment.invoiceNumber && ` · ${order.payment.invoiceNumber}`}</dd>
          <dt className="text-zinc-500">Set up</dt><dd>{order.startPolicy === 'immediately' ? 'Right away' : 'When paid'}</dd>
          {order.notes && (<><dt className="text-zinc-500">Notes</dt><dd className="whitespace-pre-line">{order.notes}</dd></>)}
        </dl>

        {unpaid && order.payment.method === 'invoice' && (
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1">
              <span className="block text-xs text-zinc-400">Invoice number</span>
              <input className="input w-40" value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} />
            </label>
            <button type="button" className="btn-secondary py-2 px-3 text-sm" disabled={!!busy || invoiceNumber === (order.payment.invoiceNumber ?? '')}
              onClick={() => act('setOrderInvoiceNumber', { invoiceNumber })}>Save number</button>
            <button type="button" className="btn-primary py-2 px-3 text-sm" disabled={!!busy} onClick={() => act('markOrderPaid', { invoiceNumber })}>
              {busy === 'markOrderPaid' && <Loader2 className="w-4 h-4 animate-spin" />} Mark invoice paid
            </button>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {order.status === 'awaiting_payment' && (
            <button type="button" className="btn-secondary py-2 px-3 text-sm" disabled={!!busy} onClick={() => act('startCustomerOrder')}>
              {busy === 'startCustomerOrder' && <Loader2 className="w-4 h-4 animate-spin" />} Set up now, paid later
            </button>
          )}
          {order.status === 'failed' && (
            <button type="button" className="btn-primary py-2 px-3 text-sm" disabled={!!busy} onClick={() => act('retryCustomerOrder')}>
              {busy === 'retryCustomerOrder' && <Loader2 className="w-4 h-4 animate-spin" />} Retry setup
            </button>
          )}
          {cancellable && (confirmCancel ? (
            <>
              <button type="button" className="py-2 px-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold" disabled={!!busy} onClick={() => act('cancelCustomerOrder')}>
                Yes, cancel the order
              </button>
              <button type="button" className="btn-secondary py-2 px-3 text-sm" onClick={() => setConfirmCancel(false)}>Keep it</button>
            </>
          ) : (
            <button type="button" className="text-sm text-rose-300 hover:text-rose-200 px-2" onClick={() => setConfirmCancel(true)}>Cancel order…</button>
          ))}
        </div>
        {error && <p role="alert" className="text-rose-400 flex items-center gap-1.5"><AlertCircle className="w-4 h-4" /> {error}</p>}
      </div>

      <div className="space-y-4">
        <div>
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Setup</p>
          <ol className="space-y-1.5">
            {STEPS.map(([id, label]) => {
              const s = order.provisioning.steps[id] ?? { status: 'pending' as StepStatus }
              return (
                <li key={id} className="flex items-start gap-2">
                  <StepIcon status={s.status} />
                  <span className={s.status === 'pending' ? 'text-zinc-500' : 'text-zinc-200'}>
                    {label}{s.error && <span className="block text-xs text-rose-400">{s.error}</span>}
                  </span>
                </li>
              )
            })}
          </ol>
          {order.provisioning.note && <p className="mt-2 text-xs text-amber-300 flex items-center gap-1.5"><CircleDot className="w-3.5 h-3.5" /> {order.provisioning.note}</p>}
        </div>
        {events.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">History</p>
            <ul className="space-y-1 text-xs text-zinc-500">
              {events.map(e => (
                <li key={e.id}>{e.at ? format(e.at.toDate(), 'd MMM yyyy HH:mm') : 'just now'} · {EVENT_LABEL[e.action] ?? e.action} · {who(e.by)}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Section ───────────────────────────────────────────────────────────────────

export default function CustomerOrders() {
  const { data: orders, loading } = useCollection<Order>('customer_orders', [orderBy('createdAt', 'desc')], true, 'superadmin-orders')
  const [showForm, setShowForm] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [created, setCreated] = useState(false)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-zinc-100">Customers</h2>
          <p className="text-xs text-zinc-500">New customers are orders: paid by invoice, then set up on their own address.</p>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/order" className="text-sm text-zinc-400 hover:text-zinc-200">Order page (preview)</Link>
          {created && <span className="text-sm text-emerald-400 flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" /> Order created</span>}
          <button type="button" onClick={() => setShowForm(s => !s)} className="flex items-center gap-2 btn bg-brand-600 text-white hover:bg-brand-500 py-2 text-sm">
            {showForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />} {showForm ? 'Cancel' : 'New customer'}
          </button>
        </div>
      </div>

      {showForm && <NewCustomerForm onDone={() => { setShowForm(false); setCreated(true); setTimeout(() => setCreated(false), 4000) }} />}

      <div className="bg-zinc-900 border border-white/10 rounded-2xl divide-y divide-white/8">
        {loading ? (
          <div className="py-10"><Loader2 className="w-5 h-5 animate-spin text-zinc-500 mx-auto" /></div>
        ) : orders.length === 0 ? (
          <p className="py-10 text-center text-sm text-zinc-500">No customer orders yet.</p>
        ) : orders.map(o => (
          <div key={o.id}>
            <button type="button" className="w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-white/[0.03]"
              aria-expanded={open === o.id} onClick={() => setOpen(open === o.id ? null : o.id)}>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-zinc-100 truncate">{o.school.name}</p>
                <p className="text-xs text-zinc-500 truncate">
                  {o.address} · {o.organisation.name}{o.source === 'self_service' && ' · ordered online'}{o.preview && ' · preview'}
                  {o.createdAt && ` · ${format(o.createdAt.toDate(), 'd MMM yyyy')}`}
                </p>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full border ${STATUS[o.status].pill}`}>{STATUS[o.status].label}</span>
              {open === o.id ? <ChevronUp className="w-4 h-4 text-zinc-500" /> : <ChevronDown className="w-4 h-4 text-zinc-500" />}
            </button>
            {open === o.id && <OrderDetails order={o} />}
          </div>
        ))}
      </div>
    </div>
  )
}
