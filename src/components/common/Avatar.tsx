import { cn, initials, avatarColor } from '@/lib/utils'

interface Props {
  uid: string
  name: string
  avatarUrl?: string | null
  size?: 'xs' | 'sm' | 'md' | 'lg'
  className?: string
}

const sizes = {
  xs: 'w-6 h-6 text-xs',
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-12 h-12 text-base',
}

export default function Avatar({ uid, name, avatarUrl, size = 'md', className }: Props) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        className={cn('rounded-full object-cover', sizes[size], className)}
      />
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
