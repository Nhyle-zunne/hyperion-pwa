import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AdminNavigation from '../components/AdminNavigation'
import QuestionBankCombobox from '../components/QuestionBankCombobox'
import { supabase } from '../lib/supabase'
import { withPageLoading } from '../lib/pageLoading'
import { editBankQuestion, readEditableBank, type QuestionEdit } from '../lib/questionBankEditor'

type Asset = { path: string; label: string; track: string; competenceId: string; part: number | null; format: 'standard' | 'gmdss'; repositoryPath?: string }
type QuestionPreview = { questionText: string; options: string[]; correctAnswerIndex: number; explanation?: string; isRetired?: boolean }
type Preview = { requestId: string; baseHead: string; validationId: string; files: { path: string; questionCount: number; previousCount: number; changed: number; appended: number; explanationsPreserved?: number; staleExplanationsCleared?: number; corrections: { number: number; before: QuestionPreview; after: QuestionPreview }[] }[] }
type QueueStatus = 'ready' | 'publishing' | 'success' | 'error'
type QueueItem = { id: string; file: File; targetPath: string; status: QueueStatus; error?: string; questionCount?: number; baseHead?: string }
const TRACKS = [
  ['DECK_OIC_NW', 'Deck OIC-NW'],
  ['GMDSS_GOC', 'GMDSS GOC'],
  ['ENGINE_OIC_EW', 'Engine OIC-EW'],
  ['DECK_MGT', 'Deck Management'],
  ['ENGINE_MGT', 'Engine Management']
] as const
const MAX_FILE_BYTES = 700000
const MAX_ENCRYPTED_FILE_BYTES = 1048576
function rawCsvName(path: string) {
  const name = path.split('/').pop() || ''
  return name.endsWith('.enc') ? name.slice(0, -4).toLowerCase() : name.toLowerCase()
}
function uploadedCsvName(name: string) {
  const lower = name.toLowerCase()
  return lower.endsWith('.csv.enc') ? lower.slice(0, -4) : lower
}
function isEncryptedCsv(file: File) { return file.name.toLowerCase().endsWith('.csv.enc') }
function csvFileSupported(file: File) {
  const name = file.name.toLowerCase()
  return name.endsWith('.csv') || name.endsWith('.csv.enc')
}
function fileSizeLimit(file: File) { return isEncryptedCsv(file) ? MAX_ENCRYPTED_FILE_BYTES : MAX_FILE_BYTES }
function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

export default function AdminQuestionBankScreen() {
  const pickerRef = useRef<HTMLInputElement>(null)
  const [assets, setAssets] = useState<Asset[]>([])
  const [publisherReady, setPublisherReady] = useState<boolean | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [publishedLink, setPublishedLink] = useState('')
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [message, setMessage] = useState('')
  const [isError, setIsError] = useState(false)
  const [batchResult, setBatchResult] = useState<{ attempted: number; updated: number; failed: number } | null>(null)
  const [editorTarget, setEditorTarget] = useState('')
  const [editorText, setEditorText] = useState('')
  const [editorOriginalText, setEditorOriginalText] = useState('')
  const [editorBaseHead, setEditorBaseHead] = useState('')
  const [editorSearch, setEditorSearch] = useState('')
  const [editorOrdinal, setEditorOrdinal] = useState(0)
  const [editorDraft, setEditorDraft] = useState<QuestionEdit | null>(null)
  const [editorBusy, setEditorBusy] = useState(false)
  const [editorError, setEditorError] = useState('')
  const [editorNotice, setEditorNotice] = useState<{ kind: 'info' | 'success' | 'error'; text: string } | null>(null)
  const editorBank = useMemo(() => {
    if (!editorText || !editorTarget) return null
    try { return readEditableBank(editorTarget, editorText) } catch { return null }
  }, [editorTarget, editorText])
  const editorMatches = useMemo(() => editorBank?.questions.filter(q => {
    const needle = editorSearch.trim().toLowerCase()
    return !needle || String(q.ordinal).includes(needle) || q.questionText.toLowerCase().includes(needle)
  }).slice(0, 150) || [], [editorBank, editorSearch])
  const selectedEditorQuestion = editorBank?.questions.find(q => q.ordinal === editorOrdinal) || null
  // The form is separate from the applied CSV draft. Do not silently queue
  // old CSV bytes or discard typed edits when switching questions.
  const editorFormDirty = !!(selectedEditorQuestion && editorDraft && (
    editorDraft.questionText.trim() !== selectedEditorQuestion.questionText ||
    editorDraft.correctAnswerIndex !== selectedEditorQuestion.correctAnswerIndex ||
    editorDraft.explanation !== selectedEditorQuestion.explanation ||
    editorDraft.retired !== selectedEditorQuestion.retired ||
    editorDraft.options.length !== selectedEditorQuestion.options.length ||
    editorDraft.options.some((option, i) => option.trim() !== selectedEditorQuestion.options[i])
  ))
  const editorHasAppliedEdits = !!editorText && editorText !== editorOriginalText
  const editorDraftQueued = queue.some(item => !!item.baseHead && item.targetPath === editorTarget && item.status !== 'success')
  const updateEditorDraft = (draft: QuestionEdit) => {
    setEditorDraft(draft)
    setEditorError('')
    setEditorNotice(null)
  }

  const call = useCallback(async (body: Record<string, unknown>) => {
    if (!supabase) throw new Error('Question-bank administration is not configured.')
    const { data: auth } = await supabase.auth.getSession()
    if (!auth.session?.access_token) throw new Error('Sign in with your administrator account.')
    const response = await fetch('/api/question-bank/admin', { method: 'POST', headers: { Authorization: 'Bearer ' + auth.session.access_token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    let data: any
    try { data = await response.json() } catch { throw new Error('The publishing service could not confirm this action. Keep the batch and retry; saved study data is preserved.') }
    if (!response.ok || data?.error) throw Object.assign(new Error(data?.error || 'GitHub administration could not be completed.'), { status: response.status })
    return data
  }, [])

  const loadAssets = useCallback(async () => {
    setLoading(true)
    try {
      const result = await call({ action: 'inventory' })
      const rows = Array.isArray(result.assets) ? result.assets.map((asset: Asset) => ({ ...asset, label: asset.label || `${TRACKS.find(([id]) => id === asset.track)?.[1] || asset.track} · ${asset.competenceId}${asset.part ? ' · Part ' + asset.part : ''}` })) as Asset[] : []
      setAssets(rows)
      setPublisherReady(result.configured === true)

      setQueue(old => old.map(item => {
        if (item.targetPath && rows.some(asset => asset.path === item.targetPath)) return item
        const match = rows.find(asset => rawCsvName(asset.path) === uploadedCsvName(item.file.name))
        return { ...item, targetPath: match?.path || item.targetPath }
      }))
    } catch (reason) {
      setIsError(true)
      setMessage(reason instanceof Error ? reason.message : 'Could not load supported question-bank files.')
    } finally {
      setLoading(false)
    }
  }, [call])
  useEffect(() => { void withPageLoading('Loading question-bank inventory', () => loadAssets()) }, [loadAssets])

  const assetByPath = useMemo(() => new Map(assets.map(asset => [asset.path, asset])), [assets])
  const duplicatePaths = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of queue) if (item.targetPath && item.status !== 'success') counts.set(item.targetPath, (counts.get(item.targetPath) || 0) + 1)
    return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([target]) => target))
  }, [queue])
  const totalBytes = useMemo(() => queue.reduce((sum, item) => sum + item.file.size, 0), [queue])
  const successCount = queue.filter(item => item.status === 'success').length
  const hasUnpublishedFiles = queue.some(item => item.status !== 'success')
  const allFilesUpdated = queue.length > 0 && !hasUnpublishedFiles
  const problemCount = queue.filter(item => !item.targetPath || duplicatePaths.has(item.targetPath) || item.file.size > fileSizeLimit(item.file) || !!item.error).length

  const queueGroups = useMemo(() => {
    const groups: { key: string; label: string; items: QueueItem[] }[] = TRACKS.map(([track, label]) => {
      const items = queue.filter(item => assetByPath.get(item.targetPath)?.track === track)
      return { key: track, label, items }
    }).filter(group => group.items.length > 0)
    const unmatched = queue.filter(item => !assetByPath.get(item.targetPath))
    if (unmatched.length) groups.push({ key: 'needs-mapping', label: 'Needs mapping / unsupported files', items: unmatched })
    return groups
  }, [queue, assetByPath])

  const addFiles = (list: FileList | File[]) => {
    if (busy) return
    const incoming = Array.from(list)
    if (!incoming.length) return
    const additions: QueueItem[] = incoming.map((file, index) => {
      const match = assets.find(asset => rawCsvName(asset.path) === uploadedCsvName(file.name))
      const isCsv = csvFileSupported(file)
      return {
        id: file.name + '-' + file.size + '-' + file.lastModified + '-' + Date.now() + '-' + index,
        file,
        targetPath: isCsv ? (match?.path || '') : '',
        status: 'ready',
        error: !isCsv ? 'Unsupported file. Choose a raw .csv or Hyperion-compatible .csv.enc file.' : file.size > fileSizeLimit(file) ? (isEncryptedCsv(file) ? 'Encrypted file exceeds 1 MiB.' : 'Raw CSV exceeds 700 KB.') : undefined
      }
    })
    setQueue(old => [...old, ...additions])
    setPreview(null)
    setBatchResult(null)
    setMessage('')
    setIsError(false)
    if (incoming.some(file => !csvFileSupported(file))) {
      setMessage('Only raw .csv and Hyperion-compatible .csv.enc files are supported.')
      setIsError(true)
    }
  }

  const updateTarget = (id: string, targetPath: string) => {
    setPreview(null)
    setBatchResult(null)
    setQueue(old => old.map(item => item.id === id ? { ...item, targetPath, status: item.status === 'success' ? 'success' : 'ready', error: undefined } : item))
  }


  const loadEditor = async () => {
    if (!editorTarget) return
    setEditorBusy(true)
    setEditorError('')
    setEditorNotice(null)
    try {
      const result = await call({ action: 'editor-load', path: editorTarget })
      if (result.path !== editorTarget || typeof result.csvText !== 'string' || !/^[a-f0-9]{40}$/.test(result.baseHead || '')) {
        throw new Error('The question editor received an invalid source revision.')
      }
      const bank = readEditableBank(editorTarget, result.csvText)
      setEditorText(result.csvText)
      setEditorOriginalText(result.csvText)
      setEditorBaseHead(result.baseHead)
      setEditorOrdinal(bank.questions[0].ordinal)
      const first = bank.questions[0]
      setEditorDraft({ questionText: first.questionText, options: first.options, correctAnswerIndex: first.correctAnswerIndex, explanation: first.explanation, retired: first.retired })
      setMessage('Question set loaded securely. Changes are drafts until you validate and publish.')
      setIsError(false)
    } catch (reason) {
      setEditorError(reason instanceof Error ? reason.message : 'The question set could not be opened.')
      setEditorText('')
      setEditorOriginalText('')
      setEditorBaseHead('')
      setEditorDraft(null)
    } finally { setEditorBusy(false) }
  }

  const chooseEditorQuestion = (ordinal: number) => {
    if (ordinal !== editorOrdinal && editorFormDirty) {
      setEditorNotice({ kind: 'error', text: `Question #${editorOrdinal} has unapplied form changes. Apply or discard them before selecting another question.` })
      return
    }
    const question = editorBank?.questions.find(q => q.ordinal === ordinal)
    if (!question) return
    setEditorOrdinal(ordinal)
    setEditorDraft({ questionText: question.questionText, options: question.options.slice(), correctAnswerIndex: question.correctAnswerIndex, explanation: question.explanation, retired: question.retired })
    setEditorError('')
    setEditorNotice(null)
  }

  const applyEditorDraft = () => {
    if (!editorBank || !editorDraft || !selectedEditorQuestion) {
      setEditorNotice({ kind: 'error', text: 'Open a question bank and select a question first.' })
      return
    }
    if (!editorFormDirty) {
      setEditorNotice({ kind: 'info', text: 'No changes to apply yet. Change a question field, answer, explanation or retirement status first.' })
      return
    }
    try {
      const updated = editBankQuestion(editorBank, editorOrdinal, editorDraft)
      const next = readEditableBank(editorTarget, updated)
      const selection = next.questions.find(q => q.ordinal === editorOrdinal)
      if (!selection || next.questions.length !== editorBank.questions.length ||
          next.questions.some((item, i) => item.ordinal !== editorBank.questions[i].ordinal || item.rowIndex !== editorBank.questions[i].rowIndex)) {
        throw Error('The question-bank structure changed. The edit was not saved.')
      }
      setEditorText(updated)
      setEditorDraft({ questionText: selection.questionText, options: selection.options.slice(), correctAnswerIndex: selection.correctAnswerIndex, explanation: selection.explanation, retired: selection.retired })
      // If this bank was already queued, applying another change invalidates
      // the previously built File. Prevent publishing an obsolete snapshot.
      setQueue(old => old.filter(item => !(item.baseHead && item.targetPath === editorTarget && item.status !== 'success')))
      setPreview(null)
      setBatchResult(null)
      setEditorError('')
      setEditorNotice({ kind: 'success', text: `Question #${editorOrdinal} saved to the local draft. ${editorDraftQueued ? 'An older queued version was cleared. ' : ''}Next: add the edited bank to the publish queue.` })
      setMessage('Question edit saved locally. Add the edited bank to the queue, validate, then publish. No live questions have changed.')
      setIsError(false)
    } catch (reason) {
      const error = reason instanceof Error ? reason.message : 'This question could not be edited.'
      setEditorError(error)
      setEditorNotice({ kind: 'error', text: error })
    }
  }

  const queueEditorChanges = () => {
    const feedback = (text: string) => { setEditorError(''); setEditorNotice({ kind: 'error', text }) }
    if (!editorText || !editorTarget || !editorBaseHead) {
      feedback('Open a question bank before adding changes to the queue.')
      return
    }
    if (editorFormDirty) {
      feedback('Apply the current edit to the local draft first, then add the edited bank to the queue.')
      return
    }
    if (!editorHasAppliedEdits) {
      feedback('No applied edits to queue. Change a question and click Apply question edit to draft first.')
      return
    }
    if (queue.some(item => item.status !== 'success' && item.targetPath !== editorTarget)) {
      feedback('Publish or clear the existing upload queue first. An edited question set cannot be mixed with another upload.')
      return
    }
    const file = new File([editorText], rawCsvName(editorTarget), { type: 'text/csv' })
    if (file.size > MAX_FILE_BYTES) {
      feedback('This edited CSV exceeds 700 KB. The current draft was not queued.')
      return
    }
    setQueue(old => [...old.filter(item => item.targetPath !== editorTarget || item.status === 'success'), {
      id: 'editor-' + crypto.randomUUID(), file, targetPath: editorTarget, status: 'ready', baseHead: editorBaseHead
    }])
    setPreview(null)
    setBatchResult(null)
    setEditorError('')
    setEditorNotice({ kind: 'success', text: 'Edited question bank added to the upload queue. Next: validate the batch, review the changes, then publish to GitHub.' })
    setMessage('Edited questions are in the upload queue. Validate and review the changes before publishing.')
    setIsError(false)
  }

  const publishBatch = async () => {
    const todo = queue.filter(item => item.status !== 'success')
    if (!todo.length) {
      setMessage('All files in this queue are already published.')
      setIsError(false)
      return
    }
    if (todo.some(item => !csvFileSupported(item.file))) {
      setMessage('Remove unsupported files. Only raw .csv and Hyperion-compatible .csv.enc files can be published.')
      setIsError(true)
      return
    }
    if (todo.some(item => !item.targetPath)) {
      setMessage('Some filenames did not match automatically. Select a target question set for every file before publishing.')
      setIsError(true)
      return
    }
    const duplicateTargets = new Set<string>()
    for (const item of todo) if (todo.some(other => other.id !== item.id && other.targetPath === item.targetPath)) duplicateTargets.add(item.targetPath)
    if (duplicateTargets.size) {
      setMessage('Two or more files target the same question set. Keep only one file per target.')
      setIsError(true)
      return
    }
    if (todo.some(item => !assetByPath.has(item.targetPath))) {
      setMessage('A selected target is not supported. Refresh the question-set list and try again.')
      setIsError(true)
      return
    }
    const overLimit = todo.filter(item => item.file.size > fileSizeLimit(item.file))
    if (overLimit.length) {
      setMessage('These files exceed their upload size limits: ' + overLimit.map(item => item.file.name).join(', '))
      setIsError(true)
      return
    }
    if (todo.length > 10) { setMessage('Publish up to 10 files at a time. This keeps validation and publication within the service limits.'); setIsError(true); return }
    const editorSources = todo.filter(item => !!item.baseHead)
    if (editorSources.length && (todo.length !== 1 || editorSources.length !== 1)) {
      setMessage('Publish direct-editor changes by themselves to protect against stale question banks.'); setIsError(true); return
    }
    setBusy(true)
    setIsError(false)
    try {
      const files = await Promise.all(todo.map(async item => ({ path: item.targetPath, format: isEncryptedCsv(item.file) ? 'encrypted' : 'csv', content: isEncryptedCsv(item.file) ? bytesToBase64(new Uint8Array(await item.file.arrayBuffer())) : await item.file.text() })))
      if (!preview) {
        const result = await call({ action: 'validate', requestId: crypto.randomUUID(), expectedHead: editorSources[0]?.baseHead, files })
        setPreview(result.preview)
        setMessage('Validation passed. Review the changes below, then publish this batch to GitHub.')
      } else {
        const selectedIds = new Set(todo.map(item => item.id))
        setQueue(old => old.map(item => !selectedIds.has(item.id) ? item : { ...item, status: 'publishing', error: undefined }))
        const result = await call({ action: 'publish', requestId: preview.requestId, expectedHead: preview.baseHead, validationId: preview.validationId, files })
        setQueue(old => old.map(item => !selectedIds.has(item.id) ? item : ({ ...item, status: 'success', questionCount: preview.files.find(row => row.path === item.targetPath)?.questionCount, error: undefined })))
        setPublishedLink(`https://github.com/${result.repository}/commit/${result.commit}`)
        setBatchResult({ attempted: todo.length, updated: todo.length, failed: 0 })
        setMessage('Published directly to the Android question-bank folder on GitHub. Website delivery and offline version checks will pick up the verified release within a few minutes. Existing saved study data is preserved.')
        setPreview(null)
        if (editorSources.length) { setEditorText(''); setEditorOriginalText(''); setEditorBaseHead(''); setEditorDraft(null) }
      }
    } catch (reason) {
      setIsError(true)
      if ((reason as { status?: number } | null)?.status === 409) setPreview(null)
      setMessage(reason instanceof Error ? reason.message : 'GitHub publication failed.')
      setQueue(old => old.map(item => item.status === 'publishing' ? { ...item, status: 'ready' } : item))
    } finally { setBusy(false) }
  }

  const card: React.CSSProperties = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '1rem', marginBottom: '1rem', minWidth: 0 }
  const secondaryText: React.CSSProperties = { color: 'var(--text-muted)', fontSize: '.84rem', lineHeight: 1.5 }
  const statusLabel: Record<QueueStatus, string> = { ready: 'READY', publishing: 'PUBLISHING…', success: 'PUBLISHED', error: 'FAILED' }


  return <div className="screen" style={{ width: 'min(calc(100% - 1rem), 1180px)', maxWidth: 1180, margin: '0 auto', paddingBottom: '2rem' }}>
    <style>{" .admin-qb-drop{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:190px;border:2px dashed var(--border);border-radius:10px;padding:1.25rem;text-align:center;background:var(--bg-elevated);transition:border-color .15s,background .15s}.admin-qb-drop.is-dragging{border-color:var(--accent);background:var(--bg-card)}.admin-qb-folder{border:1px solid var(--border);border-radius:8px;background:var(--bg-card);overflow:hidden}.admin-qb-folder-summary{display:flex;align-items:center;gap:.55rem;flex-wrap:wrap;list-style:none;cursor:pointer;padding:.7rem .8rem;min-height:28px}.admin-qb-folder-summary::-webkit-details-marker{display:none}.admin-qb-folder[open] .admin-qb-folder-summary{border-bottom:1px solid var(--border);background:var(--bg-elevated)}.admin-qb-folder-glyph{font-size:1rem}.admin-qb-folder-name{font-weight:850;font-size:.86rem}.admin-qb-folder-count{color:var(--text-muted);font-size:.78rem}.admin-qb-folder-state{margin-left:auto;font-size:.72rem;font-weight:850;color:var(--text-muted)}.admin-qb-folder-state.is-done{color:var(--success,#15803d)}.admin-qb-folder-state.has-error{color:var(--danger,#dc2626)}.admin-qb-folder-files{padding:.35rem .55rem}.admin-qb-file-row{display:grid;grid-template-columns:minmax(160px,1fr) minmax(200px,1.25fr) minmax(95px,.6fr) auto;gap:.55rem;align-items:center;padding:.5rem .35rem;border-bottom:1px solid var(--border);min-width:0}.admin-qb-file-row:last-child{border-bottom:0}.admin-qb-file-primary{display:flex;align-items:flex-start;gap:.45rem;min-width:0}.admin-qb-file-glyph{font-size:.9rem;margin-top:.05rem}.admin-qb-file-primary>div{display:flex;align-items:baseline;gap:.35rem .5rem;flex-wrap:wrap;min-width:0}.admin-qb-file-name{font-size:.8rem;overflow-wrap:anywhere}.admin-qb-file-size,.admin-qb-file-questions{font-size:.72rem;color:var(--text-muted)}.admin-qb-file-questions{color:var(--success,#15803d)}.admin-qb-target-label{font-size:.64rem;font-weight:850;color:var(--text-muted);min-width:0}.admin-qb-target-select{width:100%;margin-top:.18rem;background:var(--bg-elevated);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:.45rem;font:inherit;font-size:.76rem;min-width:0}.admin-qb-path{display:block;font-size:.67rem;font-weight:500;margin-top:.15rem;overflow-wrap:anywhere}.admin-qb-file-status{display:flex;flex-direction:column;align-items:flex-start;gap:.15rem;min-width:0}.admin-qb-status-pill{font-size:.67rem;font-weight:900}.admin-qb-status-pill.success{color:var(--success,#15803d)}.admin-qb-status-pill.error{color:var(--danger,#dc2626)}.admin-qb-status-pill.ready{color:var(--text-muted)}.admin-qb-status-pill.publishing{color:var(--accent)}.admin-qb-row-error{font-size:.68rem;color:var(--danger,#dc2626);overflow-wrap:anywhere}.admin-qb-backup-note{font-size:.66rem;color:var(--text-muted)}.admin-qb-remove{padding:.35rem .5rem;font-size:.72rem}.admin-qb-footer{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-top:.9rem;padding-top:.7rem;border-top:1px solid var(--border)}@media(max-width:800px){.admin-qb-file-row{grid-template-columns:minmax(0,1fr) auto;gap:.45rem}.admin-qb-target-label{grid-column:1/-1}.admin-qb-file-status{grid-column:1}.admin-qb-remove{grid-column:2;grid-row:3;justify-self:end}}"} </style>
    <AdminNavigation />
    <h1 className="page-title" style={{ textAlign: 'left' }}>Question Bank Update</h1>
    <p className="subtitle" style={{ textAlign: 'left' }}>Drag in raw .csv files or already-encrypted .csv.enc files, individually or in bulk. Hyperion matches filenames to question sets and validates each file before replacement.</p>
    {publisherReady === false && !loading && <div role="status" style={card}>Publishing needs the GITHUB_BANK_WRITE_TOKEN secret in Cloudflare. Your bank remains available for study.</div>}
    {message && <div role="status" aria-live="polite" style={{ ...card, borderColor: isError ? 'var(--danger, #dc2626)' : 'var(--success, #15803d)' }}>{message}</div>}
    <p style={secondaryText}>Files publish directly to <a href="https://github.com/Nhyle-zunne/hyperion-reviewer/tree/main/app/src/main/assets/questions" target="_blank" rel="noopener noreferrer">the shared Android question folder on GitHub</a>. Upload up to 10 files per release.</p>

    <section style={card} aria-label="Edit or retire questions directly">
      <h2 style={{ fontSize: '1.1rem', marginTop: 0 }}>Edit, retire or restore questions</h2>
      <p style={secondaryText}>Select a track and competence to change a question, its choices, correct answer, explanation or retirement status. The original question numbers and historical records stay untouched. Changes use the same encrypted GitHub validation and publication process as CSV uploads.</p>
      <div style={{ display: 'grid', gap: '.35rem', marginBottom: '.75rem' }}>
        <strong style={{ fontSize: '.82rem' }}>TRACK / COMPETENCE / PART</strong>
        <QuestionBankCombobox assets={assets} tracks={TRACKS} value={editorTarget}
          disabled={loading || busy || editorBusy}
          onChange={path => {
            setEditorTarget(path)
            setEditorText('')
            setEditorOriginalText('')
            setEditorBaseHead('')
            setEditorOrdinal(0)
            setEditorDraft(null)
            setEditorError('')
          }} />
      </div>
      <button type="button" className="btn btn-outline"
        disabled={!editorTarget || !assets.some(asset => asset.path === editorTarget) || !publisherReady || editorBusy || busy || loading}
        style={{
          opacity: !editorTarget ? .4 : 1,
          cursor: !editorTarget ? 'not-allowed' : 'pointer',
          pointerEvents: !editorTarget ? 'none' : undefined,
          transition: 'opacity .16s ease'
        }}
        onClick={() => void withPageLoading('Opening encrypted question bank for editing', loadEditor)}>
        {editorBusy ? 'OPENING…' : 'OPEN QUESTION BANK'}
      </button>
      {!editorTarget && <p style={{ fontSize: '.75rem', color: 'var(--text-muted)', margin: '.45rem 0 .1rem' }}>
        Choose a question bank above to enable this button.
      </p>}
      {editorError && <p role="alert" style={{ color: 'var(--danger, #dc2626)' }}>{editorError}</p>}
      {editorBank && <>
        <p style={secondaryText}>{editorBank.questions.length.toLocaleString()} historical questions · {editorBank.questions.filter(q => q.retired).length} retired · {editorText !== editorOriginalText ? 'Unsaved local draft changes' : 'No edits yet'}</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(170px, 1fr) minmax(0, 2fr)', gap: 12, alignItems: 'start' }}>
          <div style={{ maxHeight: 420, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 8 }}>
            <input aria-label="Find question by number or text" placeholder="Search question number or text…" value={editorSearch} onChange={event => setEditorSearch(event.target.value)}
              style={{ width: '100%', padding: 8, marginBottom: 8, background: 'var(--bg-elevated)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6 }} />
            <div style={{ display: 'grid', gap: 4 }}>
              {editorMatches.map(question => <button key={question.ordinal} type="button" disabled={busy} onClick={() => chooseEditorQuestion(question.ordinal)}
                style={{ textAlign: 'left', padding: '7px 9px', border: '1px solid var(--border)', borderRadius: 6, background: question.ordinal === editorOrdinal ? 'var(--bg-elevated)' : 'transparent', color: 'var(--text)', cursor: 'pointer' }}>
                <strong>#{question.ordinal}</strong> {question.retired ? '· Retired' : ''} · {question.questionText.slice(0, 74)}
              </button>)}
              {editorBank.questions.length > 150 && <p style={secondaryText}>Showing up to 150 matches. Search to find a specific question.</p>}
            </div>
          </div>
          {selectedEditorQuestion && editorDraft && <div style={{ display: 'grid', gap: 9, minWidth: 0 }}>
            <strong>Question #{selectedEditorQuestion.ordinal}</strong>
            <label>Question text<textarea value={editorDraft.questionText} rows={3} onChange={event => setEditorDraft({ ...editorDraft, questionText: event.target.value })}
              style={{ width: '100%', marginTop: 4, color: 'var(--text)', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, padding: 8 }} /></label>
            {editorDraft.options.map((option, index) => <label key={index} style={{ display: 'grid' }}>Choice {String.fromCharCode(65 + index)}
              <textarea rows={2} value={option} onChange={event => setEditorDraft({ ...editorDraft, options: editorDraft.options.map((value, i) => i === index ? event.target.value : value) })}
                style={{ color: 'var(--text)', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, padding: 8 }} />
            </label>)}
            <label>Correct answer
              <select value={editorDraft.correctAnswerIndex} className="admin-qb-target-select" onChange={event => setEditorDraft({ ...editorDraft, correctAnswerIndex: Number(event.target.value) })}>
                {editorDraft.options.map((_, i) => <option key={i} value={i}>{String.fromCharCode(65 + i)}</option>)}
              </select>
            </label>
            <label>Explanation<textarea rows={3} value={editorDraft.explanation} onChange={event => setEditorDraft({ ...editorDraft, explanation: event.target.value })}
              style={{ width: '100%', marginTop: 4, color: 'var(--text)', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, padding: 8 }} /></label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={editorDraft.retired} disabled={selectedEditorQuestion.fixedLegacyRetirement} onChange={event => setEditorDraft({ ...editorDraft, retired: event.target.checked })} />
              <strong>Retired (exclude from new study sessions)</strong>
            </label>
            {selectedEditorQuestion.fixedLegacyRetirement && <p style={secondaryText}>This is one of the three original C10 retirements, which remain enforced by the packaged Android application and cannot be restored here.</p>}
            <p style={secondaryText}>Restoring an item allows it in future sessions. Existing bookmarks and History are never deleted. Always apply this edit before selecting another question.</p>
            <button type="button" className="btn btn-outline" disabled={busy} onClick={applyEditorDraft}>APPLY QUESTION EDIT TO DRAFT</button>
          </div>}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <button type="button" className="btn btn-primary" disabled={busy || editorBusy || !editorBaseHead || editorText === editorOriginalText} onClick={queueEditorChanges}>
            ADD EDITED QUESTIONS TO PUBLISH QUEUE
          </button>
        </div>
      </>}
      <p style={{ ...secondaryText, marginBottom: 0 }}>Android installations still require a new app release to receive edited packaged bank content. The website receives the next verified bank revision automatically.</p>
    </section>
    <section style={card}>
      <div className={'admin-qb-drop' + (dragging ? ' is-dragging' : '')}
        onDragOver={event => { event.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={event => { event.preventDefault(); setDragging(false); addFiles(event.dataTransfer.files) }}>
        <strong style={{ fontSize: '1.05rem' }}>Drag and drop CSV files here</strong>
        <p style={{ ...secondaryText, margin: '.4rem 0 .8rem' }}>Drop several files at once, or choose multiple files from your computer.</p>
        <button type="button" className="btn btn-primary" disabled={loading || busy} onClick={() => pickerRef.current?.click()}>CHOOSE CSV FILES</button>
        <input ref={pickerRef} type="file" accept=".csv,.csv.enc,text/csv,application/octet-stream" multiple hidden disabled={loading || busy}
          onChange={event => { if (event.currentTarget.files) addFiles(event.currentTarget.files); event.currentTarget.value = '' }} />
      </div>
      <p style={secondaryText}>Use raw .csv files or original Hyperion-compatible .csv.enc files. Names such as <code>oic_nw_c1.csv</code>, <code>dm_c6.csv</code>, <code>ew_c4.csv</code>, <code>em_c3.csv</code>, and <code>c1_part1.csv</code> are matched automatically. You can choose the target manually if a filename differs.</p>
    </section>
    <section style={card}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Upload queue ({queue.length})</h2>
          {!!queue.length && <p style={{ ...secondaryText, margin: '.25rem 0 0' }}>{queue.length} files · {(totalBytes / 1024).toFixed(1)} KB · {successCount} published · {problemCount} need attention</p>}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-outline" disabled={loading || busy} onClick={() => void withPageLoading('Refreshing question-bank inventory', () => loadAssets())}>Refresh question sets</button>
          <button type="button" className="btn btn-outline" disabled={busy || !queue.length} onClick={() => { setQueue([]); setBatchResult(null); setMessage(''); setIsError(false) }}>Clear queue</button>
        </div>
      </div>

      {batchResult && !busy && <div role="status" aria-live="polite" style={{
        display: 'flex', alignItems: 'flex-start', gap: '.65rem', marginTop: '.8rem', padding: '.8rem .9rem', borderRadius: 8,
        border: '1px solid ' + (batchResult.failed ? 'var(--danger, #dc2626)' : 'var(--success, #15803d)'),
        background: 'var(--bg-elevated)'
      }}>
        <strong style={{ fontSize: '1.1rem', color: batchResult.failed ? 'var(--danger, #dc2626)' : 'var(--success, #15803d)' }}>{batchResult.failed ? '!' : '✓'}</strong>
        <div style={{ minWidth: 0 }}>
          <strong>{batchResult.failed === 0 && queue.length > 0 && queue.every(item => item.status === 'success')
            ? 'All ' + queue.length + ' files updated successfully.'
            : 'Batch finished: ' + batchResult.updated + ' updated, ' + batchResult.failed + ' failed.'}</strong>
          <div style={{ ...secondaryText, marginTop: '.15rem' }}>{batchResult.failed === 0
            ? 'The verified release is committed to the shared Android asset folder. Previous encrypted versions remain in GitHub history.'
            : 'Successful files are already updated. Expand the folders marked with failures and retry only those files.'}</div>
        </div>
      </div>}

      {loading && <p style={secondaryText}>Loading supported question sets…</p>}
      {!loading && !queue.length && <p style={secondaryText}>No files added yet. Drop your CSV files above to get started.</p>}

      {!!queue.length && <div style={{ marginTop: '.75rem', display: 'grid', gap: '.45rem' }}>
        {queueGroups.map(group => {
          const published = group.items.filter(item => item.status === 'success').length
          const failed = group.items.filter(item => item.status === 'error').length
          const openInitially = group.items.some(item => item.status === 'error' || !item.targetPath || !!item.error)
          return <details key={group.key} className="admin-qb-folder" open={openInitially || undefined}>
            <summary className="admin-qb-folder-summary">
              <span className="admin-qb-folder-glyph" aria-hidden="true">📁</span>
              <span className="admin-qb-folder-name">{group.label}</span>
              <span className="admin-qb-folder-count">{group.items.length} file{group.items.length === 1 ? '' : 's'}</span>
              <span className={'admin-qb-folder-state' + (failed ? ' has-error' : published === group.items.length ? ' is-done' : '')}>
                {failed ? failed + ' failed' : published === group.items.length ? 'Published' : published + '/' + group.items.length + ' published'}
              </span>
            </summary>
            <div className="admin-qb-folder-files">
              {group.items.map(item => {
                const target = assetByPath.get(item.targetPath)
                const duplicate = !!item.targetPath && duplicatePaths.has(item.targetPath) && item.status !== 'success'
                const tooLarge = item.file.size > fileSizeLimit(item.file)
                const rowError = item.error || (tooLarge ? (isEncryptedCsv(item.file) ? 'Encrypted file exceeds 1 MiB.' : 'Raw CSV exceeds 700 KB.') : duplicate ? 'Duplicate target in this batch.' : !item.targetPath ? 'Choose a destination.' : '')
                const unsupported = !csvFileSupported(item.file)
                return <div key={item.id} className="admin-qb-file-row">
                  <div className="admin-qb-file-primary">
                    <span className="admin-qb-file-glyph" aria-hidden="true">📄</span>
                    <div style={{ minWidth: 0 }}>
                      <strong className="admin-qb-file-name">{item.file.name}</strong>
                      <span className="admin-qb-file-size">{(item.file.size / 1024).toFixed(1)} KB</span>
                      {item.questionCount != null && <span className="admin-qb-file-questions">{item.questionCount.toLocaleString()} rows</span>}
                    </div>
                  </div>
                  <label className="admin-qb-target-label">DESTINATION
                    <select value={item.targetPath} disabled={busy || item.status === 'success' || unsupported} onChange={event => updateTarget(item.id, event.target.value)} className="admin-qb-target-select">
                      <option value="">Choose target…</option>
                      {TRACKS.map(([track, label]) => <optgroup key={track} label={label}>
                        {assets.filter(asset => asset.track === track).map(asset => <option key={asset.path} value={asset.path}>{asset.label}</option>)}
                      </optgroup>)}
                    </select>
                    {target && <span className="admin-qb-path">{target.repositoryPath || target.path}</span>}
                  </label>
                  <div className="admin-qb-file-status">
                    <span className={'admin-qb-status-pill ' + item.status}>{statusLabel[item.status]}</span>
                    {rowError && item.status !== 'success' && <span className="admin-qb-row-error">{rowError}</span>}
                  </div>
                  <button type="button" className="btn btn-outline admin-qb-remove" disabled={busy} onClick={() => { setPreview(null); setQueue(old => old.filter(row => row.id !== item.id)); setBatchResult(null) }} aria-label={'Remove ' + item.file.name}>Remove</button>
                </div>
              })}
            </div>
          </details>
        })}
      </div>}

      {preview && <section className="card" aria-label="Validated question-bank changes" style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: '1.1rem' }}>Review before publishing</h2>
        <p style={secondaryText}>Destination: Android shared question assets on GitHub. Existing saved records are not modified. Files publish together or the live release stays unchanged.</p>
        {preview.files.map(file => <details key={file.path} style={{ margin: '12px 0' }}>
          <summary><strong>{file.path}</strong> · {file.questionCount.toLocaleString()} questions · {file.changed} corrected · {file.appended} appended{file.explanationsPreserved ? ` · ${file.explanationsPreserved} explanations preserved` : ''}{file.staleExplanationsCleared ? ` · ${file.staleExplanationsCleared} stale explanations cleared` : ''}</summary>
          {file.corrections.map(change => <div key={change.number} style={{ margin: '10px 0', padding: 10, borderLeft: '3px solid var(--accent)' }}><strong>Question {change.number}</strong>{(['before', 'after'] as const).map(side => <div key={side} style={{ margin: '8px 0' }}><strong>{side === 'before' ? 'Previous' : 'Updated'}</strong><p>{change[side].questionText}</p><ol type="A">{change[side].options.map((option, index) => <li key={index} style={{ color: index === change[side].correctAnswerIndex ? 'var(--accent)' : 'var(--text)' }}>{option}{index === change[side].correctAnswerIndex ? ' · Correct answer' : ''}</li>)}</ol>{change[side].explanation && <p style={secondaryText}>{change[side].explanation}</p>}{change[side].isRetired && <strong style={{ color: 'var(--danger, #dc2626)' }}>Retired from new sessions</strong>}</div>)}</div>)}
          {file.changed > file.corrections.length && <p style={secondaryText}>Showing the first {file.corrections.length} text previews. Review the full uploaded file for all {file.changed} corrections, including answer changes.</p>}
        </details>)}
      </section>}
      {publishedLink && <p><a href={publishedLink} target="_blank" rel="noopener noreferrer">View the published GitHub commit</a></p>}
      {!!queue.length && <div className="admin-qb-footer">
        <p style={{ ...secondaryText, margin: 0 }}>Up to 10 files publish together as one verified GitHub release. Raw CSV limit: 700 KB; encrypted CSV limit: 1 MiB; combined files limit: 8 MiB.</p>
        <button type="button" className="btn btn-primary" disabled={busy || loading || !publisherReady || !hasUnpublishedFiles}
          title={allFilesUpdated ? 'All files in this queue are already published. Add a new file to publish again.' : undefined}
          style={allFilesUpdated ? { opacity: 0.45, cursor: 'not-allowed', pointerEvents: 'none', filter: 'grayscale(1)', boxShadow: 'none', transform: 'none' } : undefined}
          onClick={() => void withPageLoading(preview ? 'Publishing question updates' : 'Validating question updates', () => publishBatch())}>
          {busy ? (preview ? 'PUBLISHING BATCH…' : 'VALIDATING BATCH…')
            : allFilesUpdated ? 'ALL FILES UPDATED ✓'
              : queue.some(item => item.status === 'error') && !queue.some(item => item.status === 'ready') ? 'RETRY FAILED FILES'
                : preview ? 'PUBLISH VERIFIED BATCH TO GITHUB' : 'VALIDATE BATCH'}
        </button>
      </div>}
    </section>
    <section style={{ ...card, background: 'var(--bg-elevated)' }}>
      <strong>Before publishing</strong>
      <p style={{ ...secondaryText, marginBottom: 0 }}>Files publish directly to hyperion-reviewer/app/src/main/assets/questions, never Supabase Storage. Existing valid rows cannot be removed or reordered. Review in-place corrections carefully: changing a question’s meaning cannot be distinguished automatically from replacing it. Append new questions at the end. GitHub keeps prior encrypted versions; offline packs update automatically after a complete verified replacement is prepared.</p>
    </section>
  </div>
}
