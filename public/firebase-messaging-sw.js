// CineForge Firebase Messaging Service Worker
// This SW handles ONLY push notifications — nothing else

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js')

firebase.initializeApp({
  apiKey: 'AIzaSyDU7rdWOm34fSOxsKxK9xafFw0zGyH4eX4',
  authDomain: 'academy-hub-c252f.firebaseapp.com',
  projectId: 'academy-hub-c252f',
  storageBucket: 'academy-hub-c252f.firebasestorage.app',
  messagingSenderId: '776953880788',
  appId: '1:776953880788:web:03c3e598f9a1b6b39cdb41',
})

const messaging = firebase.messaging()

messaging.onBackgroundMessage((payload) => {
  const { title, body, icon } = payload.data || {}
  if (!title) return
  // Set app icon badge when a push arrives while the app is in the background
  if (self.navigator?.setAppBadge) {
    self.navigator.setAppBadge().catch(() => {})
  }
  return self.registration.showNotification(title, {
    body: body || '',
    icon: icon || '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: payload.data?.tag || 'cineforge',
    renotify: false,
    data: payload.data,
  })
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Re-use an existing tab and navigate it to the target URL
      const existing = windowClients.find(c => c.url.startsWith(self.location.origin))
      if (existing) {
        existing.navigate(url)
        return existing.focus()
      }
      return clients.openWindow(url)
    })
  )
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'CLEAR_NOTIFICATIONS') {
    self.registration.getNotifications().then(notifications => {
      notifications.forEach(n => n.close())
    })
  }
})
