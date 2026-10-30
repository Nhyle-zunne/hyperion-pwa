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

class PayloadTooLargeError extends Error {
  constructor() {
    super('Request payload exceeds the configured limit.')
    this.name = 'PayloadTooLargeError'
  }
}

async function readRequestBody(req: Request, maxBytes: number): Promise<string> {
  const declaredLength = req.headers.get('content-length')
  if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > maxBytes) {
    throw new PayloadTooLargeError()
  }

  const reader = req.body?.getReader()
  if (!reader) return ''

  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue

      totalBytes += value.byteLength
      if (totalBytes > maxBytes) {
        try { await reader.cancel() } catch { /* The request is already being rejected. */ }
        throw new PayloadTooLargeError()
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
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
      || !Number.isInteger(question.correctAnswerIndex)
      || Number(question.correctAnswerIndex) < 0
      || Number(question.correctAnswerIndex) >= question.options.length) return null
  const canonicalOptions = question.options
    .map((text: string, index: number) => ({ text, correct: index === Number(question.correctAnswerIndex) }))
    .sort((left: { text: string; correct: boolean }, right: { text: string; correct: boolean }) => {
      if (left.text < right.text) return -1
      if (left.text > right.text) return 1
      return Number(left.correct) - Number(right.correct)
    })
  const payload = new TextEncoder().encode(JSON.stringify([question.questionText, canonicalOptions]))
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

  const { data, error } = await client.functions.invoke('question-bank', {
    body: {
      action: 'authorize-saved-questions',
      track,
      items: candidates.map(({ id, fingerprint }) => ({ id, fingerprint }))
    }
  })
  if (error || !Array.isArray(data?.allowedIndexes)) {
    // Fail closed and preserve the previous cloud row; do not treat verifier outages
    // as proof that saved question text is a permitted free sample.
    throw new Error('Saved question authorization could not be verified.')
  }
  const allowed = new Set<number>()
  for (const index of data.allowedIndexes) {
    if (Number.isInteger(index) && index >= 0 && index < candidates.length) {
      allowed.add(candidates[index].originalIndex)
    }
  }
  return allowed
}

async function filterQuestionCollection(
  client: ReturnType<typeof createClient>,
  raw: unknown,
  allowedTracks: Set<TrackId>
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
    if (allowedTracks.has(track)) {
      group.items.forEach((item, localIndex) => {
        if (isQuestion(item) && item.track === track) keep.add(group.indexes[localIndex])
      })
      continue
    }
    const allowed = await authorizeSavedQuestions(client, track, group.items)
    for (const localIndex of allowed) keep.add(group.indexes[localIndex])
  }
  const filteredItems = items.filter((_item, index) => keep.has(index))
  return JSON.stringify({ ...persisted, state: { ...state, items: filteredItems } })
}

async function authorizeSession(
  client: ReturnType<typeof createClient>,
  track: unknown,
  questions: unknown,
  allowedTracks: Set<TrackId>
): Promise<boolean> {
  if (!isTrackId(track) || !Array.isArray(questions) || questions.length < 1 || questions.length > 3000) return false
  if (!questions.every(question => isQuestion(question) && question.track === track)) return false
  if (allowedTracks.has(track)) return true

  const ids: string[] = []
  const fingerprints: string[] = []
  for (const question of questions as JsonRecord[]) {
    const fingerprint = await fingerprintQuestion(question)
    if (!fingerprint) return false
    ids.push(String(question.id))
    fingerprints.push(fingerprint)
  }
  const { data, error } = await client.functions.invoke('question-bank', {
    body: { action: 'authorize-session', track, questionIds: ids, fingerprints }
  })
  if (error || typeof data?.allowed !== 'boolean') {
    throw new Error('Session question authorization could not be verified.')
  }
  return data.allowed === true
}

async function sanitizeSnapshot(
  client: ReturnType<typeof createClient>,
  input: unknown,
  allowedTracks: Set<TrackId>
): Promise<JsonRecord> {
  if (!isRecord(input) || input.version !== 1 || !isRecord(input.storage)) {
    throw new Error('Invalid learning progress snapshot.')
  }
  const snapshot = JSON.parse(JSON.stringify(input)) as JsonRecord
  const storage = snapshot.storage as JsonRecord
  for (const key of QUESTION_STORAGE_KEYS) {
    storage[key] = await filterQuestionCollection(client, storage[key], allowedTracks)
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
      const keep = await authorizeSession(client, legacy.track, legacy.questions, allowedTracks)
      if (!keep) storage['hyperion-saved-practice'] = null
    } else {
      storage['hyperion-saved-practice'] = null
    }
  }

  if (isRecord(snapshot.activeSession)) {
    const activeSession = snapshot.activeSession
    const keep = await authorizeSession(client, activeSession.track, activeSession.questions, allowedTracks)
    if (!keep) snapshot.activeSession = null
  } else {
    snapshot.activeSession = null
  }
  return snapshot
}

async function loadAllowedTracks(
  admin: ReturnType<typeof createClient>,
  user: { id: string; email?: string }
): Promise<Set<TrackId>> {
  const adminEmails = (Deno.env.get('ADMIN_EMAILS') || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean)
  if (user.email && adminEmails.includes(user.email.toLowerCase())) return new Set(TRACKS)

  const { data, error } = await admin.from('entitlements')
    .select('track_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .gt('expires_at', new Date().toISOString())
  if (error) throw new Error('Current entitlements could not be verified.')
  return new Set((data || []).map(row => row.track_id).filter(isTrackId))
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
  let allowedTracks: Set<TrackId>
  try {
    allowedTracks = await loadAllowedTracks(admin, user)
  } catch {
    return json(req, { error: 'Current license access could not be verified.' }, 503)
  }

  let body: JsonRecord
  let rawBody: string
  try {
    rawBody = await readRequestBody(req, MAX_REQUEST_BYTES)
    const parsed = JSON.parse(rawBody)
    if (!isRecord(parsed)) return json(req, { error: 'Invalid request.' }, 400)
    body = parsed
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      return json(req, { error: 'Progress payload is too large.' }, 413)
    }
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
      const sanitized = await sanitizeSnapshot(client, data.data, allowedTracks)
      return json(req, { data: sanitized, updated_at: data.updated_at })
    } catch {
      return json(req, { error: 'Could not safely verify saved question access.' }, 503)
    }
  }

  if (body.action === 'write') {
    // Version-checked writes prevent two devices from silently overwriting each
    // other's entire JSON snapshot. Clients must re-read, merge, and retry on 409.
    if (!Object.prototype.hasOwnProperty.call(body, 'expected_updated_at')) {
      return json(req, { error: 'The progress version is required. Refresh the app and retry.' }, 428)
    }
    const expectedUpdatedAt = body.expected_updated_at
    if (
      expectedUpdatedAt !== null
      && (typeof expectedUpdatedAt !== 'string' || !Number.isFinite(Date.parse(expectedUpdatedAt)))
    ) {
      return json(req, { error: 'The progress version is invalid.' }, 400)
    }

    try {
      const sanitized = await sanitizeSnapshot(client, body.data, allowedTracks)
      if (expectedUpdatedAt === null) {
        // First writer inserts; a competing first writer receives a conflict.
        const { data, error } = await admin.from('user_learning_progress')
          .insert({ user_id: user.id, data: sanitized })
          .select('updated_at')
          .maybeSingle()
        if (error) {
          if (error.code === '23505' || error.code === '409') {
            return json(req, { error: 'Progress changed on another device. Re-read and merge before retrying.', conflict: true }, 409)
          }
          return json(req, { error: 'Could not save progress.' }, 500)
        }
        return json(req, { ok: true, updated_at: data?.updated_at ?? null })
      }

      const { data, error } = await admin.from('user_learning_progress')
        .update({ data: sanitized })
        .eq('user_id', user.id)
        .eq('updated_at', expectedUpdatedAt)
        .select('updated_at')
        .maybeSingle()

      if (error) return json(req, { error: 'Could not save progress.' }, 500)
      if (!data) {
        return json(req, { error: 'Progress changed on another device. Re-read and merge before retrying.', conflict: true }, 409)
      }
      return json(req, { ok: true, updated_at: data.updated_at })
    } catch {
      // Do not persist unsanitized question-bearing progress when access verification fails.
      return json(req, { error: 'Could not safely verify saved question access.' }, 503)
    }
  }

  return json(req, { error: 'Unknown progress action.' }, 400)
})
