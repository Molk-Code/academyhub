// Data-access layer: shared queries and the scoping rules that go with them.
// Pages call these instead of building the same Firestore query and filter
// themselves, so a rule (which class, which events, which people) is fixed in
// one place. queries.test.ts checks that pages don't drift back.
export * from './scope'
export * from './cohort'
export * from './events'
export * from './users'
