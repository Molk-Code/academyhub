import { describe, expect, it } from 'vitest'
import { contrastRatio, readableTextOn } from './contrast'

describe('contrast', () => {
  it('matches known WCAG ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1)
    expect(contrastRatio('#ffffff', '#ff6b35')).toBeCloseTo(2.84, 1)  // why btn-primary text is dark
    expect(contrastRatio('#10141a', '#ff6b35')).toBeCloseTo(6.51, 1)
  })
  it('picks the readable text colour for a fill', () => {
    expect(readableTextOn('#ff6b35')).toBe('#10141a') // brand orange
    expect(readableTextOn('#0ea5e9')).toBe('#10141a') // light blue
    expect(readableTextOn('#1e3a8a')).toBe('#ffffff') // dark navy
    expect(readableTextOn('orange')).toBe('#ffffff')  // not a hex: keep the old default
  })
})
