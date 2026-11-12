import { describe, expect, it } from 'vitest'
import { parseInviteCsv, inviteLinksCsv, type ParseOptions } from './inviteCsv'

const opts: ParseOptions = {
  cohorts: [{ id: 'f1', name: 'Film 2026' }, { id: 'f2', name: 'Film 2025 – year 2' }],
  defaultRole: 'student',
  defaultCohortId: 'f1',
  existingEmails: new Set(['taken@school.se']),
  pendingEmails: new Set(['pending@school.se']),
}

describe('parseInviteCsv', () => {
  it('Swedish Excel export: BOM, semicolons, Swedish headers, first/last name', () => {
    const csv = '﻿Förnamn;Efternamn;E-post;Klass\r\nAlva;Berg;Alva.Berg@School.se;film 2025 – year 2\r\nOle;Ek;ole@school.se;\r\n'
    const rows = parseInviteCsv(csv, opts)
    expect(rows).toMatchObject([
      { line: 2, email: 'alva.berg@school.se', displayName: 'Alva Berg', role: 'student', cohortId: 'f2', status: 'ok' },
      { line: 3, email: 'ole@school.se', displayName: 'Ole Ek', cohortId: 'f1', status: 'ok' },   // default class
    ])
  })

  it('no header: email, name, role, class; quoted cells', () => {
    const rows = parseInviteCsv('t@school.se,"Lind, Tove",lärare,Film 2026\ns@school.se,Sam', opts)
    expect(rows[0]).toMatchObject({ displayName: 'Lind, Tove', role: 'teacher', cohortId: null, status: 'ok' })
    expect(rows[1]).toMatchObject({ email: 's@school.se', role: 'student', cohortId: 'f1' })
  })

  it('a single column of emails', () => {
    const rows = parseInviteCsv('a@x.se\nb@x.se', opts)
    expect(rows.map(r => [r.email, r.status, r.note])).toEqual([
      ['a@x.se', 'ok', 'No name — they type it when signing up'],
      ['b@x.se', 'ok', 'No name — they type it when signing up'],
    ])
  })

  it('errors and skips say why', () => {
    const csv = 'email,name,role,class\nnot-an-email,X\nx@x.se,X,boss\ny@x.se,Y,admin\nz@x.se,Z,,Film 1999\ntaken@school.se,T\npending@school.se,P\npending@school.se,P'
    const rows = parseInviteCsv(csv, opts)
    expect(rows.map(r => r.status)).toEqual(['error', 'error', 'error', 'error', 'skip', 'ok', 'skip'])
    expect(rows[3].note).toBe('No current class called "Film 1999"')
    expect(rows[4].note).toBe('Already has an account')
    expect(rows[5].note).toMatch(/unused invite/)
    expect(rows[6].note).toMatch(/twice/)
  })

  it('empty input', () => {
    expect(parseInviteCsv('\n\n', opts)).toEqual([])
  })
})

describe('inviteLinksCsv', () => {
  it('quotes cells that need it', () => {
    expect(inviteLinksCsv([{ email: 'a@x.se', displayName: 'A; B', cohortName: null, url: 'https://x/a', emailed: true }]))
      .toBe('email;name;class;invite link;emailed\r\na@x.se;"A; B";;https://x/a;yes')
  })
})
