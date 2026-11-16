import { collectBankImages, checkMediaAssets, checkPublishBudget, type MediaBundler } from './questionMediaBundler.ts'
import { decryptToText, deriveKeyBytes, toSearchQuestions } from '../supabase/functions/_shared/bankCodec.ts'
import { parseCsvText } from '../src/lib/csvParser.ts'
import { parseQuestionImageRefs } from '../src/lib/questionMedia.ts'
import { GITHUB_BANK_FILES, GITHUB_BANK_REPOSITORY, GITHUB_BANK_ROOT, GITHUB_BANK_MANIFEST, GITHUB_BANK_RELEASE, githubAssetPath, INITIAL_BANK_RELEASE, readBounded, sha256, validateBankManifest, type BankRelease } from '../supabase/functions/_shared/githubBankSource.ts'

export class PublisherError extends Error { status: number; constructor(message: string, status = 400) { super(message); this.status = status } }
export type BankUpload = { path: string; format: 'csv' | 'encrypted'; content: string }
export type PublishInput = { files: BankUpload[]; requestId: string; expectedHead?: string; validationId?: string }
const allowed = new Set(GITHUB_BANK_FILES.map(file => file.path))
const encoder = new TextEncoder()
const C1_EXPLANATION_PATH = 'deck/oic_nw_c1.csv.enc'

/**
 * Preserve an existing OIC-NW C1 explanation only when the question, all four
 * choice cells, and the keyed answer are byte-for-byte unchanged. A new bank
 * upload may intentionally omit explanations; never replace those with blanks.
 *
 * A copied old explanation on a changed question is stale and is removed.
 * An explicitly rewritten explanation, however, is kept. Compare by numbered
 * slot, never fuzzy text matches: near-duplicate navigation questions often
 * have distinct answers and must not borrow each other's explanations.
 */
export function reconcileC1Explanations(before: string, uploaded: string) {
  const parse = (text: string) => {
    const rows = parseCsvText(text)
    const questions = rows.filter(row => {
      const number = (row[0] || '').trim()
      const choices = row.slice(2, 6).map(choice => (choice || '').trim())
      return row.length >= 7 && /^[0-9]+$/.test(number) && Number(number) > 0
        && !!(row[1] || '').trim() && (row[1] || '').trim().toLowerCase() !== 'question'
        && choices.filter(Boolean).length >= 2
        && !choices.every((choice, i) => choice === ['A', 'B', 'C', 'D'][i])
    })
    return { rows, questions }
  }
  const original = parse(before), next = parse(uploaded)
  // Never guess how raw CSV slots correspond to the server's actual questions.
  if (original.questions.length !== toSearchQuestions(C1_EXPLANATION_PATH, before).length
      || next.questions.length !== toSearchQuestions(C1_EXPLANATION_PATH, uploaded).length) {
    throw new PublisherError('The C1 CSV layout could not be reconciled safely; explanations were not changed.', 409)
  }
  let preserved = 0, cleared = 0
  for (let i = 0; i < Math.min(original.questions.length, next.questions.length); i++) {
    const oldRow = original.questions[i], newRow = next.questions[i]
    const oldExplanation = oldRow[7] || '', supplied = newRow[7] || ''
    const unchanged = [1, 2, 3, 4, 5, 6].every(column => (oldRow[column] || '') === (newRow[column] || ''))
    if (unchanged && !supplied.trim() && oldExplanation.trim()) {
      newRow[7] = oldExplanation
      preserved++
    } else if (!unchanged && oldExplanation.trim() && supplied.trim() === oldExplanation.trim()) {
      newRow[7] = ''
      cleared++
    }
  }
  const encodeCell = (value: string) => /[",\r\n]/.test(value)
    ? '"' + value.replace(/"/g, '""') + '"' : value
  const text = preserved || cleared
    ? next.rows.map(row => row.map(encodeCell).join(',')).join('\r\n')
    : uploaded
  return { text, preserved, cleared }
}

export function validateQuestionChanges(path: string, before: string, after: string) {
  if (!allowed.has(path)) throw new PublisherError('Unsupported question-bank destination path.')
  const previous = toSearchQuestions(path, before), next = toSearchQuestions(path, after)
  // A legacy CSV upload must not silently clear retirement flags set in the
  // admin editor. Restoration requires an explicit ACTIVE marker per question.
  const hasStatusColumn = (text: string) => parseCsvText(text).slice(0, 15)
    .some(row => row.some(value => value.trim().toUpperCase() === 'HYPERION_STATUS'))
  if (previous.some(question => question.isRetired === true) && !hasStatusColumn(after)) {
    throw new PublisherError('This CSV omits existing retirement flags. Open the question bank in the admin editor or preserve its HYPERION_STATUS column.', 409)
  }
  // Match bankCodec's header selection so a marker in a data cell cannot authorize image removal.
  const rows = parseCsvText(after), gmdss = path.startsWith('gmdss/')
  const detectedHeader = rows.slice(0, 15).findIndex(row => {
    const joined = row.map(cell => cell.trim().toLowerCase()).join('|')
    return gmdss ? joined.includes('question') && joined.includes('option1')
      : (joined.includes('question') && (joined.includes('correct') || joined.includes('|a|')))
        || (row[0]?.trim().toLowerCase() === 'no.' && row[1]?.trim().toLowerCase() === 'question')
  })
  const header = detectedHeader < 0 ? (gmdss ? 3 : 0) : detectedHeader
  const mediaColumn = (rows[header] || []).findIndex(value => value.trim().toUpperCase() === 'HYPERION_MEDIA')
  if (previous.some(question => Array.isArray(question.imageAttachments) && question.imageAttachments.length) && mediaColumn < 0) {
    throw new PublisherError('This CSV omits existing question images. Preserve its HYPERION_MEDIA column; to remove images intentionally, keep the column and explicitly clear their cells.', 409)
  }
  if (mediaColumn >= 0) {
    for (const row of rows.slice(header + 1)) {
      const value = row[mediaColumn] || ''
      if (value.trim() && !parseQuestionImageRefs(value).length) {
        throw new PublisherError('The HYPERION_MEDIA column contains invalid image metadata. Preserve valid attachment references or explicitly clear the cell to remove images.')
      }
    }
  }
  if (!next.length) throw new PublisherError('The CSV does not contain valid questions.')
  if (next.length < previous.length) throw new PublisherError('Removing questions or publishing a shorter list would break saved references. Keep existing questions and append new ones.')
  const identity = (q: Record<string, unknown>) => {
    const prompt = [q.questionText, q.options]
    if (typeof q.questionText === 'string' && !q.questionText.trim()) {
      const images = Array.isArray(q.imageAttachments) ? q.imageAttachments : []
      prompt.push(images.filter(ref => ref.placement === 'question').map(ref => [ref.sha256, ref.mime]).sort())
    }
    return JSON.stringify(prompt)
  }
  const semantic = (q: Record<string, unknown>) => JSON.stringify([q.questionText, q.options, q.correctAnswerIndex, q.explanation, q.isRetired === true, q.imageAttachments || []])
  const positions = new Map<string, Set<number>>()
  previous.forEach((q, i) => { const key = identity(q); const indexes = positions.get(key) || new Set<number>(); indexes.add(i); positions.set(key, indexes) })
  let changed = 0
  const corrections: { number: number; before: Record<string, unknown>; after: Record<string, unknown> }[] = []
  next.forEach((q, i) => {
    const oldPositions = positions.get(identity(q))
    if (oldPositions && !oldPositions.has(i)) throw new PublisherError(`Question ${i + 1} was reordered from an existing position. Preserve question order to protect bookmarks and mistakes.`)
    if (i < previous.length && semantic(previous[i]) !== semantic(q)) {
      changed++
      if (corrections.length < 20) corrections.push({ number: i + 1, before: { questionText: previous[i].questionText, options: previous[i].options, correctAnswerIndex: previous[i].correctAnswerIndex, explanation: previous[i].explanation, isRetired: previous[i].isRetired === true, imageAttachments: previous[i].imageAttachments || [] }, after: { questionText: q.questionText, options: q.options, correctAnswerIndex: q.correctAnswerIndex, explanation: q.explanation, isRetired: q.isRetired === true, imageAttachments: q.imageAttachments || [] } })
    }
    if (i < previous.length && previous[i].id !== q.id) throw new PublisherError('An existing question ID changed.')
  })
  return { path, questionCount: next.length, previousCount: previous.length, appended: next.length - previous.length, changed, corrections }
}
function base64(bytes: Uint8Array): string { let value = ''; for (let i = 0; i < bytes.length; i += 32768) value += String.fromCharCode(...bytes.subarray(i, i + 32768)); return btoa(value) }
async function encrypt(text: string): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12)), key = await crypto.subtle.importKey('raw', deriveKeyBytes(), 'AES-GCM', false, ['encrypt'])
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(text)))
  const bytes = new Uint8Array(12 + ciphertext.byteLength); bytes.set(iv); bytes.set(ciphertext, 12); return bytes
}
export function apiClient(fetcher: typeof fetch, token: string) {
  return async (path: string, method = 'GET', body?: unknown, raw = false, missing = false) => {
    let response: Response
    try { response = await fetcher(`https://api.github.com/repos/${GITHUB_BANK_REPOSITORY}/${path}`, { method, headers: { Authorization: `Bearer ${token}`, Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'Hyperion-Bank-Publisher', 'X-GitHub-Api-Version': '2022-11-28' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) }) }
    catch { throw new PublisherError('GitHub is temporarily unavailable. Your live bank was not knowingly replaced; retry the same publication to check its status.', 502) }
    if (missing && response.status === 404) return null
    if (!response.ok) {
      if (response.status === 409 || response.status === 422) throw new PublisherError('The GitHub branch changed during publication. Refresh and validate again; concurrent changes were preserved.', 409)
      if (response.status === 401 || response.status === 403 || response.status === 404) throw new PublisherError('GitHub publishing access is unavailable. Check the token expiry, selected repository and Contents read/write permission.', 503)
      throw new PublisherError('GitHub could not complete the operation. Retry the same publication safely.', 502)
    }
    return response
  }
}
export async function publisherState(fetcher: typeof fetch, token: string) {
  const api = apiClient(fetcher, token)
  const head = await (await api('git/ref/heads/main'))!.json() as { object?: { sha?: string } }
  const headSha = head.object?.sha
  if (!headSha || !/^[a-f0-9]{40}$/.test(headSha)) throw new PublisherError('GitHub returned an invalid branch revision.', 502)
  const baseCommit = await (await api('git/commits/' + headSha))!.json() as { tree?: { sha?: string } }
  const treeSha = baseCommit.tree?.sha
  if (!treeSha || !/^[a-f0-9]{40}$/.test(treeSha)) throw new PublisherError('GitHub returned an invalid base tree.', 502)
  const manifestResponse = await api(`contents/${GITHUB_BANK_ROOT}/${GITHUB_BANK_MANIFEST}?ref=${headSha}`, 'GET', undefined, true)
  const manifestBytes = await readBounded(manifestResponse!.body, 65536)
  let manifest: unknown
  try { manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) } catch { throw new PublisherError('The GitHub manifest is invalid.', 409) }
  const files = validateBankManifest(manifest)
  const pointerResponse = await api(`contents/${GITHUB_BANK_ROOT}/${GITHUB_BANK_RELEASE}?ref=${headSha}`, 'GET', undefined, true, true)
  let release: BankRelease = INITIAL_BANK_RELEASE
  if (pointerResponse) {
    let pointer: any
    try { pointer = JSON.parse(new TextDecoder().decode(await readBounded(pointerResponse.body, 4096))) } catch { throw new PublisherError('The GitHub release pointer is invalid.', 409) }
    if (pointer.version !== 1 || !/^[a-f0-9]{40}$/.test(pointer.revision || '') || await sha256(manifestBytes) !== pointer.manifestSha256 || !Number.isFinite(Date.parse(pointer.publishedAt || '')) || typeof pointer.publicationId !== 'string' || !/^[a-f0-9]{64}$/.test(pointer.inputDigest || '')) throw new PublisherError('GitHub contains unpublished or inconsistent manifest changes. Reconcile them before publishing.', 409)
    release = { ...pointer, files }
  } else if (files.some(file => { const original = GITHUB_BANK_FILES.find(item => item.path === file.path); return original?.sha256 !== file.sha256 || original.bytes !== file.bytes })) {
    throw new PublisherError('GitHub contains manifest changes without a published release. Reconcile them before publishing.', 409)
  }
  return { api, head: headSha, tree: treeSha, release, files, manifest: manifest as Record<string, unknown> }
}
async function verifyPublishedBankTree(state: Awaited<ReturnType<typeof publisherState>>) {
  const publishedCommit = await (await state.api('git/commits/' + state.release.revision))!.json() as { tree?: { sha?: string } }
  const publishedTree = publishedCommit.tree?.sha
  if (!publishedTree || !/^[a-f0-9]{40}$/.test(publishedTree)) throw new PublisherError('The published GitHub tree is invalid.', 409)
  const readTree = async (sha: string) => {
    const response = await state.api('git/trees/' + sha + '?recursive=1')
    const value = JSON.parse(new TextDecoder().decode(await readBounded(response!.body, 2 * 1024 * 1024))) as { truncated?: boolean; tree?: { path: string; sha: string; mode: string; type: string }[] }
    if (value.truncated || !Array.isArray(value.tree)) throw new PublisherError('The GitHub tree could not be checked completely.', 409)
    return new Map(value.tree.map(entry => [entry.path, entry]))
  }
  const original = await readTree(publishedTree), current = await readTree(state.tree)
  for (const path of [...state.files.map(file => githubAssetPath(file.path)), GITHUB_BANK_MANIFEST]) {
    const key = GITHUB_BANK_ROOT + '/' + path, before = original.get(key), after = current.get(key)
    if (!before || !after || before.sha !== after.sha || before.mode !== '100644' || after.mode !== '100644' || before.type !== 'blob' || after.type !== 'blob') throw new PublisherError('GitHub has unpublished changes outside the verified release: ' + path + '. Reconcile them before publishing.', 409)
  }
}
async function prepare(input: PublishInput, fetcher: typeof fetch, token: string, publishing: boolean) {
  if (!input || !Array.isArray(input.files) || input.files.length < 1 || input.files.length > 10) throw new PublisherError('Choose between 1 and 10 files per publication.')
  if (!/^[a-zA-Z0-9-]{8,128}$/.test(input.requestId || '')) throw new PublisherError('A valid publication request ID is required.')
  if (input.expectedHead !== undefined && !/^[a-f0-9]{40}$/.test(input.expectedHead)) throw new PublisherError('Invalid base revision.')
  const seen = new Set<string>(); let total = 0
  const decoded: { path: string; bytes: Uint8Array; text: string; inputHash: string; format: string }[] = []
  for (const file of input.files) {
    if (!file || !allowed.has(file.path) || seen.has(file.path)) throw new PublisherError('Unsupported or duplicate destination path.')
    seen.add(file.path)
    if (typeof file.content !== 'string' || !['csv', 'encrypted'].includes(file.format)) throw new PublisherError('Choose a compatible CSV or encrypted CSV file.')
    let bytes: Uint8Array, text: string
    if (file.format === 'encrypted') {
      if (file.content.length > 1398104 || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.content)) throw new PublisherError('Invalid encrypted file or encrypted file exceeds 1 MiB.')
      try { bytes = Uint8Array.from(atob(file.content), value => value.charCodeAt(0)) } catch { throw new PublisherError('Invalid encrypted file encoding.') }
      if (bytes.length > 1048576 || bytes.length < 28) throw new PublisherError('Encrypted files must be compatible and no larger than 1 MiB.')
      try { text = await decryptToText(bytes) } catch { throw new PublisherError('The encrypted file is not compatible with the Hyperion question bank.') }
    } else {
      const raw = encoder.encode(file.content); if (raw.length > 700000) throw new PublisherError('Raw CSV exceeds 700 KB.')
      text = file.content; bytes = await encrypt(text)
    }
    total += bytes.length; if (total > 8 * 1024 * 1024) throw new PublisherError('This publication exceeds the combined 8 MiB file limit.')
    decoded.push({ path: file.path, bytes, text, format: file.format, inputHash: await sha256(encoder.encode(file.content)) })
  }
  const state = await publisherState(fetcher, token)
  const expectedHead = input.expectedHead || state.head
  const validationId = await sha256(encoder.encode(JSON.stringify({ requestId: input.requestId, expectedHead, files: decoded.map(file => [file.path, file.format, file.inputHash]) })))
  if (publishing && input.validationId !== validationId) throw new PublisherError('The files changed after validation. Validate this batch again.', 409)
  if (publishing && state.release.publicationId === input.requestId && state.release.inputDigest === validationId) return { alreadyPublished: true as const, state, validationId }
  if (state.head !== expectedHead) throw new PublisherError('The GitHub branch changed after validation. Refresh and validate again.', 409)
  await verifyPublishedBankTree(state)
  const summaries = []
  for (const file of decoded) {
    const oldResponse = await state.api(`contents/${GITHUB_BANK_ROOT}/${githubAssetPath(file.path)}?ref=${state.head}`, 'GET', undefined, true)
    const old = await readBounded(oldResponse!.body, 1048576), metadata = state.files.find(item => item.path === file.path)!
    if (old.length !== metadata.bytes || await sha256(old) !== metadata.sha256) throw new PublisherError('This GitHub file has changes outside the published manifest. Reconcile them before publishing.', 409)
    let oldText: string
    try { oldText = await decryptToText(old) } catch { throw new PublisherError('The current encrypted GitHub bank could not be validated.', 409) }
    let explanationsPreserved = 0, staleExplanationsCleared = 0
    if (file.path === C1_EXPLANATION_PATH) {
      const reconciled = reconcileC1Explanations(oldText, file.text)
      explanationsPreserved = reconciled.preserved
      staleExplanationsCleared = reconciled.cleared
      if (reconciled.text !== file.text) {
        file.text = reconciled.text
        file.bytes = await encrypt(file.text)
        if (file.bytes.length > 1048576) throw new PublisherError('Reconciled C1 CSV exceeds the 1 MiB encrypted file limit.')
      }
    }
    summaries.push({
      ...validateQuestionChanges(file.path, oldText, file.text),
      unchanged: await sha256(file.bytes) === metadata.sha256,
      explanationsPreserved, staleExplanationsCleared
    })
  }
  if (decoded.reduce((total, file) => total + file.bytes.length, 0) > 8 * 1024 * 1024) throw new PublisherError('The reconciled publication exceeds the combined 8 MiB file limit.')
  return { alreadyPublished: false as const, state, validationId, decoded, preview: { requestId: input.requestId, baseHead: state.head, validationId, files: summaries } }
}
export async function validateGithubBatch(input: PublishInput, fetcher: typeof fetch, token: string) {
  const result = await prepare(input, fetcher, token, false)
  return result.alreadyPublished ? null : result.preview
}
export async function publishGithubBatch(input: PublishInput, fetcher: typeof fetch, token: string, bundleMedia?: MediaBundler) {
  if (!input.expectedHead || !input.validationId) throw new PublisherError('Validate the files before publishing.', 409)
  const result = await prepare(input, fetcher, token, true)
  if (result.alreadyPublished) return { revision: result.state.release.revision, commit: result.state.head, alreadyPublished: true, repository: GITHUB_BANK_REPOSITORY }
  const references = collectBankImages(result.decoded)
  checkPublishBudget(result.decoded.length, references.length)
  if (references.length && !bundleMedia) throw new PublisherError('Question images must be bundled before publishing.', 503)
  // Finish and verify every image before creating any GitHub object or moving main.
  const media = references.length ? await checkMediaAssets(references, { assets: await bundleMedia!(references) }) : []
  const { api } = result.state
  const entries: { path: string; mode: string; type: string; sha?: string; content?: string }[] = []
  const files = result.state.files.map(file => ({ ...file }))
  for (const file of result.decoded) {
    const blob = await (await api('git/blobs', 'POST', { content: base64(file.bytes), encoding: 'base64' }))!.json() as { sha: string }
    entries.push({ path: GITHUB_BANK_ROOT + '/' + githubAssetPath(file.path), mode: '100644', type: 'blob', sha: blob.sha })
    Object.assign(files.find(item => item.path === file.path)!, { bytes: file.bytes.length, sha256: await sha256(file.bytes) })
  }
  for (const asset of media) {
    const blob = await (await api('git/blobs', 'POST', { content: asset.ciphertext, encoding: 'base64' }))!.json() as { sha: string }
    if (!/^[a-f0-9]{40}$/.test(blob.sha)) throw new PublisherError('GitHub returned an invalid image blob.', 502)
    entries.push({ path: 'app/src/main/assets/' + asset.path, mode: '100644', type: 'blob', sha: blob.sha })
  }
  const manifestText = JSON.stringify({ ...result.state.manifest, version: 1, encrypted: true, files }, null, 2) + '\n'
  entries.push({ path: GITHUB_BANK_ROOT + '/' + GITHUB_BANK_MANIFEST, mode: '100644', type: 'blob', content: manifestText })
  const tree = await (await api('git/trees', 'POST', { base_tree: result.state.tree, tree: entries }))!.json() as { sha: string }
  const bank = await (await api('git/commits', 'POST', { message: `Update ${result.decoded.length} Hyperion question-bank file(s)`, tree: tree.sha, parents: [result.state.head] }))!.json() as { sha: string }
  if (!/^[a-f0-9]{40}$/.test(bank.sha)) throw new PublisherError('GitHub returned an invalid bank commit.', 502)
  const pointer = { version: 1, revision: bank.sha, manifestSha256: await sha256(encoder.encode(manifestText)), publishedAt: new Date().toISOString(), publicationId: input.requestId, inputDigest: result.validationId, previousRevision: result.state.release.revision }
  const releaseTree = await (await api('git/trees', 'POST', { base_tree: tree.sha, tree: [{ path: GITHUB_BANK_ROOT + '/' + GITHUB_BANK_RELEASE, mode: '100644', type: 'blob', content: JSON.stringify(pointer, null, 2) + '\n' }] }))!.json() as { sha: string }
  const commit = await (await api('git/commits', 'POST', { message: 'Publish verified Hyperion question-bank release', tree: releaseTree.sha, parents: [bank.sha] }))!.json() as { sha: string }
  await api('git/refs/heads/main', 'PATCH', { sha: commit.sha, force: false })
  return { revision: bank.sha, commit: commit.sha, alreadyPublished: false, repository: GITHUB_BANK_REPOSITORY, files: result.preview.files }
}
