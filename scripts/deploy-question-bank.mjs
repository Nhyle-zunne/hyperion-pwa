// Management API deployment supports the cloud environment's injected credentials.
import { readFile } from 'node:fs/promises'
const project = 'evnjoezffghtrzqacwcj'
if (!process.env.SUPABASE_ACCESS_TOKEN) throw new Error('Secure Supabase management access is required.')
const paths = ['question-bank/index.ts', 'question-bank/access.mjs', '_shared/bankCodec.ts', '_shared/githubBankSource.ts', '_shared/github-bank-manifest.json']
const form = new FormData()
form.append('metadata', JSON.stringify({ entrypoint_path: 'question-bank/index.ts', name: 'question-bank', verify_jwt: false }))
for (const path of paths) form.append('file', new File([await readFile('supabase/functions/' + path)], path, { type: path.endsWith('.json') ? 'application/json' : 'application/typescript' }))
const bundleOnly = process.argv.includes('--bundle-only')
const response = await fetch(`https://api.supabase.com/v1/projects/${project}/functions/deploy?slug=question-bank${bundleOnly ? '&bundleOnly=true' : ''}`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}` }, body: form })
if (!response.ok) {
  const failure = await response.text()
  throw new Error(`Question-bank deployment failed (HTTP ${response.status}): ${failure.slice(0, 1800)}`)
}
if (bundleOnly) { await response.arrayBuffer(); console.log('Question-bank source bundle validated by Supabase.') }
else { const result = await response.json(); console.log(JSON.stringify({ deployedFunction: result.slug || 'question-bank', version: result.version, status: result.status })) }
