# Still hard-coded to one customer or to "CineForge"

Inventory for the rename / per-customer work (after the modules phases).
Counts are occurrences of the literal string "CineForge".

## 1. Customer data and personal data in the code (fix first)

| Where | What |
|---|---|
| `src/data/guideSeedData.ts` | Molkom FAQ seed: staff names, @regionvarmland.se emails, a phone number, Studio Molkom, opening hours. Personal data in the repo; should move to a per-customer seed file outside git (or be removed once seeded). |
| `functions/src/food-box.ts:276` | `FOOD_BOX_RECIPIENT` — a personal work address hard-wired as a recipient. Should come from `email_config/global.foodBoxEmail` only. |
| `src/lib/equipmentContract.ts:48`, `functions/src/equipment-signing.ts:27` | Equipment contract text names "Molkom Folk High School" (same text twice — client and server). |
| `src/pages/student/Guide.tsx:204` | "Key people at Molkoms folkhögskola". |
| `firestore.rules:921`, `src/pages/SuperAdmin.tsx:18` (default) | Superadmin email. Functions already read `SUPERADMIN_EMAILS` from env; the rules can't — generate it like the school id (`scripts/build-rules.mjs`) or use a custom claim. |

## 2. Project / deployment

| Where | What |
|---|---|
| `functions/src/lib.ts:20` | `APP_URL` default `https://academy-hub-c252f.web.app` (overridden per project in `functions/.env.<project>`). |
| `functions/src/gdpr.ts:11` | `GCLOUD_PROJECT` fallback `academy-hub-c252f` (only used if the runtime doesn't set it). |
| `src/pages/admin/OfficeCalendarSync.tsx:18` | Fallback functions host when `VITE_FIREBASE_PROJECT_ID` is missing. |
| `firestore.rules` `schoolDoc()` | `schools/molkom` — by design the one template line `scripts/build-rules.mjs` replaces. |
| `src/lib/school.ts`, `functions/src/lib.ts` | `SCHOOL_ID` default `molkom` (env overrides). |

## 3. Brand: name "CineForge"

- **Static, before any data loads:** `index.html` (title, meta ×3), `public/manifest.json` (×2), `public/display-manifest.json`, `firebase-templates/display.html` (×2), `firebase-templates/firebase-messaging-sw.js` (notification tag). These need build-time substitution per customer (the Vite template plugin already does this for Firebase config).
- **UI defaults:** `src/contexts/SchoolContext.tsx` (default name/shortName ×2), layouts (`AdminLayout`, `TeacherLayout`, `StudentLayout` ×3 each — logo alt/labels), `CompleteProfileGate`, `WelcomeModal`, `InstallPrompt`, `NotificationInit`, `UpgradePage`, `SchoolSignup`, `QrDisplay` (×4), `RoomDisplay`, `MyBookings`, `Profile`, `SchoolInfo`, `EmailConfig`, `SharePointSettings` (×5), `OfficeCalendarSync` (×3), `MicrosoftAuthContext`, `teacher/Lessons` (×4), `PrivacyPolicy` (×4 — partly via `LEGAL.appName`), `src/config/legal.ts` (`appName`).
- **Server-side output:** email sender default name in `minivan.ts` (×5), `food-box.ts`, `calendar.ts`, `auth.ts`, `contact.ts` (×3, subject prefix); PDF templates `production-pdf.ts` (×3), `notifications-core.ts`, `equipment-signing.ts`; exports `scheduleExport.ts`, `ShotLogTab.tsx`, `ContractSignatures.tsx`.
- **Superadmin "Studio Plan" badge** in the sidebar reads the stored legacy tier, so a modules-based customer still sees e.g. "Studio Plan" — should show `planName` / modules.

## 4. Visual / wording assumptions

- Login page: orange background gradient, orange button glow and orange field labels stay orange with a custom accent (only the button colour follows `primaryColor`).
- `you@school.com` placeholders: `Login.tsx` (×2), `AcceptInvite.tsx`, `SchoolSignup.tsx`; tagline default "Filmmaking Education Platform".
- Browser tab title comes from `schools/{id}.shortName` (not the login profile) once signed in; "CineForge" from `index.html` before.
- `src/pages/equipment/molkom.css` and the `molkom-app` / `student-molkom-app` class names (styling only).
- Tailwind `brand` palette is fixed orange (`tailwind.config.js`, `--brand` in `index.css`).
- Email "from" fallback `onboarding@resend.dev` in five functions — Resend's test sender, which only delivers to the Resend account owner.

## 5. Public rental shop — gaps noticed (for your decision)

- **No customer accounts:** guests submit a booking request with name/email/phone each time; no sign-up, no "my bookings" for guests, no way to see request status.
- **Shop password is not secret:** `shopPassword` lives on `schools/{id}`, which the rules let anyone read (`allow get: if true`), so the "password" protects nothing. Move it to a server-checked callable or a non-public doc.
- **Shop branding** uses the school doc's `name`, not the login profile (`public_config/main`).
- **No pricing / quotes / deposits / terms acceptance** in the guest flow; no availability calendar before submitting.
- **Guest booking spam:** guest creates are allowed by the rules when the shop is open, with no rate limit or App Check (compare the contact form, which has both).
- **No confirmation email to the guest** when a request is received or decided.
