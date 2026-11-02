# Production domains and sign-in returns

The production website is https://hyperionmaritime.org. Keep `workers_dev = false` and `preview_urls = false` explicitly in `wrangler.toml`: dashboard toggles alone can be overwritten by deployment defaults. The existing custom domain remains attached to the same Worker.

Supabase Auth URL Configuration must use:

- Site URL: `https://hyperionmaritime.org`
- Allowed return URLs: `https://hyperionmaritime.org/auth/callback` and `https://hyperionmaritime.org`

The website's Google sign-in requests `/auth/callback` on the custom domain. If that URL is absent from Supabase's allow list, Supabase can fall back to its configured Site URL. A previous configuration allowed only the workers.dev origin, causing a visible detour through that site before the website's canonical-domain redirect.

Keep Google's own OAuth callback pointed at the Supabase Auth callback; the application's return destination is configured separately in Supabase. These URL settings do not change user accounts, sessions, saved study records, or license data.

The release smoke check guards the Wrangler settings. After every production deployment, `scripts/verify-worker-domains.mjs` checks the actual Cloudflare API flags, and the existing live-release check verifies the custom domain serves the expected build. The domain verifier uses the existing deployment credential from the environment and never prints it.
