import { createClient } from 'npm:@supabase/supabase-js@2'

type TrackId = 'DECK_OIC_NW' | 'GMDSS_GOC' | 'ENGINE_OIC_EW' | 'DECK_MGT' | 'ENGINE_MGT'
type JsonRecord = Record<string, unknown>

const TRACKS = ['DECK_OIC_NW', 'GMDSS_GOC', 'ENGINE_OIC_EW', 'DECK_MGT', 'ENGINE_MGT'] as const
const QUESTION_STORAGE_KEYS = ['hyperion-bookmarks', 'hyperion-vault'] as const
const MAX_REQUEST_BYTES = 8 * 1024 * 1024
const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
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

type ProgressQuestionCandidate = { index: number; track: TrackId; id: string; fingerprint: string }
type ProgressSessionCandidate = { track: TrackId; questions: { id: string; fingerprint: string }[] }

function parseQuestionCollection(raw: unknown): { persisted: JsonRecord; state: JsonRecord; items: unknown[] } | null {
  if (typeof raw !== 'string') return null
  try {
    const parsed = JSON.parse(raw)
    if (!isRecord(parsed) || !isRecord(parsed.state) || !Array.isArray(parsed.state.items)) return null
    return { persisted: parsed, state: parsed.state, items: parsed.state.items }
  } catch {
    return null
  }
}

async function fingerprintSessionCandidate(track: unknown, questions: unknown): Promise<ProgressSessionCandidate | null> {
  if (!isTrackId(track) || !Array.isArray(questions) || questions.length < 1 || questions.length > 3000) return null
  if (!questions.every(question => isQuestion(question) && question.track === track)) return null
  const fingerprints = await Promise.all((questions as JsonRecord[]).map(fingerprintQuestion))
  if (fingerprints.some(value => value === null)) return null
  return {
    track,
    questions: (questions as JsonRecord[]).map((question, index) => ({
      id: String(question.id),
      fingerprint: fingerprints[index] as string
    }))
  }
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
  const collections = new Map<string, { persisted: JsonRecord; state: JsonRecord; items: unknown[]; keep: Set<number> }>()
  const bookmarkItems: ProgressQuestionCandidate[] = []
  const vaultItems: ProgressQuestionCandidate[] = []

  for (const key of QUESTION_STORAGE_KEYS) {
    const parsed = parseQuestionCollection(storage[key])
    if (!parsed) {
      storage[key] = null
      continue
    }
    const keep = new Set<number>()
    const candidates = key === 'hyperion-bookmarks' ? bookmarkItems : vaultItems
    for (let index = 0; index < parsed.items.length; index++) {
      const item = parsed.items[index]
      if (!isQuestion(item) || !isTrackId(item.track)) continue
      if (allowedTracks.has(item.track)) {
        keep.add(index)
        continue
      }
      const fingerprint = await fingerprintQuestion(item)
      if (fingerprint) candidates.push({ index, track: item.track, id: item.id, fingerprint })
    }
    collections.set(key, { ...parsed, keep })
  }

  const legacyKey = 'hyperion-saved-practice'
  let legacyCandidate: ProgressSessionCandidate | null = null
  if (typeof storage[legacyKey] === 'string') {
    let legacy: JsonRecord | null = null
    try {
      const parsed = JSON.parse(String(storage[legacyKey]))
      if (isRecord(parsed)) legacy = parsed
    } catch {
      legacy = null
    }
    if (legacy && isTrackId(legacy.track) && allowedTracks.has(legacy.track)) {
      legacyCandidate = await fingerprintSessionCandidate(legacy.track, legacy.questions)
      if (!legacyCandidate) storage[legacyKey] = null
      // Entitled sessions are accepted locally after full snapshot validation below.
    } else if (legacy) {
      legacyCandidate = await fingerprintSessionCandidate(legacy.track, legacy.questions)
      if (!legacyCandidate) storage[legacyKey] = null
    } else {
      storage[legacyKey] = null
    }
  }

  let activeCandidate: ProgressSessionCandidate | null = null
  if (isRecord(snapshot.activeSession)) {
    activeCandidate = await fingerprintSessionCandidate(snapshot.activeSession.track, snapshot.activeSession.questions)
    if (!activeCandidate) snapshot.activeSession = null
  } else {
    snapshot.activeSession = null
  }

  const needsRemoteAuthorization =
    bookmarkItems.length > 0 ||
    vaultItems.length > 0 ||
    (legacyCandidate !== null && !allowedTracks.has(legacyCandidate.track)) ||
    (activeCandidate !== null && !allowedTracks.has(activeCandidate.track))

  let allowedBookmarkIndexes = new Set<number>()
  let allowedVaultIndexes = new Set<number>()
  let legacyAllowed = legacyCandidate !== null && allowedTracks.has(legacyCandidate.track)
  let activeAllowed = activeCandidate !== null && allowedTracks.has(activeCandidate.track)

  if (needsRemoteAuthorization) {
    const { data, error } = await client.functions.invoke('question-bank', {
      body: {
        action: 'authorize-progress-snapshot',
        bookmarkItems,
        vaultItems,
        legacySavedPractice: legacyCandidate && !allowedTracks.has(legacyCandidate.track) ? legacyCandidate : null,
        activeSession: activeCandidate && !allowedTracks.has(activeCandidate.track) ? activeCandidate : null
      }
    })
    if (error ||
        !Array.isArray(data?.bookmarkAllowedIndexes) ||
        !Array.isArray(data?.vaultAllowedIndexes) ||
        typeof data?.legacySavedPracticeAllowed !== 'boolean' ||
        typeof data?.activeSessionAllowed !== 'boolean') {
      // Fail closed and preserve the previous cloud row if authorization is unavailable.
      throw new Error('Saved question authorization could not be verified.')
    }
    allowedBookmarkIndexes = new Set(data.bookmarkAllowedIndexes.filter((i: unknown) => Number.isInteger(i) && Number(i) >= 0))
    allowedVaultIndexes = new Set(data.vaultAllowedIndexes.filter((i: unknown) => Number.isInteger(i) && Number(i) >= 0))
    if (legacyCandidate && !allowedTracks.has(legacyCandidate.track)) legacyAllowed = data.legacySavedPracticeAllowed
    if (activeCandidate && !allowedTracks.has(activeCandidate.track)) activeAllowed = data.activeSessionAllowed
  }

  for (const [key, collection] of collections) {
    const remoteAllowed = key === 'hyperion-bookmarks' ? allowedBookmarkIndexes : allowedVaultIndexes
    const candidateItems = key === 'hyperion-bookmarks' ? bookmarkItems : vaultItems
    candidateItems.forEach(candidate => {
      if (remoteAllowed.has(candidate.index)) collection.keep.add(candidate.index)
    })
    const filteredItems = collection.items.filter((_item, index) => collection.keep.has(index))
    storage[key] = JSON.stringify({
      ...collection.persisted,
      state: { ...collection.state, items: filteredItems }
    })
  }

  if (legacyCandidate && !legacyAllowed) storage[legacyKey] = null
  if (activeCandidate && !activeAllowed) snapshot.activeSession = null

  return snapshot
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (isRecord(value)) {
    const keys = Object.keys(value).filter(key => key !== 'savedAt' && key !== 'changedSections').sort()
    return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function equivalentProgressSnapshots(left: unknown, right: unknown): boolean {
  return isRecord(left) && isRecord(right)
    && left.version === 1 && right.version === 1
    && isRecord(left.storage) && isRecord(right.storage)
    && canonicalJson(left) === canonicalJson(right)
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
    let allowedTracks: Set<TrackId>
    try {
      allowedTracks = await loadAllowedTracks(admin, user)
    } catch {
      return json(req, { error: 'Current license access could not be verified.' }, 503)
    }
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
      // Many client versions periodically resend an unchanged full snapshot.
      // Detect that case before entitlement lookups, question-bank verification,
      // or a Postgres UPDATE. A matching row was previously sanitized for this
      // same user; this response returns no question data.
      const current = await admin.from('user_learning_progress')
        .select('data,updated_at')
        .eq('user_id', user.id)
        .maybeSingle()
      if (current.error) return json(req, { error: 'Could not check the progress version.' }, 500)
      if (expectedUpdatedAt === null) {
        if (current.data) {
          return json(req, { error: 'Progress changed on another device. Re-read and merge before retrying.', conflict: true }, 409)
        }
      } else {
        if (!current.data || current.data.updated_at !== expectedUpdatedAt) {
          return json(req, { error: 'Progress changed on another device. Re-read and merge before retrying.', conflict: true }, 409)
        }
        if (equivalentProgressSnapshots(body.data, current.data.data)) {
          return json(req, { ok: true, unchanged: true, updated_at: current.data.updated_at })
        }
      }

      let allowedTracks: Set<TrackId>
      try {
        allowedTracks = await loadAllowedTracks(admin, user)
      } catch {
        return json(req, { error: 'Current license access could not be verified.' }, 503)
      }

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
        return json(req, {
          ok: true,
          updated_at: data?.updated_at ?? null,
          ...(body.return_data === true ? { data: sanitized } : {})
        })
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
      return json(req, {
        ok: true,
        updated_at: data.updated_at,
        ...(body.return_data === true ? { data: sanitized } : {})
      })
    } catch {
      // Do not persist unsanitized question-bearing progress when access verification fails.
      return json(req, { error: 'Could not safely verify saved question access.' }, 503)
    }
  }

  return json(req, { error: 'Unknown progress action.' }, 400)
})
