self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
    .then(() => self.clients.claim())
))

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js')

firebase.initializeApp({
  apiKey:            'AIzaSyDU7rdWOm34fSOxsKxK9xafFw0zGyH4eX4',
  authDomain:        'academy-hub-c252f.firebaseapp.com',
  projectId:         'academy-hub-c252f',
  storageBucket:     'academy-hub-c252f.firebasestorage.app',
  messagingSenderId: '776953880788',
  appId:             '1:776953880788:web:03c3e598f9a1b6b39cdb41',
})

const messaging = firebase.messaging()

messaging.onBackgroundMessage((payload) => {
  const { title, body, icon } = payload.data
  return self.registration.showNotification(title, {
    body,
    icon:  icon || '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag:   payload.data?.tag ?? 'cineforge',
    data:  payload.data ?? {},
  })
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  if ('clearAppBadge' in self) self.clearAppBadge().catch(() => {})
  const url = event.notification.data?.url ?? '/'
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
      for (const c of cs) {
        if (c.url.includes(self.location.origin) && 'focus' in c) {
          c.focus()
          if (c.navigate) c.navigate(url)
          return
        }
      }
      if (clients.openWindow) return clients.openWindow(url)
    }),
  )
})

self.addEventListener('message', async (event) => {
  if (event.data?.type !== 'CLEAR_NOTIFICATIONS') return
  const notifications = await self.registration.getNotifications()
  notifications.forEach(n => n.close())
  if ('clearAppBadge' in self) self.clearAppBadge().catch(() => {})
})
