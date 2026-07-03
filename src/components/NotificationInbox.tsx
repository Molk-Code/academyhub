import { useState } from 'react'
import { Bell } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { doc, updateDoc, writeBatch, collection } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useCollection, where, orderBy } from '@/hooks/useFirestore'
import { limit } from 'firebase/firestore'
import { useAuth } from '@/contexts/AuthContext'
import type { NotificationDoc } from '@/types'

export default function NotificationInbox() {
  const { profile } = useAuth()
  const [open, setOpen] = useState(false)

  const { data: notifications } = useCollection<NotificationDoc>(
    'notifications',
    profile ? [where('uid', '==', profile.uid), orderBy('createdAt', 'desc'), limit(20)] : [],
    !!profile,
  )

  const unread = notifications.filter(n => !n.isRead).length

  async function markRead(id: string) {
    await updateDoc(doc(db, 'notifications', id), { isRead: true })
  }

  async function markAllRead() {
    const unreadItems = notifications.filter(n => !n.isRead)
    if (unreadItems.length === 0) return
    const batch = writeBatch(db)
    unreadItems.forEach(n => batch.update(doc(db, 'notifications', n.id), { isRead: true }))
    await batch.commit()
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="relative p-2 rounded-xl text-zinc-400 hover:bg-white/10 transition-colors"
        aria-label="Notifications"
      >
        <Bell className="w-5 h-5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-orange-500 rounded-full text-[10px] font-bold flex items-center justify-center text-white leading-none">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="fixed z-50 bg-zinc-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
            style={{
              top: 56,
              right: 8,
              width: 'min(320px, calc(100vw - 16px))',
              maxHeight: 'calc(100dvh - 72px)',
            }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/8 flex-shrink-0">
              <p className="font-semibold text-sm text-white">Notifications</p>
              {unread > 0 && (
                <button
                  onClick={markAllRead}
                  className="text-xs text-orange-400 hover:text-orange-300 transition-colors"
                >
                  Mark all read
                </button>
              )}
            </div>
            <div className="overflow-y-auto flex-1">
              {notifications.length === 0 ? (
                <div className="text-center py-8 text-zinc-500 text-sm">No notifications yet</div>
              ) : (
                notifications.map(n => (
                  <a
                    key={n.id}
                    href={n.url ?? '#'}
                    onClick={() => { markRead(n.id); setOpen(false) }}
                    className={`block px-4 py-3 border-b border-white/5 hover:bg-white/5 transition-colors ${!n.isRead ? 'bg-orange-500/5' : ''}`}
                  >
                    <div className="flex items-start gap-2">
                      {!n.isRead && (
                        <div className="w-1.5 h-1.5 bg-orange-500 rounded-full mt-1.5 flex-shrink-0" />
                      )}
                      <div className={!n.isRead ? '' : 'pl-3.5'}>
                        <p className="text-sm font-medium text-white leading-snug">{n.title}</p>
                        <p className="text-xs text-zinc-400 mt-0.5">{n.body}</p>
                        <p className="text-xs text-zinc-600 mt-1">
                          {n.createdAt ? formatDistanceToNow(n.createdAt.toDate(), { addSuffix: true }) : ''}
                        </p>
                      </div>
                    </div>
                  </a>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
