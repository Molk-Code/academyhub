import { admin, db } from './lib'

// ─────────────────────────────────────────────────────────────────────────────
// Push notification helpers
// ─────────────────────────────────────────────────────────────────────────────

export async function sendPush(
  tokens: string[],
  opts: { title: string; body: string; url?: string; tag?: string },
) {
  if (tokens.length === 0) return
  const uniqueTokens = [...new Set(tokens)]
  try {
    for (let i = 0; i < uniqueTokens.length; i += 500) {
      const chunk = uniqueTokens.slice(i, i + 500)
      const res = await admin.messaging().sendEachForMulticast({
        tokens: chunk,
        // Data-only — no notification field so FCM does not auto-display.
        // The service worker's onBackgroundMessage handler is the sole display path.
        data: {
          title: opts.title,
          body:  opts.body,
          url:   opts.url ?? '/',
          tag:   opts.tag ?? 'cineforge',
        },
        webpush: {
          headers: { Urgency: 'high' },
        },
      })
      const successCount = res.responses.filter(r => r.success).length
      const failCount    = res.responses.filter(r => !r.success).length
      console.log('sendPush result', {
        title: opts.title,
        tokenCount: chunk.length,
        successCount,
        failCount,
        errors: res.responses.filter(r => !r.success).map(r => r.error?.message),
      })
      // Remove stale tokens that are no longer registered
      const stale = res.responses
        .map((r, idx) => (!r.success ? chunk[idx] : null))
        .filter(Boolean) as string[]
      if (stale.length > 0) {
        const usersSnap = await db.collection('users')
          .where('fcmTokens', 'array-contains-any', stale)
          .get()
        await Promise.all(usersSnap.docs.map(d =>
          d.ref.update({ fcmTokens: admin.firestore.FieldValue.arrayRemove(...stale) }),
        ))
      }
    }
  } catch (err: any) {
    console.error('sendPush error', { message: err?.message })
  }
}

export async function saveNotifications(
  uids: string[],
  opts: { title: string; body: string; url?: string },
) {
  if (uids.length === 0) return
  const batch = db.batch()
  for (const uid of uids) {
    const ref = db.collection('notifications').doc()
    batch.set(ref, {
      uid,
      title:     opts.title,
      body:      opts.body,
      url:       opts.url ?? '/',
      isRead:    false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    })
  }
  await batch.commit()
}

export async function sendFcmToTokens(tokens: string[], title: string, body: string): Promise<void> {
  if (!tokens.length) return
  const messaging = admin.messaging()
  // Send in batches of 500 (FCM multicast limit)
  for (let i = 0; i < tokens.length; i += 500) {
    const batch = tokens.slice(i, i + 500)
    await messaging.sendEachForMulticast({
      tokens: batch,
      notification: { title, body },
      data: { title, body, tag: 'event-reminder' },
      webpush: {
        notification: {
          title,
          body,
          icon: '/icons/icon-192.png',
          badge: '/icons/icon-192.png',
          tag: 'event-reminder',
        },
      },
    })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Booking notification helpers
// ─────────────────────────────────────────────────────────────────────────────

export async function getOrCreateBookingsChannel(): Promise<string> {
  const snap = await db.collection('chat_channels')
    .where('name', '==', 'Bookings')
    .limit(1)
    .get()

  if (!snap.empty) return snap.docs[0].id

  const ref = await db.collection('chat_channels').add({
    name:             'Bookings',
    description:      'Food box orders and minivan requests',
    order:            99,
    isPublic:         false,
    allowedRoles:     ['teacher', 'admin'],
    allowedCohortIds: [],
    allowedTeamIds:   [],
    memberIds:        [],
    createdAt:        admin.firestore.FieldValue.serverTimestamp(),
    createdBy:        'system',
  })
  return ref.id
}

export async function postToBookingsChannel(channelId: string, text: string) {
  await db.collection('chat_channels').doc(channelId)
    .collection('messages').add({
      authorId:        'system',
      authorName:      'CineForge',
      authorAvatarUrl: null,
      content:         text,
      attachments:     [],
      reactions:       {},
      skipPush:        true,   // prevent onChatMessage from sending a duplicate push
      createdAt:       admin.firestore.FieldValue.serverTimestamp(),
    })
  await db.collection('chat_channels').doc(channelId).update({
    lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
  })
}

export async function pushToTeachersAndAdmins(title: string, body: string, url: string) {
  const snap = await db.collection('users')
    .where('role', 'in', ['teacher', 'admin'])
    .get()
  const tokens: string[] = []
  const uids: string[] = []
  snap.docs.forEach(d => {
    tokens.push(...(d.data().fcmTokens ?? []))
    uids.push(d.id)
  })
  await Promise.all([
    sendPush(tokens, { title, body, url, tag: 'booking' }),
    saveNotifications(uids, { title, body, url }),
  ])
}

export async function pushToTeachersAndAdminsSplit(
  title: string,
  body: string,
  teacherUrl: string,
  adminUrl: string,
) {
  const snap = await db.collection('users')
    .where('role', 'in', ['teacher', 'admin'])
    .get()
  const teacherTokens: string[] = []; const teacherUids: string[] = []
  const adminTokens:   string[] = []; const adminUids:   string[] = []
  snap.docs.forEach(d => {
    const role = d.data().role
    const tokens: string[] = d.data().fcmTokens ?? []
    if (role === 'admin') { adminTokens.push(...tokens); adminUids.push(d.id) }
    else                  { teacherTokens.push(...tokens); teacherUids.push(d.id) }
  })
  await Promise.all([
    sendPush(teacherTokens, { title, body, url: teacherUrl, tag: 'booking' }),
    saveNotifications(teacherUids, { title, body, url: teacherUrl }),
    sendPush(adminTokens,   { title, body, url: adminUrl,   tag: 'booking' }),
    saveNotifications(adminUids,   { title, body, url: adminUrl }),
  ])
}

export async function pushToStudent(studentId: string, title: string, body: string) {
  const snap = await db.collection('users').doc(studentId).get()
  const tokens: string[] = snap.data()?.fcmTokens ?? []
  await sendPush(tokens, { title, body, url: '/booking', tag: 'booking-update' })
}
