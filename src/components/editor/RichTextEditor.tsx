import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import TextAlign from '@tiptap/extension-text-align'
import Image from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import {
  Bold, Italic, UnderlineIcon, Strikethrough,
  Heading1, Heading2, Heading3,
  List, ListOrdered, Quote, Minus, Link2, Image as ImageIcon,
  AlignLeft, AlignCenter, AlignRight,
  Undo, Redo,
} from 'lucide-react'
import { useCallback } from 'react'

interface RichTextEditorProps {
  value: string
  onChange: (html: string) => void
  placeholder?: string
  minHeight?: number
}

function ToolbarButton({
  onClick, active, title, children,
}: {
  onClick: () => void
  active?: boolean
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onMouseDown={e => { e.preventDefault(); onClick() }}
      title={title}
      className={`
        p-1.5 rounded-md transition-colors text-sm
        ${active
          ? 'bg-brand-600 text-white'
          : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700'
        }
      `}
    >
      {children}
    </button>
  )
}

function Divider() {
  return <div className="w-px h-5 bg-white/10 mx-0.5 self-center flex-shrink-0" />
}

export default function RichTextEditor({ value, onChange, placeholder = 'Start writing…', minHeight = 400 }: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: 'text-brand-400 underline cursor-pointer' },
      }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Image.configure({ inline: false }),
      Placeholder.configure({ placeholder }),
    ],
    content: value,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML())
    },
    editorProps: {
      attributes: {
        class: 'outline-none',
        style: `min-height:${minHeight}px; padding: 1.25rem;`,
      },
      handlePaste: (_view, event) => {
        // Let TipTap handle Word/Google Docs HTML paste natively
        const clipboardData = event.clipboardData
        if (!clipboardData) return false
        const html = clipboardData.getData('text/html')
        // If clipboard has HTML (Word, Google Docs, web), TipTap's default
        // transformer will clean and import it — return false to let it handle
        if (html) return false
        return false
      },
    },
  }, [])

  const setLink = useCallback(() => {
    if (!editor) return
    const prev = editor.getAttributes('link').href
    const url = window.prompt('URL', prev)
    if (url === null) return
    if (url === '') {
      editor.chain().focus().unsetLink().run()
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }, [editor])

  const addImage = useCallback(() => {
    if (!editor) return
    const url = window.prompt('Image URL')
    if (url) editor.chain().focus().setImage({ src: url }).run()
  }, [editor])

  if (!editor) return null

  return (
    <div className="flex flex-col h-full border border-white/10 rounded-xl overflow-hidden bg-zinc-950">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b border-white/10 bg-zinc-900 flex-shrink-0">
        {/* Undo/Redo */}
        <ToolbarButton onClick={() => editor.chain().focus().undo().run()} title="Undo" active={false}>
          <Undo className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().redo().run()} title="Redo" active={false}>
          <Redo className="w-4 h-4" />
        </ToolbarButton>
        <Divider />

        {/* Headings */}
        <ToolbarButton onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive('heading', { level: 1 })} title="Heading 1">
          <Heading1 className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })} title="Heading 2">
          <Heading2 className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive('heading', { level: 3 })} title="Heading 3">
          <Heading3 className="w-4 h-4" />
        </ToolbarButton>
        <Divider />

        {/* Text formatting */}
        <ToolbarButton onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Bold">
          <Bold className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italic">
          <Italic className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="Underline">
          <UnderlineIcon className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} title="Strikethrough">
          <Strikethrough className="w-4 h-4" />
        </ToolbarButton>
        <Divider />

        {/* Lists */}
        <ToolbarButton onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Bullet list">
          <List className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Numbered list">
          <ListOrdered className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')} title="Blockquote">
          <Quote className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().setHorizontalRule().run()} active={false} title="Divider">
          <Minus className="w-4 h-4" />
        </ToolbarButton>
        <Divider />

        {/* Alignment */}
        <ToolbarButton onClick={() => editor.chain().focus().setTextAlign('left').run()} active={editor.isActive({ textAlign: 'left' })} title="Align left">
          <AlignLeft className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().setTextAlign('center').run()} active={editor.isActive({ textAlign: 'center' })} title="Align center">
          <AlignCenter className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().setTextAlign('right').run()} active={editor.isActive({ textAlign: 'right' })} title="Align right">
          <AlignRight className="w-4 h-4" />
        </ToolbarButton>
        <Divider />

        {/* Link & Image */}
        <ToolbarButton onClick={setLink} active={editor.isActive('link')} title="Insert link">
          <Link2 className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton onClick={addImage} active={false} title="Insert image">
          <ImageIcon className="w-4 h-4" />
        </ToolbarButton>

        {/* Paste hint */}
        <span className="ml-auto text-xs text-zinc-600 pr-1 hidden sm:block">Paste from Word or PDF supported</span>
      </div>

      {/* Editor area */}
      <div className="flex-1 overflow-y-auto">
        <EditorContent
          editor={editor}
          className="
            prose prose-invert prose-sm max-w-none h-full
            [&_.ProseMirror]:outline-none
            [&_.ProseMirror_h1]:text-2xl [&_.ProseMirror_h1]:font-bold [&_.ProseMirror_h1]:text-zinc-100 [&_.ProseMirror_h1]:mb-3 [&_.ProseMirror_h1]:mt-6
            [&_.ProseMirror_h2]:text-xl [&_.ProseMirror_h2]:font-bold [&_.ProseMirror_h2]:text-zinc-100 [&_.ProseMirror_h2]:mb-2 [&_.ProseMirror_h2]:mt-5
            [&_.ProseMirror_h3]:text-base [&_.ProseMirror_h3]:font-semibold [&_.ProseMirror_h3]:text-zinc-200 [&_.ProseMirror_h3]:mb-2 [&_.ProseMirror_h3]:mt-4
            [&_.ProseMirror_p]:text-zinc-300 [&_.ProseMirror_p]:leading-relaxed [&_.ProseMirror_p]:mb-3
            [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-5 [&_.ProseMirror_ul]:mb-3 [&_.ProseMirror_ul]:text-zinc-300
            [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-5 [&_.ProseMirror_ol]:mb-3 [&_.ProseMirror_ol]:text-zinc-300
            [&_.ProseMirror_li]:mb-1
            [&_.ProseMirror_blockquote]:border-l-4 [&_.ProseMirror_blockquote]:border-brand-600 [&_.ProseMirror_blockquote]:pl-4 [&_.ProseMirror_blockquote]:italic [&_.ProseMirror_blockquote]:text-zinc-400 [&_.ProseMirror_blockquote]:my-3
            [&_.ProseMirror_hr]:border-white/10 [&_.ProseMirror_hr]:my-4
            [&_.ProseMirror_strong]:text-zinc-100 [&_.ProseMirror_strong]:font-semibold
            [&_.ProseMirror_em]:italic
            [&_.ProseMirror_a]:text-brand-400 [&_.ProseMirror_a]:underline
            [&_.ProseMirror_code]:bg-zinc-800 [&_.ProseMirror_code]:px-1 [&_.ProseMirror_code]:rounded [&_.ProseMirror_code]:text-brand-300 [&_.ProseMirror_code]:text-xs
            [&_.ProseMirror_pre]:bg-zinc-800 [&_.ProseMirror_pre]:rounded-lg [&_.ProseMirror_pre]:p-4 [&_.ProseMirror_pre]:mb-3
            [&_.ProseMirror_img]:max-w-full [&_.ProseMirror_img]:rounded-lg [&_.ProseMirror_img]:my-3
            [&_.ProseMirror_.is-editor-empty:first-child::before]:content-[attr(data-placeholder)] [&_.ProseMirror_.is-editor-empty:first-child::before]:text-zinc-600 [&_.ProseMirror_.is-editor-empty:first-child::before]:float-left [&_.ProseMirror_.is-editor-empty:first-child::before]:pointer-events-none [&_.ProseMirror_.is-editor-empty:first-child::before]:h-0
          "
        />
      </div>
    </div>
  )
}
