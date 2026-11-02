// Verify that the public origin serves this build, independently of an open tab's cache.
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
const base = new URL(process.env.HYPERION_RELEASE_URL || 'https://hyperionmaritime.org')
const localHtml = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8')
const assets = [...localHtml.matchAll(/(?:src|href)="(\/assets\/[^"?]+\.(?:js|css))"/g)].map(match => match[1])
if (!assets.length) throw new Error('Build output has no versioned entry assets. Run the production build first.')
base.searchParams.set('release-check', createHash('sha256').update(localHtml).digest('hex').slice(0, 16))

// Edge caches and the custom domain may briefly serve a prior version immediately
// after Wrangler deploy reports success. Confirm the actual HTML, not just upload
// success, and allow a short bounded propagation window before failing the build.
const attempts = 6
let lastError
for (let attempt = 1; attempt <= attempts; attempt++) {
  const url = new URL(base)
  url.searchParams.set('attempt', String(attempt))
  try {
    const response = await fetch(url, { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw new Error(`Live release check failed: HTTP ${response.status}.`)
    const html = await response.text()
    const missing = assets.filter(asset => !html.includes(asset))
    if (missing.length) {
      throw new Error(`Production is serving a different build. Missing current assets: ${missing.join(', ')}.`)
    }
    console.log(`Verified production entry assets at ${base.origin} (attempt ${attempt}/${attempts}).`)
    process.exit(0)
  } catch (error) {
    lastError = error
    if (attempt < attempts) {
      console.warn(`Live release not yet verified (attempt ${attempt}/${attempts}): ${error instanceof Error ? error.message : String(error)}. Retrying…`)
      await new Promise(resolve => setTimeout(resolve, 3500))
    }
  }
}
throw new Error(`Production release could not be verified after ${attempts} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)} A successful source build does not establish a live deployment.`)
