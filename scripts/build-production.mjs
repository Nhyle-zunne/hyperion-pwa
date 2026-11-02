import { spawnSync } from 'node:child_process'
import { productionEnvironment, assertProductionAuth } from './assert-production-auth.mjs'
const env = await productionEnvironment()
await assertProductionAuth(env)
for (const args of [
  ['scripts/verify-supabase-build.mjs', '--env'],
  ['scripts/generate-worker-bank-codec.mjs', '--check'],
  ['node_modules/typescript/bin/tsc', '-b'],
  ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.worker.json'],
  ['node_modules/vite/bin/vite.js', 'build'],
  ['scripts/verify-supabase-build.mjs', '--dist']
]) {
  const child = spawnSync(process.execPath, args, { env, stdio: 'inherit' })
  if (child.error) throw child.error
  if (child.status !== 0) process.exit(child.status || 1)
}
await assertProductionAuth(env, true)
console.log('Production build includes verified public sign-in and GitHub delivery configuration.')
