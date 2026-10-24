# Hyperion – Maritime Licensure Reviewer (PWA)

Progressive Web App rebuild of the Hyperion Android app.

## Features (current status)

- Offline signed-key activation (HYPE2- ECDSA P-256, device-bound)
- License management (tiers: ALL / OIC / GOC / EW / DM / EM)
- Paywall that routes only to Activate Key
- No Google Play Billing / no Bond Store
- Home, Track Selection, Activation, License, How-to-Avail, About, Terms
- Bottom navigation
- PWA-ready (installable, offline shell via service worker)

## Remaining work

- Full question banks (encrypted CSV decryption already ported)
- Practice / Quiz / Drill / Flashcard / Mock Exam flows
- History, Streaks, Study Time, Bookmarks, Mistakes Vault
- IndexedDB persistence for sessions & progress

## Deploy to Cloudflare Pages

1. Push this folder to a Git repository.
2. In Cloudflare Pages: connect the repo.
3. Build settings:
   - Framework preset: Vite
   - Build command: `npm run build`
   - Build output directory: `dist`
4. Deploy.

Or locally:

```bash
npm install
npm run build
# then upload the `dist` folder / use wrangler pages deploy dist
```

## Local development

```bash
npm install
npm run dev
```

## Support

https://www.facebook.com/hyperionbynhyle/
