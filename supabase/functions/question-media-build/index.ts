import { createClient } from 'npm:@supabase/supabase-js@2'
import { BUCKET } from '../question-media/policy.ts'
import { authorizeBuild, buildMediaAssets, validateBuildImages } from './build.ts'

// Server-to-server export only: no browser CORS permission and no public storage URLs.
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, private' }
})
Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  const url = Deno.env.get('SUPABASE_URL'), anon = Deno.env.get('SUPABASE_ANON_KEY'), service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !anon || !service) return json({ error: 'Media build is not configured.' }, 503)
  const authorization = req.headers.get('Authorization')
  const allowed = await authorizeBuild(authorization, req.headers.get('X-Hyperion-Build-Auth'), Deno.env.get('ADMIN_EMAILS') || '', async () => {
    const client = createClient(url, anon, { global: { headers: { Authorization: authorization || '' } }, auth: { persistSession: false, autoRefreshToken: false } })
    const { data, error } = await client.auth.getUser()
    return error ? null : data.user
  }, fetch)
  if (!allowed) return json({ error: 'Verified administrator or repository maintainer access is required.' }, 403)
  let images
  try {
    const reader = req.body?.getReader()
    if (!reader) throw new Error('Missing body')
    const chunks: Uint8Array[] = []; let size = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.length
        if (size > 8192) { await reader.cancel(); throw new Error('Oversized body') }
        chunks.push(value)
      }
    } finally { reader.releaseLock() }
    const bytes = new Uint8Array(size); let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
    images = validateBuildImages(JSON.parse(new TextDecoder().decode(bytes)))
  }
  catch { return json({ error: 'Invalid or oversized image build request.' }, 400) }
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
  try {
    return json(await buildMediaAssets(images, async path => {
      const { data, error } = await admin.storage.from(BUCKET).download(path)
      return error ? null : data
    }))
  } catch { return json({ error: 'Image build failed: required private media is missing, oversized, or failed integrity checks.' }, 409) }
})
