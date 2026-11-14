// CineForge Firebase Messaging Service Worker
// Handles push notifications + forces navigation requests fresh from network
// to prevent iOS PWA from serving stale cached app shells after deploys.

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('fetch', (event) => {
  // Only intercept same-origin navigation requests (the HTML page itself)
  if (event.request.mode === 'navigate' && event.request.url.startsWith(self.location.origin)) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .catch(() => caches.match(event.request).then(r => r ?? fetch(event.request)))
    )
  }
})

// ── Notification clicks ──────────────────────────────────────────────────────
// Registered before firebase.messaging() on purpose: the Messaging SDK adds its
// own click handler, which for pushes with a `notification` block (all of ours)
// stops other handlers and only *focuses* an open app window without going to
// the link. Ours runs first and stops the SDK's instead.
//   App open (any tab / the installed app): focus it and ask it to navigate
//     in-app ({ type: 'notification-click', url }); NotificationNavigator in
//     the app maps the link to the right page for the user's role. If the
//     window doesn't answer (an older version still loaded), load the link.
//   App not open: open /open?to=<link>, which waits for sign-in, then does
//     the same mapping.
function notificationLink(notification) {
  const d = notification.data || {}
  const fcm = d.FCM_MSG || {}
  return d.url || (fcm.data && fcm.data.url) || (fcm.fcmOptions && fcm.fcmOptions.link) ||
    (fcm.notification && fcm.notification.click_action) || '/'
}

function inAppPath(link) {
  try {
    const u = new URL(link, self.location.origin)
    return u.origin === self.location.origin ? u.pathname + u.search + u.hash : '/'
  } catch (e) { return '/' }
}

function askToNavigate(client, path) {
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    const timer = setTimeout(() => resolve(false), 1500)
    channel.port1.onmessage = () => { clearTimeout(timer); resolve(true) }
    try { client.postMessage({ type: 'notification-click', url: path }, [channel.port2]) }
    catch (e) { clearTimeout(timer); resolve(false) }
  })
}

self.addEventListener('notificationclick', (event) => {
  event.stopImmediatePropagation()
  event.notification.close()
  const path = inAppPath(notificationLink(event.notification))
  const openPath = '/open?to=' + encodeURIComponent(path)
  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true })
    const ours = windows.filter(c => c.url.startsWith(self.location.origin))
    const client = ours.find(c => c.focused) || ours.find(c => c.visibilityState === 'visible') || ours[0]
    if (!client) return clients.openWindow(openPath)
    try { await client.focus() } catch (e) { /* not allowed on some platforms; navigation still works */ }
    if (await askToNavigate(client, path)) return
    try { await client.navigate(new URL(openPath, self.location.origin).href) }
    catch (e) { return clients.openWindow(openPath) }
  })())
})

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js')

firebase.initializeApp({
  apiKey: '%VITE_FIREBASE_API_KEY%',
  authDomain: '%VITE_FIREBASE_AUTH_DOMAIN%',
  projectId: '%VITE_FIREBASE_PROJECT_ID%',
  storageBucket: '%VITE_FIREBASE_STORAGE_BUCKET%',
  messagingSenderId: '%VITE_FIREBASE_MESSAGING_SENDER_ID%',
  appId: '%VITE_FIREBASE_APP_ID%',
})

const messaging = firebase.messaging()

messaging.onBackgroundMessage((payload) => {
  // Pushes that carry a `notification` block are already shown by the browser /
  // FCM SDK. Showing our own copy too is what produced duplicates on iOS, which
  // doesn't collapse notifications by tag. Only display data-only pushes here.
  if (payload.notification) return
  const { title, body, icon } = payload.data || {}
  if (!title) return
  return self.registration.showNotification(title, {
    body: body || '',
    icon: icon || '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: payload.data?.tag || 'cineforge',
    renotify: false,
    data: payload.data,
  })
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'CLEAR_NOTIFICATIONS') {
    self.registration.getNotifications().then(notifications => {
      notifications.forEach(n => n.close())
    })
  }
})
