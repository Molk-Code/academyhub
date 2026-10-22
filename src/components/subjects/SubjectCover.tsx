import type { ReactNode } from 'react'
import type { SubjectDoc } from '@/types'
import { coverImageUrl } from '@/lib/cloudinary'
import { cn } from '@/lib/utils'

// Cinematic cover for a subject: its uploaded image (or a gradient in the
// subject colour when none) faded to black at the bottom, with the emoji on a
// blurred pill top-left and `children` laid over the bottom edge.
export default function SubjectCover({
  subject, className, size = 'card', children,
}: {
  subject: Pick<SubjectDoc, 'imageUrl' | 'color' | 'iconEmoji' | 'title'>
  className?: string
  size?: 'card' | 'hero'
  children?: ReactNode
}) {
  const [w, h] = size === 'hero' ? [1600, 520] : [800, 320]

  return (
    <div className={cn('relative w-full overflow-hidden', className)}>
      {subject.imageUrl ? (
        <img
          src={coverImageUrl(subject.imageUrl, w, h)}
          alt=""
          loading="lazy"
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <div className={cn('absolute inset-0', subject.color)}>
          <div className="absolute inset-0 bg-gradient-to-br from-white/10 via-transparent to-black/40" />
          <span className="absolute -right-4 -bottom-6 text-[7rem] leading-none opacity-25 select-none" aria-hidden>
            {subject.iconEmoji}
          </span>
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />
      <span className="absolute top-2.5 left-2.5 px-2 py-0.5 rounded-full bg-black/45 backdrop-blur-md text-base leading-6 select-none">
        {subject.iconEmoji}
      </span>
      {children && <div className="absolute inset-x-0 bottom-0 p-3.5">{children}</div>}
    </div>
  )
}
