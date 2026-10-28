import { useState, useEffect, useRef, useCallback } from 'react'
import {
  collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot,
  serverTimestamp, orderBy, query, runTransaction,
} from 'firebase/firestore'
import { format, formatDistanceToNow } from 'date-fns'
import { Plus, Trash2, BookOpen, Search } from 'lucide-react'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { cn } from '@/lib/utils'
import { merge3, mapCaret } from '@/lib/textMerge'

interface NoteDoc {
  id: string
  title: string
  body: string
  createdBy: string
  createdByName: string
  updatedBy: string
  updatedByName: string
  createdAt: any
  updatedAt: any
}

function timeAgo(ts: any) {
  if (!ts?.toDate) return ''
  try { return formatDistanceToNow(ts.toDate(), { addSuffix: true }) } catch { return '' }
}

function noteDate(ts: any) {
  if (!ts?.toDate) return ''
  try { return format(ts.toDate(), 'd MMM yyyy · HH:mm') } catch { return '' }
}

export default function Notebook() {
  const { profile } = useAuth()
  const [notes, setNotes]       = useState<NoteDoc[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [title, setTitle]       = useState('')
  const [body, setBody]         = useState('')
  const [search, setSearch]     = useState('')
  const [creating, setCreating] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const bodyRef   = useRef<HTMLTextAreaElement>(null)

  // Live co-editing: `base` is the last server version the editor agreed
  // with; `live` mirrors the editor so async saves see current text; `edits`
  // counts keystrokes so a save can tell whether the user typed meanwhile.
  const base   = useRef({ title: '', body: '' })
  const live   = useRef({ title: '', body: '' })
  const edits  = useRef(0)
  const synced = useRef(0)   // value of `edits` the server has caught up with

  // Real-time notes list
  useEffect(() => {
    const q = query(collection(db, 'teacher_notes'), orderBy('updatedAt', 'desc'))
    return onSnapshot(q, snap => {
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() } as NoteDoc))
      setNotes(docs)
    })
  }, [])

  // Put text into the editor without making the caret jump
  const applyToEditor = useCallback((next: { title: string; body: string }) => {
    const el = bodyRef.current
    const focused = el && document.activeElement === el
    const before = live.current.body
    const selStart = el?.selectionStart ?? 0
    const selEnd = el?.selectionEnd ?? 0
    live.current = next
    setTitle(next.title)
    setBody(next.body)
    if (focused && before !== next.body) {
      requestAnimationFrame(() => {
        el.setSelectionRange(mapCaret(before, next.body, selStart), mapCaret(before, next.body, selEnd))
      })
    }
  }, [])

  // Load the note when it's opened, then follow other teachers' edits live.
  // While this user has unsaved typing, remote changes wait for the save,
  // which merges both.
  const loadedNoteId = useRef<string | null>(null)
  useEffect(() => {
    if (!selected) {
      setTitle(''); setBody(''); loadedNoteId.current = null
      base.current = live.current = { title: '', body: '' }
      return
    }
    const note = notes.find(n => n.id === selected)
    if (!note) return
    const remote = { title: note.title ?? '', body: note.body ?? '' }
    if (loadedNoteId.current !== selected) {
      loadedNoteId.current = selected
      edits.current = synced.current = 0
      base.current = remote
      applyToEditor(remote)
      return
    }
    if (edits.current !== synced.current) return
    if (remote.title === live.current.title && remote.body === live.current.body) {
      base.current = remote
      return
    }
    base.current = remote
    applyToEditor(remote)
  }, [selected, notes, applyToEditor])

  const scheduleSave = useCallback(() => {
    if (!selected || !profile) return
    const noteId = selected
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      const sentAt = edits.current
      const mine = live.current
      const from = base.current
      const meta = {
        updatedBy:     profile.uid,
        updatedByName: profile.displayName ?? 'Teacher',
        updatedAt:     serverTimestamp(),
      }
      let saved = mine
      try {
        // Merge onto whatever is on the server now, so simultaneous edits
        // by another teacher aren't overwritten
        saved = await runTransaction(db, async tx => {
          const ref = doc(db, 'teacher_notes', noteId)
          const snap = await tx.get(ref)
          const server = { title: snap.data()?.title ?? '', body: snap.data()?.body ?? '' }
          const merged = {
            title: merge3(from.title, mine.title, server.title),
            body:  merge3(from.body,  mine.body,  server.body),
          }
          tx.update(ref, { ...merged, ...meta })
          return merged
        })
      } catch {
        // Offline (transactions need the server) — plain save, last write wins
        await updateDoc(doc(db, 'teacher_notes', noteId), { ...mine, ...meta })
      }
      if (loadedNoteId.current !== noteId) return
      base.current = saved
      if (edits.current === sentAt) {
        synced.current = sentAt
        applyToEditor(saved)
      } else {
        // Typed during the save — carry those keystrokes onto the merged text
        applyToEditor({
          title: merge3(mine.title, live.current.title, saved.title),
          body:  merge3(mine.body,  live.current.body,  saved.body),
        })
      }
    }, 800)
  }, [selected, profile, applyToEditor])

  function handleTitleChange(val: string) {
    setTitle(val)
    live.current = { ...live.current, title: val }
    edits.current++
    scheduleSave()
  }

  function handleBodyChange(val: string) {
    setBody(val)
    live.current = { ...live.current, body: val }
    edits.current++
    scheduleSave()
  }

  async function createNote() {
    if (!profile || creating) return
    setCreating(true)
    const ref = await addDoc(collection(db, 'teacher_notes'), {
      title:         '',
      body:          '',
      createdBy:     profile.uid,
      createdByName: profile.displayName ?? 'Teacher',
      updatedBy:     profile.uid,
      updatedByName: profile.displayName ?? 'Teacher',
      createdAt:     serverTimestamp(),
      updatedAt:     serverTimestamp(),
    })
    setCreating(false)
    loadedNoteId.current = ref.id
    edits.current = synced.current = 0
    base.current = live.current = { title: '', body: '' }
    setSelected(ref.id)
    setTitle('')
    setBody('')
  }

  async function deleteNote(id: string) {
    if (!window.confirm('Delete this note?')) return
    await deleteDoc(doc(db, 'teacher_notes', id))
    if (selected === id) { setSelected(null); setTitle(''); setBody('') }
  }

  const filtered = search.trim()
    ? notes.filter(n =>
        n.title.toLowerCase().includes(search.toLowerCase()) ||
        n.body.toLowerCase().includes(search.toLowerCase()),
      )
    : notes

  const selectedNote = notes.find(n => n.id === selected)

  return (
    <div className="flex h-[calc(100dvh-5rem)] lg:h-[calc(100dvh-4rem)] -m-4 -my-5 sm:-m-6 lg:-m-8 overflow-hidden rounded-none lg:rounded-2xl">

      {/* ── Note list panel ─────────────────────────────────────────────────── */}
      <aside className={cn(
        'flex flex-col bg-zinc-900 border-r border-white/8',
        selected ? 'hidden lg:flex lg:w-72 xl:w-80 flex-shrink-0' : 'flex flex-1 lg:w-72 xl:w-80 lg:flex-none',
      )}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/8">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-amber-400" />
            <h1 className="text-base font-bold text-zinc-100">Notebook</h1>
          </div>
          <button
            onClick={createNote}
            disabled={creating}
            className="w-7 h-7 flex items-center justify-center rounded-lg bg-brand-600 hover:bg-brand-500 text-white transition-colors"
            title="New note"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {/* Search */}
        <div className="px-3 py-2 border-b border-white/5">
          <div className="flex items-center gap-2 bg-zinc-800 rounded-lg px-3 py-1.5">
            <Search className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search notes…"
              className="flex-1 bg-transparent text-sm text-zinc-200 placeholder-zinc-500 outline-none"
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 && (
            <div className="text-center text-zinc-500 text-sm py-12 px-4">
              {search ? 'No notes match your search.' : 'No notes yet. Tap + to create one.'}
            </div>
          )}
          {filtered.map(note => (
            <button
              key={note.id}
              onClick={() => { loadedNoteId.current = null; setSelected(note.id) }}
              className={cn(
                'w-full text-left px-4 py-3 border-b border-white/5 transition-colors group',
                selected === note.id ? 'bg-amber-500/10' : 'hover:bg-white/4',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <p className={cn('text-sm font-semibold truncate', selected === note.id ? 'text-amber-300' : 'text-zinc-100')}>
                  {note.title || 'Untitled'}
                </p>
                <button
                  onClick={e => { e.stopPropagation(); deleteNote(note.id) }}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded text-zinc-500 hover:text-rose-400 transition-all flex-shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className="text-xs text-zinc-500 truncate mt-0.5">{note.body || 'No content'}</p>
              <p className="text-[10px] text-zinc-600 mt-1">{timeAgo(note.updatedAt)}</p>
            </button>
          ))}
        </div>
      </aside>

      {/* ── Editor panel ────────────────────────────────────────────────────── */}
      <main className={cn(
        'flex flex-col flex-1 bg-zinc-950 min-w-0',
        !selected && 'hidden lg:flex',
      )}>
        {!selected ? (
          <div className="flex-1 flex flex-col items-center justify-center text-zinc-600 gap-3">
            <BookOpen className="w-10 h-10 opacity-30" />
            <p className="text-sm">Select a note or create a new one</p>
          </div>
        ) : (
          <>
            {/* Mobile back */}
            <div className="lg:hidden flex items-center gap-2 px-4 py-3 border-b border-white/8">
              <button
                onClick={() => setSelected(null)}
                className="text-sm text-brand-400 hover:text-brand-300 transition-colors"
              >
                ← All notes
              </button>
            </div>

            {/* Title */}
            <div className="px-6 pt-5 pb-0">
              <input
                value={title}
                onChange={e => handleTitleChange(e.target.value)}
                placeholder="Title"
                className="w-full bg-transparent text-2xl font-bold text-zinc-100 placeholder-zinc-600 outline-none border-none"
              />
              {selectedNote && (
                <p className="text-xs text-zinc-500 mt-1">
                  {noteDate(selectedNote.updatedAt)}
                  {selectedNote.updatedByName ? ` · ${selectedNote.updatedByName}` : ''}
                </p>
              )}
            </div>

            {/* Divider */}
            <div className="mx-6 my-3 border-t border-white/8" />

            {/* Body */}
            <div className="flex-1 px-6 pb-6 overflow-y-auto">
              <textarea
                ref={bodyRef}
                value={body}
                onChange={e => handleBodyChange(e.target.value)}
                placeholder="Start writing…"
                className="w-full h-full min-h-[300px] bg-transparent text-sm text-zinc-200 placeholder-zinc-600 outline-none border-none resize-none leading-relaxed"
              />
            </div>
          </>
        )}
      </main>
    </div>
  )
}
