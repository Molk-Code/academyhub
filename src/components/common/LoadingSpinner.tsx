import { cn } from '@/lib/utils'

interface Props {
  fullScreen?: boolean
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

export default function LoadingSpinner({ fullScreen, size = 'md', className }: Props) {
  const sizes = { sm: 'w-4 h-4', md: 'w-8 h-8', lg: 'w-12 h-12' }

  const spinner = (
    <div
      className={cn(
        'rounded-full border-2 border-zinc-700 border-t-brand-500 animate-spin',
        sizes[size],
        className,
      )}
    />
  )

  if (fullScreen) {
    return (
      <div className="fixed inset-0 flex items-center justify-center z-50" style={{ background: 'var(--bg-primary)' }}>
        {spinner}
      </div>
    )
  }

  return spinner
}
