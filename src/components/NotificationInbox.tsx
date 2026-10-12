import { useRef, useState } from 'react'
import { Bell } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { doc, updateDoc, writeBatch, collection } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useCollection, where, orderBy } from '@/hooks/useFirestore'
import { limit } from 'firebase/firestore'
import { useAuth } from '@/contexts/AuthContext'
import { useBookingBadgeDetail } from '@/hooks/useBookingBadge'
import { useChatUnreadCount } from '@/hooks/useChatUnread'
import { useBugReportBadge } from '@/hooks/useBugReportBadge'
import type { NotificationDoc } from '@/types'

// Pending-item badges (food/van/equipment requests, open bug reports, unread
// chat) live outside the `notifications` log — they're derived counts, not
// logged events — but should still surface here so the bell reflects
// everything currently unseen, not just past point-in-time pushes.
type SyntheticItem = { id: string; title: string; body: string; url: string }

function useSyntheticItems(): SyntheticItem[] {
  const { role } = useAuth()
  const { food, van, equipment } = useBookingBadgeDetail()
  const chatUnread = useChatUnreadCount()
  const bugReports = useBugReportBadge()
  const chatUrl = role === 'admin' ? '/admin/chat' : role === 'teacher' ? '/teacher/chat' : '/chat'

  const items: SyntheticItem[] = []
  if (bugReports > 0) items.push({ id: 'synthetic-bug-reports', title: '🐛 Open bug reports', body: `${bugReports} report${bugReports === 1 ? '' : 's'} awaiting review`, url: '/admin/bug-reports' })
  if (equipment > 0)  items.push({ id: 'synthetic-equipment',   title: '📦 Pending equipment requests', body: `${equipment} request${equipment === 1 ? '' : 's'} awaiting review`, url: '/admin/equipment' })
  if (food > 0)       items.push({ id: 'synthetic-food',        title: '🍱 Pending food box orders', body: `${food} order${food === 1 ? '' : 's'} awaiting confirmation`, url: '/admin/food-box-orders' })
  if (van > 0)        items.push({ id: 'synthetic-van',         title: '🚐 Pending vehicle requests', body: `${van} request${van === 1 ? '' : 's'} awaiting review`, url: '/admin/minivan' })
  if (chatUnread > 0) items.push({ id: 'synthetic-chat',        title: '💬 Unread chat messages', body: `${chatUnread} channel${chatUnread === 1 ? '' : 's'} with new messages`, url: chatUrl })
  return items
}

export default function NotificationInbox() {
  const { profile } = useAuth()
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number; width: number }>({ top: 56, left: 8, width: 320 })

  function toggleOpen() {
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      const width = Math.min(320, window.innerWidth - 16)
      const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))
      setPos({ top: rect.bottom + 8, left, width })
    }
    setOpen(o => !o)
  }

  const { data: notifications } = useCollection<NotificationDoc>(
    'notifications',
    profile ? [where('uid', '==', profile.uid), orderBy('createdAt', 'desc'), limit(4)] : [],
    !!profile,
  )

  const syntheticItems = useSyntheticItems()
  // Synthetic items (pending-item badges) are always "unseen" by nature — they
  // disappear on their own once the underlying thing is resolved — so they're
  // pinned first and count toward the bell badge alongside real unread logs.
  const combined = [...syntheticItems, ...notifications].slice(0, 4)
  const unread = syntheticItems.length + notifications.filter(n => !n.isRead).length

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
        ref={btnRef}
        onClick={toggleOpen}
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
              top: pos.top,
              left: pos.left,
              width: pos.width,
              maxHeight: `calc(100dvh - ${pos.top + 16}px)`,
            }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/8 flex-shrink-0">
              <p className="font-semibold text-sm text-white">Notifications</p>
              {notifications.some(n => !n.isRead) && (
                <button
                  onClick={markAllRead}
                  className="text-xs text-orange-400 hover:text-orange-300 transition-colors"
                >
                  Mark all read
                </button>
              )}
            </div>
            <div className="overflow-y-auto flex-1">
              {combined.length === 0 ? (
                <div className="text-center py-8 text-zinc-500 text-sm">No notifications yet</div>
              ) : (
                combined.map(n => {
                  const isSynthetic = !('createdAt' in n)
                  const isUnread = isSynthetic || !n.isRead
                  return (
                    <a
                      key={n.id}
                      href={n.url ?? '#'}
                      onClick={() => { if (!isSynthetic) markRead(n.id); setOpen(false) }}
                      className={`block px-4 py-3 border-b border-white/5 hover:bg-white/5 transition-colors ${isUnread ? 'bg-orange-500/5' : ''}`}
                    >
                      <div className="flex items-start gap-2">
                        {isUnread && (
                          <div className="w-1.5 h-1.5 bg-orange-500 rounded-full mt-1.5 flex-shrink-0" />
                        )}
                        <div className={isUnread ? '' : 'pl-3.5'}>
                          <p className="text-sm font-medium text-white leading-snug">{n.title}</p>
                          <p className="text-xs text-zinc-400 mt-0.5">{n.body}</p>
                          <p className="text-xs text-zinc-600 mt-1">
                            {!isSynthetic && n.createdAt ? formatDistanceToNow(n.createdAt.toDate(), { addSuffix: true }) : ''}
                          </p>
                        </div>
                      </div>
                    </a>
                  )
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
