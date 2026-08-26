import { Link } from 'react-router-dom'
import { Shield } from 'lucide-react'

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200">
      <div className="max-w-3xl mx-auto px-6 py-12">

        <div className="flex items-center gap-3 mb-10">
          <Shield className="w-8 h-8 text-brand-400 flex-shrink-0" />
          <div>
            <h1 className="text-3xl font-bold text-white">Privacy Policy</h1>
            <p className="text-sm text-zinc-500 mt-0.5">CineForge — last updated August 2026</p>
          </div>
        </div>

        <div className="prose prose-invert prose-zinc max-w-none space-y-10 text-sm leading-relaxed">

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">1. Who we are</h2>
            <p>
              CineForge is a digital platform for film school administration operated by your educational institution.
              Your school acts as the <strong>data controller</strong> — the organisation responsible for how your
              personal data is collected, stored, and used. Google Firebase (operated by Google Ireland Ltd, Gordon
              House, Barrow Street, Dublin 4, Ireland) acts as our <strong>data processor</strong>, hosting all data
              on servers within the European Economic Area.
            </p>
            <p className="mt-2">
              A Data Processing Agreement (DPA) is in place with Google under their standard Firebase Terms of Service,
              as required by GDPR Article 28.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">2. What data we collect</h2>
            <ul className="list-disc pl-5 space-y-1.5 text-zinc-300">
              <li><strong>Account data:</strong> name, email address, profile photo, phone number, school email</li>
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
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left py-2 pr-6 font-semibold text-zinc-300">Data type</th>
                    <th className="text-left py-2 font-semibold text-zinc-300">Retention period</th>
                  </tr>
                </thead>
                <tbody className="text-zinc-400 divide-y divide-white/5">
                  {[
                    ['Account profile', '1 year after course end'],
                    ['Attendance records', '1 year after course end'],
                    ['Assignment submissions & grades', '1 year after course end'],
                    ['Chat messages', '1 year after course end'],
                    ['Room bookings', '1 year after course end'],
                    ['Points log', '1 year after course end'],
                    ['Development plans (NOPRA)', '1 year after course end'],
                    ['Push notification tokens', 'Cleaned automatically when device is no longer active'],
                    ['Deletion logs', '5 years (legal obligation)'],
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
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">6. Your rights under GDPR</h2>
            <div className="space-y-3 text-zinc-300">
              <p><strong>Right of access:</strong> You can download all your personal data from your profile page using the "Download My Data" button.</p>
              <p><strong>Right to rectification:</strong> You can update your name, photo, phone number, and email in your profile at any time.</p>
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

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">8. Contact and complaints</h2>
            <p className="text-zinc-300">
              For questions or requests about your personal data, contact your school administrator.
            </p>
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
          <span>CineForge · GDPR-compliant data handling</span>
          <Link to="/login" className="text-brand-400 hover:underline">Back to login</Link>
        </div>
      </div>
    </div>
  )
}
