import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

const MAX_WAIT_MS = 8000   // lists load from Firestore after the page appears

// Notification links can name the item they are about: <page>?focus=<doc id>.
// Mounted once near the app root. When the URL has ?focus=, waits for the
// element marked data-focus-id="<id>" to appear, scrolls it to the middle of
// the screen and outlines it for a moment, then drops ?focus= from the URL so
// a reload or back doesn't jump again.
export default function FocusTarget() {
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const id = params.get('focus')
    if (!id) return
    let cancelled = false
    const started = Date.now()

    function clearParam() {
      params.delete('focus')
      const qs = params.toString()
      navigate({ pathname: location.pathname, search: qs ? `?${qs}` : '', hash: location.hash }, { replace: true })
    }

    function attempt() {
      if (cancelled) return
      const el = document.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(id!)}"]`)
      if (!el) {
        if (Date.now() - started < MAX_WAIT_MS) setTimeout(attempt, 200)
        else clearParam()
        return
      }
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      const { outline, outlineOffset, transition } = el.style
      el.style.transition = 'outline-color .6s ease-out'
      el.style.outline = '3px solid #f97316'
      el.style.outlineOffset = '2px'
      setTimeout(() => { el.style.outlineColor = 'transparent' }, 2500)
      setTimeout(() => { Object.assign(el.style, { outline, outlineOffset, transition }) }, 3200)
      clearParam()
    }
    attempt()
    return () => { cancelled = true }
  }, [location.pathname, location.search]) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}
