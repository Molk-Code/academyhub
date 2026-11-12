import type { KeyboardEvent } from 'react'

// Clickable cards/rows that aren't <button>s: reachable with Tab and
// activated with Enter/Space by re-using their onClick (WCAG 2.1.1).
// Only the element itself reacts — Enter on an inner button stays inner.
function activateOnKey(e: KeyboardEvent<HTMLElement>) {
  if (e.target !== e.currentTarget) return
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    e.currentTarget.click()
  }
}

/** Spread on a clickable <div>/<li>: {...clickable} */
export const clickable = { role: 'button', tabIndex: 0, onKeyDown: activateOnKey } as const

/** Spread on a clickable table row (keeps its row role): {...clickableRow} */
export const clickableRow = { tabIndex: 0, onKeyDown: activateOnKey } as const
