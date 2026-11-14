// Who may open the superadmin page and the hidden previews (the rules and
// functions check again server-side). VITE_SUPERADMIN_EMAILS (comma-separated)
// overrides, e.g. for the emulator.
export const SUPER_ADMIN_EMAILS: string[] = (import.meta.env.VITE_SUPERADMIN_EMAILS as string | undefined)?.split(',').map(e => e.trim()).filter(Boolean)
  ?? ['fredrik.fridlund@gmail.com']

export function isSuperAdminEmail(email: string | null | undefined): boolean {
  return !!email && SUPER_ADMIN_EMAILS.includes(email)
}
