// Shown while a role's layout chunk (and the user's role) loads. Kept out of the
// layout files so the entry bundle doesn't pull in every role's layout.

export function StudentLayoutSkeleton() {
  return (
    <div className="flex h-screen" style={{ background: 'var(--bg-primary)' }}>
      <div className="hidden lg:flex w-64 flex-col flex-shrink-0 border-r" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
        <div className="h-16 flex items-center gap-3 px-5 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="w-8 h-8 rounded-lg bg-brand-500/20 animate-pulse flex-shrink-0" />
          <div className="h-4 w-24 bg-white/10 rounded animate-pulse" />
        </div>
        <div className="flex-1 px-3 py-4 space-y-1">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-10 bg-white/5 rounded-xl animate-pulse" style={{ opacity: 1 - i * 0.1 }} />
          ))}
        </div>
      </div>
      <div className="flex-1 p-8">
        <div className="h-8 w-48 bg-white/10 rounded-xl animate-pulse mb-2" />
        <div className="h-4 w-64 bg-white/5 rounded animate-pulse mb-8" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-16 bg-white/5 rounded-xl mb-3 animate-pulse" />
        ))}
      </div>
    </div>
  )
}

export function AdminLayoutSkeleton() {
  return (
    <div className="flex h-screen bg-zinc-950">
      <div className="hidden lg:flex w-64 bg-zinc-900 border-r border-white/8 flex-col p-4 flex-shrink-0">
        <div className="flex items-center gap-2 mb-8 px-2">
          <div className="w-8 h-8 rounded-lg bg-orange-500/20 animate-pulse" />
          <div className="h-4 w-24 bg-white/10 rounded animate-pulse" />
        </div>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-9 bg-white/5 rounded-xl mb-1 animate-pulse" style={{ opacity: 1 - i * 0.1 }} />
        ))}
      </div>
      <div className="flex-1 p-8">
        <div className="h-8 w-48 bg-white/10 rounded-xl animate-pulse mb-2" />
        <div className="h-4 w-64 bg-white/5 rounded animate-pulse mb-8" />
        <div className="grid grid-cols-3 gap-4 mb-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 bg-white/5 rounded-2xl animate-pulse" />
          ))}
        </div>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-16 bg-white/5 rounded-xl mb-3 animate-pulse" />
        ))}
      </div>
    </div>
  )
}
