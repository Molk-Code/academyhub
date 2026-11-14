import { Link } from 'react-router-dom'
import { LEGAL } from '@/config/legal'
import { ORDER_TERMS as T, TERMS_VERSION } from '@/config/orderTerms'
import { useLegal } from '@/lib/publicConfig'
import { MODULE_INFO } from '@/config/modules'
import { Decided, Missing } from './OrderLayout'

// Draft Terms of Service for organisations ordering CineForge. Wording for
// legal review, not legal advice; commercial values come from
// src/config/orderTerms.ts and show as "Missing" until decided.

export function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold text-white">{n}. {title}</h2>
      <div className="space-y-2 text-sm text-zinc-300 leading-relaxed">{children}</div>
    </section>
  )
}

export function ProviderLine() {
  const legal = useLegal()
  const org = legal('orgNumber')
  const street = legal('streetAddress'), postal = legal('postalCode'), city = legal('city')
  return (
    <>
      <strong>{legal('providerName') ?? <Missing what="provider name" />}</strong>
      {', org. no. '}{org ?? <Missing what="organisation number" />}
      {', '}{street && postal && city ? `${street}, ${postal} ${city}` : <Missing what="postal address" />}
      {' ('}“the provider”{')'}
    </>
  )
}

export default function OrderTerms() {
  const legal = useLegal()
  const contact = legal('contactEmail')
  const modules = Object.values(MODULE_INFO).map(m => m.name).join(', ')
  return (
    <article className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold text-white">Terms of Service</h1>
        <p className="text-sm text-zinc-500 mt-1">{LEGAL.appName} for organisations · version {TERMS_VERSION}</p>
      </header>

      <Section n={1} title="Who the agreement is between">
        <p>These terms apply between <ProviderLine /> and the organisation that orders {LEGAL.appName} (“the customer”).</p>
        <p>The person who places the order confirms that they may enter into agreements on the customer’s behalf.</p>
        <p>The agreement consists of the accepted order, these terms and the <Link to="/order/dpa" className="text-brand-400 hover:underline">data processing agreement</Link>. If they conflict, the data processing agreement applies to personal data, and otherwise the order comes before these terms.</p>
      </Section>

      <Section n={2} title="The service">
        <p>{LEGAL.appName} is a web app for running film schools and film and equipment departments. The customer chooses one or more modules ({modules}) in the order.</p>
        <p>Each customer gets its own installation with its own database, at its own address (for example <code>theirschool.{LEGAL.appDomain}</code>). Customers’ data is not mixed.</p>
        <p>The provider develops the service continuously. Functions may change, as long as the service as a whole keeps its purpose.</p>
      </Section>

      <Section n={3} title="Ordering and start">
        <p>An order is binding once the provider has accepted it. The provider may decline an order, for example if the details can’t be verified.</p>
        <p>After acceptance the provider sets up the installation and sends the customer’s administrator an invitation. Setup may start before or after the first invoice is paid, as stated when the order is accepted.</p>
      </Section>

      <Section n={4} title="Prices and payment">
        <p>Prices are those stated in the order: <Decided value={T.pricing} what="prices" />. Prices are excluding VAT.</p>
        <p>The provider invoices in advance for each period. Payment is due <Decided value={T.paymentTermDays ? `${T.paymentTermDays} days after the invoice date` : ''} what="payment term (days)" />. Late payment interest and reminder fees may be charged as permitted by law.</p>
        <p>If an invoice remains unpaid after a reminder, the provider may restrict the service to read-only access until it is paid. The provider tells the customer before doing so.</p>
      </Section>

      <Section n={5} title="The customer’s responsibilities">
        <p>The customer decides who gets access, keeps its users’ details up to date and makes sure its users follow these terms.</p>
        <p>The customer is responsible for the content its users add, and for having the right to add it.</p>
        <p>The service may not be used for anything unlawful, to harm others, or in a way that puts the service’s security or operation at risk.</p>
      </Section>

      <Section n={6} title="The customer’s data">
        <p>The customer owns its data. The provider uses it only to provide the service, as described in the data processing agreement.</p>
        <p>Where the provider handles personal data for the customer, the provider is the customer’s processor and the data processing agreement applies.</p>
      </Section>

      <Section n={7} title="Availability and support">
        <p>The provider aims to keep the service available at all times, but doesn’t promise uninterrupted access. Planned maintenance is announced in advance where possible.</p>
        <p>Support is given by email{contact ? <> to <a href={`mailto:${contact}`} className="text-brand-400 hover:underline">{contact}</a></> : <> (<Missing what="support address" />)</>}.</p>
      </Section>

      <Section n={8} title="Changes to prices and terms">
        <p>The provider announces changes to prices or these terms <Decided value={T.changeNotice ? `at least ${T.changeNotice}` : ''} what="notice period for changes" /> before they take effect. If the customer doesn’t accept a change, it may end the agreement from the day the change takes effect.</p>
      </Section>

      <Section n={9} title="Term and ending the agreement">
        <p>The agreement runs for <Decided value={T.initialTerm} what="initial period" /> from acceptance and is then extended by the same period at a time, unless ended with a notice period of <Decided value={T.noticePeriod} what="notice period" />.</p>
        <p>Either party may end the agreement immediately if the other seriously breaches it and doesn’t put it right within a reasonable time after being asked to.</p>
        <p>When the agreement ends, the customer can ask for an export of its data. The provider deletes the customer’s data within {LEGAL.deleteAfterAgreementEndsDays} days after the agreement ends, and backups within a further {LEGAL.backupRetentionDays} days.</p>
      </Section>

      <Section n={10} title="Liability">
        <p>The provider’s total liability under the agreement is limited to <Decided value={T.liabilityCap} what="liability cap" />. Neither party is liable for indirect loss, such as lost profit, unless caused by gross negligence or intent.</p>
        <p>Neither party is liable for delays or failures caused by circumstances outside its reasonable control.</p>
      </Section>

      <Section n={11} title="Law and disputes">
        <p>The agreement is governed by <Decided value={T.governingLaw} what="governing law" />. Disputes are settled by <Decided value={T.disputes} what="dispute forum" />.</p>
      </Section>
    </article>
  )
}
