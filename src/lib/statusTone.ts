import type { CSSProperties } from 'react'

// One set of equipment status colours, used by Inventory, Statistics and the
// admin dashboard. Ordered by urgency. Missing is the only solid fill, so the
// worst state is always the loudest; every state also has its own icon and word.
// The same values are CSS variables (--status-*) in index.css.

export type StatusTone = 'missing' | 'overdue' | 'damaged' | 'pending' | 'out' | 'shelf'

export interface ToneStyle {
  /** Text/icon colour on the tone's own background */
  fg: string
  bg: string
  border: string
  /** Solid colour for a unit block, bar or dot; also readable as text on dark surfaces */
  solid: string
}

export const STATUS_TONE: Record<StatusTone, ToneStyle> = {
  missing: { fg: '#10141a', bg: '#ff5449',               border: '#ff5449',               solid: '#ff5449' },
  overdue: { fg: '#ffb4ab', bg: 'rgba(255,180,171,.12)', border: 'rgba(255,180,171,.5)',  solid: '#ffb4ab' },
  damaged: { fg: '#f6ae2d', bg: 'rgba(246,174,45,.12)',  border: 'rgba(246,174,45,.45)',  solid: '#f6ae2d' },
  pending: { fg: '#dcc6ff', bg: 'rgba(220,198,255,.1)',  border: 'rgba(220,198,255,.4)',  solid: '#dcc6ff' },
  out:     { fg: '#b4c5ff', bg: 'rgba(180,197,255,.1)',  border: 'rgba(180,197,255,.4)',  solid: '#b4c5ff' },
  shelf:   { fg: '#c8ccd5', bg: 'transparent',           border: 'rgba(200,204,213,.45)', solid: '#31353c' },
}

/** Inline style for a status pill or chip in the given tone */
export function toneChip(tone: StatusTone): CSSProperties {
  const t = STATUS_TONE[tone]
  return { background: t.bg, color: t.fg, border: `1px ${tone === 'shelf' ? 'dashed' : 'solid'} ${t.border}` }
}
