import { useState, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'
import { useCollection, orderBy } from '@/hooks/useFirestore'
import type { GuideSectionDoc, GuideArticleDoc, GuideContactDoc } from '@/types'
import { Search, Phone, Mail, AlertTriangle, Info } from 'lucide-react'
import Breadcrumb from '@/components/common/Breadcrumb'

function plainText(content: string, maxLen: number): string {
  const stripped = content.trimStart().startsWith('<')
    ? content.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
    : content.replace(/[#*_`]/g, '').trim()
  return stripped.slice(0, maxLen)
}

const PALETTE = [
  '#3b82f6', '#f97316', '#22c55e', '#a855f7',
  '#f59e0b', '#ec4899', '#ef4444', '#14b8a6',
  '#6366f1', '#06b6d4', '#84cc16', '#f43f5e',
]

const CONTACTS_COLOR = '#6366f1'

type View = 'grid' | 'section' | 'article'

export default function StudentGuide() {
  const { data: sections } = useCollection<GuideSectionDoc>('guide_sections', [orderBy('order', 'asc')])
  const { data: articles } = useCollection<GuideArticleDoc>('guide_articles', [orderBy('order', 'asc')])
  const { data: contacts } = useCollection<GuideContactDoc>('guide_contacts', [orderBy('order', 'asc')])

  const [view, setView]                     = useState<View>('grid')
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null)
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery]       = useState('')

  const publishedSections = useMemo(() => sections.filter(s => s.isPublished), [sections])
  const publishedArticles = useMemo(() => articles.filter(a => a.isPublished), [articles])

  const sectionColors = useMemo(
    () => Object.fromEntries(publishedSections.map((s, i) => [s.id, PALETTE[i % PALETTE.length]])),
    [publishedSections],
  )

  const searchResults = useMemo(() => {
    const q = searchQuery.toLowerCase().trim()
    if (!q) return []
    return publishedArticles
      .filter(a => a.title.toLowerCase().includes(q) || a.content.toLowerCase().includes(q))
      .map(a => ({ ...a, section: publishedSections.find(s => s.id === a.sectionId) }))
  }, [searchQuery, publishedArticles, publishedSections])

  const sectionArticles = useMemo(
    () => selectedSectionId ? publishedArticles.filter(a => a.sectionId === selectedSectionId) : [],
    [publishedArticles, selectedSectionId],
  )

  const selectedArticle = useMemo(
    () => publishedArticles.find(a => a.id === selectedArticleId) ?? null,
    [publishedArticles, selectedArticleId],
  )

  const selectedSection = useMemo(
    () => publishedSections.find(s => s.id === selectedSectionId) ?? null,
    [publishedSections, selectedSectionId],
  )

  function openSection(id: string) {
    setSelectedSectionId(id)
    setView('section')
    setSearchQuery('')
    window.scrollTo(0, 0)
  }

  function openArticle(articleId: string, sectionId?: string) {
    if (sectionId) setSelectedSectionId(sectionId)
    setSelectedArticleId(articleId)
    setView('article')
    window.scrollTo(0, 0)
  }

  function goBack() {
    if (view === 'article') {
      setView('section')
      setSelectedArticleId(null)
    } else {
      setView('grid')
      setSelectedSectionId(null)
    }
    window.scrollTo(0, 0)
  }

  function goToGrid() {
    setView('grid')
    setSelectedSectionId(null)
    setSelectedArticleId(null)
    window.scrollTo(0, 0)
  }

  // ── GRID VIEW ──────────────────────────────────────────────────────────────
  if (view === 'grid') {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-extrabold" style={{ color: 'var(--text-primary)' }}>School Guide</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>
            Everything you need to know about your filmmaking education
          </p>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5" style={{ color: 'var(--text-muted)' }} />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search the Production Bible..."
            className="w-full pl-12 pr-4 py-3.5 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
          />
        </div>

        {/* Search results */}
        {searchQuery ? (
          <div className="space-y-2">
            <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
              {searchResults.length} result{searchResults.length !== 1 ? 's' : ''}
            </p>
            {searchResults.length === 0 ? (
              <div className="text-center py-12" style={{ color: 'var(--text-muted)' }}>
                <p className="text-sm">No results found for "{searchQuery}"</p>
              </div>
            ) : searchResults.map(a => (
              <button
                key={a.id}
                onClick={() => openArticle(a.id, a.sectionId)}
                className="w-full text-left rounded-2xl p-4 transition-all hover:border-white/20"
                style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-base">{a.section?.icon ?? '📄'}</span>
                  <span className="text-xs font-semibold" style={{ color: sectionColors[a.sectionId] ?? '#86bbd8' }}>
                    {a.section?.title}
                  </span>
                </div>
                <p className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{a.title}</p>
                <p className="text-xs mt-0.5 line-clamp-2" style={{ color: 'var(--text-muted)' }}>
                  {plainText(a.content, 120)}…
                </p>
              </button>
            ))}
          </div>
        ) : (
          /* Category grid */
          <div className="grid grid-cols-2 gap-3">
            {publishedSections.map((section, idx) => {
              const c = PALETTE[idx % PALETTE.length]
              const count = publishedArticles.filter(a => a.sectionId === section.id).length
              if (count === 0) return null
              return (
                <CategoryCard
                  key={section.id}
                  icon={section.icon}
                  title={section.title}
                  description={(section as any).description}
                  color={c}
                  onClick={() => openSection(section.id)}
                />
              )
            })}
            {contacts.length > 0 && (
              <CategoryCard
                icon="📞"
                title="Contacts"
                description="Key people to contact"
                color={CONTACTS_COLOR}
                onClick={() => openSection('__contacts__')}
              />
            )}
          </div>
        )}
      </div>
    )
  }

  // ── CONTACTS SECTION ───────────────────────────────────────────────────────
  if (view === 'section' && selectedSectionId === '__contacts__') {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <Breadcrumb items={[
          { label: 'Home', href: '/dashboard' },
          { label: 'School Guide', onClick: goToGrid },
          { label: 'Contacts' },
        ]} />
        <div className="flex items-center gap-4 mb-8">
          <div className="w-16 h-16 rounded-full flex items-center justify-center text-3xl flex-shrink-0"
            style={{ backgroundColor: CONTACTS_COLOR + '22', border: `2px solid ${CONTACTS_COLOR}44` }}>
            📞
          </div>
          <div>
            <h1 className="text-2xl font-extrabold" style={{ color: 'var(--text-primary)' }}>Contacts</h1>
            <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>Key people at Molkoms folkhögskola</p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {contacts.map((c, i) => {
            const cc = PALETTE[i % PALETTE.length]
            return (
              <div key={c.id} className="rounded-2xl p-5"
                style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-base font-bold text-white flex-shrink-0"
                    style={{ backgroundColor: cc }}>
                    {c.name.charAt(0)}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-sm leading-tight" style={{ color: 'var(--text-primary)' }}>{c.name}</p>
                    <p className="text-xs mt-0.5 font-medium" style={{ color: cc }}>{c.role}</p>
                  </div>
                </div>
                <div className="space-y-1.5">
                  {c.phone && (
                    <a href={`tel:${c.phone.replace(/\s/g, '')}`}
                      className="flex items-center gap-2 text-sm transition-colors hover:opacity-80"
                      style={{ color: 'var(--text-secondary)' }}>
                      <Phone className="w-3.5 h-3.5 flex-shrink-0" />
                      <span>{c.phone}</span>
                    </a>
                  )}
                  {c.email && (
                    <a href={`mailto:${c.email}`}
                      className="flex items-center gap-2 text-sm transition-colors hover:opacity-80"
                      style={{ color: 'var(--text-secondary)' }}>
                      <Mail className="w-3.5 h-3.5 flex-shrink-0" />
                      <span className="truncate">{c.email}</span>
                    </a>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // ── SECTION ARTICLE LIST ───────────────────────────────────────────────────
  if (view === 'section' && selectedSection) {
    const c = sectionColors[selectedSection.id] ?? '#f97316'
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <Breadcrumb items={[
          { label: 'Home', href: '/dashboard' },
          { label: 'School Guide', onClick: goToGrid },
          { label: selectedSection.title },
        ]} />
        <div className="flex items-center gap-4 mb-8">
          <div className="w-16 h-16 rounded-full flex items-center justify-center text-3xl flex-shrink-0"
            style={{ backgroundColor: c + '22', border: `2px solid ${c}44` }}>
            {selectedSection.icon}
          </div>
          <div>
            <h1 className="text-2xl font-extrabold" style={{ color: 'var(--text-primary)' }}>{selectedSection.title}</h1>
            {(selectedSection as any).description && (
              <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>{(selectedSection as any).description}</p>
            )}
          </div>
        </div>
        <div className="space-y-2">
          {sectionArticles.map(article => (
            <button
              key={article.id}
              onClick={() => openArticle(article.id)}
              className="w-full text-left rounded-2xl p-4 transition-all hover:scale-[1.01]"
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
            >
              <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>{article.title}</p>
              <p className="text-xs mt-1 line-clamp-2" style={{ color: 'var(--text-muted)' }}>
                {plainText(article.content, 100)}…
              </p>
              <div className="mt-2.5 h-0.5 w-8 rounded-full" style={{ backgroundColor: c }} />
            </button>
          ))}
        </div>
      </div>
    )
  }

  // ── ARTICLE VIEW ──────────────────────────────────────────────────────────
  if (view === 'article' && selectedArticle) {
    const articleSection = publishedSections.find(s => s.id === selectedArticle.sectionId)
    const c = articleSection ? (sectionColors[articleSection.id] ?? '#f97316') : '#f97316'

    const mdComponents: Components = {
      h2: ({ children }) => (
        <h2 className="text-xl font-bold mt-10 mb-4 pb-3" style={{ color: 'var(--text-primary)', borderBottom: `2px solid ${c}40` }}>
          {children}
        </h2>
      ),
      h3: ({ children }) => (
        <h3 className="text-base font-bold mt-7 mb-2.5" style={{ color: c }}>{children}</h3>
      ),
      p: ({ children }) => (
        <p className="mb-4 text-[15px]" style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>{children}</p>
      ),
      ul: ({ children }) => <ul className="space-y-1.5 mb-5 ml-1">{children}</ul>,
      ol: ({ children }) => <ol className="space-y-1.5 mb-5 ml-1 list-decimal list-inside">{children}</ol>,
      li: ({ children }) => (
        <li className="flex items-start gap-2.5 text-[15px]" style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>
          <span className="w-1.5 h-1.5 rounded-full mt-2.5 flex-shrink-0" style={{ backgroundColor: c }} />
          <span>{children}</span>
        </li>
      ),
      strong: ({ children }) => <strong className="font-semibold" style={{ color: 'var(--text-primary)' }}>{children}</strong>,
      blockquote: ({ children }) => {
        const text = String(children)
        const isWarning = text.includes('⚠️') || text.toLowerCase().includes('important') || text.toLowerCase().includes('never')
        return (
          <div className="flex gap-3 rounded-xl px-4 py-3.5 mb-5 border" style={isWarning
            ? { background: 'rgba(245,158,11,0.08)', borderColor: 'rgba(245,158,11,0.25)' }
            : { background: c + '0d', borderColor: c + '30' }
          }>
            <div className="flex-shrink-0 mt-0.5">
              {isWarning
                ? <AlertTriangle className="w-4 h-4 text-amber-500" />
                : <Info className="w-4 h-4" style={{ color: c }} />
              }
            </div>
            <div className="text-sm leading-relaxed font-medium" style={{ color: isWarning ? '#fcd34d' : c }}>
              {children}
            </div>
          </div>
        )
      },
      table: ({ children }) => (
        <div className="mb-6 rounded-xl overflow-hidden border border-white/10 overflow-x-auto">
          <table className="w-full min-w-[400px] text-sm">{children}</table>
        </div>
      ),
      thead: ({ children }) => <thead style={{ background: c + '22' }}>{children}</thead>,
      th: ({ children }) => <th className="px-4 py-3 text-left text-xs font-semibold text-white uppercase tracking-wider">{children}</th>,
      td: ({ children }) => <td className="px-4 py-3 border-t border-white/8" style={{ color: 'var(--text-secondary)' }}>{children}</td>,
      tr: ({ children }) => <tr className="hover:bg-white/5 transition-colors">{children}</tr>,
      code: ({ children, className }) => className?.includes('language-') ? (
        <pre className="bg-slate-900 text-slate-100 rounded-xl px-5 py-4 overflow-x-auto text-sm mb-5">
          <code>{children}</code>
        </pre>
      ) : (
        <code className="px-1.5 py-0.5 rounded-md text-sm font-mono" style={{ background: c + '18', color: c }}>{children}</code>
      ),
      hr: () => <hr className="border-white/10 my-8" />,
      a: ({ href, children }) => (
        <a href={href} className="underline underline-offset-2" style={{ color: c }} target="_blank" rel="noreferrer">{children}</a>
      ),
    }

    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <Breadcrumb items={[
          { label: 'Home', href: '/dashboard' },
          { label: 'School Guide', onClick: goToGrid },
          ...(articleSection ? [{ label: articleSection.title, onClick: goBack }] : []),
          { label: selectedArticle.title },
        ]} />
        <article>
          {articleSection && (
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xl">{articleSection.icon}</span>
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full"
                style={{ backgroundColor: c + '20', color: c }}>
                {articleSection.title}
              </span>
            </div>
          )}
          <h1 className="text-3xl font-extrabold leading-tight mb-8" style={{ color: 'var(--text-primary)' }}>
            {selectedArticle.title}
          </h1>
          {selectedArticle.content.trimStart().startsWith('<') ? (
            <div
              className="
                prose prose-invert prose-sm max-w-none
                prose-headings:text-zinc-100 prose-h1:text-2xl prose-h2:text-xl prose-h3:text-base
                prose-p:text-zinc-300 prose-p:leading-relaxed
                prose-a:text-brand-400 prose-a:underline
                prose-strong:text-zinc-100 prose-strong:font-semibold
                prose-em:italic
                prose-ul:list-disc prose-ul:pl-5 prose-ul:text-zinc-300
                prose-ol:list-decimal prose-ol:pl-5 prose-ol:text-zinc-300
                prose-li:mb-1
                prose-blockquote:border-l-4 prose-blockquote:border-brand-600 prose-blockquote:pl-4 prose-blockquote:italic prose-blockquote:text-zinc-400
                prose-hr:border-white/10
                prose-code:bg-zinc-800 prose-code:px-1 prose-code:rounded prose-code:text-brand-300 prose-code:text-xs
                prose-pre:bg-zinc-800 prose-pre:rounded-lg prose-pre:p-4
                prose-img:rounded-lg prose-img:my-3
              "
              dangerouslySetInnerHTML={{ __html: selectedArticle.content }}
            />
          ) : (
            <ReactMarkdown components={mdComponents} remarkPlugins={[remarkGfm]}>
              {selectedArticle.content}
            </ReactMarkdown>
          )}
        </article>
      </div>
    )
  }

  return null
}

// ── Category card component ───────────────────────────────────────────────────

function CategoryCard({ icon, title, description, color, onClick }: {
  icon: string
  title: string
  description?: string
  color: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="group rounded-[20px] p-6 text-center transition-all duration-150 hover:scale-[1.03] active:scale-[0.97] w-full"
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.boxShadow = `0 0 0 2px ${color}40, 0 8px 24px ${color}20`
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.boxShadow = '0 1px 3px rgba(0,0,0,0.3)'
      }}
    >
      {/* Circle icon */}
      <div
        className="w-16 h-16 rounded-full flex items-center justify-center text-3xl mx-auto mb-3 transition-transform duration-150 group-hover:scale-110"
        style={{ backgroundColor: color + '22', border: `2px solid ${color}44` }}
      >
        {icon}
      </div>
      {/* Title */}
      <p className="font-semibold text-[15px] leading-tight mb-1" style={{ color: 'var(--text-primary)' }}>
        {title}
      </p>
      {/* Description */}
      {description && (
        <p className="text-xs leading-snug mb-3" style={{ color: 'var(--text-muted)' }}>{description}</p>
      )}
      {/* Colored underline accent */}
      <div className="h-1 w-10 rounded-full mx-auto mt-2" style={{ backgroundColor: color }} />
    </button>
  )
}
