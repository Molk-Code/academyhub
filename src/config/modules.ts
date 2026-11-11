import type { ModuleId } from '@/lib/features'

// Display names and colours for the sellable modules (placeholders until the
// rename). Used by the superadmin and the login page profile.
export interface ModuleInfo {
  name: string
  tagline: string
  /** Tailwind-independent hex, for badges and the login accent */
  accent: string
}

export const MODULE_INFO: Record<ModuleId, ModuleInfo> = {
  rental_inventory: {
    name:    'Rental & Inventory',
    tagline: 'Asset register, QR check-out and check-in, labels, equipment booking and a public rental shop.',
    accent:  '#0ea5e9',
  },
  production: {
    name:    'Production',
    tagline: 'Script breakdown, crew and cast, shots, schedule, shot log and budget.',
    accent:  '#a855f7',
  },
  academy: {
    name:    'Academy',
    tagline: 'Lessons, assignments, tests, grades, semester planning and school logistics.',
    accent:  '#f97316',
  },
}

export const CORE_INFO = {
  name:    'Core',
  tagline: 'Users and roles, chat, calendar, FAQ, notifications, profile and privacy tools — always included.',
}
