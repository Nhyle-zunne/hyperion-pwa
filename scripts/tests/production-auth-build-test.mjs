import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
const root = await mkdtemp(join(tmpdir(), 'hyperion-auth-config-'))
const guard = fileURLToPath(new URL('../assert-production-auth.mjs', import.meta.url))
const url = 'https://synthetic.supabase.co'
const key = 'sb_publishable_synthetic_test_only'
const env = { ...process.env }
delete env.VITE_SUPABASE_URL
delete env.VITE_SUPABASE_ANON_KEY
const run = (overrides = {}, args = []) => spawnSync(process.execPath, [guard, ...args], { cwd: root, env: { ...env, ...overrides }, encoding: 'utf8' })
try {
  assert.notEqual(run().status, 0, 'Missing auth configuration must block production builds')
  assert.notEqual(run({ VITE_SUPABASE_URL: url }).status, 0)
  assert.notEqual(run({ VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: 'sb_secret_synthetic_test_only' }).status, 0)
  const jwt = role => `synthetic.${Buffer.from(JSON.stringify({ role, ref: 'synthetic' })).toString('base64url')}.test`
  assert.notEqual(run({ VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: jwt('service_role') }).status, 0)
  assert.notEqual(run({ VITE_SUPABASE_URL: 'https://different.supabase.co', VITE_SUPABASE_ANON_KEY: jwt('anon') }).status, 0)
  await writeFile(join(root, '.env.production'), `VITE_SUPABASE_URL=${url}\nVITE_SUPABASE_ANON_KEY=${key}\n`)
  assert.equal(run().status, 0, 'Public file defaults must load when CI has no overrides')
  assert.equal(run({ VITE_SUPABASE_URL: 'https://preview.supabase.co', VITE_SUPABASE_ANON_KEY: key }).status, 0)
  await mkdir(join(root, 'dist/assets'), { recursive: true })
  await writeFile(join(root, 'dist/assets/test.js'), 'const unconfigured = null')
  assert.notEqual(run({}, ['--built']).status, 0, 'An unconfigured artifact must block deployment')
  await writeFile(join(root, 'dist/assets/test.js'), JSON.stringify({ url, key }))
  assert.equal(run({}, ['--built']).status, 0)
  console.log('PASS: production auth defaults, overrides, privileged-key rejection, project matching and built-artifact configuration checks.')
} finally { await rm(root, { recursive: true, force: true }) }
