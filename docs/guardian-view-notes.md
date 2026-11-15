# Guardian view: design note (not built)

A read-only view where a parent or guardian follows one student's attendance, assignments and
grades. Not built yet; this note is the starting point if schools ask for it. It is not legal
advice. Check the points below with the school's data protection officer before building.

## Who it is for

Students in vocational and folk high school programmes are often adults, and then a guardian
has no part in the student's data. The view only makes sense for students under 18, and then
only as far as the school's own rules and the law allow.

## Data model (additive)

- `guardian_links/{id}`: `studentId`, `guardianUid`, `relationship` (free text),
  `status` (`invited` | `active` | `revoked`), `createdBy` (staff uid), `createdAt`,
  `consent` (`{ by: 'student' | 'staff', at, note }`), `expiresAt` (default: the student's
  18th birthday or the end of the class, whichever comes first).
- Guardians are users with a new role `guardian`, invited by email by staff only. No
  self-sign-up and no guardian invite links students can create.
- No copies of grades or attendance: the view reads the same data through a callable
  (`guardianSummary`) that checks an active link and returns only the summary fields: the
  same as the term summary (attendance, assignments, status, score, pass), without teacher
  feedback, absence reasons, chat, videos or other students' data.
- Rules: guardians get no direct read access to `submissions`, `points_log`, `absence_reports`
  or `lessons`. `guardian_links` is readable by the linked guardian and staff, writable by
  staff only (least privilege).

## Consent and GDPR

- **Legal basis**: the school decides (public task for municipal and region schools, or
  consent). The school is the data controller; CineForge is the processor under the DPA, which
  needs a line for guardian access.
- **Minors**: show the student who can see their data. From an age the school sets (often 16),
  ask the student before a link becomes active, or let them object. A student who turns 18
  loses the link automatically.
- **Protected identity** (skyddad identitet) and separated parents: a link is never created
  from data in the app alone. Staff confirm the guardian against the school's own records, and
  can revoke a link at once.
- **Minimisation**: no absence reasons (they can be health data), no teacher feedback text, no
  free-text messages.
- **Transparency and rights**: the privacy page lists guardian access; the student and the
  guardian can export or ask to delete the link; links and their revocations are logged
  (who, when).
- **Retention**: revoked and expired links are deleted after a set period (for example 30
  days), with the existing retention job.

## Plan and scope

Fits Academy Standard and up, behind a per-school switch that is off by default. Build only
when a school asks, and after its data protection officer has approved the points above.
