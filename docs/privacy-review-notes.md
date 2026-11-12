# Privacy policy and public pages: review notes

Written 2026-11-12 with the changes to `/login`, `/contact` and `/privacy`.
Everything below needs a decision or a check by the provider (Fredrik Fridlund
Cinematography AB) or whoever handles data protection for the provider or the
school. Nothing here is legal advice.

## 1. Changed policy text (draft, needs review)

| Where | Change |
|---|---|
| Header | "Last updated" now comes from `privacyPolicyUpdated` in `src/config/legal.ts` (2026-11-12). |
| Section 1 "Who we are" | Rewritten. Names the provider. The school or organisation is the **controller** for its users' data, and the provider is its **processor**. The provider is controller for contact-form messages and for running the website. |
| Section 1 | **Removed:** "A Data Processing Agreement (DPA) is in place with Google under their standard Firebase Terms of Service". See 2.1. |
| Section 1 | **Removed:** "Google Firebase … hosting all data on servers within the European Economic Area". The database, functions and file storage are in the EU (checked), but Authentication, Hosting, Cloud Messaging and Performance Monitoring are not confirmed (see 3). |
| Section 5 | New "Sub-processors" table. It shows only entries marked `verified: true` in `legal.ts`. **All are unverified, so no table is shown yet.** |
| Section 9 "Contact" | Students and staff contact their organisation's administrator first. The provider is contacted via `privacyContactEmail` for contact-form messages and the website; that line is hidden until the address is set. The IMY paragraph is unchanged. |
| Footer | "GDPR-compliant data handling" replaced with "CineForge · Fredrik Fridlund Cinematography AB · last updated …". |

## 2. Decisions and confirmations needed

1. **DPA with Google.** I can't see whether Google's data processing terms have been
   accepted for the `cineforge-eu` project. Check in the Firebase console: Project
   settings → General (scroll down) and/or the Google Cloud console: IAM & Admin →
   Settings ("Data Processing and Security Terms" / "Cloud Data Processing Addendum").
   Once accepted, add a sentence such as "Google processes data under its Cloud Data
   Processing Addendum" if you want it in the policy.
2. **DPAs with schools.** Section 1 says the school's use "is intended to be covered by a
   data processing agreement between the organisation and the provider". If a DPA is
   signed with each customer, change "is intended to be" to "is". If not, one is
   needed before the processor role holds (GDPR Art. 28).
3. **Section 3 (legal basis).** Unchanged. It states the school's legal bases (Art.
   6.1b and 6.1f). These are the controller's (the school's) decisions; check them with
   the school. Public authorities and schools often rely on Art. 6.1e (public task)
   instead.
4. **Section 5, "Google Firebase … does not use it for advertising".** Unchanged, but not
   verified from the repo. Check against Google's terms or remove.
5. **Section 7, "No tracking cookies or third-party advertising scripts".** True for
   advertising, but the app also loads:
   - **Google Fonts** from `fonts.googleapis.com`, `fonts.gstatic.com` (`src/index.css`).
     Every visitor's IP address goes to Google. Self-hosting the two fonts (Inter, Plus
     Jakarta Sans) would remove this; recommended.
   - **Firebase Performance Monitoring** (`src/lib/firebase.ts`, `getPerformance`):
     sends page-load and network timing to Google.
   Consider mentioning both in section 7, or remove Performance Monitoring.
6. **Third parties the browser calls directly** (not sub-processors in the usual sense,
   but they receive the user's IP address; mention them or decide not to):
   - Production schedule: `nominatim.openstreetmap.org` (address lookup), `api.open-meteo.com` and
     `archive-api.open-meteo.com` (weather), `api.sunrise-sunset.org`
     (`src/pages/student/production/ScheduleTab.tsx`).
   - School settings: `open.er-api.com` (currency rates, admins only, `src/pages/admin/SchoolInfo.tsx`).
   - Opening resources: YouTube embeds, the Microsoft Office online viewer
     (`view.officeapps.live.com`), the Google Docs viewer (`docs.google.com`)
     (`src/pages/*/Resources.tsx`).
   - SharePoint and OneDrive through Microsoft Graph, in the school's own Microsoft 365
     tenant (`src/lib/graphApi.ts`). The school is already Microsoft's customer for this.

## 3. Sub-processors: how to verify each one

To publish one, fill in `location` and `safeguard` with the checked facts and set
`verified: true` in `src/config/legal.ts`. The policy then shows the table.

| Sub-processor | Status | How to check |
|---|---|---|
| Google Cloud Firestore | Location **checked**: `eur3` (EU multi-region, Belgium and the Netherlands) via `firebase firestore:databases:get "(default)" --project eu`. | Safeguard: confirm the Google terms (2.1). |
| Google Cloud Functions | Location **checked**: `europe-west1` (Belgium) from `functions/.env.cineforge-eu`; `firebase functions:list --project eu` shows it. | Safeguard: as above. |
| Google Cloud Storage | Location **checked**: `EUROPE-WEST1` (single region) via `gcloud storage buckets describe gs://cineforge-eu.firebasestorage.app --format="value(location)"`. The backups bucket `gs://cineforge-eu-backups` is `EU` (multi-region). | Safeguard: as above. |
| Firebase Authentication | Not confirmed; Authentication has no per-project location setting. | See Google's "Privacy and Security in Firebase" page (firebase.google.com/support/privacy), which lists where each Firebase product processes data. |
| Firebase Hosting | Not confirmed: a global CDN, so pages are served from the nearest edge. | Same page. Likely needs a transfer safeguard (Google's terms with Standard Contractual Clauses). |
| Firebase Cloud Messaging | Not confirmed. | Same page. |
| Firebase Performance Monitoring | Not confirmed. | Same page, or remove it from the app (2.5). |
| Cloudinary | Not confirmed. | Cloudinary console → Settings → Account / product environment: check which data centre (region) the cloud is hosted in. Cloudinary's Data Processing Addendum is linked from its privacy policy and trust pages. **Note:** `.env.eu` has no `VITE_CLOUDINARY_*` values, so uploads to Cloudinary from the EU build are probably not configured yet. |
| Resend | Not confirmed. | Resend dashboard → Domains: each sending domain shows the region it was created in (e.g. us-east-1 or eu-west-1 Ireland). Resend's DPA is under its legal pages. If the domain is in the US, the safeguard is needed. |

## 4. Placeholders still unset in `src/config/legal.ts`

- `orgNumber`: organisationsnummer of Fredrik Fridlund Cinematography AB
- `streetAddress`, `postalCode`, `city`: postal address (country is set to Sweden but
  is only shown once a street or city is set)
- `contactEmail`: role address (e.g. contact@cineforge.se). Also set it as
  `CONTACT_NOTIFY_EMAIL` in `functions/.env.cineforge-eu`.
- `privacyContactEmail`: role address (e.g. privacy@cineforge.se)
- `vatNumber`: optional
- Every `subProcessors` entry: `verified: false`, and `safeguard` or `location` placeholders (section 3)

Lines with a placeholder are never shown. These values can also be set without a
deploy in Firestore `public_config/main.legal` (same field names).

## 5. Security headers and Content Security Policy

Set in `firebase.json` (production, **not deployed**) and `firebase.eu.json`:
`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` (no page of the app is
embedded in a frame; the app only embeds others), `Referrer-Policy:
strict-origin-when-cross-origin`, `Permissions-Policy: camera=(self), microphone=(),
geolocation=(self)` (camera for QR and barcode scanning, geolocation for "use my
location" in the production schedule, no microphone use found), `Strict-Transport-Security:
max-age=31536000; includeSubDomains`.

**includeSubDomains:** once browsers see it on cineforge.se, every subdomain of
cineforge.se must work over HTTPS for a year. Check there is no http-only subdomain
before deploying.

`Content-Security-Policy-Report-Only` (logs violations, blocks nothing). Origins and
where they come from:

| Directive | Origin | Used by |
|---|---|---|
| script-src | 'self' | app bundle; `/boot.js` and `/display.js` (were inline scripts, moved to files so no 'unsafe-inline' is needed) |
| script-src | www.gstatic.com | `display.html` Firebase modules; service worker `importScripts` |
| style-src | 'unsafe-inline' | React `style={{}}` props, `display.html` `<style>` |
| style-src, font-src | fonts.googleapis.com, fonts.gstatic.com | `src/index.css` |
| connect-src | firestore, identitytoolkit, securetoken, firebaseinstallations, fcmregistrations, firebaselogging-pa, firebaseremoteconfig, firebase, firebasestorage (.googleapis.com) | Firebase SDKs |
| connect-src | *.cloudfunctions.net | HTTP functions; callables |
| connect-src | api.cloudinary.com, res.cloudinary.com | `src/lib/cloudinary.ts` |
| connect-src | graph.microsoft.com, login.microsoftonline.com, *.sharepoint.com | `src/lib/graphApi.ts`, `src/contexts/MicrosoftAuthContext.tsx` |
| connect-src | open.er-api.com, nominatim.openstreetmap.org, api.open-meteo.com, archive-api.open-meteo.com, api.sunrise-sunset.org | see 2.6 |
| frame-src | www.youtube.com, view.officeapps.live.com, docs.google.com, firebasestorage, res.cloudinary.com, *.sharepoint.com | resource and PDF viewers |
| frame-src | login.microsoftonline.com, *.firebaseapp.com | MSAL silent token, Firebase Auth helper |
| img-src | https: data: blob: | Cloudinary, Storage, SharePoint thumbnails, user-linked images, QR codes |
| media-src | res.cloudinary.com, firebasestorage, *.sharepoint.com, blob: | video player |

Checked locally (EU build served with `firebase serve --config firebase.eu.json`):
`/login`, `/contact` and `/privacy` load only allowed origins. No violation events
fired while moving between them.

**When to switch to enforcing** (`Content-Security-Policy`), after about a week of real use:
1. Add a reporting endpoint (`report-to` or `report-uri`), or ask a few users to send
   console screenshots. Without one, violations are only visible in each user's console.
2. No violations for a full week from normal use of every role: student, teacher, admin,
   rental, room display, QR display and the phone scanner.
3. Known open ends are decided: resources linking PDFs or videos on hosts not listed
   (frame-src and media-src would block them), App Check, which needs reCAPTCHA origins
   when switched on, and the `img-src https:` wildcard (narrow it if possible).
4. Enforce on the EU project first, watch for a day, then do the same in production.
