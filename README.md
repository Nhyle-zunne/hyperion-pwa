# Hyperion Maritime — PWA

Hyperion Maritime is a maritime licensure-review Progressive Web App built with React, TypeScript, Vite, and Supabase. The product includes account-based track licenses, protected question banks, practice/drill flows, timed mock exams, progress history, and offline study support.

## Reviewer tracks

- Deck OIC-NW
- GMDSS GOC
- Engine OIC-EW
- Deck Management
- Engine Management

## Core app features

- Quick Scan / drill, competence-based practice, and practice-all-question flows
- Timed mock exams with submit-to-finish behavior
- Session history, saved/resumable progress, bookmarks, mistakes, streaks, and study-time tracking
- Account-based track licensing with fixed 7-day, one-calendar-month, and one-calendar-year terms
- Responsive PWA installation and offline shell
- Offline question-pack caching using encrypted IndexedDB storage; server-side authorization remains authoritative while online

## Stack and source layout

- `src/` — React UI, routing, licensing state, checkout/account UI, question-bank client, and practice/session state
- `supabase/functions/` — server-side payment, checkout, licensing, account, and question-bank endpoints
- `supabase/migrations/` — ordered database schema, RLS, and transaction-function changes
- `SUPABASE_PAYMENTS_SETUP.md` — current manual checkout and historical payment-recovery safeguards
- `.github/workflows/pwa-build.yml` — automated TypeScript/Vite build check on pushes and pull requests

The question-bank Edge Function reads encrypted CSV assets from the private `question-banks` Storage bucket. Do not move these files to public hosting or expose Supabase service-role or payment-provider secret keys in frontend code.

## Local development

Requirements: Node.js 24 or a compatible current Node.js release.

```sh
npm install
npm run dev
```

Build the production bundle:

```sh
npm run build
npm run preview
```

The CI workflow verifies dependency installation, security checks, and the production TypeScript/Vite build. It does not replace browser-based acceptance tests or administrator verification of real manual-payment processing.

## Deployment

Connect the repository to Cloudflare Pages with:

- Framework preset: Vite
- Build command: `npm run build`
- Build output directory: `dist`

Use the Supabase CLI to apply the ordered migrations to a fresh/recovery environment. Do not use `supabase/schema.sql` alone as a full bootstrap; it is a legacy consolidated schema snapshot and does not replace the current migration chain.

Before accepting live QR Ph/bank transfers, verify the account details and manual-review workflow in [SUPABASE_PAYMENTS_SETUP.md](./SUPABASE_PAYMENTS_SETUP.md). Historical hosted payment verification and refunds must remain operational for earlier customers.

## Support

https://www.facebook.com/HyperionMaritime/
