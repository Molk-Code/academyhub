// Stripe integration — not active during beta
// Will be enabled when launching public subscription model

export const STRIPE_PUBLISHABLE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY ?? ''

export const PRICING_TIERS = {
  basic: {
    name: 'Basic',
    price: 49,
    currency: 'EUR',
    maxStudents: 30,
    features: ['attendance', 'calendar', 'tests', 'chat'],
  },
  professional: {
    name: 'Professional',
    price: 149,
    currency: 'EUR',
    maxStudents: 100,
    features: ['attendance', 'calendar', 'tests', 'chat', 'videoLab', 'roomBooking'],
  },
  enterprise: {
    name: 'Enterprise',
    price: 399,
    currency: 'EUR',
    maxStudents: -1, // unlimited
    features: ['all'],
  },
} as const
