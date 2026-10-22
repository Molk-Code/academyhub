import { useRef, type ReactNode, type PointerEvent } from 'react'
import { Move } from 'lucide-react'
import type { SubjectDoc } from '@/types'
import { coverImageUrl } from '@/lib/cloudinary'
import { cn } from '@/lib/utils'

type Focus = { x: number; y: number }

const clamp = (v: number) => Math.min(100, Math.max(0, Math.round(v * 10) / 10))

// Cinematic cover for a subject: its uploaded image (or a gradient in the
// subject colour when none) faded to black at the bottom, with `children` laid
// over the bottom edge.
// Pass `onReposition` to let the user drag the image to reframe it.
export default function SubjectCover({
  subject, className, size = 'card', children, onReposition,
}: {
  subject: Pick<SubjectDoc, 'imageUrl' | 'imageFocus' | 'color' | 'iconEmoji' | 'title'>
  className?: string
  size?: 'card' | 'hero'
  children?: ReactNode
  onReposition?: (focus: Focus) => void
}) {
  const [w, h] = size === 'hero' ? [1600, 520] : [800, 320]
  const imgRef = useRef<HTMLImageElement>(null)
  const drag = useRef<{ x0: number; y0: number; fx: number; fy: number } | null>(null)

  const focus = subject.imageFocus ?? { x: 50, y: 50 }
  const editable = !!onReposition && !!subject.imageUrl
  // Hand-framed images (and the editor, so dragging starts from what you see)
  // load uncropped and are framed with object-position.
  const uncropped = !!subject.imageFocus || editable

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (!editable) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x0: e.clientX, y0: e.clientY, fx: focus.x, fy: focus.y }
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current, img = imgRef.current
    if (!d || !img || !img.naturalWidth) return
    // How far the covered image overhangs the frame on each axis — object-position
    // 0–100% slides across exactly that overhang.
    const box = e.currentTarget.getBoundingClientRect()
    const scale = Math.max(box.width / img.naturalWidth, box.height / img.naturalHeight)
    const overX = img.naturalWidth * scale - box.width
    const overY = img.naturalHeight * scale - box.height
    // Dragging the image right reveals more of its left side → lower x%
    onReposition!({
      x: overX > 1 ? clamp(d.fx - ((e.clientX - d.x0) / overX) * 100) : 50,
      y: overY > 1 ? clamp(d.fy - ((e.clientY - d.y0) / overY) * 100) : 50,
    })
  }

  function endDrag() { drag.current = null }

  return (
    <div
      className={cn('relative w-full overflow-hidden', editable && 'cursor-grab active:cursor-grabbing touch-none select-none', className)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {subject.imageUrl ? (
        <img
          ref={imgRef}
          src={coverImageUrl(subject.imageUrl, w, h, uncropped)}
          alt=""
          loading="lazy"
          draggable={false}
          className="absolute inset-0 w-full h-full object-cover pointer-events-none"
          style={uncropped ? { objectPosition: `${focus.x}% ${focus.y}%` } : undefined}
        />
      ) : (
        <div className={cn('absolute inset-0', subject.color)}>
          <div className="absolute inset-0 bg-gradient-to-br from-white/10 via-transparent to-black/40" />
          <span className="absolute -right-4 -bottom-6 text-[7rem] leading-none opacity-25 select-none" aria-hidden>
            {subject.iconEmoji}
          </span>
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent pointer-events-none" />
      {editable && (
        <span className="absolute top-2.5 right-2.5 flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/55 backdrop-blur-md text-[11px] font-medium text-white/90 pointer-events-none">
          <Move className="w-3 h-3" /> Drag to reposition
        </span>
      )}
      {children && <div className="absolute inset-x-0 bottom-0 p-3.5 pointer-events-none [&_a]:pointer-events-auto [&_button]:pointer-events-auto">{children}</div>}
    </div>
  )
}
