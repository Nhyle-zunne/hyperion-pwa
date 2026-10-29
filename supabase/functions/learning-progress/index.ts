import { createClient } from 'npm:@supabase/supabase-js@2'

type TrackId = 'DECK_OIC_NW' | 'GMDSS_GOC' | 'ENGINE_OIC_EW' | 'DECK_MGT' | 'ENGINE_MGT'
type JsonRecord = Record<string, unknown>

const TRACKS = ['DECK_OIC_NW', 'GMDSS_GOC', 'ENGINE_OIC_EW', 'DECK_MGT', 'ENGINE_MGT'] as const
const QUESTION_STORAGE_KEYS = ['hyperion-bookmarks', 'hyperion-vault'] as const
const MAX_REQUEST_BYTES = 8 * 1024 * 1024
const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin'
}

function headers(req: Request) {
  const origin = req.headers.get('Origin') || ''
  const allowed = ['https://hyperionmaritime.org', 'https://www.hyperionmaritime.org', 'http://localhost:5173', 'http://127.0.0.1:5173']
  return { ...corsHeaders, 'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : 'https://hyperionmaritime.org' }
}

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers(req), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  })
}

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isTrackId(value: unknown): value is TrackId {
  return typeof value === 'string' && TRACKS.includes(value as TrackId)
}

function isQuestion(value: unknown): value is JsonRecord {
  if (!isRecord(value)) return false
  return typeof value.id === 'string'
    && typeof value.questionText === 'string'
    && Array.isArray(value.options)
    && value.options.every(option => typeof option === 'string')
    && Number.isInteger(value.correctAnswerIndex)
    && isTrackId(value.track)
}

async function fingerprintQuestion(question: JsonRecord): Promise<string | null> {
  if (typeof question.questionText !== 'string'
      || !Array.isArray(question.options)
      || !question.options.every(option => typeof option === 'string')
      || !Number.isInteger(question.correctAnswerIndex)) return null
  const payload = new TextEncoder().encode(JSON.stringify([
    question.questionText,
    question.options,
    question.correctAnswerIndex
  ]))
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', payload))
  return Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('')
}

async function authorizeSavedQuestions(
  client: ReturnType<typeof createClient>,
  track: TrackId,
  questions: unknown[]
): Promise<Set<number>> {
  const candidates: { originalIndex: number; id: string; fingerprint: string }[] = []
  for (let index = 0; index < questions.length; index++) {
    const item = questions[index]
    if (!isQuestion(item) || item.track !== track || item.id.length > 120) continue
    const fingerprint = await fingerprintQuestion(item)
    if (fingerprint) candidates.push({ originalIndex: index, id: item.id, fingerprint })
  }
  if (!candidates.length) return new Set()

  try {
    const { data, error } = await client.functions.invoke('question-bank', {
      body: {
        action: 'authorize-saved-questions',
        track,
        items: candidates.map(({ id, fingerprint }) => ({ id, fingerprint }))
      }
    })
    if (error || !Array.isArray(data?.allowedIndexes)) return new Set()
    const allowed = new Set<number>()
    for (const index of data.allowedIndexes) {
      if (Number.isInteger(index) && index >= 0 && index < candidates.length) {
        allowed.add(candidates[index].originalIndex)
      }
    }
    return allowed
  } catch {
    return new Set()
  }
}

async function filterQuestionCollection(
  client: ReturnType<typeof createClient>,
  raw: unknown
): Promise<string | null> {
  if (typeof raw !== 'string') return null
  let persisted: JsonRecord
  try {
    const parsed = JSON.parse(raw)
    if (!isRecord(parsed) || !isRecord(parsed.state) || !Array.isArray(parsed.state.items)) return null
    persisted = parsed
  } catch {
    return null
  }
  const state = persisted.state as JsonRecord
  const items = state.items as unknown[]
  const keep = new Set<number>()
  const byTrack = new Map<TrackId, { indexes: number[]; items: unknown[] }>()
  items.forEach((item, index) => {
    if (!isRecord(item) || !isTrackId(item.track)) return
    const track = item.track
    const group = byTrack.get(track) ?? { indexes: [], items: [] }
    group.indexes.push(index)
    group.items.push(item)
    byTrack.set(track, group)
  })
  for (const [track, group] of byTrack) {
    const allowed = await authorizeSavedQuestions(client, track, group.items)
    for (const localIndex of allowed) keep.add(group.indexes[localIndex])
  }
  const filteredItems = items.filter((_item, index) => keep.has(index))
  return JSON.stringify({ ...persisted, state: { ...state, items: filteredItems } })
}

async function authorizeSession(
  client: ReturnType<typeof createClient>,
  track: unknown,
  questions: unknown
): Promise<boolean> {
  if (!isTrackId(track) || !Array.isArray(questions) || questions.length < 1 || questions.length > 3000) return false
  const ids: string[] = []
  const fingerprints: string[] = []
  for (const question of questions) {
    if (!isQuestion(question) || question.track !== track || question.id.length > 120) return false
    const fingerprint = await fingerprintQuestion(question)
    if (!fingerprint) return false
    ids.push(question.id)
    fingerprints.push(fingerprint)
  }
  try {
    const { data, error } = await client.functions.invoke('question-bank', {
      body: { action: 'authorize-session', track, questionIds: ids, fingerprints }
    })
    return !error && data?.allowed === true
  } catch {
    return false
  }
}

async function sanitizeSnapshot(
  client: ReturnType<typeof createClient>,
  input: unknown
): Promise<JsonRecord> {
  if (!isRecord(input) || input.version !== 1 || !isRecord(input.storage)) {
    throw new Error('Invalid learning progress snapshot.')
  }
  // Clone before filtering so callers' objects are never mutated unexpectedly.
  const snapshot = JSON.parse(JSON.stringify(input)) as JsonRecord
  const storage = snapshot.storage as JsonRecord
  for (const key of QUESTION_STORAGE_KEYS) {
    storage[key] = await filterQuestionCollection(client, storage[key])
  }

  const legacySavedPractice = storage['hyperion-saved-practice']
  if (typeof legacySavedPractice === 'string') {
    let legacy: JsonRecord | null = null
    try {
      const parsed = JSON.parse(legacySavedPractice)
      if (isRecord(parsed)) legacy = parsed
    } catch {
      legacy = null
    }
    if (legacy) {
      const keep = await authorizeSession(client, legacy.track, legacy.questions)
      if (!keep) storage['hyperion-saved-practice'] = null
    } else {
      storage['hyperion-saved-practice'] = null
    }
  }

  if (isRecord(snapshot.activeSession)) {
    const activeSession = snapshot.activeSession
    if (!await authorizeSession(client, activeSession.track, activeSession.questions)) {
      snapshot.activeSession = null
    }
  } else {
    snapshot.activeSession = null
  }
  return snapshot
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: headers(req) })
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed.' }, 405)

  const auth = req.headers.get('Authorization')
  if (!auth) return json(req, { error: 'Sign-in required.' }, 401)

  const url = Deno.env.get('SUPABASE_URL')
  const anon = Deno.env.get('SUPABASE_ANON_KEY')
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !anon || !service) return json(req, { error: 'Progress service is not configured.' }, 503)

  const client = createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } })
  const { data: { user }, error: authError } = await client.auth.getUser()
  if (authError || !user) return json(req, { error: 'Please sign in again.' }, 401)
  const admin = createClient(url, service, { auth: { persistSession: false } })

  let body: JsonRecord
  let rawBody: string
  try {
    rawBody = await req.text()
    if (rawBody.length > MAX_REQUEST_BYTES) return json(req, { error: 'Progress payload is too large.' }, 413)
    const parsed = JSON.parse(rawBody)
    if (!isRecord(parsed)) return json(req, { error: 'Invalid request.' }, 400)
    body = parsed
  } catch {
    return json(req, { error: 'Invalid request.' }, 400)
  }

  if (body.action === 'read') {
    const { data, error } = await admin.from('user_learning_progress')
      .select('data,updated_at')
      .eq('user_id', user.id)
      .maybeSingle()
    if (error) return json(req, { error: 'Could not load progress.' }, 500)
    if (!data) return json(req, { data: null, updated_at: null })
    try {
      const sanitized = await sanitizeSnapshot(client, data.data)
      return json(req, { data: sanitized, updated_at: data.updated_at })
    } catch {
      return json(req, { error: 'Could not safely verify saved question access.' }, 503)
    }
  }

  if (body.action === 'write') {
    try {
      const sanitized = await sanitizeSnapshot(client, body.data)
      const { data, error } = await admin.from('user_learning_progress')
        .upsert({ user_id: user.id, data: sanitized }, { onConflict: 'user_id' })
        .select('updated_at')
        .single()
      if (error) return json(req, { error: 'Could not save progress.' }, 500)
      return json(req, { ok: true, updated_at: data.updated_at })
    } catch {
      // Do not persist unsanitized question-bearing progress when access verification fails.
      return json(req, { error: 'Could not safely verify saved question access.' }, 503)
    }
  }

  return json(req, { error: 'Unknown progress action.' }, 400)
})
