// Inspect Cloudflare's actual state after deployment, not just the local config.
const token = process.env.CLOUDFLARE_API_TOKEN
if (!token) throw new Error('Cloudflare deployment credentials are required for domain verification.')
const endpoint = 'https://api.cloudflare.com/client/v4/accounts/e4f2b51a3c1a61a5ba56a7d5cf1d8f45/workers/scripts/hyperion-pwa/subdomain'
const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) })
if (!response.ok) throw new Error(`Could not verify Worker URL settings (HTTP ${response.status}).`)
const state = await response.json()
if (state.success !== true || state.result?.enabled !== false || state.result?.previews_enabled !== false) {
  throw new Error('Worker production/preview URLs must both remain disabled after deployment.')
}
console.log('Verified Cloudflare workers.dev and preview URLs are both disabled.')
