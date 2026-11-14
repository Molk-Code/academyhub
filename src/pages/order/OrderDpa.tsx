import { Link } from 'react-router-dom'
import { LEGAL, publishedSubProcessors } from '@/config/legal'
import { ORDER_TERMS as T, TERMS_VERSION } from '@/config/orderTerms'
import { useLegal } from '@/lib/publicConfig'
import { Decided, Missing } from './OrderLayout'
import { Section, ProviderLine } from './OrderTerms'

// Draft data processing agreement (personuppgiftsbiträdesavtal), structured
// after the points GDPR Art. 28(3) lists. Wording for legal review; it makes
// no claim of compliance. Sub-processors come from src/config/legal.ts and
// only verified ones are listed.

export default function OrderDpa() {
  const legal = useLegal()
  const privacy = legal('privacyContactEmail')
  const subProcessors = publishedSubProcessors()
  return (
    <article className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold text-white">Data processing agreement</h1>
        <p className="text-sm text-zinc-500 mt-1">{LEGAL.appName} for organisations · version {TERMS_VERSION}</p>
      </header>

      <Section n={1} title="Parties and roles">
        <p>This agreement is between the organisation that orders {LEGAL.appName} (“the controller”) and <ProviderLine /> (“the processor”). It is part of the agreement made under the <Link to="/order/terms" className="text-brand-400 hover:underline">Terms of Service</Link>.</p>
        <p>The controller decides why and how its users’ personal data is processed. The processor processes it only on the controller’s behalf.</p>
      </Section>

      <Section n={2} title="What is processed">
        <p><strong>Purpose and nature:</strong> providing {LEGAL.appName} to the controller: storing, showing, sending and deleting data as the controller’s users use the service, plus backups, support and security.</p>
        <p><strong>Duration:</strong> as long as the Terms of Service apply, and until the data is deleted after they end (section 9).</p>
        <p><strong>Data subjects:</strong> the controller’s students, staff and other users it invites; for the rental shop, people who book equipment; people named in productions (crew and cast).</p>
        <p><strong>Types of personal data</strong>, depending on the modules used:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>account details: name, email address, profile photo, role and class;</li>
          <li>attendance, absence reports, assignment submissions, results and points;</li>
          <li>chat messages, notifications and device tokens for push notifications;</li>
          <li>room, equipment and vehicle bookings;</li>
          <li>production details: crew and cast names, contact details and schedules;</li>
          <li>development plans entered by students;</li>
          <li>sign-in and usage times.</li>
        </ul>
        <p>The service isn’t designed for special categories of personal data (such as health data). The controller should not enter them except where the service asks for them, for example the reason for an absence, and is responsible for doing so lawfully.</p>
      </Section>

      <Section n={3} title="Instructions">
        <p>The processor processes the personal data only on the controller’s documented instructions. This agreement, the Terms of Service and the settings the controller makes in the service are those instructions.</p>
        <p>If the processor believes an instruction breaks data protection law, it tells the controller. If the law requires the processor to process data in another way, it tells the controller first, unless the law forbids that.</p>
      </Section>

      <Section n={4} title="Confidentiality">
        <p>Everyone at the processor who can access the personal data is bound by confidentiality, and gets access only as far as their work needs.</p>
      </Section>

      <Section n={5} title="Security">
        <p>The processor protects the personal data with technical and organisational measures suited to the risk, including:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>a separate installation and database for each customer;</li>
          <li>encryption in transit (HTTPS) and at rest, as provided by Google Cloud;</li>
          <li>access by role within the service, so that users see only what their role needs;</li>
          <li>daily backups, kept for {LEGAL.backupRetentionDays} days;</li>
          <li>logging of the provider’s administrative changes.</li>
        </ul>
      </Section>

      <Section n={6} title="Sub-processors">
        <p>The controller gives general authorisation for the processor to use sub-processors. The processor binds each sub-processor by a written agreement with data protection obligations at least as strict as these, and remains responsible for them.</p>
        <p>The processor tells the controller before adding or replacing a sub-processor. The controller may object on reasonable grounds; if the parties can’t agree, the controller may end the agreement.</p>
        {subProcessors.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-white/10 text-left text-zinc-300">
                  <th scope="col" className="py-2 pr-4 font-semibold">Sub-processor</th>
                  <th scope="col" className="py-2 pr-4 font-semibold">Purpose</th>
                  <th scope="col" className="py-2 pr-4 font-semibold">Location</th>
                  <th scope="col" className="py-2 font-semibold">Safeguard</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-zinc-400">
                {subProcessors.map(p => (
                  <tr key={p.name}><td className="py-2 pr-4">{p.name}</td><td className="py-2 pr-4">{p.purpose}</td><td className="py-2 pr-4">{p.location}</td><td className="py-2">{p.safeguard}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p><Missing what="verified sub-processor list (mark entries verified in src/config/legal.ts)" /></p>
        )}
      </Section>

      <Section n={7} title="Helping the controller">
        <p>Taking into account what the processor knows and the nature of the processing, the processor helps the controller:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>answer requests from data subjects, such as access, correction or deletion; many of these the controller can handle itself in the service;</li>
          <li>with security, data protection impact assessments and prior consultation with the supervisory authority.</li>
        </ul>
        <p>A request that reaches the processor directly is passed on to the controller and isn’t answered by the processor itself.</p>
      </Section>

      <Section n={8} title="Personal data breaches">
        <p>The processor tells the controller about a personal data breach without undue delay, and <Decided value={T.breachNotice} what="breach notice time" /> after becoming aware of it. The notice describes what is known about the breach, its likely consequences and the measures taken, and is completed as more becomes known.</p>
      </Section>

      <Section n={9} title="When the agreement ends">
        <p>On request before the agreement ends, the processor gives the controller an export of its data. The processor then deletes the personal data within {LEGAL.deleteAfterAgreementEndsDays} days after the agreement ends, and from backups within a further {LEGAL.backupRetentionDays} days, unless the law requires it to be kept.</p>
      </Section>

      <Section n={10} title="Information and audits">
        <p>The processor makes available the information the controller needs to show that the obligations in this agreement are met, and allows reasonable audits by the controller or an auditor it appoints, announced in advance. Each party bears its own costs, unless an audit shows a significant breach by the processor.</p>
      </Section>

      <Section n={11} title="Transfers outside the EU/EEA">
        <p>The processor stores customers’ data in the EU. Personal data is transferred outside the EU/EEA only where data protection law allows it, for example under the EU Commission’s standard contractual clauses, and only through sub-processors listed under section 6.</p>
      </Section>

      <Section n={12} title="Contact">
        <p>Questions about personal data: {privacy ? <a href={`mailto:${privacy}`} className="text-brand-400 hover:underline">{privacy}</a> : <Missing what="privacy contact address" />}.</p>
      </Section>
    </article>
  )
}
