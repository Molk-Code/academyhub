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
  appName: string
  appDomain: string
  /** Keep equal to CONTACT_RETENTION_MONTHS in functions/src/contact.ts */
  contactRetentionMonths: number
}

export const LEGAL: LegalConfig = {
  providerName:        'TODO: legal name of the provider',
  orgNumber:           'TODO: organisation number or "sole trader"',
  streetAddress:       'TODO: street address',
  postalCode:          'TODO: postal code',
  city:                'TODO: city',
  country:             'Sweden',
  contactEmail:        'TODO: role address, e.g. contact@cineforge.se',
  privacyContactEmail: 'TODO: role address, e.g. privacy@cineforge.se',
  appName:             'CineForge',
  appDomain:           'cineforge.se',
  contactRetentionMonths: 12,
}

type TextKey = { [K in keyof LegalConfig]: LegalConfig[K] extends string ? K : never }[keyof LegalConfig]

export function isPlaceholder(value: string): boolean {
  return value.trim() === '' || value.trim().toUpperCase().startsWith('TODO')
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
