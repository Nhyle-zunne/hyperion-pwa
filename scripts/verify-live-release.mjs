// Verify that the public origin serves this build, independently of an open tab's cache.
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
const base = new URL(process.env.HYPERION_RELEASE_URL || 'https://hyperionmaritime.org')
const localHtml = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8')
const assets = [...localHtml.matchAll(/(?:src|href)="(\/assets\/[^"?]+\.(?:js|css))"/g)].map(match => match[1])
if (!assets.length) throw new Error('Build output has no versioned entry assets. Run the production build first.')
base.searchParams.set('release-check', createHash('sha256').update(localHtml).digest('hex').slice(0, 16))
const response = await fetch(base, { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(15000) })
if (!response.ok) throw new Error(`Live release check failed: HTTP ${response.status}.`)
const html = await response.text()
const missing = assets.filter(asset => !html.includes(asset))
if (missing.length) throw new Error(`Production is serving a different build. Missing current assets: ${missing.join(', ')}. A successful source build does not establish a live deployment.`)
console.log(`Verified production entry assets at ${base.origin}.`)
