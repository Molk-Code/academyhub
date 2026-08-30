# CineForge architecture review — fixes to work through in Claude Code

Context: this was written from a Cowork session that doesn't have Firebase CLI access,
based on reading the codebase only. Claude Code has live Firebase access (Firestore,
Auth, Functions logs) — use that to verify each finding before changing anything, since
some of this is inferred from code alone and should be double-checked against real data.

Suggested order: #1 first (live bug, security-relevant), then #2/#3 (real but not on
fire), then #4–#7 (foundational, do incrementally rather than as one big PR).

---

## 1. Auth custom claims drift from Firestore (live bug — fix first)

**Where:** `src/contexts/AuthContext.tsx` (~line 70–82).

**Problem:** `cohortId` (and other permission-relevant fields) is resolved as
`claimCohortId ?? profileDoc.cohortId ?? null`, prioritizing the ID token's custom
claims over the live Firestore `users/{uid}` doc. Custom claims are set once, in
`onUserCreate` (functions/src/index.ts), from the invitation at signup time, and never
refreshed afterward. When an admin later changes a user's role or cohort via the admin
UI (`updateDoc(doc(db,'users',uid), {...})` in `UserManager.tsx` / `CohortManager.tsx`),
the Firestore doc updates immediately but the claim doesn't — so the user keeps their
old permissions/visible data until they manually sign out and back in. We hit this
directly: a teacher's `cohortId` in Firestore was `null` but calendar sync events
targeted at "all cohorts" still didn't show for them, because their cached token likely
still carried a stale claim.

**Also check:** grep `firestore.rules` for `request.auth.token.cohortId` and
`request.auth.token.role` — everywhere those appear, this isn't just a display bug,
it's a security rule relying on stale data (e.g., someone demoted from teacher to
student could retain teacher-level write access until they log out).

**Fix — do both:**
1. Add a Firestore-triggered Cloud Function (`onUpdate` on `users/{uid}`) that calls
   `admin.auth().setCustomUserClaims(uid, { role, cohortId })` whenever those fields
   change, so claims stay in sync automatically without a manual re-invite flow.
2. On the client, force a token refresh when it matters: add a listener on the
   currently-signed-in user's own `users/{uid}` doc, and call
   `auth.currentUser.getIdToken(true)` when `role` or `cohortId` changes on it. This
   makes permission changes apply within seconds instead of requiring logout.

Verify by: change a test user's cohort/role as admin, confirm (without logging that
user out) their client picks up the new value within a few seconds.

---

## 2. Subscription tier gating is client-side only

**Where:** `src/hooks/useFeature.ts` + `src/lib/features.ts` (tier→feature map),
`firestore.rules`.

**Problem:** `useFeature`/`useTier` control what renders/routes in the UI based on the
school's tier (Studio/Academy/Campus), but nothing in `firestore.rules` checks tier —
only role (admin/teacher/student). A user on Academy tier (no production/equipment
per the pricing model) can still read/write `productions/*`, `equipment/*`,
`equipment_bookings/*`, `inventory_projects/*` etc. directly via the Firestore SDK,
since rules only gate by role there. If tier is meant to be a real paywall (it should
be, given it's priced), this is a revenue leak, not just a cosmetic gap.

**Fix:**
1. Find where the school's tier lives (`schools/{schoolId}.tier` per the superadmin
   registry, or possibly `settings/school` for the single-tenant case right now —
   check both, they may be out of sync, see #3).
2. Add a `firestore.rules` helper that reads the tier via `get()` and mirrors the
   tier→feature map from `src/lib/features.ts` (rules can't import JS, so this needs
   to be reimplemented in rules syntax — keep the two in sync manually, or generate
   the rules snippet from the same source list to avoid drift).
3. Apply it to `allow read, write` on the gated collections (start with `productions`,
   `equipment`, `equipment_bookings`, `inventory_projects`).

---

## 3. Multi-tenancy is a registry, not real data isolation

**Where:** `firestore.rules` — `schoolId` only appears inside the `/schools/{schoolId}`
match block itself (the superadmin registry). No other collection (`users`, `cohorts`,
`lessons`, `equipment`, `chat_channels`, etc.) is scoped by `schoolId`.

**Problem:** Fine today with one school on the project, but if a second school is ever
onboarded into the *same* Firebase project, all core data is currently global — both
schools' users, classes, chat, equipment would share one pool.

**Decide first, then act:**
- Option A (simplest): each new school gets its own Firebase project. No code changes
  needed; the Schools Registry becomes purely a directory/CRM, not a live-data
  partition. Recommended unless multi-school-per-project is a near-term requirement.
- Option B (shared project): thread `schoolId` through every top-level collection,
  every query, and every rule. This is a real migration — inventory every collection,
  add `schoolId` to new docs going forward, write a backfill script for existing docs,
  update every rule's `allow` clauses, update every client query to filter by
  `schoolId`. Don't attempt this piecemeal; treat it as a dedicated project.

---

## 4. No automated tests

**Where:** confirmed zero test files under `src/` or `functions/src/` (only
`node_modules` third-party tests matched a `*.test.ts` search).

**Fix, incrementally:**
- Frontend: add Vitest (pairs naturally with the existing Vite setup) — start with
  the money/safety-adjacent logic: point/prize redemption math, grade calculation,
  tier gating (`hasFeature`).
- Functions: add `firebase-functions-test` + Vitest/Jest against the Firestore/Auth
  emulators. Priority coverage: `processRedemption`, `gradeSubmission`,
  `exportUserData`/`deleteUserData` (GDPR), the new claims-sync trigger from #1, and
  `receiveOfficeCalendarEvent` (the calendar webhook — already has clear input/output
  contracts, cheap to test: valid payload, missing externalId, disabled sync, delete
  branch, isAllDay string/boolean coercion).
- Wire `firebase emulators:exec "npm test"` into CI once tests exist.

---

## 5. No error monitoring in production

**Problem:** No Sentry or equivalent in `package.json`. We only caught the timezone
parsing edge case and the claims-drift bug this session through manual back-and-forth
testing — in production, issues like that currently have no way to surface except a
student or teacher complaining.

**Fix, cheapest first:**
- Cloud Functions: already deployed on GCP, so Cloud Error Reporting is essentially
  free and mostly automatic — thrown errors and `console.error` calls are already
  visible in Cloud Logging. Check `console.error` usage is consistent (it is, e.g. in
  `receiveOfficeCalendarEvent`), and consider enabling/reviewing the Error Reporting
  dashboard in the GCP console for `academy-hub-c252f`.
- Frontend: nothing currently catches client-side JS errors. Add `@sentry/react`
  (free tier is fine for this scale) or, at minimum, a global `window.onerror` /
  `ErrorBoundary` (there's already an ErrorBoundary component per the feature list —
  check whether it just shows a fallback UI or also reports the error anywhere).

---

## 6. `functions/src/index.ts` is a single ~2,900-line file

**Problem:** every Cloud Function — attendance, grading, points, PDFs, email, GDPR,
calendar sync, everything — lives in one file. Works today, but reviewing diffs and
finding things gets harder as it grows.

**Fix:** split by domain, each file exporting its functions, re-exported from
`index.ts` (or have `index.ts` just do `export * from './attendance'` etc.). Suggested
split: `attendance.ts`, `grading.ts`, `points.ts` (redemption/prizes),
`gdpr.ts` (export/delete user data), `calendarSync.ts` (the new
`receiveOfficeCalendarEvent`), `notifications.ts` (push/email), `production.ts`
(PDF exports), `users.ts` (invites, claims, password reset). Do this mechanically,
one domain at a time, with a deploy + smoke test after each move — low risk since it's
pure code motion, not logic changes, but do it in small steps to keep diffs reviewable.

---

## 7. Duplicate user documents (worked around, not fixed)

**Where:** `src/pages/student/Calendar.tsx`, the `invitableGroups` memo — it groups
`users` docs by `displayName` and merges their doc IDs into one group specifically
because, per the code comment, "the same person can end up with multiple `users`
documents."

**Problem:** this is a workaround living in one component. Any other query against
`users` that doesn't do the same displayName-matching trick will silently treat
duplicate docs as different people (e.g., attendance stats, leaderboard points,
invite-to-event flows elsewhere).

**Fix:**
1. Find the root cause first — check `onUserCreate`, the invite-acceptance flow, and
   anywhere else a `users/{id}` doc gets created (bulk invite tool, CSV import if any).
   Likely candidates: re-inviting an email that already has an account, or a
   placeholder doc created before invite-acceptance that doesn't get cleaned up.
2. Prevent new duplicates at the source once found.
3. Write a one-time script (run once via `firebase functions:shell` or a temporary
   callable) to find and merge existing duplicates by matching `email` (more reliable
   than `displayName`), keeping the doc whose ID matches the Firebase Auth `uid` and
   migrating any references (points, attendance, personal_events, etc.) to it.
4. Once cleaned up, remove the displayName-grouping workaround from `Calendar.tsx`.

---

## Not urgent, but noted from the same review

- Bundle size warnings on `vite build` (vendor chunks >500kB — Firebase SDK, xlsx,
  editor). Worth a `manualChunks` pass in `vite.config.ts` if load times on school
  wifi/older devices become a complaint.
- No admin-facing analytics/reporting dashboard despite having rich structured data
  (attendance, points, equipment usage, grades) — likely a good next *feature*, not a
  fix, but flagging since the data's already there.
