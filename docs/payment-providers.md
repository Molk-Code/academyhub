# Payment providers for rentals (note, not built)

Rental summaries (Equipment → Export, and "Rental summary" on a booking or project) list
items, days, prices and totals as PDF or CSV. They take no payment and are marked "Not a tax
invoice" until the seller's legal details and a VAT rate are filled in. This note lists what
could take payment later. Nothing here is implemented.

## Options

| Provider | What it covers | Fit |
|---|---|---|
| **Stripe** (Checkout, Payment Links, Invoicing) | Cards, Apple Pay/Google Pay, Klarna; hosted invoices with sequential numbers; webhooks | Best first choice: hosted pages mean no card data in CineForge, and one webhook can mark a booking paid. Stripe Invoicing can issue the actual invoice instead of us. |
| **Swish via a provider** (e.g. Stripe, Adyen, or a Swedish PSP that offers Swish Handel) | Swish payments in Sweden | Swish directly needs a bank agreement and certificates per merchant. Going through a provider that already offers Swish avoids that. Check which providers support Swish for the customer's bank before choosing. |
| **Accounting software's own invoicing** (Fortnox, Visma) | Invoices, reminders, bookkeeping | Fits customers who already invoice there: import the CSV (or later an API integration) and let that system issue the invoice and take payment. |

## If built later

- Each customer has its own Firebase project, so each needs its own provider account (or a
  connected account under one platform account, e.g. Stripe Connect). Keys go in Secret Manager
  per project, never in code.
- Use hosted checkout/invoice pages and webhooks; never handle card numbers in the app.
- Store only a reference on the booking (e.g. `payment: { provider, id, status }`), written by
  the webhook function, not by the client.
- A tax invoice needs a unique sequential number, buyer details and the seller's legal details.
  Letting the provider or accounting system issue it avoids building a numbering series here.
- Refunds, deposits for damage and late fees are separate decisions; settle them before building.

Out of scope for now, as agreed: payment processing and accounting API integrations.
