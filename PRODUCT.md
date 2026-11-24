# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two customer types, equally important:

- **Film and media schools** (the first customer is Molkom). Staff (admins, teachers) run teaching, productions, rooms, vehicles and the equipment store. Students follow lessons and assignments, book equipment for their productions and sign borrowing contracts.
- **Rental houses** running only the Rental & Inventory module. Staff manage the asset register and check-out/check-in. Borrowers book gear and sign contracts.

Staff mostly work at a desk, but scanning, check-out and check-in happen on a phone at the equipment counter. Students and borrowers mostly use their phones.

## Product Purpose

One system that runs a film school or rental house end to end: equipment, productions and teaching in one place. Success means staff always know where every unit of gear is and who holds it, and students get from "I need gear" to signed and checked out without paperwork.

## Positioning

Two things together:

- **Film-specific workflows:** equipment is tied to student productions, borrowing contracts are signed in the app, and check-out uses QR codes, unit by unit.
- **Modular packaging:** customers buy only the modules they need (Rental & Inventory, Production, Academy), each in its own deployment hosted in the EU.

## Operating Context

- Modules (internal ids): `rental_inventory`, `production` and `academy`. Core is always on: users and roles, chat, calendar, FAQ, notifications, profile, and privacy/GDPR tools.
- Each customer gets a separate Firebase deployment. The EU deployment serves cineforge.se, and customer schools update from published releases.
- Roles: superadmin, admin, teacher, student. Rental-only customers also have borrowers.
- QR scanning and label printing happen at the equipment counter. There are wall displays for rooms and QR check-in devices.

## Capabilities and Constraints

- Shipping web app: React, Vite, Tailwind and Firebase. There is no native app; the phone experience is mobile web.
- Display names of modules are not final. Code uses the internal ids, and display names live in one config file.
- Existing data shapes must not break. New fields are optional, and new collections are added alongside existing ones.

## Brand Commitments

- Name: CineForge. Product display names are configurable per deployment (`%APP_NAME%`).
- The interface is in English.

## Evidence on Hand

- One live school customer (Molkom) on the original deployment, plus the EU deployment.
- No testimonials, customer counts, case studies or pricing exist in the repo. Do not invent any on public pages.

## Product Principles

1. Know where every unit is: equipment state is shown per unit and per production, never as a vague total.
2. Phone-first for whoever is at the counter or on set; desk-first for planning and admin.
3. Only show what the customer bought: features from modules a customer hasn't bought stay hidden, not disabled.
4. Never ship a feature that hasn't been run, and never claim one works without checking.

## Accessibility & Inclusion

WCAG 2.2 AA: 4.5:1 text contrast, visible focus, 44px touch targets on touch screens, and respect for reduced motion. These are already applied across the app.
