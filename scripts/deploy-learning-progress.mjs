// Deploy only after the preservation schema is present; never run migrations implicitly.
import { readFile } from 'node:fs/promises'
const base = 'https://api.supabase.com/v1/projects/evnjoezffghtrzqacwcj'
if (!process.env.SUPABASE_ACCESS_TOKEN) throw new Error('Secure Supabase management access is required.')
const headers = { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}` }
async function checked(response, label) {
  if (!response.ok) throw new Error(`${label} failed (HTTP ${response.status}).`)
  return response
}
const query = `select to_regclass('public.user_learning_progress_revisions') is not null as revisions,
  to_regclass('public.user_learning_session_archives') is not null as archives,
  to_regprocedure('public.recover_learning_progress_collections(uuid,boolean)') is not null as recovery,
  exists(select 1 from pg_trigger where tgrelid='public.user_learning_progress'::regclass and tgname='preserve_learning_progress' and not tgisinternal) as preservation`
const schema = await (await checked(await fetch(base + '/database/query', {
  method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ query, read_only: true })
}), 'Preservation schema check')).json()
if (!schema[0] || !['revisions', 'archives', 'recovery', 'preservation'].every(key => schema[0][key] === true)) {
  throw new Error('Required preservation schema is missing. Apply the reviewed saved-progress/session-audit migration before deploying.')
}
if (!process.argv.includes('--verify-only')) {
  const form = new FormData()
  form.append('metadata', JSON.stringify({ entrypoint_path: 'learning-progress/index.ts', name: 'learning-progress', verify_jwt: true }))
  form.append('file', new File([await readFile('supabase/functions/learning-progress/index.ts')], 'learning-progress/index.ts', { type: 'application/typescript' }))
  const bundleOnly = process.argv.includes('--bundle-only')
  const response = await checked(await fetch(base + '/functions/deploy?slug=learning-progress' + (bundleOnly ? '&bundleOnly=true' : ''), { method: 'POST', headers, body: form }), 'Progress function deployment')
  if (bundleOnly) { await response.arrayBuffer(); console.log('Progress source bundle validated by Supabase.'); process.exit(0) }
  const result = await response.json()
  console.log(JSON.stringify({ deployedFunction: 'learning-progress', version: result.version, status: result.status }))
}
const metadata = await (await checked(await fetch(base + '/functions/learning-progress', { headers }), 'Progress metadata check')).json()
if (metadata.verify_jwt !== true) throw new Error('Progress gateway JWT verification must remain enabled.')
const deployed = await (await checked(await fetch(base + '/functions/learning-progress/body', { headers }), 'Deployed progress contract check')).text()
for (const feature of ['recover-saved', 'read-session', 'write-session', 'write-sessions', 'DecompressionStream', 'known_snapshot_hash']) {
  if (!deployed.includes(feature)) throw new Error(`Deployed progress backend is missing ${feature}. Do not publish a frontend requiring it.`)
}
console.log('Verified deployed recovery, archive read/write, gzip support and gateway JWT enforcement.')
