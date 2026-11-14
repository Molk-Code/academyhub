// The commercial and legal decisions the order page, the Terms of Service and
// the data processing agreement depend on. Empty = not decided yet: the hidden
// preview shows a marked "Missing" chip there instead of inventing a value.
// These pages stay superadmin-only until every value is filled in and the
// texts have had a legal review.
//
// TERMS_VERSION is what a customer accepts when ordering. Set the same value as
// ORDER_TERMS_VERSION in functions/.env.<projectId> when ordering opens, and
// change both whenever the wording changes.

export const TERMS_VERSION = 'draft-2026-11-14'

export interface OrderTermsDecisions {
  /** Shown on the order page, e.g. "From 1 500 SEK per month excl. VAT" (per module or package) */
  pricing: string
  /** Days to pay an invoice, e.g. "30" */
  paymentTermDays: string
  /** Initial agreement period, e.g. "12 months" */
  initialTerm: string
  /** Notice period for ending the agreement, e.g. "3 months before the end of a period" */
  noticePeriod: string
  /** How far ahead price or terms changes are announced, e.g. "60 days" */
  changeNotice: string
  /** Cap on the provider's liability, e.g. "the fees paid in the last 12 months" */
  liabilityCap: string
  /** Law that governs the agreement, e.g. "Swedish law" */
  governingLaw: string
  /** Where disputes are settled, e.g. "the general courts of Sweden, with X District Court as first instance" */
  disputes: string
  /** How quickly a personal data breach is reported to the customer, e.g. "within 48 hours" */
  breachNotice: string
}

export const ORDER_TERMS: OrderTermsDecisions = {
  pricing: 'the plan per module chosen in the order, in euros per month, billed annually in advance (20% off when all three modules are ordered)',
  paymentTermDays: '',
  initialTerm: '',
  noticePeriod: '',
  changeNotice: '',
  liabilityCap: '',
  governingLaw: '',
  disputes: '',
  breachNotice: '',
}

/** Decisions still open */
export function openDecisions(): (keyof OrderTermsDecisions)[] {
  return (Object.keys(ORDER_TERMS) as (keyof OrderTermsDecisions)[]).filter(k => !ORDER_TERMS[k].trim())
}
