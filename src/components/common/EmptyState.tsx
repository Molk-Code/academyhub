import type { LucideIcon } from 'lucide-react'

interface Props {
  icon?: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
}

export default function EmptyState({ icon: Icon, title, description, action }: Props) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      {Icon && (
        <div className="w-14 h-14 bg-zinc-800 rounded-2xl flex items-center justify-center mb-4">
          <Icon className="w-7 h-7 text-zinc-400" />
        </div>
      )}
      <h3 className="text-base font-semibold text-zinc-300 mb-1">{title}</h3>
      {description && <p className="text-sm text-zinc-400 max-w-xs">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
