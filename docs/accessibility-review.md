# Accessibility review — WCAG 2.1 AA (EN 301 549)

Date: 2026-11-12 · Scope: the web app (`modules` branch), dark theme · Method:
measured contrast for the palette, code scans for keyboard and naming issues,
and an in-browser audit of 18 pages (signed out, student, teacher, admin) with a
script that measures every visible text element's computed colour against its
effective background and lists focusable controls without an accessible name.

> This is a self-assessment, not a third-party audit. For public procurement
> and the Swedish accessibility statement (*tillgänglighetsredogörelse*, DOS-lagen)
> plan an external audit and a test with screen-reader users (NVDA, VoiceOver).

## Result

| Page group | Contrast failures | Unnamed controls | Before → after |
|---|---|---|---|
| Login, contact (signed out) | 0 | 0 | 1 unnamed (password eye) → 0 |
| Student: dashboard, calendar, assignments, profile, room booking, chat | 0 | 0 | 6 contrast + 6 unnamed → 0 |
| Teacher: dashboard, calendar, students, assignments | 0 | 0 | 2 contrast + 1 unnamed → 0 |
| Admin: users, contact requests, room booking | 0 | 0 | 6 unnamed → 0 |

Skip link present and first in tab order on every signed-in page; `lang="en"`.

## What was wrong and what changed

### Contrast (1.4.3, 1.4.11)
| Issue | Before | Fix | After |
|---|---|---|---|
| White text on the orange primary button (`btn-primary`, 126 uses + 61 ad hoc) | 2.84:1 | dark text `#10141a` on orange (global) | 6.51:1 |
| `text-zinc-600` (145 uses) on cards/panels | 2.35–2.67 | token `#5d626c → #8c919b` | ≥ 4.55 on every surface |
| `text-zinc-500` on raised panels | 4.50 | token `#8b909b → #979ca7` | ≥ 5.23 |
| `text-zinc-700` / `text-gray-600` as text (21) | ~1.3 | → `text-zinc-500` | ≥ 5.2 |
| Error text `text-rose/red-500/600` (151) | 3.6–4.45 | rose-400 / red-400 (global) | ≥ 5.2 |
| Light-theme leftovers `text-*-700/800` on dark (21) and light hover flashes (36) | 2.7–3.6 | `-400` text, `hover:bg-*-500/10` tints | pass |
| Brand chips `text-brand-700` on `bg-brand-50/100` (22) | 3.51–4.10 | `text-brand-800` | 5.03–5.88 |
| Calendar active view button, selected day number | 2.84 | dark text | 6.51 |
| Form field edges (inputs, selects) | 1.14–1.20 | border `#6f737a` | 3.02 vs field, 3.43 vs card |
| Customer accent colour on the login button | any | text colour picked automatically; superadmin shows the ratio and warns | — |

### Keyboard and focus (2.1.1, 2.4.1, 2.4.7)
- **Visible focus everywhere:** global `:focus-visible` outline (brand orange, ≥ 5:1 on every
  surface). Mouse clicks look as before. 77 `focus:outline-none` no longer hide keyboard focus.
- **Skip link** "Skip to main content" in the student, teacher and admin layouts → `#main-content`.
- **26 clickable cards/rows** (`div`/`tr` with `onClick`) were unreachable by keyboard; now Tab +
  Enter/Space via `src/lib/a11y.ts` (`clickable`, `clickableRow`). 91 others were checked and are
  modal backdrops or propagation guards (fine).
- **Drag and drop:** My Plan to-dos gained the keyboard sensor (the other three sortable lists had it).
- **Profile photo button** only appeared on hover; now also on keyboard focus.

### Names and roles (4.1.2)
- 32 icon-only buttons, the password eye (with `aria-pressed`), mobile menu open/close
  (`aria-expanded`), banner dismiss ×4, week arrows ×8, calendar colour swatches (`aria-pressed`),
  user-selection checkboxes.
- Hand-written toggle switches (5 components) now `role="switch"` + `aria-checked` + a name.

### Other
- **Zoom (1.4.4):** removed `maximum-scale=1` from the viewport (it blocked pinch-zoom on Android).
  iOS zoom-on-focus stays prevented by 16 px inputs.
- **Motion (2.3.3):** `prefers-reduced-motion` honoured in CSS and in framer-motion (`MotionConfig`).

## Still open (backlog, in priority order)

1. **Modals/dialogs (≈66 overlays):** none has `role="dialog"`, `aria-modal`, focus moved into the
   dialog, focus trapped, Esc to close everywhere, or focus returned afterwards. Fix with one shared
   `<Modal>` component and migrate screens to it.
2. **Live updates:** toasts, "Saved", form errors and async results are not announced
   (`aria-live` / `role="status"` / `role="alert"`).
3. **Form errors not linked to fields** (`aria-invalid`, `aria-describedby`) on most forms.
4. **Charts and the semester wheel** (SVG) have no text alternative or data table.
5. **Generated PDFs** (food box, minivan, production, equipment contract) are not tagged PDFs.
6. **Calendar (FullCalendar) and the equipment scanner** need a screen-reader pass; the app's own
   timeline view is the accessible alternative for the calendar.
7. **Language:** the UI is English, but some content is Swedish (guide, PDFs) without `lang="sv"`
   on those parts (3.1.2).
8. **Accessibility statement:** publish one (required for Swedish public-sector services) once the
   external audit is done; this document is the starting point.
