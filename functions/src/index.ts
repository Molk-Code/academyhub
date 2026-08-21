// Barrel: re-export every callable/trigger handler from the domain modules.
// Firebase Functions discovers exports on this module — as long as each name
// is re-exported here, the deploy tool keeps the same function registrations.

export * from './auth'
export * from './points'
export * from './notifications-core'
export * from './notifications-triggers'
export * from './notifications-scheduled'
export * from './equipment'
export * from './food-box'
export * from './minivan'
export * from './assignments'
export * from './production-pdf'
export * from './calendar'
export * from './gdpr'
