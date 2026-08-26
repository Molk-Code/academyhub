import { useState, useMemo, useRef } from 'react'
import { addDoc, collection, updateDoc, deleteDoc, doc, serverTimestamp, collectionGroup, query, where, getDocs, writeBatch } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { db } from '@/lib/firebase'
import { uploadWithQuota, deleteWithTracking } from '@/lib/uploadWithQuota'
import { useCollection, orderBy } from '@/hooks/useFirestore'
import type { GuestTeacherDoc, GuestTeacherBookingDoc, GuestTeacherDocument, LessonDoc, SyncedEventDoc } from '@/types'
import {
  Plus, Pencil, Trash2, FileUp, X, UserRound, Search, ExternalLink,
  MapPin, Calendar, Clock, Mail, FileText, Eye, Download, LayoutGrid, List,
} from 'lucide-react'
import { cn, initials, avatarColor } from '@/lib/utils'
import { useCurrency } from '@/hooks/useCurrency'
import { format, isToday, isTomorrow, startOfDay } from 'date-fns'
import { nanoid } from 'nanoid'
import LoadingSpinner from '@/components/common/LoadingSpinner'

type SortKey = 'name' | 'price' | 'booked'
type ViewMode = 'cards' | 'list'

const EMPTY_FORM = {
  name: '', bio: '', portfolioUrl: '', notes: '',
  price: '', location: '', email: '',
}

// Safely coerce legacy string or array to string[]
function toExpertiseArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter(Boolean)
  if (typeof v === 'string' && v) return [v]
  return []
}
const NOTES_PREVIEW_LENGTH = 180

export default function GuestTeacherBank() {
  const { data: guests, loading } = useCollection<GuestTeacherDoc>('guest_teachers')
  const { data: bookings }        = useCollection<GuestTeacherBookingDoc>('guest_teacher_bookings')
  const { data: lessons }         = useCollection<LessonDoc>('lessons', [orderBy('startTime', 'asc')])
  const { data: syncedEvents }    = useCollection<SyncedEventDoc>('synced_events')
  const { symbol: currencySymbol } = useCurrency()

  const [sortKey, setSortKey]         = useState<SortKey>('name')
  const [viewMode, setViewMode]       = useState<ViewMode>('cards')
  const [search, setSearch]           = useState('')
  const [filterExpertise, setFilterExpertise] = useState<string | null>(null)
  const [filterLocation, setFilterLocation]   = useState<string | null>(null)
  const [panel, setPanel]           = useState<'add' | { id: string } | null>(null)
  const [form, setForm]             = useState(EMPTY_FORM)
  const [expertises, setExpertises]         = useState<string[]>([])
  const [expertiseInput, setExpertiseInput] = useState('')
  const [img, setImg]               = useState<File | null>(null)
  const [imgPreview, setImgPreview] = useState<string | null>(null)
  const [saving, setSaving]         = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const imgRef     = useRef<HTMLInputElement>(null)
  const docRef     = useRef<HTMLInputElement>(null)
  const expertRef  = useRef<HTMLInputElement>(null)

  // Document state
  const [pendingDocs, setPendingDocs]     = useState<File[]>([])
  const [removedDocIds, setRemovedDocIds] = useState<Set<string>>(new Set())
  const [viewingDoc, setViewingDoc]       = useState<GuestTeacherDocument | null>(null)

  // Profile overlay
  const [viewingProfile, setViewingProfile] = useState<GuestTeacherDoc | null>(null)

  // Lesson booking state
  const [lessonPanelFor, setLessonPanelFor]   = useState<string | null>(null)
  const [selectedLessonId, setSelectedLessonId] = useState('')
  const [bookingLesson, setBookingLesson]     = useState(false)
  const [bookingError, setBookingError]       = useState<string | null>(null)

  // Notes expand state
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set())

  function toggleNotes(id: string) {
    setExpandedNotes(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // Booking map
  const bookingMap = useMemo(() => {
    const m: Record<string, GuestTeacherBookingDoc[]> = {}
    for (const b of bookings) {
      if (!m[b.guestTeacherId]) m[b.guestTeacherId] = []
      m[b.guestTeacherId].push(b)
    }
    return m
  }, [bookings])

  // Dynamic tag lists derived from actual data
  const expertiseTags = useMemo(
    () => [...new Set(guests.flatMap(g => toExpertiseArray(g.expertise)))].sort(),
    [guests],
  )
  const locationTags = useMemo(
    () => [...new Set(guests.map(g => g.location).filter(Boolean))].sort(),
    [guests],
  )

  const upcomingLessons = useMemo(() => {
    const now = Date.now()
    return lessons.filter(l => (l.startTime?.toDate?.()?.getTime() ?? 0) >= now)
  }, [lessons])

  const editingGuest = useMemo(
    () => panel !== 'add' && panel !== null ? (guests.find(g => g.id === (panel as { id: string }).id) ?? null) : null,
    [panel, guests],
  )

  const existingDocs = useMemo(
    () => (editingGuest?.documents ?? []).filter(d => !removedDocIds.has(d.id)),
    [editingGuest, removedDocIds],
  )

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    const result = guests.filter(g => {
      const exps = toExpertiseArray(g.expertise)
      if (q && !g.name.toLowerCase().includes(q) && !exps.some(e => e.toLowerCase().includes(q)) && !g.location.toLowerCase().includes(q)) return false
      if (filterExpertise && !exps.includes(filterExpertise)) return false
      if (filterLocation  && g.location  !== filterLocation)  return false
      return true
    })
    return [...result].sort((a, b) => {
      if (sortKey === 'name')  return a.name.localeCompare(b.name)
      if (sortKey === 'price') {
        const pa = parseFloat(a.price) || 0
        const pb = parseFloat(b.price) || 0
        return pa - pb || a.price.localeCompare(b.price)
      }
      if (sortKey === 'booked') {
        const ba = (bookingMap[a.id]?.length ?? 0) > 0 ? 1 : 0
        const bb = (bookingMap[b.id]?.length ?? 0) > 0 ? 1 : 0
        return bb - ba
      }
      return 0
    })
  }, [guests, search, sortKey, bookingMap, filterExpertise, filterLocation])

  function openAdd() {
    setPanel('add'); setForm(EMPTY_FORM); setExpertises([]); setExpertiseInput('')
    setImg(null); setImgPreview(null)
    setPendingDocs([]); setRemovedDocIds(new Set()); setError(null)
  }

  function openEdit(g: GuestTeacherDoc) {
    setPanel({ id: g.id })
    setForm({
      name: g.name, bio: g.bio, portfolioUrl: g.portfolioUrl ?? '',
      notes: g.notes, price: g.price, location: g.location, email: g.email ?? '',
    })
    setExpertises(toExpertiseArray(g.expertise)); setExpertiseInput('')
    setImg(null); setImgPreview(g.profilePictureUrl)
    setPendingDocs([]); setRemovedDocIds(new Set()); setError(null)
  }

  function cancel() {
    setPanel(null); setError(null)
    setExpertises([]); setExpertiseInput('')
    setPendingDocs([]); setRemovedDocIds(new Set())
  }

  function addExpertise() {
    const val = expertiseInput.trim()
    if (val && !expertises.includes(val)) setExpertises(prev => [...prev, val])
    setExpertiseInput('')
    expertRef.current?.focus()
  }

  function removeExpertise(tag: string) {
    setExpertises(prev => prev.filter(e => e !== tag))
  }

  function onPickImage(file: File) { setImg(file); setImgPreview(URL.createObjectURL(file)) }

  function onPickDocs(files: FileList | null) {
    if (!files) return
    setPendingDocs(prev => [...prev, ...Array.from(files)])
  }

  function removePending(idx: number) {
    setPendingDocs(prev => prev.filter((_, i) => i !== idx))
  }

  function markDocRemoved(id: string) {
    setRemovedDocIds(prev => new Set([...prev, id]))
  }

  async function save() {
    if (!form.name.trim()) { setError('Name is required'); return }
    setSaving(true); setError(null)
    try {
      // Upload profile picture
      let profilePictureUrl: string | null = imgPreview
      let storagePath: string | null = null
      if (img) {
        storagePath = `guest_teachers/${Date.now()}_${img.name}`
        profilePictureUrl = await uploadWithQuota(img, storagePath)
      }

      // Delete removed documents from storage
      for (const id of removedDocIds) {
        const d = editingGuest?.documents?.find(doc => doc.id === id)
        if (d?.storagePath) { try { await deleteWithTracking(d.storagePath) } catch {} }
      }

      // Upload pending documents
      const newDocs: GuestTeacherDocument[] = []
      for (const file of pendingDocs) {
        const path = `guest_teachers/docs/${Date.now()}_${file.name}`
        const url  = await uploadWithQuota(file, path)
        newDocs.push({ id: nanoid(), name: file.name, url, storagePath: path, mimeType: file.type })
      }

      const documents = [...existingDocs, ...newDocs]

      if (panel === 'add') {
        await addDoc(collection(db, 'guest_teachers'), {
          name: form.name.trim(), bio: form.bio.trim(),
          portfolioUrl: form.portfolioUrl.trim() || null, notes: form.notes.trim(),
          expertise: expertises, price: form.price.trim(), location: form.location.trim(),
          email: form.email.trim() || null,
          profilePictureUrl, storagePath, documents,
          createdAt: serverTimestamp(),
        })
      } else {
        if (img && editingGuest?.storagePath) { try { await deleteWithTracking(editingGuest.storagePath) } catch {} }
        const update: Partial<GuestTeacherDoc> & Record<string, unknown> = {
          name: form.name.trim(), bio: form.bio.trim(),
          portfolioUrl: form.portfolioUrl.trim() || null, notes: form.notes.trim(),
          expertise: expertises, price: form.price.trim(), location: form.location.trim(),
          email: form.email.trim() || null,
          documents,
        }
        if (img) { update.profilePictureUrl = profilePictureUrl; update.storagePath = storagePath }
        const guestId = (panel as { id: string }).id
        await updateDoc(doc(db, 'guest_teachers', guestId), update)

        // Sync to any subject teacher entries that reference this guest teacher
        const snap = await getDocs(query(collectionGroup(db, 'teachers'), where('guestTeacherId', '==', guestId)))
        if (!snap.empty) {
          const batch = writeBatch(db)
          snap.docs.forEach(d => {
            const subjectUpdate: Record<string, unknown> = {
              name:         form.name.trim(),
              description:  form.bio.trim(),
              portfolioUrl: form.portfolioUrl.trim() || null,
              expertise:    expertises.join(', '),
            }
            if (img) subjectUpdate.imageUrl = profilePictureUrl
            batch.update(d.ref, subjectUpdate)
          })
          await batch.commit()
        }
      }
      cancel()
    } catch (e: any) {
      setError(e?.message ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function remove(g: GuestTeacherDoc) {
    if (!confirm(`Remove ${g.name} from the guest teacher library?`)) return
    if (g.storagePath) { try { await deleteWithTracking(g.storagePath) } catch {} }
    for (const d of (g.documents ?? [])) {
      try { await deleteWithTracking(d.storagePath) } catch {}
    }
    for (const b of (bookingMap[g.id] ?? [])) {
      try { await deleteDoc(doc(db, 'guest_teacher_bookings', b.id)) } catch {}
    }
    await deleteDoc(doc(db, 'guest_teachers', g.id))
  }

  async function bookForLesson(guestId: string) {
    if (!selectedLessonId) return
    const lesson = lessons.find(l => l.id === selectedLessonId)
    if (!lesson) return
    const guest = guests.find(g => g.id === guestId)
    if (!guest?.email) {
      setBookingError('No email assigned to this guest teacher. Add an email in their profile before booking.')
      return
    }
    setBookingLesson(true); setBookingError(null)
    try {
      await addDoc(collection(db, 'guest_teacher_bookings'), {
        guestTeacherId: guestId, type: 'lesson',
        lessonId: selectedLessonId, lessonTitle: lesson.title,
        lessonStart: lesson.startTime, lessonEnd: lesson.endTime,
        createdAt: serverTimestamp(),
      })
      // Send confirmation email
      try {
        const fn = httpsCallable(getFunctions(), 'sendGuestTeacherBookingEmail')
        await fn({ guestTeacherId: guestId, lessonId: selectedLessonId })
      } catch (emailErr: any) {
        console.warn('Email send failed:', emailErr)
      }
      setLessonPanelFor(null); setSelectedLessonId(''); setBookingError(null)
    } catch (e: any) {
      setBookingError(e?.message ?? 'Booking failed')
    } finally {
      setBookingLesson(false)
    }
  }

  async function removeBooking(bookingId: string) {
    await deleteDoc(doc(db, 'guest_teacher_bookings', bookingId))
  }

  if (loading) return <LoadingSpinner />

  return (
    <div className="space-y-6">

      {/* Inline document viewer modal */}
      {viewingDoc && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/90 backdrop-blur-sm">
          <div className="flex items-center justify-between px-4 py-3 bg-zinc-900 border-b border-white/10 flex-shrink-0">
            <p className="text-sm font-medium text-zinc-100 truncate">{viewingDoc.name}</p>
            <div className="flex items-center gap-2 flex-shrink-0">
              <a href={viewingDoc.url} download={viewingDoc.name} className="btn-ghost py-1.5 text-xs gap-1.5">
                <Download className="w-3.5 h-3.5" /> Download
              </a>
              <a href={viewingDoc.url} target="_blank" rel="noopener noreferrer" className="btn-ghost py-1.5 text-xs gap-1.5">
                <ExternalLink className="w-3.5 h-3.5" /> Open in tab
              </a>
              <button onClick={() => setViewingDoc(null)} className="p-1.5 hover:bg-white/10 rounded-lg transition-colors">
                <X className="w-5 h-5 text-zinc-300" />
              </button>
            </div>
          </div>
          {viewingDoc.mimeType === 'application/pdf' || viewingDoc.url.toLowerCase().endsWith('.pdf') ? (
            <iframe src={viewingDoc.url} className="flex-1 w-full border-0" title={viewingDoc.name} />
          ) : viewingDoc.mimeType.startsWith('image/') ? (
            <div className="flex-1 flex items-center justify-center p-8">
              <img src={viewingDoc.url} alt={viewingDoc.name} className="max-w-full max-h-full object-contain rounded-xl" />
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 text-zinc-400">
              <FileText className="w-16 h-16 text-zinc-600" />
              <p className="text-sm">Preview not available for this file type.</p>
              <a href={viewingDoc.url} target="_blank" rel="noopener noreferrer" className="btn-primary gap-1.5">
                <ExternalLink className="w-4 h-4" /> Open in tab
              </a>
            </div>
          )}
        </div>
      )}

      {/* Profile overlay */}
      {viewingProfile && (() => {
        const g = viewingProfile
        const guestBookings    = bookingMap[g.id] ?? []
        const subjectBookings  = guestBookings.filter(b => b.type === 'subject')
        const lessonBookings   = guestBookings.filter(b => b.type === 'lesson')
        const hasLessonBooking = lessonBookings.length > 0
        const hasSubjectOnly   = subjectBookings.length > 0 && !hasLessonBooking
        const isBooked         = hasLessonBooking || syncedEvents.some(e => e.guestTeacherIds?.includes(g.id))
        const docs             = g.documents ?? []
        return (
          <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 backdrop-blur-sm overflow-y-auto py-8 px-4">
            <div className="relative w-full max-w-lg bg-zinc-900 border border-white/10 rounded-2xl shadow-2xl">
              {/* Close + edit */}
              <div className="absolute top-4 right-4 flex gap-2">
                <button
                  onClick={() => { setViewingProfile(null); openEdit(g) }}
                  className="p-2 bg-zinc-800 rounded-xl text-zinc-400 hover:text-zinc-200 transition-colors"
                  title="Edit"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setViewingProfile(null)}
                  className="p-2 bg-zinc-800 rounded-xl text-zinc-400 hover:text-zinc-200 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Hero */}
              <div className="flex flex-col items-center text-center pt-10 pb-6 px-6 border-b border-white/8">
                {g.profilePictureUrl ? (
                  <img src={g.profilePictureUrl} alt={g.name} className="w-28 h-28 rounded-full object-cover ring-4 ring-white/10 shadow-lg" />
                ) : (
                  <div className={cn('w-28 h-28 rounded-full flex items-center justify-center text-white text-3xl font-bold ring-4 ring-white/10', avatarColor(g.name))}>
                    {initials(g.name)}
                  </div>
                )}
                <h2 className="mt-4 text-xl font-bold text-zinc-100">{g.name}</h2>
                {toExpertiseArray(g.expertise).length > 0 && (
                  <div className="flex flex-wrap justify-center gap-1.5 mt-1.5">
                    {toExpertiseArray(g.expertise).map(e => (
                      <span key={e} className="text-xs bg-brand-600/20 text-brand-300 px-2.5 py-0.5 rounded-full font-medium">{e}</span>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap items-center justify-center gap-3 mt-2 text-xs text-zinc-400">
                  {g.location && (
                    <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{g.location}</span>
                  )}
                  {g.price && <span>{g.price} {currencySymbol}</span>}
                </div>
                {/* Booking badge */}
                {isBooked ? (
                  <span className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />Booked
                  </span>
                ) : hasSubjectOnly ? (
                  <span className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-500/20 text-amber-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />Added to subject — not booked for lesson
                  </span>
                ) : (
                  <span className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-rose-500/20 text-rose-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />Not booked
                  </span>
                )}
              </div>

              <div className="p-6 space-y-5">
                {/* Contact */}
                {(g.email || g.portfolioUrl) && (
                  <div className="flex flex-wrap gap-3">
                    {g.email && (
                      <a href={`mailto:${g.email}`} className="inline-flex items-center gap-1.5 text-sm text-zinc-300 hover:text-brand-400 transition-colors">
                        <Mail className="w-4 h-4 text-zinc-500" />{g.email}
                      </a>
                    )}
                    {g.portfolioUrl && (
                      <a href={g.portfolioUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm text-brand-400 hover:underline">
                        <ExternalLink className="w-4 h-4" />Portfolio
                      </a>
                    )}
                  </div>
                )}

                {/* Bio */}
                {g.bio && (
                  <div>
                    <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-1.5">Bio</p>
                    <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-line">{g.bio}</p>
                  </div>
                )}

                {/* Documents */}
                {docs.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-2">Documents</p>
                    <div className="space-y-1.5">
                      {docs.map(d => (
                        <button
                          key={d.id}
                          onClick={() => setViewingDoc(d)}
                          className="w-full flex items-center gap-2 bg-zinc-800/60 hover:bg-zinc-800 rounded-lg px-3 py-2.5 text-sm transition-colors text-left group/doc"
                        >
                          <FileText className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                          <span className="flex-1 text-zinc-200 truncate">{d.name}</span>
                          <Eye className="w-4 h-4 text-zinc-600 group-hover/doc:text-brand-400 transition-colors flex-shrink-0" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Booking info */}
                {isBooked && (
                  <div>
                    <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-2">Booking info</p>
                    <div className="space-y-2">
                      {subjectBookings.map(b => (
                        <div key={b.id} className="flex items-center gap-2 bg-zinc-800/40 rounded-lg px-3 py-2 text-sm">
                          <span className="text-zinc-400">Subject:</span>
                          <span className="text-zinc-100 font-medium">{b.subjectTitle}</span>
                        </div>
                      ))}
                      {lessonBookings.map(b => {
                        const startDate = b.lessonStart?.toDate?.()
                        const endDate   = b.lessonEnd?.toDate?.()
                        return (
                          <div key={b.id} className="bg-zinc-800/40 rounded-lg px-3 py-2 text-sm">
                            <div className="flex items-center gap-2">
                              <span className="text-zinc-400">Lesson:</span>
                              <span className="text-zinc-100 font-medium">{b.lessonTitle}</span>
                            </div>
                            {startDate && (
                              <p className="text-xs text-zinc-500 flex items-center gap-1.5 mt-1">
                                <Calendar className="w-3 h-3" />{format(startDate, 'dd MMM yyyy')}
                                <Clock className="w-3 h-3 ml-1" />{format(startDate, 'HH:mm')}{endDate ? `–${format(endDate, 'HH:mm')}` : ''}
                              </p>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Notes */}
                {g.notes && (
                  <div>
                    <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-1.5">Notes</p>
                    <div className="bg-zinc-800/60 rounded-lg p-3 text-sm text-zinc-300 whitespace-pre-line leading-relaxed">
                      {g.notes}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })()}

      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Guest Teacher Library</h1>
          <p className="text-sm text-zinc-400 mt-0.5">Manage guest teachers you can assign to subjects and lessons</p>
        </div>
        {!panel && (
          <button onClick={openAdd} className="btn-primary gap-1.5">
            <Plus className="w-4 h-4" /> Add guest teacher
          </button>
        )}
      </div>

      {/* Add / Edit panel */}
      {panel !== null && (
        <div className="bg-zinc-900 border border-white/10 rounded-2xl p-5 space-y-4">
          <h2 className="text-base font-semibold text-zinc-100">
            {panel === 'add' ? 'Add guest teacher' : 'Edit guest teacher'}
          </h2>

          {/* Profile photo */}
          <div className="flex items-center gap-4">
            <div className="relative group flex-shrink-0">
              {imgPreview ? (
                <img src={imgPreview} alt="" className="w-20 h-20 rounded-full object-cover" />
              ) : (
                <div className={cn('w-20 h-20 rounded-full flex items-center justify-center text-white text-xl font-bold', form.name ? avatarColor(form.name) : 'bg-zinc-700')}>
                  {form.name ? initials(form.name) : <UserRound className="w-8 h-8 text-zinc-400" />}
                </div>
              )}
              <button type="button" onClick={() => imgRef.current?.click()}
                className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <FileUp className="w-4 h-4 text-white" />
              </button>
              <input ref={imgRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onPickImage(f) }} />
            </div>
            <p className="text-xs text-zinc-500">Click photo to upload profile picture</p>
          </div>

          {/* Basic fields */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label text-xs">Name *</label>
              <input className="input py-2 text-sm" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Full name" />
            </div>
            <div>
              <label className="label text-xs">Price</label>
              <input
                type="number" min="0" step="any"
                className="input py-2 text-sm"
                value={form.price}
                onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
                placeholder="e.g. 5000"
              />
            </div>
          </div>

          {/* Expertise tags */}
          <div>
            <label className="label text-xs">Expertise <span className="text-zinc-400 font-normal">(add multiple)</span></label>
            {expertises.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {expertises.map(tag => (
                  <span key={tag} className="inline-flex items-center gap-1 bg-brand-600/20 text-brand-300 text-xs px-2.5 py-1 rounded-full">
                    {tag}
                    <button type="button" onClick={() => removeExpertise(tag)} className="hover:text-rose-400 transition-colors ml-0.5">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input
                ref={expertRef}
                className="input py-2 text-sm flex-1"
                value={expertiseInput}
                onChange={e => setExpertiseInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addExpertise() } }}
                placeholder="e.g. Cinematography, Director…"
              />
              <button type="button" onClick={addExpertise} className="btn-secondary py-2 text-xs px-3 flex-shrink-0">Add</button>
            </div>
          </div>

          <div>
            <label className="label text-xs">Location</label>
            <input className="input py-2 text-sm" value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="e.g. Stockholm" />
          </div>

          <div>
            <label className="label text-xs">Email <span className="text-zinc-400 font-normal">(optional)</span></label>
            <input type="email" className="input py-2 text-sm" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="name@example.com" />
          </div>

          <div>
            <label className="label text-xs">Bio / Description</label>
            <textarea rows={3} className="input py-2 text-sm resize-none" value={form.bio} onChange={e => setForm(f => ({ ...f, bio: e.target.value }))} placeholder="Brief bio…" />
          </div>

          <div>
            <label className="label text-xs">Portfolio link <span className="text-zinc-400 font-normal">(optional)</span></label>
            <input className="input py-2 text-sm" value={form.portfolioUrl} onChange={e => setForm(f => ({ ...f, portfolioUrl: e.target.value }))} placeholder="https://…" />
          </div>

          <div>
            <label className="label text-xs">Notes <span className="text-zinc-400 font-normal">(internal)</span></label>
            <textarea rows={3} className="input py-2 text-sm resize-none" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Internal notes…" />
          </div>

          {/* Documents */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="label text-xs mb-0">Documents <span className="text-zinc-400 font-normal">(CV, résumé, PDF…)</span></label>
              <button
                type="button"
                onClick={() => docRef.current?.click()}
                className="btn-ghost py-1 text-xs gap-1.5"
              >
                <FileUp className="w-3.5 h-3.5" /> Upload files
              </button>
              <input
                ref={docRef}
                type="file"
                multiple
                accept=".pdf,.doc,.docx,.txt,image/*"
                className="hidden"
                onChange={e => onPickDocs(e.target.files)}
              />
            </div>

            {/* Existing docs */}
            {existingDocs.length > 0 && (
              <ul className="space-y-1 mb-2">
                {existingDocs.map(d => (
                  <li key={d.id} className="flex items-center gap-2 bg-zinc-800/60 rounded-lg px-3 py-2 text-xs">
                    <FileText className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
                    <span className="flex-1 text-zinc-200 truncate">{d.name}</span>
                    <button onClick={() => setViewingDoc(d)} className="text-zinc-400 hover:text-brand-400 transition-colors" title="Preview">
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => markDocRemoved(d.id)} className="text-zinc-500 hover:text-rose-500 transition-colors" title="Remove">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {/* Pending uploads */}
            {pendingDocs.length > 0 && (
              <ul className="space-y-1">
                {pendingDocs.map((f, i) => (
                  <li key={i} className="flex items-center gap-2 bg-brand-600/10 border border-brand-600/20 rounded-lg px-3 py-2 text-xs">
                    <FileText className="w-3.5 h-3.5 text-brand-400 flex-shrink-0" />
                    <span className="flex-1 text-zinc-200 truncate">{f.name}</span>
                    <span className="text-zinc-500 flex-shrink-0">{(f.size / 1024).toFixed(0)} KB</span>
                    <button onClick={() => removePending(i)} className="text-zinc-500 hover:text-rose-500 transition-colors">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {existingDocs.length === 0 && pendingDocs.length === 0 && (
              <p className="text-xs text-zinc-500">No documents uploaded yet.</p>
            )}
          </div>

          {error && <p className="text-xs text-rose-500">{error}</p>}

          <div className="flex gap-2">
            <button onClick={save} disabled={saving} className="btn-primary py-2">
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button onClick={cancel} className="btn-ghost py-2"><X className="w-4 h-4" /></button>
          </div>
        </div>
      )}

      {/* Search + sort + filters */}
      {!panel && (
        <div className="space-y-3">
          {/* Search row */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <input className="input pl-9 py-2 text-sm" placeholder="Search by name, expertise or location…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div className="flex gap-2">
              {/* Sort */}
              <div className="flex gap-1 bg-zinc-900 border border-white/10 rounded-xl p-1">
                {(['name', 'price', 'booked'] as SortKey[]).map(key => (
                  <button key={key} onClick={() => setSortKey(key)}
                    className={cn('px-3 py-1.5 rounded-lg text-sm font-medium transition-all capitalize', sortKey === key ? 'bg-brand-600 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300')}>
                    {key}
                  </button>
                ))}
              </div>
              {/* View toggle */}
              <div className="flex gap-1 bg-zinc-900 border border-white/10 rounded-xl p-1">
                <button
                  onClick={() => setViewMode('cards')}
                  className={cn('p-1.5 rounded-lg transition-all', viewMode === 'cards' ? 'bg-brand-600 text-white' : 'text-zinc-500 hover:text-zinc-300')}
                  title="Card view"
                >
                  <LayoutGrid className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={cn('p-1.5 rounded-lg transition-all', viewMode === 'list' ? 'bg-brand-600 text-white' : 'text-zinc-500 hover:text-zinc-300')}
                  title="List view"
                >
                  <List className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Expertise tags */}
          {expertiseTags.length > 0 && (
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-xs text-zinc-500 font-medium">Expertise:</span>
              {expertiseTags.map(tag => (
                <button
                  key={tag}
                  onClick={() => setFilterExpertise(prev => prev === tag ? null : tag)}
                  className={cn(
                    'text-xs px-2.5 py-1 rounded-full border transition-all',
                    filterExpertise === tag
                      ? 'bg-brand-600 border-brand-500 text-white'
                      : 'border-white/10 text-zinc-400 hover:border-white/25 hover:text-zinc-200',
                  )}
                >
                  {tag}
                </button>
              ))}
              {filterExpertise && (
                <button onClick={() => setFilterExpertise(null)} className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}

          {/* Location tags */}
          {locationTags.length > 0 && (
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-xs text-zinc-500 font-medium">Location:</span>
              {locationTags.map(tag => (
                <button
                  key={tag}
                  onClick={() => setFilterLocation(prev => prev === tag ? null : tag)}
                  className={cn(
                    'text-xs px-2.5 py-1 rounded-full border transition-all',
                    filterLocation === tag
                      ? 'bg-brand-600 border-brand-500 text-white'
                      : 'border-white/10 text-zinc-400 hover:border-white/25 hover:text-zinc-200',
                  )}
                >
                  {tag}
                </button>
              ))}
              {filterLocation && (
                <button onClick={() => setFilterLocation(null)} className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Content */}
      {filtered.length === 0 && !panel ? (
        <div className="text-center py-20 text-zinc-500">
          {guests.length === 0 ? 'No guest teachers yet. Add your first one.' : 'No results match your search.'}
        </div>
      ) : !panel && viewMode === 'list' ? (
        /* ── List view ── */
        <div className="bg-zinc-900 border border-white/10 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: '700px' }}>
              <thead>
                <tr className="border-b border-white/8 text-left">
                  <th className="px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide whitespace-nowrap" style={{ minWidth: '180px' }}>Teacher</th>
                  <th className="px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide whitespace-nowrap" style={{ minWidth: '160px' }}>Expertise</th>
                  <th className="px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide whitespace-nowrap" style={{ minWidth: '120px' }}>Location</th>
                  <th className="px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide whitespace-nowrap" style={{ minWidth: '120px' }}>Price</th>
                  <th className="px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide whitespace-nowrap" style={{ minWidth: '110px' }}>Status</th>
                  <th className="px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide whitespace-nowrap" style={{ minWidth: '180px' }}>Contact</th>
                  <th className="px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide whitespace-nowrap" style={{ minWidth: '140px' }}>Docs</th>
                  <th className="px-2 py-3" style={{ minWidth: '64px' }} />
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filtered.map(g => {
                  const guestBookings    = bookingMap[g.id] ?? []
                  const listSubjectBkgs  = guestBookings.filter(b => b.type === 'subject')
                  const listLessonBkgs   = guestBookings.filter(b => b.type === 'lesson')
                  const listHasLesson    = listLessonBkgs.length > 0
                  const listSubjectOnly  = listSubjectBkgs.length > 0 && !listHasLesson
                  const isBooked         = listHasLesson || syncedEvents.some(e => e.guestTeacherIds?.includes(g.id))
                  const exps             = toExpertiseArray(g.expertise)
                  const visibleExps      = exps.slice(0, 2)
                  const extraExps        = exps.length - visibleExps.length
                  const docs             = g.documents ?? []
                  return (
                    <tr key={g.id} className="hover:bg-white/3 transition-colors group align-middle">
                      {/* Name + photo */}
                      <td className="px-4 py-3">
                        <button onClick={() => setViewingProfile(g)} className="flex items-center gap-2.5 hover:opacity-80 transition-opacity text-left">
                          {g.profilePictureUrl ? (
                            <img src={g.profilePictureUrl} alt={g.name} className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
                          ) : (
                            <div className={cn('w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0', avatarColor(g.name))}>
                              {initials(g.name)}
                            </div>
                          )}
                          <span className="font-medium text-zinc-100 truncate max-w-[140px]">{g.name}</span>
                        </button>
                      </td>
                      {/* Expertise — max 2 chips + overflow count */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 flex-nowrap">
                          {visibleExps.map(e => (
                            <span key={e} className="text-[10px] bg-brand-600/20 text-brand-300 px-1.5 py-0.5 rounded-full whitespace-nowrap">{e}</span>
                          ))}
                          {extraExps > 0 && (
                            <span className="text-[10px] bg-zinc-700 text-zinc-400 px-1.5 py-0.5 rounded-full whitespace-nowrap">+{extraExps}</span>
                          )}
                        </div>
                      </td>
                      {/* Location */}
                      <td className="px-4 py-3 text-zinc-400 text-xs whitespace-nowrap">
                        {g.location && <span className="flex items-center gap-1"><MapPin className="w-3 h-3 flex-shrink-0" />{g.location}</span>}
                      </td>
                      {/* Price */}
                      <td className="px-4 py-3 text-zinc-400 text-xs whitespace-nowrap">{g.price}{g.price ? ` ${currencySymbol}` : ''}</td>
                      {/* Status */}
                      <td className="px-4 py-3">
                        {isBooked ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap bg-emerald-500/20 text-emerald-400">
                            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-emerald-400" />Booked
                          </span>
                        ) : listSubjectOnly ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap bg-amber-500/20 text-amber-400">
                            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-amber-400" />Subject only
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap bg-rose-500/20 text-rose-400">
                            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-rose-400" />Not booked
                          </span>
                        )}
                      </td>
                      {/* Contact */}
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          {g.email && (
                            <a href={`mailto:${g.email}`} className="text-xs text-zinc-400 hover:text-brand-400 transition-colors flex items-center gap-1 whitespace-nowrap">
                              <Mail className="w-3 h-3 flex-shrink-0" />{g.email}
                            </a>
                          )}
                          {g.portfolioUrl && (
                            <a href={g.portfolioUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-400 hover:underline flex items-center gap-1 whitespace-nowrap">
                              <ExternalLink className="w-3 h-3 flex-shrink-0" />Portfolio
                            </a>
                          )}
                        </div>
                      </td>
                      {/* Docs */}
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          {docs.map(d => (
                            <button key={d.id} onClick={() => setViewingDoc(d)} className="text-xs text-zinc-400 hover:text-brand-400 transition-colors flex items-center gap-1 text-left whitespace-nowrap max-w-[130px]">
                              <FileText className="w-3 h-3 flex-shrink-0" />
                              <span className="truncate">{d.name}</span>
                            </button>
                          ))}
                        </div>
                      </td>
                      {/* Actions */}
                      <td className="px-3 py-3">
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity justify-end">
                          <button onClick={() => openEdit(g)} className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
                          <button onClick={() => remove(g)} className="p-1.5 rounded-lg text-zinc-400 hover:text-rose-500 hover:bg-white/5 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : !panel ? (
        /* ── Card grid view ── */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map(g => {
            const guestBookings    = bookingMap[g.id] ?? []
            const subjectBookings  = guestBookings.filter(b => b.type === 'subject')
            const lessonBookings   = guestBookings.filter(b => b.type === 'lesson')
            const hasLessonBooking = lessonBookings.length > 0
            const hasSubjectOnly   = subjectBookings.length > 0 && !hasLessonBooking
            const isBooked         = hasLessonBooking || syncedEvents.some(e => e.guestTeacherIds?.includes(g.id))
            const showLessonPanel  = lessonPanelFor === g.id
            const notesExpanded    = expandedNotes.has(g.id)
            const docs             = g.documents ?? []

            return (
              <div key={g.id} className="group relative flex flex-col gap-3 bg-zinc-900 rounded-2xl border border-white/10 p-4 hover:border-white/20 transition-colors">
                {/* Edit / delete */}
                <div className="absolute top-3 right-3 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => openEdit(g)} className="p-1.5 bg-zinc-800 rounded-full shadow text-zinc-400 hover:text-zinc-200"><Pencil className="w-3 h-3" /></button>
                  <button onClick={() => remove(g)} className="p-1.5 bg-zinc-800 rounded-full shadow text-zinc-400 hover:text-rose-500"><Trash2 className="w-3 h-3" /></button>
                </div>

                {/* Identity — click opens profile */}
                <button
                  onClick={() => setViewingProfile(g)}
                  className="flex items-center gap-3 pr-14 w-full text-left hover:opacity-80 transition-opacity"
                >
                  {g.profilePictureUrl ? (
                    <img src={g.profilePictureUrl} alt={g.name} className="w-14 h-14 rounded-full object-cover flex-shrink-0" />
                  ) : (
                    <div className={cn('w-14 h-14 rounded-full flex items-center justify-center text-white text-base font-bold flex-shrink-0', avatarColor(g.name))}>
                      {initials(g.name)}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="font-semibold text-sm text-zinc-100 truncate">{g.name}</p>
                    {toExpertiseArray(g.expertise).length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {toExpertiseArray(g.expertise).map(e => (
                          <span key={e} className="text-[10px] bg-brand-600/20 text-brand-300 px-1.5 py-0.5 rounded-full whitespace-nowrap">{e}</span>
                        ))}
                      </div>
                    )}
                    {g.location && (
                      <p className="text-xs text-zinc-500 flex items-center gap-1 mt-0.5">
                        <MapPin className="w-3 h-3 flex-shrink-0" />{g.location}
                      </p>
                    )}
                  </div>
                </button>

                {/* Bio */}
                {g.bio && <p className="text-xs text-zinc-400 leading-relaxed line-clamp-2">{g.bio}</p>}

                {/* Meta */}
                <div className="flex flex-wrap gap-2 text-xs text-zinc-400">
                  {g.price && <span>{g.price} {currencySymbol}</span>}
                  {g.email && (
                    <a href={`mailto:${g.email}`} className="inline-flex items-center gap-1 text-zinc-400 hover:text-brand-400 transition-colors">
                      <Mail className="w-3 h-3" />{g.email}
                    </a>
                  )}
                  {g.portfolioUrl && (
                    <a href={g.portfolioUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand-500 hover:underline">
                      Portfolio <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>

                {/* Documents */}
                {docs.length > 0 && (
                  <div className="border-t border-white/5 pt-2 space-y-1">
                    <p className="text-[11px] font-medium text-zinc-500 uppercase tracking-wide mb-1.5">Documents</p>
                    {docs.map(d => (
                      <button
                        key={d.id}
                        onClick={() => setViewingDoc(d)}
                        className="w-full flex items-center gap-2 bg-zinc-800/60 hover:bg-zinc-800 rounded-lg px-3 py-2 text-xs transition-colors text-left group/doc"
                      >
                        <FileText className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
                        <span className="flex-1 text-zinc-200 truncate">{d.name}</span>
                        <Eye className="w-3.5 h-3.5 text-zinc-600 group-hover/doc:text-brand-400 transition-colors flex-shrink-0" />
                      </button>
                    ))}
                  </div>
                )}

                {/* Booking status */}
                <div className="flex items-center gap-2">
                  {isBooked ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-400">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />Booked
                    </span>
                  ) : hasSubjectOnly ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-500/20 text-amber-400">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />Added to subject — not booked for lesson
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-rose-500/20 text-rose-400">
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />Not booked
                    </span>
                  )}
                </div>

                {/* Booking info */}
                {isBooked && (
                  <div className="space-y-1.5 border-t border-white/5 pt-3">
                    <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Booking info</p>
                    {subjectBookings.map(b => (
                      <div key={b.id} className="flex items-start justify-between gap-2 text-xs">
                        <div>
                          <span className="text-zinc-300">Subject: </span>
                          <span className="text-zinc-100 font-medium">{b.subjectTitle}</span>
                        </div>
                        <button onClick={() => removeBooking(b.id)} className="text-zinc-600 hover:text-rose-500 transition-colors flex-shrink-0" title="Remove booking">
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                    {lessonBookings.map(b => {
                      const startDate = b.lessonStart?.toDate?.()
                      const endDate   = b.lessonEnd?.toDate?.()
                      return (
                        <div key={b.id} className="flex items-start justify-between gap-2 text-xs">
                          <div>
                            <span className="text-zinc-300">Lesson: </span>
                            <span className="text-zinc-100 font-medium">{b.lessonTitle}</span>
                            {startDate && (
                              <p className="text-zinc-500 flex items-center gap-1 mt-0.5">
                                <Calendar className="w-3 h-3" />
                                {format(startDate, 'dd MMM yyyy')}
                                <Clock className="w-3 h-3 ml-1" />
                                {format(startDate, 'HH:mm')}{endDate ? `–${format(endDate, 'HH:mm')}` : ''}
                              </p>
                            )}
                          </div>
                          <button onClick={() => removeBooking(b.id)} className="text-zinc-600 hover:text-rose-500 transition-colors flex-shrink-0" title="Remove booking">
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Notes */}
                {g.notes && (
                  <div className="border-t border-white/5 pt-2">
                    <p className="text-[11px] font-medium text-zinc-500 uppercase tracking-wide mb-1.5">Notes</p>
                    <div className="bg-zinc-800/60 rounded-lg p-2.5 text-xs text-zinc-300 whitespace-pre-line leading-relaxed">
                      {notesExpanded || g.notes.length <= NOTES_PREVIEW_LENGTH
                        ? g.notes
                        : `${g.notes.slice(0, NOTES_PREVIEW_LENGTH).trimEnd()}…`}
                    </div>
                    {g.notes.length > NOTES_PREVIEW_LENGTH && (
                      <button onClick={() => toggleNotes(g.id)} className="text-[11px] text-brand-400 hover:text-brand-300 mt-1 transition-colors">
                        {notesExpanded ? 'Show less' : 'Show more'}
                      </button>
                    )}
                  </div>
                )}

                {/* Book for lesson */}
                {!showLessonPanel ? (
                  <button
                    onClick={() => { setLessonPanelFor(g.id); setSelectedLessonId(''); setBookingError(null) }}
                    className="text-xs text-zinc-500 hover:text-brand-400 transition-colors text-left mt-auto"
                  >
                    + Book for a lesson
                  </button>
                ) : (
                  <div className="border-t border-white/5 pt-3 space-y-2">
                    <p className="text-xs font-medium text-zinc-300">Select a lesson</p>
                    {/* Calendar-style grouped lesson list */}
                    <div className="max-h-52 overflow-y-auto space-y-2 pr-0.5">
                      {(() => {
                        const grouped: Record<string, LessonDoc[]> = {}
                        for (const l of upcomingLessons) {
                          const d = l.startTime?.toDate?.()
                          if (!d) continue
                          const key = format(startOfDay(d), 'yyyy-MM-dd')
                          if (!grouped[key]) grouped[key] = []
                          grouped[key].push(l)
                        }
                        const days = Object.keys(grouped).sort()
                        if (days.length === 0) return <p className="text-[11px] text-zinc-600">No upcoming lessons.</p>
                        return days.map(day => {
                          const dayDate = new Date(day + 'T00:00:00')
                          const label = isToday(dayDate) ? 'Today' : isTomorrow(dayDate) ? 'Tomorrow' : format(dayDate, 'EEE d MMM')
                          return (
                            <div key={day}>
                              <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1">{label}</p>
                              <div className="space-y-1">
                                {grouped[day].map(l => {
                                  const st = l.startTime?.toDate?.()
                                  const et = l.endTime?.toDate?.()
                                  const isSelected = selectedLessonId === l.id
                                  return (
                                    <button
                                      key={l.id}
                                      onClick={() => setSelectedLessonId(isSelected ? '' : l.id)}
                                      className={cn(
                                        'w-full text-left rounded-lg px-2.5 py-2 text-xs transition-colors border',
                                        isSelected
                                          ? 'bg-brand-600/20 border-brand-500/40 text-brand-300'
                                          : 'bg-zinc-800/50 border-white/5 text-zinc-300 hover:bg-zinc-800',
                                      )}
                                    >
                                      <p className="font-medium truncate">{l.title}</p>
                                      {st && (
                                        <p className="text-zinc-500 flex items-center gap-1 mt-0.5">
                                          <Clock className="w-2.5 h-2.5" />
                                          {format(st, 'HH:mm')}{et ? `–${format(et, 'HH:mm')}` : ''}
                                          {l.classroom && <><MapPin className="w-2.5 h-2.5 ml-1" />{l.classroom}</>}
                                        </p>
                                      )}
                                    </button>
                                  )
                                })}
                              </div>
                            </div>
                          )
                        })
                      })()}
                    </div>
                    {bookingError && lessonPanelFor === g.id && (
                      <p className="text-xs text-rose-400">{bookingError}</p>
                    )}
                    <div className="flex gap-2">
                      <button onClick={() => bookForLesson(g.id)} disabled={!selectedLessonId || bookingLesson} className="btn-primary py-1.5 text-xs">
                        {bookingLesson ? 'Booking…' : 'Confirm booking & send email'}
                      </button>
                      <button onClick={() => { setLessonPanelFor(null); setBookingError(null) }} className="btn-ghost py-1.5 text-xs">Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
