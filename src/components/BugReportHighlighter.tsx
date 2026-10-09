import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

const STORAGE_KEY = 'bugReportHighlight'
const MAX_AGE_MS = 20000
const MAX_ATTEMPTS = 30

export function requestHighlight(page: string, selector: string, tabLabel?: string) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ page, selector, tabLabel, ts: Date.now() }))
  } catch { /* storage unavailable — highlight is a nice-to-have, safe to skip */ }
}

// Finds a tab-like button by its exact visible text and clicks it — used to
// switch a tabbed page (e.g. the production editor) back to the sub-view the
// reporter was on, since that's client-side state not reflected in the URL.
function clickMatchingTab(label: string) {
  const buttons = document.querySelectorAll('button')
  for (const btn of buttons) {
    if (btn.textContent?.trim() === label) { btn.click(); return true }
  }
  return false
}

// Mounted once near the app root. After navigating to a reported page, looks
// for a pending highlight request (set by requestHighlight) and, once the
// target element shows up in the DOM, scrolls to it and flashes an outline —
// the same visual the reporter saw while picking the element originally.
export default function BugReportHighlighter() {
  const location = useLocation()

  useEffect(() => {
    let raw: string | null
    try { raw = sessionStorage.getItem(STORAGE_KEY) } catch { return }
    if (!raw) return

    let data: { page: string; selector: string; tabLabel?: string; ts: number }
    try { data = JSON.parse(raw) } catch { return }
    if (location.pathname !== data.page) return
    if (Date.now() - data.ts > MAX_AGE_MS) { try { sessionStorage.removeItem(STORAGE_KEY) } catch {}; return }

    let cancelled = false
    let attempts = 0
    let triedTab = false

    function tryHighlight() {
      if (cancelled) return
      if (!triedTab && data.tabLabel) { triedTab = clickMatchingTab(data.tabLabel) }
      let el: Element | null = null
      try { el = document.querySelector(data.selector) } catch { /* stale/invalid selector */ }

      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        const rect = el.getBoundingClientRect()
        const box = document.createElement('div')
        box.style.cssText = [
          'position:fixed', 'z-index:9998', 'pointer-events:none', 'border-radius:4px',
          'outline:3px solid #f59e0b', 'outline-offset:2px', 'background:rgba(245,158,11,0.12)',
          'transition:opacity 0.6s ease-out',
          `top:${rect.top}px`, `left:${rect.left}px`, `width:${rect.width}px`, `height:${rect.height}px`,
        ].join(';')
        document.body.appendChild(box)
        setTimeout(() => { box.style.opacity = '0' }, 2200)
        setTimeout(() => box.remove(), 2800)
        try { sessionStorage.removeItem(STORAGE_KEY) } catch {}
        return
      }

      attempts++
      if (attempts < MAX_ATTEMPTS) setTimeout(tryHighlight, 200)
      else { try { sessionStorage.removeItem(STORAGE_KEY) } catch {} }
    }

    tryHighlight()
    return () => { cancelled = true }
  }, [location.pathname])

  return null
}
