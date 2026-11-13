import { describe, it, expect } from 'vitest'
import { scanSessionIdFrom } from './scanSessionLink'

describe('scanSessionIdFrom', () => {
  it('reads the session id from the desktop QR code', () => {
    expect(scanSessionIdFrom('https://cineforge.se/scan/AbC123_x-9')).toBe('AbC123_x-9')
    expect(scanSessionIdFrom(' https://academy-hub-c252f.web.app/scan/abc/ ')).toBe('abc')
  })
  it('ignores anything else', () => {
    for (const t of ['abc', 'equipmentId.3', 'https://cineforge.se/scan', 'https://cineforge.se/scan/a/b', 'https://cineforge.se/admin/scan/abc', 'https://x.se/scan/a%2Fb', 'javascript:alert(1)']) {
      expect(scanSessionIdFrom(t)).toBeNull()
    }
  })
})
