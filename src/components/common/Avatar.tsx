import { useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn, initials, avatarColor } from '@/lib/utils'

interface Props {
  uid: string
  name: string
  avatarUrl?: string | null
  size?: 'xs' | 'sm' | 'md' | 'lg'
  className?: string
  enlargeable?: boolean
}

const sizes = {
  xs: 'w-6 h-6 text-xs',
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-12 h-12 text-base',
}

export default function Avatar({ uid, name, avatarUrl, size = 'md', className, enlargeable }: Props) {
  const [open, setOpen] = useState(false)

  if (avatarUrl) {
    return (
      <>
        <img
          src={avatarUrl}
          alt={name}
          className={cn(
            'rounded-full object-cover flex-shrink-0',
            enlargeable && 'cursor-pointer hover:opacity-90 transition-opacity',
            sizes[size],
            className,
          )}
          onTouchStart={enlargeable ? (e) => { e.stopPropagation() } : undefined}
          onClick={enlargeable ? (e) => { e.preventDefault(); e.stopPropagation(); setOpen(true) } : undefined}
        />
        {open && createPortal(
          <div
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(false) }}
            onTouchEnd={(e) => { e.preventDefault(); setOpen(false) }}
          >
            <div className="relative flex flex-col items-center" onClick={e => e.stopPropagation()} onTouchEnd={e => e.stopPropagation()}>
              <img
                src={avatarUrl}
                alt={name}
                className="rounded-2xl object-contain shadow-2xl"
                style={{ maxWidth: 'min(90vw, 360px)', maxHeight: '75vh' }}
              />
              <p className="text-zinc-300 text-sm font-medium mt-3">{name}</p>
              <button
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(false) }}
                onTouchEnd={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(false) }}
                className="absolute -top-3 -right-3 w-7 h-7 bg-zinc-800 border border-white/20 rounded-full flex items-center justify-center text-zinc-300 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>,
          document.body,
        )}
      </>
    )
  }

  return (
    <div
      className={cn(
        'rounded-full flex items-center justify-center text-white font-bold flex-shrink-0',
        avatarColor(uid),
        sizes[size],
        className,
      )}
    >
      {initials(name)}
    </div>
  )
}
