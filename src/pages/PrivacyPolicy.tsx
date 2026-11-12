import { Link } from 'react-router-dom'
import { Shield } from 'lucide-react'
import { LEGAL, publishedSubProcessors } from '@/config/legal'
import { useLegal } from '@/lib/publicConfig'
import { ProviderDetails } from '@/components/LegalFooter'
import { usePageMeta } from '@/lib/pageMeta'

const updated = new Date(`${LEGAL.privacyPolicyUpdated}T12:00:00`)
  .toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

export default function PrivacyPolicy() {
  usePageMeta(`${LEGAL.appName} · Privacy policy`, `How ${LEGAL.appName} handles personal data: what is stored, why, for how long, and who to contact.`)
  const legal = useLegal()
  const privacyEmail = legal('privacyContactEmail')
  const provider = legal('providerName') ?? 'the provider'
  const contactMonths = LEGAL.contactRetentionMonths
  const subProcessors = publishedSubProcessors()
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200">
      <div className="max-w-3xl mx-auto px-6 py-12">

        <div className="flex items-center gap-3 mb-10">
          <Shield className="w-8 h-8 text-brand-400 flex-shrink-0" />
          <div>
            <h1 className="text-3xl font-bold text-white">Privacy Policy</h1>
            <p className="text-sm text-zinc-500 mt-0.5">{LEGAL.appName} — last updated {updated}</p>
          </div>
        </div>

        <div className="prose prose-invert prose-zinc max-w-none space-y-10 text-sm leading-relaxed">

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">1. Who we are</h2>
            {/* Draft wording on controller and processor roles — for review by
                whoever handles data protection (docs/privacy-review-notes.md) */}
            <div className="space-y-3 text-zinc-300">
              <p>
                {LEGAL.appName} ({LEGAL.appDomain}) is a platform for running film schools and film and equipment
                departments. It is provided by <strong>{provider}</strong> (“the provider”).
              </p>
              <ProviderDetails className="text-sm" />
              <p>
                <strong>When a school or other organisation uses {LEGAL.appName}</strong> for its students and staff,
                that organisation is the <strong>data controller</strong> for their personal data: it decides what the
                service is used for and who has access. The provider processes that data on the organisation’s behalf,
                as its <strong>processor</strong>. This is intended to be covered by a data processing agreement between
                the organisation and the provider.
              </p>
              <p>
                <strong>For messages sent through the public contact form, and for operating this website,</strong> the
                provider is the data controller.
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">2. What data we collect</h2>
            <ul className="list-disc pl-5 space-y-1.5 text-zinc-300">
              <li><strong>Account data:</strong> name, email address, profile photo, school email</li>
              <li><strong>Attendance records:</strong> lesson check-ins, absence reports, attendance timestamps</li>
              <li><strong>Academic activity:</strong> assignment submissions, test results, points and level history</li>
              <li><strong>Chat messages:</strong> messages sent in group channels and direct messages</li>
              <li><strong>Room bookings:</strong> which rooms you have booked and when</li>
              <li><strong>Development plans:</strong> personal reflections and goals entered in the NOPRA plan tool</li>
              <li><strong>Device tokens:</strong> FCM push notification tokens tied to your devices</li>
              <li><strong>Usage metadata:</strong> timestamps of logins, last-read markers for notifications</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">3. Why we collect it and legal basis</h2>
            <div className="space-y-3 text-zinc-300">
              <p><strong>Educational administration (contractual necessity — GDPR Art. 6.1b):</strong> Attendance
              tracking, lesson materials, assignment grading, and timetabling are core functions of the school's
              educational agreement with you.</p>
              <p><strong>Communication (legitimate interest — GDPR Art. 6.1f):</strong> Chat, push notifications,
              and absence reporting enable effective communication between students and staff.</p>
              <p><strong>School resource management (legitimate interest):</strong> Room bookings, vehicle requests,
              and food box orders.</p>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">4. How long we keep your data</h2>
            {/* Draft — for review (docs/privacy-review-notes.md). Describes what
                the app actually does; the organisation decides for its users. */}
            <p className="text-zinc-300 mb-3">
              Your school or organisation decides how long its students’ and staff’s data is kept. It can delete
              accounts at any time, and it can choose to have former students’ data deleted automatically a set time
              after their class ends. You can delete your own account from your profile at any time.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-white/10">
                    <th scope="col" className="text-left py-2 pr-6 font-semibold text-zinc-300">Data</th>
                    <th scope="col" className="text-left py-2 font-semibold text-zinc-300">How long it is kept</th>
                  </tr>
                </thead>
                <tbody className="text-zinc-400 divide-y divide-white/5">
                  {[
                    ['Account, attendance, assignments and grades, bookings, points, development plans',
                      'While your organisation uses ' + LEGAL.appName + ' and decides to keep it, or until the account is deleted'],
                    ['Chat messages', 'For the period your organisation sets (until deleted, if it sets none)'],
                    ['Former students (in a class that has ended)', 'Deleted automatically after the period your organisation sets, if it has turned this on'],
                    ['Push notification tokens', 'Removed when you sign out or the device stops accepting notifications'],
                    ['All data of an organisation that stops using ' + LEGAL.appName, `Deleted within ${LEGAL.deleteAfterAgreementEndsDays} days after the agreement ends, unless the organisation first asks for a copy`],
                    ['Backups', `${LEGAL.backupRetentionDays} days`],
                    ['Record that an account was deleted (account id and date only)', 'Kept as proof that the deletion was carried out'],
                    ['Contact form messages', `${contactMonths} months (longer only while on legal hold)`],
                  ].map(([type, period]) => (
                    <tr key={type}>
                      <td className="py-2 pr-6">{type}</td>
                      <td className="py-2">{period}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">5. Who can see your data</h2>
            <ul className="list-disc pl-5 space-y-1.5 text-zinc-300">
              <li><strong>You</strong> — can see all your own data</li>
              <li><strong>Teachers</strong> — can see attendance, submissions, grades, development plans, and booking requests for students in their class</li>
              <li><strong>Administrators</strong> — can see all of the above for all students</li>
              <li><strong>Other students</strong> — can see your name and profile photo; room bookings show your first name on the public display</li>
              <li><strong>Google Firebase</strong> — processes data as our infrastructure provider; does not use it for advertising</li>
            </ul>
            {/* Only sub-processors marked verified in src/config/legal.ts are listed */}
            {subProcessors.length > 0 && (
              <div className="mt-6">
                <h3 className="text-base font-semibold text-white mb-2">Sub-processors</h3>
                <p className="text-zinc-300 mb-3">
                  The provider uses these companies to run {LEGAL.appName}. The list may change; customers will be
                  informed of changes.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="border-b border-white/10">
                        <th scope="col" className="text-left py-2 pr-4 font-semibold text-zinc-300">Company / service</th>
                        <th scope="col" className="text-left py-2 pr-4 font-semibold text-zinc-300">Purpose</th>
                        <th scope="col" className="text-left py-2 pr-4 font-semibold text-zinc-300">Processing location</th>
                        <th scope="col" className="text-left py-2 font-semibold text-zinc-300">Safeguard if data leaves the EEA</th>
                      </tr>
                    </thead>
                    <tbody className="text-zinc-400 divide-y divide-white/5">
                      {subProcessors.map(p => (
                        <tr key={p.name}>
                          <td className="py-2 pr-4 text-zinc-300">{p.name}</td>
                          <td className="py-2 pr-4">{p.purpose}</td>
                          <td className="py-2 pr-4">{p.location}</td>
                          <td className="py-2">{p.safeguard}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">6. Your rights under GDPR</h2>
            <div className="space-y-3 text-zinc-300">
              <p><strong>Right of access:</strong> You can download all your personal data from your profile page using the "Download My Data" button.</p>
              <p><strong>Right to rectification:</strong> You can update your name, photo, and email in your profile at any time.</p>
              <p><strong>Right to erasure ("right to be forgotten"):</strong> You can permanently delete your account and associated data from your profile page. Attendance records will be anonymised rather than deleted, as the school has a legitimate interest in maintaining attendance statistics.</p>
              <p><strong>Right to data portability:</strong> Your data export is in JSON format, which is machine-readable and portable.</p>
              <p><strong>Right to object:</strong> Contact your school administrator to raise objections to specific uses of your data.</p>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">7. Cookies and local storage</h2>
            <p className="text-zinc-300">
              CineForge uses browser local storage (not cookies) to store notification read-state and UI preferences.
              No tracking cookies or third-party advertising scripts are used. Firebase Authentication uses a
              session token stored in IndexedDB to keep you logged in.
            </p>
          </section>

          {/* Wording drafted with the contact form — to be reviewed by the
              provider or the school's data protection officer */}
          <section>
            <h2 className="text-lg font-semibold text-white mb-3">8. The public contact form</h2>
            <div className="space-y-3 text-zinc-300">
              <p>
                Anyone, including people without an account, can write to us through the contact form linked from the
                login page.
              </p>
              <p><strong>What is stored:</strong> your name, email address, organisation (if given), the subject you
              choose, your message, your browser's user-agent string, and a one-way salted hash of your IP address.
              The IP address itself is never stored; the hash is used only to limit how many messages can be sent from
              one connection.</p>
              <p><strong>Purpose:</strong> to read and answer your message, and to protect the form against abuse.</p>
              <p><strong>Legal basis:</strong> our legitimate interest in answering enquiries and keeping the service
              secure (GDPR Art. 6.1f), or steps taken at your request before entering into an agreement
              (GDPR Art. 6.1b), for example when a school asks about using {LEGAL.appName}.</p>
              <p><strong>Who sees it:</strong> administrators of {LEGAL.appName}. Your message is also forwarded by
              email to our contact address so it can be answered.</p>
              <p><strong>How long:</strong> messages are deleted automatically {contactMonths} months after they
              arrive. A message is kept longer only if it is placed on legal hold because of an ongoing legal
              matter, and only for as long as that matter requires.</p>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">9. Contact and complaints</h2>
            {/* Draft wording — for review (docs/privacy-review-notes.md) */}
            <p className="text-zinc-300">
              <strong>Students and staff:</strong> for questions or requests about your personal data, contact your
              school’s or organisation’s administrator first. They are responsible for your data in {LEGAL.appName}.
            </p>
            {privacyEmail && (
              <p className="mt-2 text-zinc-300">
                <strong>Contact form and this website:</strong> for questions about messages sent through the contact
                form or about this website, email {provider} at{' '}
                <a href={`mailto:${privacyEmail}`} className="text-brand-400 hover:underline">{privacyEmail}</a>.
              </p>
            )}
            <ProviderDetails className="mt-3 text-sm" />
            <p className="mt-2 text-zinc-300">
              If you believe your data is being processed unlawfully, you have the right to lodge a complaint with
              the Swedish supervisory authority:{' '}
              <a
                href="https://www.imy.se"
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-400 hover:underline"
              >
                Integritetsskyddsmyndigheten (IMY) — imy.se
              </a>
            </p>
          </section>

        </div>

        <div className="mt-12 pt-6 border-t border-white/10 flex items-center justify-between text-xs text-zinc-500">
          <span>{LEGAL.appName} · {provider} · last updated {updated}</span>
          <Link to="/login" className="text-brand-400 hover:underline">Back to login</Link>
        </div>
      </div>
    </div>
  )
}
