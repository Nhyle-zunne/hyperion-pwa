// Fail closed before publishing a PWA with Google sign-in disabled by missing Vite variables.
// Only browser-safe Supabase URL + anon/publishable key belong in VITE_*.
// This runs in every production build (GitHub Actions, Codex, or Cloudflare).
import { loadEnv } from 'vite'
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const PROJECT_REF = 'evnjoezffghtrzqacwcj'
const EXPECTED_URL = `https://${PROJECT_REF}.supabase.co`
const env = loadEnv('production', process.cwd(), 'VITE_')
const url = typeof env.VITE_SUPABASE_URL === 'string' ? env.VITE_SUPABASE_URL.trim().replace(/\\/+$/, '') : ''
const key = typeof env.VITE_SUPABASE_ANON_KEY === 'string' ? env.VITE_SUPABASE_ANON_KEY.trim() : ''

function fail(message) {
  throw new Error(`Hyperion production auth check failed: ${message} Never deploy this build.`)
}

if (!url || !key) fail('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY.')
if (url !== EXPECTED_URL) fail('Supabase URL does not match the production Hyperion project.')
if (/^sb_secret_/i.test(key) || /^sk_(?:live|test)_/i.test(key)) fail('A server-side secret was provided as a public browser key.')

if (key.startsWith('sb_publishable_')) {
  if (!/^sb_publishable_[A-Za-z0-9_-]{12,}$/.test(key)) fail('Malformed Supabase publishable browser key.')
} else {
  const segments = key.split('.')
  if (segments.length !== 3) fail('Expected a Supabase anon JWT or publishable browser key.')
  let claims
  try {
    claims = JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8'))
  } catch {
    fail('Malformed Supabase anon JWT.')
  }
  if (claims.role !== 'anon' || claims.ref !== PROJECT_REF) {
    fail('Supabase browser JWT must have anon role and match the Hyperion production project.')
  }
}

if (process.argv.includes('--dist')) {
  const dist = resolve('dist')
  const assets = []
  async function collect(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) await collect(path)
      else if (entry.isFile() && path.endsWith('.js')) assets.push(path)
    }
  }
  try { await collect(dist) } catch {
    fail('Could not read built JavaScript assets in dist/.')
  }
  if (!assets.length) fail('No compiled JavaScript assets were found.')
  let foundUrl = false
  let foundKey = false
  for (const asset of assets) {
    const js = await readFile(asset, 'utf8')
    if (js.includes(url)) foundUrl = true
    if (js.includes(key)) foundKey = true
  }
  if (!foundUrl || !foundKey) {
    fail('Built JavaScript does not contain the configured production Supabase URL and browser key.')
  }
  console.log('Hyperion production auth configuration verified in compiled JS.')
} else {
  console.log('Hyperion production auth configuration verified before build.')
}
