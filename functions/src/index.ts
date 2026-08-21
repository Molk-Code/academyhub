// Barrel: re-export every callable/trigger handler from the domain modules.
// Firebase Functions discovers exports on this module — as long as each name
// is re-exported here, the deploy tool keeps the same function registrations.

export * from './auth'
export * from './points'
export * from './notifications'
export * from './equipment'
export * from './production'
export * from './calendar'
export * from './gdpr'
