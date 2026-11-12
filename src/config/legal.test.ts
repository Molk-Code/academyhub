import { describe, expect, it } from 'vitest'
import { LEGAL, isPlaceholder, legal, missingLegalFields, publishedSubProcessors } from './legal'

describe('legal config', () => {
  it('placeholders are recognised and never returned', () => {
    expect(isPlaceholder('TODO: org number')).toBe(true)
    expect(isPlaceholder('  ')).toBe(true)
    expect(isPlaceholder('Fredrik Fridlund Cinematography AB')).toBe(false)
    for (const key of missingLegalFields()) expect(legal(key)).toBeUndefined()
  })
  it('the provider and the app name are set', () => {
    expect(legal('providerName')).toBe('Fredrik Fridlund Cinematography AB')
    expect(legal('appDomain')).toBe('cineforge.se')
  })
  it('only verified sub-processors without placeholders are published', () => {
    for (const p of publishedSubProcessors()) {
      expect(p.verified).toBe(true)
      expect([p.name, p.purpose, p.location, p.safeguard].some(isPlaceholder)).toBe(false)
    }
    expect(publishedSubProcessors().length).toBe(LEGAL.subProcessors.filter(p => p.verified).length)
  })
})
