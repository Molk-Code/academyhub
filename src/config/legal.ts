// Provider details shown on the login page footer, the contact page and the
// privacy policy (the information Swedish/EU rules on information-society
// services expect to be easy to find). Replace every 'TODO:' value; until
// then the UI hides that line instead of showing a placeholder.
//
// Use role addresses (contact@…, privacy@…), never a personal mailbox.
// contactEmail must also be set as CONTACT_NOTIFY_EMAIL in
// functions/.env.<projectId>, which is where contact form messages are sent.

export interface LegalConfig {
  providerName: string
  /** Swedish organisationsnummer, or the text 'sole trader' (enskild firma) */
  orgNumber: string
  streetAddress: string
  postalCode: string
  city: string
  country: string
  contactEmail: string
  privacyContactEmail: string
  /** Optional: Swedish VAT number (momsregistreringsnummer, SE…01) */
  vatNumber: string
  appName: string
  appDomain: string
  /** Keep equal to CONTACT_RETENTION_MONTHS in functions/src/contact.ts */
  contactRetentionMonths: number
  /** An organisation's data is deleted within this many days after its agreement ends */
  deleteAfterAgreementEndsDays: number
  /** Daily backups are deleted after this many days (lifecycle rule on the backup bucket) */
  backupRetentionDays: number
  /** Date shown as "last updated" on the privacy policy (YYYY-MM-DD) */
  privacyPolicyUpdated: string
  subProcessors: SubProcessor[]
}

/**
 * A third party that processes personal data on the provider's behalf.
 * Only entries with verified: true appear in the privacy policy; set it once
 * the location and transfer safeguard have been checked (see
 * docs/privacy-review-notes.md for how).
 */
export interface SubProcessor {
  name: string
  purpose: string
  /** Where the data is stored/processed */
  location: string
  /** Safeguard if data leaves the EEA, or why none is needed */
  safeguard: string
  verified: boolean
}

export const LEGAL: LegalConfig = {
  providerName:        'Fredrik Fridlund Cinematography AB',
  orgNumber:           'TODO: organisationsnummer (XXXXXX-XXXX)',
  streetAddress:       'TODO: street address',
  postalCode:          'TODO: postal code',
  city:                'TODO: city',
  country:             'Sweden',
  contactEmail:        'TODO: role address, e.g. contact@cineforge.se',
  privacyContactEmail: 'TODO: role address, e.g. privacy@cineforge.se',
  vatNumber:           'TODO: optional VAT number (SE…01)',
  appName:             'CineForge',
  appDomain:           'cineforge.se',
  contactRetentionMonths: 12,
  deleteAfterAgreementEndsDays: 90,
  // gs://cineforge-eu-backups has a lifecycle rule deleting objects after 30 days
  backupRetentionDays: 30,
  privacyPolicyUpdated: '2026-11-12',
  subProcessors: [
    // Locations below were read from the cineforge-eu project on 2026-11-12:
    // Firestore `firebase firestore:databases:get` → eur3; functions region in
    // functions/.env.cineforge-eu → europe-west1; Storage bucket
    // `gcloud storage buckets describe` → EUROPE-WEST1. The safeguard wording
    // still needs review (docs/privacy-review-notes.md), so these stay
    // unverified until then.
    { name: 'Google Cloud Firestore (Firebase)', purpose: 'Database for all app data',
      location: 'EU multi-region (eur3: Belgium and the Netherlands)', safeguard: 'TODO: confirm Google data processing terms', verified: false },
    { name: 'Google Cloud Functions (Firebase)', purpose: 'Server-side processing (email, scheduled jobs, exports)',
      location: 'Belgium (europe-west1)', safeguard: 'TODO: confirm Google data processing terms', verified: false },
    { name: 'Google Cloud Storage (Firebase)', purpose: 'Uploaded files (e.g. screenplays, profile photos)',
      location: 'Belgium (europe-west1)', safeguard: 'TODO: confirm Google data processing terms', verified: false },
    { name: 'Firebase Authentication', purpose: 'Sign-in and account security',
      location: 'TODO: confirm (not set per project)', safeguard: 'TODO', verified: false },
    { name: 'Firebase Hosting', purpose: 'Delivers the website (global content delivery network)',
      location: 'TODO: confirm (global CDN)', safeguard: 'TODO', verified: false },
    { name: 'Firebase Cloud Messaging', purpose: 'Push notifications to devices',
      location: 'TODO: confirm', safeguard: 'TODO', verified: false },
    { name: 'Firebase Performance Monitoring', purpose: 'Anonymous page-load and network timing',
      location: 'TODO: confirm', safeguard: 'TODO', verified: false },
    { name: 'Cloudinary', purpose: 'Image and video storage and delivery',
      location: 'TODO: confirm the account\'s data region', safeguard: 'TODO', verified: false },
    { name: 'Resend', purpose: 'Email delivery (invites, notifications, contact-form forwarding)',
      location: 'TODO: confirm the sending region', safeguard: 'TODO', verified: false },
  ],
}

type TextKey = { [K in keyof LegalConfig]: LegalConfig[K] extends string ? K : never }[keyof LegalConfig]

export function isPlaceholder(value: string): boolean {
  return value.trim() === '' || value.trim().toUpperCase().startsWith('TODO')
}

/** Sub-processors cleared for publication: verified, with no placeholder left in them */
export function publishedSubProcessors(): SubProcessor[] {
  return LEGAL.subProcessors.filter(p => p.verified && ![p.name, p.purpose, p.location, p.safeguard].some(isPlaceholder))
}

/** The configured value, or undefined while it is still a placeholder */
export function legal(key: TextKey): string | undefined {
  return isPlaceholder(LEGAL[key]) ? undefined : LEGAL[key]
}

/** Keys still holding placeholders */
export function missingLegalFields(): TextKey[] {
  return (Object.keys(LEGAL) as (keyof LegalConfig)[])
    .filter((k): k is TextKey => typeof LEGAL[k] === 'string' && isPlaceholder(LEGAL[k] as string))
}
