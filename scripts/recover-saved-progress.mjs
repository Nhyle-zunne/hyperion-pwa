// Management API recovery. No browser session or customer password is used.
// Run Node 24 with NODE_USE_ENV_PROXY=1 in a proxy-managed environment.
import { readFile } from 'node:fs/promises'
const args = process.argv.slice(2)
const option = name => args[args.indexOf(name) + 1]
const project = args.includes('--project-ref') ? option('--project-ref') : ''
const email = args.includes('--email') ? option('--email') : ''
const all = args.includes('--all')
const apply = args.includes('--apply')
if (!/^[a-z0-9]{20}$/.test(project) || (!all && !email) || (all && email)) {
  throw new Error('Usage: --project-ref REF (--email ADDRESS | --all) [--install] [--apply]. Default is counts-only dry-run.')
}
const token = process.env.SUPABASE_ACCESS_TOKEN
if (!token) throw new Error('Configure SUPABASE_ACCESS_TOKEN securely in environment settings. Do not paste it into chat or commit it.')
const query = async sql => {
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql })
  })
  if (!response.ok) throw new Error(`Supabase management query failed (HTTP ${response.status}). No credential or row contents are printed.`)
  return response.json()
}
if (args.includes('--install')) {
  const migration = await readFile(new URL('../supabase/migrations/20261102090000_preserve_saved_progress_and_session_audits.sql', import.meta.url), 'utf8')
  await query('begin;\n' + migration + '\ncommit;')
  console.log('Saved-data preservation migration installed.')
}
const scope = all ? '' : `where lower(u.email) = lower('${email.replaceAll("'", "''")}')`
const result = await query(`select p.user_id, public.recover_learning_progress_collections(p.user_id, ${apply ? 'true' : 'false'}) as recovery from public.user_learning_progress p join auth.users u on u.id=p.user_id ${scope};`)
console.log(JSON.stringify({ applied: apply, accounts: result }, null, 2))
