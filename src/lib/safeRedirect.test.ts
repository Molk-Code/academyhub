import { describe, it, expect } from 'vitest'
import { safeRedirect } from './safeRedirect'

describe('safeRedirect', () => {
  it('keeps paths inside the app', () => {
    expect(safeRedirect('/scan/abc123')).toBe('/scan/abc123')
    expect(safeRedirect('/admin/equipment?tab=bookings')).toBe('/admin/equipment?tab=bookings')
  })
  it('falls back for anything else', () => {
    for (const v of [null, undefined, '', 'scan/x', '//evil.example', '/\\evil.example', 'https://evil.example', 'javascript:alert(1)', '/\nx', '/login?redirect=/x']) {
      expect(safeRedirect(v)).toBe('/')
    }
  })
})
