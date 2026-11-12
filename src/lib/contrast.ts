// WCAG 2.1 contrast helpers (relative luminance, 1.4.3 / 1.4.11)

function luminance(hex: string): number {
  const h = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const DARK = '#10141a'
const LIGHT = '#ffffff'

/** Text colour for a button or chip filled with `bg`: whichever of dark/white reads better */
export function readableTextOn(bg: string): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(bg)) return LIGHT
  return contrastRatio(DARK, bg) >= contrastRatio(LIGHT, bg) ? DARK : LIGHT
}
