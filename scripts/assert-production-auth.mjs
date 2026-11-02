import { loadEnv } from 'vite'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export async function productionEnvironment() {
  let defaults = {}
  try { defaults = JSON.parse(await readFile('config/public-production.json', 'utf8')) } catch { /* Explicit environment configuration is also supported. */ }
  return {
    VITE_SUPABASE_URL: defaults.supabaseUrl,
    VITE_SUPABASE_ANON_KEY: defaults.supabaseAnonKey,
    VITE_QUESTION_BANK_DELIVERY: defaults.questionBankDelivery,
    ...loadEnv('production', process.cwd(), 'VITE_'), ...process.env
  }
}
export async function assertProductionAuth(env, built = false) {
  const url = env.VITE_SUPABASE_URL, key = env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Production sign-in configuration is missing. Refusing to build a site with login disabled.')
  const endpoint = new URL(url)
  if (endpoint.protocol !== 'https:' || !endpoint.hostname.endsWith('.supabase.co')) throw new Error('Production sign-in requires a valid Supabase project URL.')
  if (!key.startsWith('sb_publishable_')) {
    let claims
    try { claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()) } catch { throw new Error('Production client key must be a public Supabase publishable or anon key.') }
    if (claims.role !== 'anon' || endpoint.hostname !== `${claims.ref}.supabase.co`) throw new Error('Refusing a privileged or mismatched production browser key.')
  }
  if (built) {
    const assets = await readdir('dist/assets')
    const bundles = await Promise.all(assets.filter(name => name.endsWith('.js')).map(name => readFile(join('dist/assets', name), 'utf8')))
    if (!bundles.some(bundle => bundle.includes(url) && bundle.includes(key))) throw new Error('The production bundle is missing its public sign-in configuration. Refusing deployment.')
    await writeFile('dist/hyperion-public-config.json', JSON.stringify({ supabaseUrl: url, supabaseAnonKey: key }))
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await assertProductionAuth(await productionEnvironment(), process.argv.includes('--built'))
  console.log('Production public sign-in configuration verified.')
}
