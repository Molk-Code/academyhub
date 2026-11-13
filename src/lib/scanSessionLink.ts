// The desktop shows a QR code with <origin>/scan/<sessionId>. Inside the app
// (/scan, "Join from this phone") we read that code and open the session here,
// so an installed app that is already signed in can be used instead of the
// browser the phone's camera would open. Only the id is used; the session is
// always opened in this app.
export function scanSessionIdFrom(text: string): string | null {
  let path: string
  try { path = new URL(text.trim()).pathname } catch { return null }
  const m = /^\/scan\/([A-Za-z0-9_-]{1,64})\/?$/.exec(path)
  return m ? m[1] : null
}
