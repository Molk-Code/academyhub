// Where to go after signing in, from ?redirect= (e.g. the phone scanner sends
// /login?redirect=/scan/<id>). Only paths inside this app: anything that could
// leave the site (//host, https://…, /\host) falls back to the home route.
export function safeRedirect(value: string | null | undefined, fallback = '/'): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback
  if (/[\u0000-\u001f]/.test(value) || value.startsWith('/login')) return fallback
  return value
}
