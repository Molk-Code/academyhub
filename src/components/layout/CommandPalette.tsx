import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, CornerDownLeft } from 'lucide-react'
import { cn } from '@/lib/utils'

// "Search or jump to…": every page the sidebar offers, found by typing
// (⌘K / Ctrl+K anywhere in the portal, or the button at the top of the sidebar).

export interface JumpItem {
  to: string
  label: string
  /** The sidebar section it lives in, shown beside it and searched too */
  group?: string
  icon: React.ComponentType<{ className?: string }>
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
export const JUMP_SHORTCUT = isMac ? '⌘K' : 'Ctrl K'

/** Items whose label or section matches every typed word; label starts rank first */
export function matchJumpItems(items: JumpItem[], query: string): JumpItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return items
  const hay = (i: JumpItem) => `${i.label} ${i.group ?? ''}`.toLowerCase()
  return items
    .filter(i => words.every(w => hay(i).includes(w)))
    .sort((a, b) => Number(!a.label.toLowerCase().startsWith(words[0])) - Number(!b.label.toLowerCase().startsWith(words[0])))
}

/** Opens the palette on ⌘K / Ctrl+K */
export function useJumpShortcut(open: () => void) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        open()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
}

export function JumpButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      className="w-full flex items-center gap-2 h-10 px-3 rounded-xl bg-[var(--bg-primary)] border border-white/10 text-sm text-zinc-500 hover:text-zinc-300 hover:border-white/20 transition-colors"
    >
      <Search className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
      <span className="flex-1 text-left">Search or jump to…</span>
      <kbd className="hidden lg:inline text-[11px] font-sans border border-white/15 rounded-md px-1.5 py-px">{JUMP_SHORTCUT}</kbd>
    </button>
  )
}

export default function CommandPalette({ open, onClose, items }: {
  open: boolean
  onClose: () => void
  items: JumpItem[]
}) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const restoreRef = useRef<HTMLElement | null>(null)
  const listId = useId()
  const results = useMemo(() => matchJumpItems(items, query), [items, query])

  useEffect(() => {
    if (!open) return
    restoreRef.current = document.activeElement as HTMLElement | null
    setQuery('')
    setActive(0)
    requestAnimationFrame(() => inputRef.current?.focus())
    return () => restoreRef.current?.focus?.()
  }, [open])

  useEffect(() => { setActive(0) }, [query])

  if (!open) return null

  function go(item: JumpItem | undefined) {
    if (!item) return
    onClose()
    navigate(item.to)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); onClose() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); go(results[active]) }
    else if (e.key === 'Tab') e.preventDefault()   // the input is the only stop: keep focus in the dialog
  }

  const optionId = (i: number) => `${listId}-opt-${i}`

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[12vh]" onKeyDown={onKeyDown}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-label="Search or jump to a page"
        className="relative w-full max-w-lg rounded-2xl bg-[var(--bg-surface)] border border-white/10 shadow-2xl overflow-hidden">
        <div className="flex items-center gap-3 px-4 border-b-2 border-brand-500">
          <Search className="w-4 h-4 text-zinc-500 flex-shrink-0" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search or jump to…"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={results.length ? optionId(active) : undefined}
            aria-autocomplete="list"
            className="flex-1 h-14 bg-transparent text-base text-zinc-100 placeholder:text-zinc-500 outline-none jump-input"
          />
          <kbd className="text-[11px] text-zinc-500 border border-white/15 rounded-md px-1.5 py-px">Esc</kbd>
        </div>
        <ul id={listId} role="listbox" aria-label="Pages" className="max-h-[50vh] overflow-y-auto p-2">
          {results.map((item, i) => {
            const Icon = item.icon
            return (
              <li
                key={item.to}
                id={optionId(i)}
                role="option"
                aria-selected={i === active}
                onMouseMove={() => setActive(i)}
                onClick={() => go(item)}
                className={cn('flex items-center gap-3 min-h-[44px] px-3 rounded-xl cursor-pointer text-sm',
                  i === active ? 'bg-brand-500/15 text-brand-200' : 'text-zinc-300')}
              >
                <Icon className={cn('w-4 h-4 flex-shrink-0', i === active ? 'text-brand-300' : 'text-zinc-500')} />
                <span className="flex-1 truncate">{item.label}</span>
                {item.group && <span className="text-xs text-zinc-500">{item.group}</span>}
                {i === active && <CornerDownLeft className="w-3.5 h-3.5 text-brand-300" aria-hidden="true" />}
              </li>
            )
          })}
          {results.length === 0 && <li className="px-3 py-6 text-center text-sm text-zinc-500">No page called “{query}”.</li>}
        </ul>
      </div>
    </div>
  )
}
