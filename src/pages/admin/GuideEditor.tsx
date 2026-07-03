import { useState, useMemo } from 'react'
import MDEditor from '@uiw/react-md-editor'
import {
  collection, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, writeBatch,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useCollection, orderBy } from '@/hooks/useFirestore'
import type { GuideSectionDoc, GuideArticleDoc, GuideContactDoc } from '@/types'
import {
  Plus, Trash2, Check, X, Pencil, Eye, EyeOff,
  BookOpen, Users, ChevronDown, ChevronUp, Loader2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { GUIDE_SEED_DATA } from '@/data/guideSeedData'

type Tab = 'sections' | 'articles' | 'contacts'

export default function GuideEditor() {
  const { profile } = useAuth()
  const [tab, setTab] = useState<Tab>('sections')
  const [seeding, setSeeding] = useState(false)
  const [seedDone, setSeedDone] = useState(false)

  const { data: sections } = useCollection<GuideSectionDoc>('guide_sections', [orderBy('order', 'asc')])
  const { data: articles } = useCollection<GuideArticleDoc>('guide_articles', [orderBy('order', 'asc')])
  const { data: contacts } = useCollection<GuideContactDoc>('guide_contacts', [orderBy('order', 'asc')])

  async function seedData() {
    if (!profile) return
    if (!confirm('This will add the Production Bible content to Firestore. Continue?')) return
    setSeeding(true)
    try {
      const batch = writeBatch(db)

      // Seed sections
      const sectionIdMap: Record<string, string> = {}
      for (const s of GUIDE_SEED_DATA.sections) {
        const ref = doc(collection(db, 'guide_sections'))
        sectionIdMap[s.key] = ref.id
        batch.set(ref, {
          title: s.title, icon: s.icon, order: s.order, isPublished: true,
        })
      }

      // Seed articles
      for (const a of GUIDE_SEED_DATA.articles) {
        const ref = doc(collection(db, 'guide_articles'))
        batch.set(ref, {
          sectionId: sectionIdMap[a.sectionKey] ?? '',
          title: a.title,
          content: a.content,
          order: a.order,
          isPublished: true,
          updatedAt: serverTimestamp(),
        })
      }

      // Seed contacts
      for (const c of GUIDE_SEED_DATA.contacts) {
        const ref = doc(collection(db, 'guide_contacts'))
        batch.set(ref, { name: c.name, role: c.role, phone: c.phone ?? '', email: c.email ?? '', order: c.order })
      }

      await batch.commit()
      setSeedDone(true)
    } finally {
      setSeeding(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="page-title flex items-center gap-2"><BookOpen className="w-5 h-5" /> School Guide</h1>
          <p className="text-zinc-500 text-sm mt-1">Manage the School Guide content.</p>
        </div>
        {!seedDone && sections.length === 0 && (
          <button onClick={seedData} disabled={seeding} className="btn-primary gap-2">
            {seeding ? <Loader2 className="w-4 h-4 animate-spin" /> : '📖'}
            Seed with Production Bible content
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-zinc-800 rounded-xl p-1 w-fit">
        {(['sections', 'articles', 'contacts'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'px-4 py-2 rounded-lg text-sm font-medium capitalize transition-all',
              tab === t ? 'bg-zinc-900 shadow-sm text-zinc-100' : 'text-zinc-500 hover:text-zinc-300',
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'sections'  && <SectionsPanel sections={sections} profile={profile} />}
      {tab === 'articles'  && <ArticlesPanel sections={sections} articles={articles} />}
      {tab === 'contacts'  && <ContactsPanel contacts={contacts} />}
    </div>
  )
}

// ── Sections Panel ────────────────────────────────────────────────────────────

function SectionsPanel({ sections, profile }: { sections: GuideSectionDoc[]; profile: any }) {
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ title: '', icon: '📄' })
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ title: '', icon: '' })

  async function addSection() {
    if (!form.title.trim()) return
    await addDoc(collection(db, 'guide_sections'), {
      title: form.title.trim(), icon: form.icon, order: sections.length, isPublished: true,
    })
    setForm({ title: '', icon: '📄' })
    setAdding(false)
  }

  async function saveEdit(id: string) {
    await updateDoc(doc(db, 'guide_sections', id), { title: editForm.title.trim(), icon: editForm.icon.trim() })
    setEditingId(null)
  }

  async function togglePublished(s: GuideSectionDoc) {
    await updateDoc(doc(db, 'guide_sections', s.id), { isPublished: !s.isPublished })
  }

  async function moveSection(id: string, dir: -1 | 1) {
    const idx = sections.findIndex(s => s.id === id)
    const other = sections[idx + dir]
    if (!other) return
    const batch = writeBatch(db)
    batch.update(doc(db, 'guide_sections', id), { order: other.order })
    batch.update(doc(db, 'guide_sections', other.id), { order: sections[idx].order })
    await batch.commit()
  }

  async function deleteSection(id: string) {
    if (!confirm('Delete section and all its articles?')) return
    await deleteDoc(doc(db, 'guide_sections', id))
  }

  return (
    <div className="space-y-2 max-w-2xl">
      {sections.map((s, idx) => (
        <div key={s.id} className="bg-zinc-900 rounded-2xl border border-white/10 px-4 py-3 flex items-center gap-3">
          {editingId === s.id ? (
            <>
              <input value={editForm.icon} onChange={e => setEditForm(f => ({ ...f, icon: e.target.value }))} className="input w-14 text-center text-lg py-1.5" />
              <input autoFocus value={editForm.title} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))} onKeyDown={e => e.key === 'Enter' && saveEdit(s.id)} className="input flex-1 py-1.5" />
              <button onClick={() => saveEdit(s.id)} className="p-1.5 text-emerald-500 hover:text-emerald-600"><Check className="w-4 h-4" /></button>
              <button onClick={() => setEditingId(null)} className="p-1.5 text-zinc-400 hover:text-zinc-400"><X className="w-4 h-4" /></button>
            </>
          ) : (
            <>
              <span className="text-xl w-8 text-center">{s.icon}</span>
              <span className="flex-1 font-medium text-zinc-200">{s.title}</span>
              <div className="flex items-center gap-1">
                <button onClick={() => moveSection(s.id, -1)} disabled={idx === 0} className="p-1 text-zinc-400 hover:text-zinc-400 disabled:opacity-30"><ChevronUp className="w-4 h-4" /></button>
                <button onClick={() => moveSection(s.id, 1)} disabled={idx === sections.length - 1} className="p-1 text-zinc-400 hover:text-zinc-400 disabled:opacity-30"><ChevronDown className="w-4 h-4" /></button>
                <button onClick={() => togglePublished(s)} className={cn('p-1.5 rounded-lg', s.isPublished ? 'text-emerald-500' : 'text-zinc-300')}>{s.isPublished ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}</button>
                <button onClick={() => { setEditingId(s.id); setEditForm({ title: s.title, icon: s.icon }) }} className="p-1.5 text-zinc-400 hover:text-zinc-300"><Pencil className="w-3.5 h-3.5" /></button>
                <button onClick={() => deleteSection(s.id)} className="p-1.5 text-zinc-400 hover:text-rose-500"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </>
          )}
        </div>
      ))}

      {adding ? (
        <div className="bg-zinc-900 rounded-2xl border border-brand-200 p-4 flex items-center gap-3">
          <input value={form.icon} onChange={e => setForm(f => ({ ...f, icon: e.target.value }))} className="input w-14 text-center text-lg py-1.5" placeholder="📄" />
          <input autoFocus value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} onKeyDown={e => e.key === 'Enter' && addSection()} className="input flex-1 py-1.5" placeholder="Section title…" />
          <button onClick={addSection} disabled={!form.title.trim()} className="p-1.5 text-emerald-500 hover:text-emerald-600"><Check className="w-4 h-4" /></button>
          <button onClick={() => setAdding(false)} className="p-1.5 text-zinc-400 hover:text-zinc-400"><X className="w-4 h-4" /></button>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className="w-full rounded-2xl border-2 border-dashed border-white/10 p-3 text-sm text-zinc-400 hover:border-brand-300 hover:text-brand-600 transition-all flex items-center justify-center gap-2">
          <Plus className="w-4 h-4" /> Add section
        </button>
      )}
    </div>
  )
}

// ── Articles Panel ────────────────────────────────────────────────────────────

function ArticlesPanel({ sections, articles }: { sections: GuideSectionDoc[]; articles: GuideArticleDoc[] }) {
  const [selectedSectionId, setSelectedSectionId] = useState(sections[0]?.id ?? '')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [editTitle, setEditTitle] = useState('')
  const [adding, setAdding] = useState(false)
  const [newTitle, setNewTitle] = useState('')

  const sectionArticles = useMemo(
    () => articles.filter(a => a.sectionId === selectedSectionId),
    [articles, selectedSectionId],
  )

  async function addArticle() {
    if (!newTitle.trim() || !selectedSectionId) return
    await addDoc(collection(db, 'guide_articles'), {
      sectionId: selectedSectionId,
      title: newTitle.trim(),
      content: '',
      order: sectionArticles.length,
      isPublished: false,
      updatedAt: serverTimestamp(),
    })
    setNewTitle('')
    setAdding(false)
  }

  async function saveArticle(id: string) {
    await updateDoc(doc(db, 'guide_articles', id), {
      title: editTitle.trim(),
      content: editContent,
      updatedAt: serverTimestamp(),
    })
    setEditingId(null)
  }

  async function togglePublished(a: GuideArticleDoc) {
    await updateDoc(doc(db, 'guide_articles', a.id), { isPublished: !a.isPublished })
  }

  async function moveArticle(id: string, dir: -1 | 1) {
    const idx = sectionArticles.findIndex(a => a.id === id)
    const other = sectionArticles[idx + dir]
    if (!other) return
    const batch = writeBatch(db)
    batch.update(doc(db, 'guide_articles', id), { order: other.order })
    batch.update(doc(db, 'guide_articles', other.id), { order: sectionArticles[idx].order })
    await batch.commit()
  }

  async function deleteArticle(id: string) {
    if (!confirm('Delete this article?')) return
    await deleteDoc(doc(db, 'guide_articles', id))
    if (editingId === id) setEditingId(null)
  }

  if (editingId) {
    const article = articles.find(a => a.id === editingId)
    const sectionName = sections.find(s => s.id === article?.sectionId)
    return (
      <div className="flex flex-col h-[calc(100vh-10rem)] -mt-2">
        {/* Editor toolbar */}
        <div className="flex items-center gap-3 pb-3 border-b border-white/10 mb-3">
          <button onClick={() => setEditingId(null)} className="btn-secondary py-1.5 text-sm gap-1.5 flex-shrink-0">
            <X className="w-4 h-4" /> Back
          </button>
          <div className="flex-1 min-w-0">
            <input
              value={editTitle}
              onChange={e => setEditTitle(e.target.value)}
              className="input w-full font-semibold text-base"
              placeholder="Article title…"
            />
            {sectionName && (
              <p className="text-xs text-zinc-400 mt-1 px-1">{sectionName.icon} {sectionName.title}</p>
            )}
          </div>
          <button onClick={() => saveArticle(editingId)} className="btn-primary py-1.5 text-sm gap-1.5 flex-shrink-0">
            <Check className="w-4 h-4" /> Save
          </button>
        </div>
        {/* Full-height MDEditor */}
        <div data-color-mode="light" className="flex-1 min-h-0 overflow-hidden rounded-xl border border-white/10">
          <MDEditor
            value={editContent}
            onChange={v => setEditContent(v ?? '')}
            height="100%"
            preview="live"
            visibleDragbar={false}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4 max-w-3xl">
      {/* Section selector */}
      <select value={selectedSectionId} onChange={e => setSelectedSectionId(e.target.value)} className="input w-64">
        <option value="">— Select section —</option>
        {sections.map(s => <option key={s.id} value={s.id}>{s.icon} {s.title}</option>)}
      </select>

      {!selectedSectionId ? (
        <p className="text-sm text-zinc-400">Select a section to manage its articles.</p>
      ) : (
        <>
          {sectionArticles.map((a, idx) => (
            <div key={a.id} className="bg-zinc-900 rounded-2xl border border-white/10 px-4 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-zinc-100 truncate">{a.title}</p>
                <p className="text-xs text-zinc-400 truncate">{a.content.slice(0, 80) || 'No content yet'}</p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button onClick={() => moveArticle(a.id, -1)} disabled={idx === 0} className="p-1 text-zinc-400 hover:text-zinc-400 disabled:opacity-30"><ChevronUp className="w-4 h-4" /></button>
                <button onClick={() => moveArticle(a.id, 1)} disabled={idx === sectionArticles.length - 1} className="p-1 text-zinc-400 hover:text-zinc-400 disabled:opacity-30"><ChevronDown className="w-4 h-4" /></button>
                <button onClick={() => togglePublished(a)} className={cn('p-1.5 rounded-lg', a.isPublished ? 'text-emerald-500' : 'text-zinc-300')}>{a.isPublished ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}</button>
                <button onClick={() => { setEditingId(a.id); setEditTitle(a.title); setEditContent(a.content) }} className="p-1.5 text-zinc-400 hover:text-brand-600"><Pencil className="w-3.5 h-3.5" /></button>
                <button onClick={() => deleteArticle(a.id)} className="p-1.5 text-zinc-400 hover:text-rose-500"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          ))}

          {adding ? (
            <div className="bg-zinc-900 rounded-2xl border border-brand-200 p-4 flex items-center gap-3">
              <input autoFocus value={newTitle} onChange={e => setNewTitle(e.target.value)} onKeyDown={e => e.key === 'Enter' && addArticle()} className="input flex-1 py-1.5" placeholder="Article title…" />
              <button onClick={addArticle} disabled={!newTitle.trim()} className="p-1.5 text-emerald-500 hover:text-emerald-600"><Check className="w-4 h-4" /></button>
              <button onClick={() => setAdding(false)} className="p-1.5 text-zinc-400"><X className="w-4 h-4" /></button>
            </div>
          ) : (
            <button onClick={() => setAdding(true)} className="w-full rounded-2xl border-2 border-dashed border-white/10 p-3 text-sm text-zinc-400 hover:border-brand-300 hover:text-brand-600 transition-all flex items-center justify-center gap-2">
              <Plus className="w-4 h-4" /> Add article
            </button>
          )}
        </>
      )}
    </div>
  )
}

// ── Contacts Panel ────────────────────────────────────────────────────────────

function ContactsPanel({ contacts }: { contacts: GuideContactDoc[] }) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const emptyForm = { name: '', role: '', phone: '', email: '' }
  const [form, setForm] = useState(emptyForm)

  async function saveContact(id: string) {
    await updateDoc(doc(db, 'guide_contacts', id), { name: form.name, role: form.role, phone: form.phone, email: form.email })
    setEditingId(null)
  }

  async function addContact() {
    if (!form.name.trim()) return
    await addDoc(collection(db, 'guide_contacts'), { ...form, order: contacts.length })
    setForm(emptyForm)
    setAdding(false)
  }

  async function deleteContact(id: string) {
    if (!confirm('Delete this contact?')) return
    await deleteDoc(doc(db, 'guide_contacts', id))
  }

  const ContactForm = ({ onSave, onCancel }: { onSave: () => void; onCancel: () => void }) => (
    <div className="bg-zinc-900 rounded-2xl border border-brand-200 p-4 grid grid-cols-2 gap-3">
      <input className="input py-1.5 text-sm" placeholder="Name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
      <input className="input py-1.5 text-sm" placeholder="Role / Title" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} />
      <input className="input py-1.5 text-sm" placeholder="Phone" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
      <input className="input py-1.5 text-sm" placeholder="Email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
      <div className="col-span-2 flex gap-2">
        <button onClick={onSave} disabled={!form.name.trim()} className="btn-primary py-1.5 text-xs gap-1.5"><Check className="w-3.5 h-3.5" /> Save</button>
        <button onClick={onCancel} className="btn-secondary py-1.5 text-xs"><X className="w-3.5 h-3.5" /></button>
      </div>
    </div>
  )

  return (
    <div className="space-y-2 max-w-2xl">
      {contacts.map(c => (
        <div key={c.id}>
          {editingId === c.id ? (
            <ContactForm onSave={() => saveContact(c.id)} onCancel={() => setEditingId(null)} />
          ) : (
            <div className="bg-zinc-900 rounded-2xl border border-white/10 px-4 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-zinc-100">{c.name}</p>
                <p className="text-xs text-zinc-400">{c.role}</p>
                <div className="flex gap-4 mt-1 text-xs text-zinc-500">
                  {c.phone && <span>{c.phone}</span>}
                  {c.email && <span>{c.email}</span>}
                </div>
              </div>
              <div className="flex gap-1 flex-shrink-0">
                <button onClick={() => { setEditingId(c.id); setForm({ name: c.name, role: c.role, phone: c.phone ?? '', email: c.email ?? '' }) }} className="p-1.5 text-zinc-400 hover:text-brand-600"><Pencil className="w-3.5 h-3.5" /></button>
                <button onClick={() => deleteContact(c.id)} className="p-1.5 text-zinc-400 hover:text-rose-500"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          )}
        </div>
      ))}

      {adding ? (
        <ContactForm onSave={addContact} onCancel={() => { setAdding(false); setForm(emptyForm) }} />
      ) : (
        <button onClick={() => setAdding(true)} className="w-full rounded-2xl border-2 border-dashed border-white/10 p-3 text-sm text-zinc-400 hover:border-brand-300 hover:text-brand-600 transition-all flex items-center justify-center gap-2">
          <Plus className="w-4 h-4" /> Add contact
        </button>
      )}
    </div>
  )
}
