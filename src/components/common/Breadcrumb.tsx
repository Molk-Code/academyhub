import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

interface BreadcrumbItem {
  label: string
  href?: string
  onClick?: () => void
}

export default function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  const parent = items[items.length - 2]

  function handleParentNav() {
    if (parent?.onClick) parent.onClick()
  }

  return (
    <div className="mb-6">
      {/* Mobile: back button only */}
      <div className="md:hidden">
        {parent && (
          parent.href ? (
            <Link
              to={parent.href}
              className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              {parent.label}
            </Link>
          ) : (
            <button
              onClick={handleParentNav}
              className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              {parent.label}
            </button>
          )
        )}
      </div>

      {/* Desktop: full breadcrumb trail */}
      <nav className="hidden md:flex items-center gap-1.5 text-sm text-gray-500">
        {items.map((item, i) => (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-gray-700">/</span>}
            {(item.href || item.onClick) && i < items.length - 1 ? (
              item.href ? (
                <Link to={item.href} className="hover:text-orange-400 transition-colors">
                  {item.label}
                </Link>
              ) : (
                <button onClick={item.onClick} className="hover:text-orange-400 transition-colors">
                  {item.label}
                </button>
              )
            ) : (
              <span className={i === items.length - 1 ? 'text-white font-medium' : ''}>
                {item.label}
              </span>
            )}
          </span>
        ))}
      </nav>
    </div>
  )
}
