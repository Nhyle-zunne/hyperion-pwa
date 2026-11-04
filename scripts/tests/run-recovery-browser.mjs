import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:net'
import { chromium } from 'playwright'
const root = fileURLToPath(new URL('../../', import.meta.url))
const vite = fileURLToPath(new URL('../../node_modules/vite/bin/vite.js', import.meta.url))
const out = await mkdtemp(join(tmpdir(), 'hyperion-recovery-test-'))
const publisher = process.env.HYPERION_BROWSER_FIXTURE === 'publisher'
const licensed = process.env.HYPERION_BROWSER_FIXTURE === 'licensed'
const sync = licensed || process.env.HYPERION_BROWSER_FIXTURE === 'sync'
const entry = sync ? 'sync-browser' : publisher ? 'publisher-browser' : 'recovery-browser'
const env = { ...process.env, HYPERION_BROWSER_FIXTURE: sync ? 'sync' : publisher ? 'publisher' : 'recovery', HYPERION_BROWSER_TEST_OUTPUT: out, VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '', VITE_QUESTION_BANK_DELIVERY: '' }
const run = args => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, args, { cwd: root, env, stdio: 'inherit' })
  child.once('error', reject)
  child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Validation exited ${code}`)))
})
let preview
try {
  await run([vite, 'build', '--config', 'scripts/tests/keyword-browser.config.ts'])
  const server = createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  preview = spawn(process.execPath, [vite, 'preview', '--config', 'scripts/tests/keyword-browser.config.ts', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, env, stdio: 'inherit' })
  env.HYPERION_RECOVERY_TEST_URL = `http://127.0.0.1:${port}/scripts/tests/${entry}.html`
  env.CHROMIUM_PATH = process.env.CHROMIUM_PATH || chromium.executablePath()
  let ready = false
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(env.HYPERION_RECOVERY_TEST_URL)).ok) { ready = true; break } } catch { /* wait for preview */ }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  if (!ready) throw new Error('Recovery fixture preview did not start')
  await run([`scripts/tests/${licensed ? 'licensed-progress-browser' : entry}-test.mjs`])
} finally {
  preview?.kill('SIGTERM')
  await rm(out, { recursive: true, force: true })
}
