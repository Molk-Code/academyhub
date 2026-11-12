// Reads a class list exported from a spreadsheet or the school's admin system
// into invite rows. Accepts what Excel produces in Sweden (semicolons, BOM,
// quoted cells) and English or Swedish column names; without a header row the
// columns are read as email, name, role, class.

export type InviteRole = 'student' | 'teacher'

export interface InviteRow {
  line: number             // line in the file, for messages
  email: string
  displayName: string
  role: InviteRole
  cohortId: string | null
  cohortName: string | null
  status: 'ok' | 'skip' | 'error'
  note?: string            // why it's skipped or wrong, or a warning on an ok row
}

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/

const HEADERS: Record<string, string[]> = {
  email: ['email', 'e-mail', 'e-post', 'epost', 'mail', 'email address', 'e-postadress', 'mejl'],
  name: ['name', 'namn', 'full name', 'fullständigt namn', 'display name'],
  first: ['first name', 'firstname', 'förnamn', 'given name'],
  last: ['last name', 'lastname', 'efternamn', 'surname', 'family name'],
  role: ['role', 'roll', 'type', 'typ'],
  class: ['class', 'klass', 'cohort', 'grupp', 'group'],
}
const ROLES: Record<string, InviteRole | 'admin'> = {
  student: 'student', elev: 'student', studerande: 'student', deltagare: 'student',
  teacher: 'teacher', lärare: 'teacher', larare: 'teacher', staff: 'teacher', personal: 'teacher',
  admin: 'admin', administratör: 'admin',
}

// One CSV line into cells: quotes may contain the delimiter and "" for a quote
function splitLine(line: string, delim: string): string[] {
  const cells: string[] = []
  let cur = '', quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (ch === '"') quoted = false
      else cur += ch
    } else if (ch === '"') quoted = true
    else if (ch === delim) { cells.push(cur.trim()); cur = '' }
    else cur += ch
  }
  cells.push(cur.trim())
  return cells
}

function detectDelimiter(lines: string[]): string {
  const sample = lines.slice(0, 5).join('\n')
  const counts = [';', ',', '\t'].map(d => [d, sample.split(d).length] as const)
  return counts.sort((a, b) => b[1] - a[1])[0][1] > 1 ? counts[0][0] : ','
}

export interface ParseOptions {
  cohorts: { id: string; name: string }[]   // classes that can be chosen (not archived)
  defaultRole: InviteRole
  defaultCohortId: string | null
  existingEmails: Set<string>               // already have an account
  pendingEmails: Set<string>                // already have an unused invite
}

export function parseInviteCsv(text: string, opts: ParseOptions): InviteRow[] {
  const lines = text.replace(/^﻿/, '').split(/\r\n|\n|\r/).filter(l => l.trim())
  if (lines.length === 0) return []
  const delim = detectDelimiter(lines)
  const first = splitLine(lines[0], delim).map(c => c.toLowerCase())
  const hasHeader = !first.some(c => EMAIL_RE.test(c))

  const col = (key: string) => hasHeader ? first.findIndex(c => HEADERS[key].includes(c)) : -1
  const idx = hasHeader
    ? { email: col('email'), name: col('name'), first: col('first'), last: col('last'), role: col('role'), class: col('class') }
    : { email: 0, name: 1, first: -1, last: -1, role: 2, class: 3 }
  // A header without a recognised email column: use the column whose cells look like emails
  if (hasHeader && idx.email < 0 && lines[1]) {
    idx.email = splitLine(lines[1], delim).findIndex(c => EMAIL_RE.test(c))
  }

  const cohortByName = new Map(opts.cohorts.map(c => [c.name.trim().toLowerCase(), c]))
  const defaultCohort = opts.cohorts.find(c => c.id === opts.defaultCohortId) ?? null
  const seen = new Set<string>()
  const rows: InviteRow[] = []

  lines.slice(hasHeader ? 1 : 0).forEach((raw, i) => {
    const cells = splitLine(raw, delim)
    const cell = (n: number) => (n >= 0 ? cells[n] ?? '' : '')
    const email = cell(idx.email).toLowerCase()
    const displayName = (cell(idx.name) || [cell(idx.first), cell(idx.last)].filter(Boolean).join(' ')).replace(/\s+/g, ' ').trim()
    const line = i + (hasHeader ? 2 : 1)
    const row: InviteRow = { line, email, displayName, role: opts.defaultRole, cohortId: null, cohortName: null, status: 'ok' }
    const fail = (note: string) => rows.push({ ...row, status: 'error', note })
    const skip = (note: string) => rows.push({ ...row, status: 'skip', note })

    if (!email) return fail('No email address')
    if (!EMAIL_RE.test(email)) return fail(`"${email}" isn't an email address`)

    const roleCell = cell(idx.role).toLowerCase()
    if (roleCell) {
      const role = ROLES[roleCell]
      if (!role) return fail(`Unknown role "${cell(idx.role)}" (use student or teacher)`)
      if (role === 'admin') return fail('Admins can\'t be invited from a file — invite as teacher and change the role')
      row.role = role
    }

    const className = cell(idx.class)
    if (className) {
      const c = cohortByName.get(className.toLowerCase())
      if (!c) return fail(`No current class called "${className}"`)
      row.cohortId = c.id; row.cohortName = c.name
    } else if (row.role === 'student' && defaultCohort) {
      row.cohortId = defaultCohort.id; row.cohortName = defaultCohort.name
    }
    if (row.role === 'teacher') { row.cohortId = null; row.cohortName = null }

    if (seen.has(email)) return skip('Listed twice — invited once')
    seen.add(email)
    if (opts.existingEmails.has(email)) return skip('Already has an account')
    if (opts.pendingEmails.has(email)) row.note = 'Already has an unused invite — this sends another'
    if (!displayName) row.note = row.note ?? 'No name — they type it when signing up'
    rows.push(row)
  })
  return rows
}

// The results as a CSV to save or mail-merge: email, name, class, link
export function inviteLinksCsv(rows: { email: string; displayName: string; cohortName: string | null; url: string; emailed: boolean }[]): string {
  const q = (s: string) => /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  return ['email;name;class;invite link;emailed', ...rows.map(r =>
    [r.email, r.displayName, r.cohortName ?? '', r.url, r.emailed ? 'yes' : 'no'].map(q).join(';'))].join('\r\n')
}
