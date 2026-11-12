import { useEffect } from 'react'

// Per-page <title>, meta description and robots for a single-page app. The
// static index.html carries the defaults (and no noindex: Google may skip
// rendering a page whose HTML says noindex, which would hide the public pages).

function setMeta(attr: 'name' | 'property', key: string, value: string | null) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`)
  if (value === null) { el?.remove(); return }
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.content = value
}

/** Public pages: title and description, also used for link previews */
export function usePageMeta(title: string, description: string) {
  useEffect(() => {
    const prev = { title: document.title, description: document.head.querySelector<HTMLMetaElement>('meta[name="description"]')?.content ?? null }
    document.title = title
    setMeta('name', 'description', description)
    setMeta('property', 'og:title', title)
    setMeta('property', 'og:description', description)
    return () => {
      document.title = prev.title
      setMeta('name', 'description', prev.description)
    }
  }, [title, description])
}

/** Signed-in and other private screens: never indexed */
export function useNoIndex() {
  useEffect(() => {
    setMeta('name', 'robots', 'noindex, nofollow')
    return () => setMeta('name', 'robots', null)
  }, [])
}
