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
        'rounded-full border-2 border-slate-200 border-t-brand-600 animate-spin',
        sizes[size],
        className,
      )}
    />
  )

  if (fullScreen) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-white z-50">
        {spinner}
      </div>
    )
  }

  return spinner
}
