import { useState, useEffect, useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import { Bug, X, Send, Crosshair, Check } from 'lucide-react'
import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'

interface SelectedElement {
  path: string
  text: string
  tag: string
}

function describeElement(el: Element): string {
  const tag = el.tagName.toLowerCase()
  const id = el.id ? `#${el.id}` : ''
  const aria = el.getAttribute('aria-label') ?? ''
  const cls = [...el.classList]
    .filter(c => c.length < 30 && !/^(ProseMirror|tiptap|fc-)/.test(c))
    .slice(0, 3)
    .join('.')
  const text = (aria || (el.textContent?.trim() ?? '')).slice(0, 50)
  return [tag + (id || (cls ? `.${cls}` : '')), text].filter(Boolean).join(' — ')
}

export default function BugReportButton() {
  const { profile } = useAuth()
  const location = useLocation()
  const [mode, setMode] = useState<'idle' | 'selecting' | 'describing'>('idle')
  const [hoverEl, setHoverEl] = useState<Element | null>(null)
  const [highlightRect, setHighlightRect] = useState<DOMRect | null>(null)
  const [selected, setSelected] = useState<SelectedElement | null>(null)
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  const handleMouseMove = useCallback((e: MouseEvent) => {
    const target = e.target as Element
    if (target.closest('[data-bug-ui]')) { setHighlightRect(null); return }
    if (target === hoverEl) return
    setHoverEl(target)
    setHighlightRect(target.getBoundingClientRect())
  }, [hoverEl])

  const handleClick = useCallback((e: MouseEvent) => {
    const target = e.target as Element
    if (target.closest('[data-bug-ui]')) return
    e.preventDefault()
    e.stopPropagation()
    setSelected({
      path: describeElement(target),
      text: target.textContent?.trim().slice(0, 120) ?? '',
      tag: target.tagName.toLowerCase(),
    })
    setMode('describing')
  }, [])

  useEffect(() => {
    if (mode !== 'selecting') return
    document.addEventListener('mousemove', handleMouseMove, true)
    document.addEventListener('click', handleClick, true)
    document.body.style.cursor = 'crosshair'
    return () => {
      document.removeEventListener('mousemove', handleMouseMove, true)
      document.removeEventListener('click', handleClick, true)
      document.body.style.cursor = ''
      setHighlightRect(null)
      setHoverEl(null)
    }
  }, [mode, handleMouseMove, handleClick])

  // Re-measure on scroll/resize while selecting
  useEffect(() => {
    if (mode !== 'selecting' || !hoverEl) return
    const update = () => setHighlightRect(hoverEl.getBoundingClientRect())
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => { window.removeEventListener('scroll', update, true); window.removeEventListener('resize', update) }
  }, [mode, hoverEl])

  function cancel() {
    setMode('idle')
    setSelected(null)
    setDescription('')
    setDone(false)
  }

  async function submit() {
    if (!description.trim() || !profile || submitting) return
    setSubmitting(true)
    try {
      await addDoc(collection(db, 'bug_reports'), {
        uid: profile.uid,
        displayName: profile.displayName,
        role: profile.role,
        page: location.pathname,
        elementPath: selected?.path ?? '',
        elementText: selected?.text ?? '',
        elementTag: selected?.tag ?? '',
        description: description.trim(),
        status: 'open',
        createdAt: serverTimestamp(),
      })
      setDone(true)
      setTimeout(cancel, 1800)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      {/* Bell-row button */}
      <button
        data-bug-ui
        onClick={() => mode === 'idle' ? setMode('selecting') : cancel()}
        title={mode !== 'idle' ? 'Cancel bug report' : 'Report a bug'}
        className={`relative p-2 rounded-xl transition-colors ${
          mode !== 'idle'
            ? 'bg-amber-500/20 text-amber-400'
            : 'text-zinc-400 hover:bg-white/10 hover:text-zinc-300'
        }`}
      >
        <Bug className="w-5 h-5" />
      </button>

      {/* Hover highlight */}
      {mode === 'selecting' && highlightRect && (
        <div
          data-bug-ui
          className="fixed z-[9990] pointer-events-none rounded-[4px]"
          style={{
            top:    highlightRect.top,
            left:   highlightRect.left,
            width:  highlightRect.width,
            height: highlightRect.height,
            outline: '2px solid #f59e0b',
            outlineOffset: 2,
            backgroundColor: 'rgba(245,158,11,0.08)',
          }}
        />
      )}

      {/* Instruction banner */}
      {mode === 'selecting' && (
        <div
          data-bug-ui
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9995] flex items-center gap-3 bg-zinc-900 border border-amber-500/40 text-amber-300 text-sm px-4 py-2.5 rounded-2xl shadow-2xl"
        >
          <Crosshair className="w-4 h-4 flex-shrink-0 animate-pulse" />
          <span>Click where you found the bug</span>
          <button data-bug-ui onClick={cancel} className="ml-1 p-0.5 text-zinc-500 hover:text-zinc-300 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Description modal */}
      {mode === 'describing' && (
        <div data-bug-ui className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={cancel} />
          <div
            className="relative bg-zinc-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bug className="w-5 h-5 text-amber-400" />
                <h2 className="text-base font-semibold text-zinc-100">Report a bug</h2>
              </div>
              <button
                onClick={cancel}
                className="p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded-lg transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Selected element info */}
            {selected && (
              <div className="bg-zinc-800/60 border border-amber-500/20 rounded-xl px-3 py-2.5 space-y-1">
                <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">Selected element</p>
                <p className="text-xs text-amber-300 font-mono leading-snug">{selected.path}</p>
                {selected.text && (
                  <p className="text-xs text-zinc-500 italic">
                    "{selected.text.slice(0, 80)}{selected.text.length > 80 ? '…' : ''}"
                  </p>
                )}
              </div>
            )}

            {/* Description */}
            <div>
              <label className="block text-xs text-zinc-400 mb-1.5">What went wrong?</label>
              <textarea
                autoFocus
                value={description}
                onChange={e => setDescription(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit() }}
                placeholder="Describe the bug — what you expected vs what happened…"
                rows={4}
                className="w-full bg-zinc-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-amber-500/50 resize-none"
              />
            </div>

            <p className="text-[11px] text-zinc-600">Page: {location.pathname}</p>

            {done ? (
              <div className="w-full flex items-center justify-center gap-2 text-sm text-green-400 py-2">
                <Check className="w-4 h-4" /> Report submitted — thank you!
              </div>
            ) : (
              <button
                onClick={submit}
                disabled={!description.trim() || submitting}
                className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-900 font-semibold text-sm py-2.5 rounded-xl transition-colors"
              >
                <Send className="w-4 h-4" />
                {submitting ? 'Submitting…' : 'Submit report'}
              </button>
            )}
          </div>
        </div>
      )}
    </>
  )
}
