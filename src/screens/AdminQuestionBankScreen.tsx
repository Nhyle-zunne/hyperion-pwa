import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import EditorTextarea from '../components/EditorTextarea'
import '../styles/admin-question-editor.css'
import QuestionImageGallery from '../components/QuestionImageGallery'
import AdminNavigation from '../components/AdminNavigation'
import { isAllQuestionBankScope, questionBankScopeTrack } from '../lib/questionBankPicker'
import type { AdminSearchResult } from '../../worker/adminQuestionSearch'
import QuestionBankCombobox from '../components/QuestionBankCombobox'
import { supabase } from '../lib/supabase'
import { withPageLoading } from '../lib/pageLoading'
import { editBankQuestion, readEditableBank, type QuestionEdit } from '../lib/questionBankEditor'
import { QUESTION_MEDIA_LIMIT, mediaTrackForBankPath } from '../lib/questionMedia'
import { uploadQuestionImage, type ImageUploadProgress } from '../lib/questionMediaUpload'

type Asset = { path: string; label: string; track: string; competenceId: string; part: number | null; format: 'standard' | 'gmdss'; repositoryPath?: string }
type QuestionPreview = { questionText: string; options: string[]; correctAnswerIndex: number; explanation?: string; isRetired?: boolean }
type Preview = { requestId: string; baseHead: string; validationId: string; files: { path: string; questionCount: number; previousCount: number; changed: number; appended: number; explanationsPreserved?: number; staleExplanationsCleared?: number; corrections: { number: number; before: QuestionPreview; after: QuestionPreview }[] }[] }
type QueueStatus = 'ready' | 'publishing' | 'success' | 'error'
type QueueItem = { id: string; file: File; targetPath: string; status: QueueStatus; error?: string; questionCount?: number; baseHead?: string; bankRevision?: string }
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
  const imagePickerRef = useRef<HTMLInputElement>(null)
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
  const [pickerValue, setPickerValue] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<AdminSearchResult[]>([])
  const [searchRevision, setSearchRevision] = useState('')
  const [searchBusy, setSearchBusy] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [searchSummary, setSearchSummary] = useState('')
  const searchAbort = useRef<AbortController | null>(null)
  const editorLayoutRef = useRef<HTMLDivElement>(null)
  const editorFormRef = useRef<HTMLFieldSetElement>(null)
  const allScope = isAllQuestionBankScope(pickerValue)
  const [editorTarget, setEditorTarget] = useState('')
  const [editorText, setEditorText] = useState('')
  const [editorOriginalText, setEditorOriginalText] = useState('')
  const [editorBaseHead, setEditorBaseHead] = useState('')
  const [editorRevision, setEditorRevision] = useState('')
  const [editorSearch, setEditorSearch] = useState('')
  const [editorOrdinal, setEditorOrdinal] = useState(0)
  const [editorDraft, setEditorDraft] = useState<QuestionEdit | null>(null)
  const [editorBusy, setEditorBusy] = useState(false)
  const imageUploadAbort = useRef<AbortController | null>(null)
  const [imageProgress, setImageProgress] = useState<ImageUploadProgress | null>(null)
  const [imageUploading, setImageUploading] = useState(false)
  const [imageAlt, setImageAlt] = useState('')
  const [imagePlacement, setImagePlacement] = useState<'question' | 'explanation'>('question')
  const selectedImageUpload = useRef({ path: '', ordinal: 0 })
  selectedImageUpload.current = { path: editorTarget, ordinal: editorOrdinal }
  useEffect(() => {
    setImageProgress(null)
    return () => { imageUploadAbort.current?.abort() }
  }, [editorTarget, editorOrdinal])
  const editorImageTrack = mediaTrackForBankPath(editorTarget)
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
  // The form is separate from the staged CSV draft. Do not silently queue
  // old CSV bytes or discard typed edits when switching questions.
  const editorFormDirty = !!(selectedEditorQuestion && editorDraft && (
    editorDraft.questionText.trim() !== selectedEditorQuestion.questionText ||
    editorDraft.correctAnswerIndex !== selectedEditorQuestion.correctAnswerIndex ||
    editorDraft.explanation !== selectedEditorQuestion.explanation ||
    editorDraft.retired !== selectedEditorQuestion.retired ||
    JSON.stringify(editorDraft.imageAttachments || []) !== JSON.stringify(selectedEditorQuestion.imageAttachments) ||
    editorDraft.options.length !== selectedEditorQuestion.options.length ||
    editorDraft.options.some((option, i) => option.trim() !== selectedEditorQuestion.options[i])
  ))
  useEffect(() => {
    const form = editorFormRef.current
    if (!form) return
    const resize = () => editorLayoutRef.current?.style.setProperty('--editor-form-height', `${Math.ceil(form.getBoundingClientRect().height)}px`)
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(form)
    return () => observer.disconnect()
  }, [editorTarget, editorOrdinal, !!editorBank])
  useEffect(() => () => searchAbort.current?.abort(), [])
  const editorHasAppliedEdits = !!editorText && editorText !== editorOriginalText
  const editorDraftQueued = queue.some(item => !!item.baseHead && item.targetPath === editorTarget && item.status !== 'success')
  const updateEditorDraft = (draft: QuestionEdit) => {
    setEditorDraft(draft)
    setQueue(old => old.filter(item => !(item.baseHead && item.targetPath === editorTarget && item.status !== 'success')))
    setPreview(null)
    setBatchResult(null)
    setEditorError('')
    setEditorNotice(null)
  }

  const call = useCallback(async (body: Record<string, unknown>, signal?: AbortSignal) => {
    if (!supabase) throw new Error('Question-bank administration is not configured.')
    const { data: auth } = await supabase.auth.getSession()
    if (!auth.session?.access_token) throw new Error('Sign in with your administrator account.')
    const response = await fetch('/api/question-bank/admin', { method: 'POST', headers: { Authorization: 'Bearer ' + auth.session.access_token, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal })
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


  const mayLeaveEditor = () => {
    if (imageUploading || editorFormDirty || (editorHasAppliedEdits && !editorDraftQueued)) {
      setEditorNotice({ kind: 'error', text: 'Add current changes to the publish queue or discard them before opening another question bank.' })
      return false
    }
    return true
  }

  const loadEditor = async (path = editorTarget, ordinal = 1, expectedRevision?: string) => {
    if (!path || !assets.some(asset => asset.path === path) || !mayLeaveEditor()) return
    const queuedDraft = queue.find(item => item.baseHead && item.targetPath === path && item.status !== 'success')
    if (expectedRevision && ((path === editorTarget && editorBank && editorRevision !== expectedRevision && (editorHasAppliedEdits || editorDraftQueued)) || (queuedDraft?.bankRevision && queuedDraft.bankRevision !== expectedRevision))) {
      setEditorError('This bank changed since your draft was opened. Your edits are preserved. Clear its queue and discard the bank draft before reopening updated search results.')
      return
    }
    if (path === editorTarget && editorBank && (!expectedRevision || editorRevision === expectedRevision)) { chooseEditorQuestion(ordinal); return }
    setEditorBusy(true)
    setEditorError('')
    setEditorNotice(null)
    try {
      const result = await call({ action: 'editor-load', path })
      if (result.path !== path || typeof result.csvText !== 'string' || !/^[a-f0-9]{40}$/.test(result.baseHead || '') || !/^[a-f0-9]{40}$/.test(result.bankRevision || '')) throw new Error('The question editor received an invalid source revision.')
      if (expectedRevision && result.bankRevision !== expectedRevision) throw new Error('The question bank changed. Search again before opening this result.')
      const queued = queue.find(item => item.baseHead && item.targetPath === path && item.status !== 'success')
      if (queued?.bankRevision && queued.bankRevision !== result.bankRevision) throw new Error('This queued draft belongs to an older bank version. Clear it before reopening this bank.')
      const text = queued ? await queued.file.text() : result.csvText
      const bank = readEditableBank(path, text)
      const selected = bank.questions.find(question => question.ordinal === ordinal)
      if (!selected) throw new Error('This question is no longer available. Search again.')
      setEditorTarget(path)
      setEditorText(text)
      setEditorOriginalText(result.csvText)
      setEditorBaseHead(queued?.baseHead || result.baseHead)
      setEditorRevision(result.bankRevision)
      setEditorOrdinal(selected.ordinal)
      setEditorSearch('')
      setEditorDraft({ questionText: selected.questionText, options: selected.options.slice(), correctAnswerIndex: selected.correctAnswerIndex, explanation: selected.explanation, retired: selected.retired, imageAttachments: selected.imageAttachments })
      setMessage(queued ? 'Queued draft opened. Your earlier edits are preserved.' : 'Question set loaded securely. Changes are drafts until you validate and publish.')
      setIsError(false)
    } catch (reason) {
      setEditorError(reason instanceof Error ? reason.message : 'The question set could not be opened.')
    } finally { setEditorBusy(false) }
  }

  const searchAcrossBanks = async () => {
    if (!allScope || searchBusy) return
    searchAbort.current?.abort()
    const controller = new AbortController()
    searchAbort.current = controller
    setSearchBusy(true)
    setSearchResults([])
    setSearchSummary('')
    setSearchError('')
    const collected: AdminSearchResult[] = []
    let cursor = 0, revision: string | undefined
    let truncated = false
    try {
      for (let page = 0; page < assets.length + 1; page++) {
        const track = questionBankScopeTrack(pickerValue)
        const reply = await call({ action: 'editor-search', query: searchQuery, ...(track ? { track } : {}), limit: 100 - collected.length, cursor, ...(revision ? { bankRevision: revision } : {}) }, controller.signal)
        if (!Array.isArray(reply.results) || typeof reply.bankRevision !== 'string' || !/^[a-f0-9]{40}$/.test(reply.bankRevision) || (revision && revision !== reply.bankRevision)) throw new Error('The search result changed. Please search again.')
        if (reply.results.some((item: AdminSearchResult) => !item || typeof item !== 'object' || !assets.some(asset => asset.path === item.path && asset.track === item.track && asset.competenceId === item.competenceId && asset.part === item.part) || !Number.isSafeInteger(item.ordinal) || item.ordinal < 1 || typeof item.questionText !== 'string')) throw new Error('The search returned invalid question references.')
        revision = reply.bankRevision
        collected.push(...reply.results)
        if (collected.length > 100) throw new Error('The search response exceeded its limit.')
        truncated = reply.truncated === true
        if (collected.length === 100 || reply.nextCursor == null) { truncated ||= reply.nextCursor != null; break }
        if (!Number.isSafeInteger(reply.nextCursor) || reply.nextCursor <= cursor || reply.nextCursor > assets.length) throw new Error('The search returned an invalid continuation.')
        cursor = reply.nextCursor
      }
      if (controller.signal.aborted) return
      setSearchResults(collected)
      setSearchRevision(revision || '')
      setSearchSummary(`${collected.length} matching question${collected.length === 1 ? '' : 's'}${truncated ? ' · Showing the first 100; narrow your search for more.' : ''}`)
    } catch (error) {
      if (!controller.signal.aborted) setSearchError(error instanceof Error ? error.message : 'Question search is unavailable. Please retry.')
    } finally { if (!controller.signal.aborted) setSearchBusy(false) }
  }

  const chooseEditorQuestion = (ordinal: number) => {
    if (imageUploading) { setEditorNotice({kind:'info',text:'Complete the image upload before switching questions.'}); return }
    if (ordinal !== editorOrdinal && editorFormDirty) {
      setEditorNotice({ kind: 'error', text: `Question #${editorOrdinal} has changes that are not queued. Add them to the publish queue or discard them before selecting another question.` })
      return
    }
    const question = editorBank?.questions.find(q => q.ordinal === ordinal)
    if (!question) return
    setEditorOrdinal(ordinal)
    setEditorDraft({ questionText: question.questionText, options: question.options.slice(), correctAnswerIndex: question.correctAnswerIndex, explanation: question.explanation, retired: question.retired, imageAttachments: question.imageAttachments })
    setEditorError('')
    setEditorNotice(null)
  }

  const attachImageToEditor = async (file: File) => {
    if (!editorDraft || !selectedEditorQuestion || !editorTarget) return
    const track = mediaTrackForBankPath(editorTarget)
    if (!track) {setEditorError('Select a supported question bank before uploading an image.');return}
    if ((editorDraft.imageAttachments?.length || 0) >= QUESTION_MEDIA_LIMIT) {
      setEditorError('Each question supports up to four images. Remove one before uploading another.')
      return
    }
    const target = {path:editorTarget,ordinal:editorOrdinal}
    const alt = imageAlt.trim() || `${imagePlacement === 'question' ? 'Diagram' : 'Explanation diagram'} for question ${editorOrdinal}`
    const placement = imagePlacement
    const controller = new AbortController()
    imageUploadAbort.current = controller
    setImageUploading(true)
    setQueue(old => old.filter(item => !(item.baseHead && item.targetPath === editorTarget && item.status !== 'success')))
    setPreview(null)
    setBatchResult(null)
    setEditorError('')
    try {
      const ref = await uploadQuestionImage(track, file, placement, alt, {
        signal: controller.signal,
        onProgress: progress => {
          if (!controller.signal.aborted) setImageProgress(progress)
        }
      })
      if (selectedImageUpload.current.path !== target.path ||
          selectedImageUpload.current.ordinal !== target.ordinal) {
        setEditorNotice({kind:'info',text:'Image saved privately, but the selected question changed. Reopen it before attaching.'})
        return
      }
      setEditorDraft(prev => {
        if (!prev) return null
        const images = prev.imageAttachments || []
        return {...prev,imageAttachments:[
          ...images.filter(image=>image.sha256!==ref.sha256 || image.placement!==ref.placement),ref
        ]}
      })
      setImageAlt('')
      setEditorNotice({kind:'success',text:'Image uploaded. Add the edited question to the publish queue when ready.'})
    } catch (error) {
      if (controller.signal.aborted) return
      setImageProgress(null)
      setEditorError(error instanceof Error ? error.message : 'Image upload failed.')
    } finally {setImageUploading(false)}
  }

  const queueEditorChanges = () => {
    const feedback = (text: string) => { setEditorError(''); setEditorNotice({ kind: 'error', text }) }
    if (busy || editorBusy || imageUploading) return
    if (!editorBank || !editorDraft || !selectedEditorQuestion || !editorTarget || !editorBaseHead) {
      feedback('Open a question bank before adding changes to the queue.')
      return
    }
    if (!editorFormDirty && !editorHasAppliedEdits) {
      feedback('No changes to queue. Change the question, choices, image or explanation first.')
      return
    }
    if (queue.some(item => item.status !== 'success' && item.targetPath !== editorTarget)) {
      feedback('Publish or clear the existing upload queue first. An edited question set cannot be mixed with another upload.')
      return
    }
    try {
      const updated = editorFormDirty ? editBankQuestion(editorBank, editorOrdinal, editorDraft) : editorText
      const next = readEditableBank(editorTarget, updated)
      const selection = next.questions.find(q => q.ordinal === editorOrdinal)
      if (!selection || next.questions.length !== editorBank.questions.length ||
          next.questions.some((item, i) => item.ordinal !== editorBank.questions[i].ordinal || item.rowIndex !== editorBank.questions[i].rowIndex)) {
        throw Error('The question-bank structure changed. The edit was not queued.')
      }
      const file = new File([updated], rawCsvName(editorTarget), { type: 'text/csv' })
      if (file.size > MAX_FILE_BYTES) throw Error('This edited CSV exceeds 700 KB. The current draft was not queued.')
      setEditorText(updated)
      setEditorDraft({ questionText: selection.questionText, options: selection.options.slice(), correctAnswerIndex: selection.correctAnswerIndex, explanation: selection.explanation, retired: selection.retired, imageAttachments: selection.imageAttachments })
      setQueue(old => [...old.filter(item => item.targetPath !== editorTarget || item.status === 'success'), {
        id: 'editor-' + crypto.randomUUID(), file, targetPath: editorTarget, status: 'ready', baseHead: editorBaseHead, bankRevision: editorRevision
      }])
      setPreview(null)
      setBatchResult(null)
      setEditorError('')
      setEditorNotice({ kind: 'success', text: `Question #${editorOrdinal} saved in the publish queue. Nothing is published until you validate and publish.` })
      setMessage('Edited questions queued. Validate and review before publishing.')
      setIsError(false)
    } catch (reason) {
      feedback(reason instanceof Error ? reason.message : 'This question could not be queued.')
    }
  }

  const publishBatch = async () => {
    if (imageUploading) { setMessage('Finish the image upload and add the edited question to the queue before validating.'); setIsError(true); return }
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

  const card: React.CSSProperties = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '.8rem', marginBottom: '.75rem', minWidth: 0 }
  const secondaryText: React.CSSProperties = { color: 'var(--text-muted)', fontSize: '.84rem', lineHeight: 1.5 }
  const statusLabel: Record<QueueStatus, string> = { ready: 'READY', publishing: 'PUBLISHING…', success: 'PUBLISHED', error: 'FAILED' }


  return <div className="screen admin-qb-page">
    <style>{" .admin-qb-drop{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:190px;border:2px dashed var(--border);border-radius:10px;padding:1.25rem;text-align:center;background:var(--bg-elevated);transition:border-color .15s,background .15s}.admin-qb-drop.is-dragging{border-color:var(--accent);background:var(--bg-card)}.admin-qb-folder{border:1px solid var(--border);border-radius:8px;background:var(--bg-card);overflow:hidden}.admin-qb-folder-summary{display:flex;align-items:center;gap:.55rem;flex-wrap:wrap;list-style:none;cursor:pointer;padding:.7rem .8rem;min-height:28px}.admin-qb-folder-summary::-webkit-details-marker{display:none}.admin-qb-folder[open] .admin-qb-folder-summary{border-bottom:1px solid var(--border);background:var(--bg-elevated)}.admin-qb-folder-glyph{font-size:1rem}.admin-qb-folder-name{font-weight:850;font-size:.86rem}.admin-qb-folder-count{color:var(--text-muted);font-size:.78rem}.admin-qb-folder-state{margin-left:auto;font-size:.72rem;font-weight:850;color:var(--text-muted)}.admin-qb-folder-state.is-done{color:var(--success,#15803d)}.admin-qb-folder-state.has-error{color:var(--danger,#dc2626)}.admin-qb-folder-files{padding:.35rem .55rem}.admin-qb-file-row{display:grid;grid-template-columns:minmax(160px,1fr) minmax(200px,1.25fr) minmax(95px,.6fr) auto;gap:.55rem;align-items:center;padding:.5rem .35rem;border-bottom:1px solid var(--border);min-width:0}.admin-qb-file-row:last-child{border-bottom:0}.admin-qb-file-primary{display:flex;align-items:flex-start;gap:.45rem;min-width:0}.admin-qb-file-glyph{font-size:.9rem;margin-top:.05rem}.admin-qb-file-primary>div{display:flex;align-items:baseline;gap:.35rem .5rem;flex-wrap:wrap;min-width:0}.admin-qb-file-name{font-size:.8rem;overflow-wrap:anywhere}.admin-qb-file-size,.admin-qb-file-questions{font-size:.72rem;color:var(--text-muted)}.admin-qb-file-questions{color:var(--success,#15803d)}.admin-qb-target-label{font-size:.64rem;font-weight:850;color:var(--text-muted);min-width:0}.admin-qb-target-select{width:100%;margin-top:.18rem;background:var(--bg-elevated);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:.45rem;font:inherit;font-size:.76rem;min-width:0}.admin-qb-path{display:block;font-size:.67rem;font-weight:500;margin-top:.15rem;overflow-wrap:anywhere}.admin-qb-file-status{display:flex;flex-direction:column;align-items:flex-start;gap:.15rem;min-width:0}.admin-qb-status-pill{font-size:.67rem;font-weight:900}.admin-qb-status-pill.success{color:var(--success,#15803d)}.admin-qb-status-pill.error{color:var(--danger,#dc2626)}.admin-qb-status-pill.ready{color:var(--text-muted)}.admin-qb-status-pill.publishing{color:var(--accent)}.admin-qb-row-error{font-size:.68rem;color:var(--danger,#dc2626);overflow-wrap:anywhere}.admin-qb-backup-note{font-size:.66rem;color:var(--text-muted)}.admin-qb-remove{padding:.35rem .5rem;font-size:.72rem}.admin-qb-footer{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-top:.9rem;padding-top:.7rem;border-top:1px solid var(--border)}@media(max-width:800px){.admin-qb-file-row{grid-template-columns:minmax(0,1fr) auto;gap:.45rem}.admin-qb-target-label{grid-column:1/-1}.admin-qb-file-status{grid-column:1}.admin-qb-remove{grid-column:2;grid-row:3;justify-self:end}}"} </style>

    <AdminNavigation />
    <h1 className="page-title" style={{ textAlign: 'left' }}>Question Bank Update</h1>
    <p className="subtitle" style={{ textAlign: 'left' }}>Edit questions or upload CSV files. Changes stay in the queue until you validate and publish.</p>
    {publisherReady === false && !loading && <div role="status" style={card}>Publishing needs the GITHUB_BANK_WRITE_TOKEN secret in Cloudflare. Your bank remains available for study.</div>}
    {message && <div role="status" aria-live="polite" style={{ ...card, borderColor: isError ? 'var(--danger, #dc2626)' : 'var(--success, #15803d)' }}>{message}</div>}
    <p style={secondaryText}>Files publish directly to <a href="https://github.com/Nhyle-zunne/hyperion-reviewer/tree/main/app/src/main/assets/questions" target="_blank" rel="noopener noreferrer">the shared Android question folder on GitHub</a>. Upload up to 10 files per release.</p>

    <section style={card} aria-label="Edit or retire questions directly">
      <h2 style={{ fontSize: '1.1rem', marginTop: 0 }}>Edit, retire or restore questions</h2>
      <p style={secondaryText}>Choose a question, make your changes and add them to the publish queue. Question numbers and saved history are preserved.</p>
      <div style={{ display: 'grid', gap: '.35rem', marginBottom: '.75rem' }}>
        <strong style={{ fontSize: '.82rem' }}>TRACK / COMPETENCE / PART</strong>
        <QuestionBankCombobox assets={assets} tracks={TRACKS} value={pickerValue}
          disabled={loading || busy || editorBusy || searchBusy || imageUploading}
          onChange={path => {
            if (path === pickerValue || !mayLeaveEditor()) return
            searchAbort.current?.abort()
            setSearchResults([])
            setSearchError('')
            setSearchSummary('')
            setSearchQuery('')
            setPickerValue(path)
            setEditorTarget(isAllQuestionBankScope(path) ? '' : path)
            setEditorText('')
            setEditorOriginalText('')
            setEditorBaseHead('')
            setEditorRevision('')
            setEditorOrdinal(0)
            setEditorDraft(null)
            setEditorError('')
            setEditorNotice(null)
          }} />
      </div>
      {!allScope && <button type="button" className="btn btn-outline"
        disabled={!editorTarget || !assets.some(asset => asset.path === editorTarget) || !publisherReady || editorBusy || busy || loading}
        style={{
          opacity: !editorTarget ? .4 : 1,
          cursor: !editorTarget ? 'not-allowed' : 'pointer',
          pointerEvents: !editorTarget ? 'none' : undefined,
          transition: 'opacity .16s ease'
        }}
        onClick={() => void withPageLoading('Opening encrypted question bank for editing', () => loadEditor())}>
        {editorBusy ? 'OPENING…' : 'OPEN QUESTION BANK'}
      </button>}
      {!pickerValue && <p style={{ fontSize: '.75rem', color: 'var(--text-muted)', margin: '.45rem 0 .1rem' }}>
        Choose a question bank above to enable this button.
      </p>}
      {editorError && <p role="alert" style={{ color: 'var(--danger, #dc2626)' }}>{editorError}</p>}
      {(editorBank || allScope) && <>
        {editorBank && <p style={secondaryText}>{editorBank.questions.length.toLocaleString()} historical questions · {editorBank.questions.filter(q => q.retired).length} retired · {editorFormDirty ? 'Unsaved form changes' : editorHasAppliedEdits ? 'Draft edits saved' : 'No edits yet'}{editorDraftQueued ? ' · In publish queue' : ''}</p>}
        <div className="admin-qb-editor-layout" ref={editorLayoutRef}>
          <aside className="admin-qb-question-list" aria-label="Question search results">
            {allScope ? <form className="admin-qb-search-form" onSubmit={event => { event.preventDefault(); void searchAcrossBanks() }}>
              <label htmlFor="admin-global-question-search">{questionBankScopeTrack(pickerValue) ? 'All competences' : 'All tracks · All competences'}</label>
              <div><input id="admin-global-question-search" aria-label="Search questions across selected banks" placeholder="Question number or text…" maxLength={160} value={searchQuery} disabled={searchBusy} onChange={event => setSearchQuery(event.target.value)} />
              <button type="submit" className="btn btn-outline" disabled={searchBusy || editorBusy}>{searchBusy ? 'Searching…' : 'Search questions'}</button></div>
              {searchBusy && <p role="status">Searching question banks…</p>}
              {searchError && <p role="alert">{searchError}</p>}
              {searchSummary && <p role="status">{searchSummary}</p>}
            </form> : <input aria-label="Find question by number or text" placeholder="Search question number or text…" value={editorSearch} onChange={event => setEditorSearch(event.target.value)} />}
            <div className="admin-qb-question-results">
              {allScope ? searchResults.map(result => <button key={result.path + ':' + result.ordinal} type="button" disabled={busy || editorBusy} aria-current={result.path === editorTarget && result.ordinal === editorOrdinal ? 'true' : undefined} onClick={() => void loadEditor(result.path, result.ordinal, searchRevision)}>
                <small>{TRACKS.find(([track]) => track === result.track)?.[1]} · {result.competenceId}{result.part == null ? '' : ' · Part ' + result.part} · #{result.ordinal}</small>
                <span>{result.questionText || 'Image question'}</span>
              </button>) : editorMatches.map(question => <button key={question.ordinal} type="button" disabled={busy} aria-current={question.ordinal === editorOrdinal ? 'true' : undefined} onClick={() => chooseEditorQuestion(question.ordinal)}>
                <strong>#{question.ordinal}</strong> {question.retired ? '· Retired' : ''} · {question.questionText.slice(0, 110) || 'Image question'}
              </button>)}
              {!allScope && editorBank && editorBank.questions.length > 150 && <p style={secondaryText}>Showing up to 150 matches. Search to find a specific question.</p>}
            </div>
          </aside>
          {selectedEditorQuestion && editorDraft && <fieldset ref={editorFormRef} disabled={busy || editorBusy} className="admin-qb-question-form">
            <strong>Question #{selectedEditorQuestion.ordinal}</strong>
            <label>Question text<EditorTextarea aria-label="Question text" value={editorDraft.questionText} onChange={event => updateEditorDraft({ ...editorDraft, questionText: event.target.value })} /></label>
            <small className="admin-qb-hint">Optional when a question image is attached.</small>
            <div className="admin-qb-choices">
              {editorDraft.options.map((option, index) => <label key={`${editorTarget}:${editorOrdinal}:${index}`}>Choice {String.fromCharCode(65 + index)}
                <EditorTextarea autoGrow={false} aria-label={'Choice ' + String.fromCharCode(65 + index)} value={option} onChange={event => updateEditorDraft({ ...editorDraft, options: editorDraft.options.map((value, i) => i === index ? event.target.value : value) })} />
              </label>)}
            </div>
            <label className="admin-qb-answer">Correct answer
              <select aria-label="Correct answer" value={editorDraft.correctAnswerIndex} className="admin-qb-target-select" onChange={event => updateEditorDraft({ ...editorDraft, correctAnswerIndex: Number(event.target.value) })}>
                {editorDraft.options.map((_, i) => <option key={i} value={i}>{String.fromCharCode(65 + i)}</option>)}
              </select>
            </label>
            <label>Explanation<EditorTextarea aria-label="Explanation" value={editorDraft.explanation} onChange={event => updateEditorDraft({ ...editorDraft, explanation: event.target.value })} /></label>
            <div className="card admin-qb-images" style={{padding:10,display:'grid',gap:8,border:'1px solid var(--border)'}}>
              <strong>Question images (up to four)</strong>
              <p style={secondaryText}>PNG, JPEG or WebP · Up to four private images.</p>
              <div className="admin-qb-image-list">{(editorDraft.imageAttachments || []).map((image,index)=><div key={image.sha256+image.placement} style={{display:'grid',gap:8,borderBottom:'1px solid var(--border)',paddingBottom:8}}>
                {editorImageTrack && <QuestionImageGallery question={{ id: `admin:${editorTarget}:${editorOrdinal}`, track: editorImageTrack, imageAttachments: [image] }} placement={image.placement} />}
                <span style={{fontSize:'.85rem',overflowWrap:'anywhere'}}>{image.placement==='question'?'Question':'Explanation'} · {image.alt}</span>
                <button type="button" className="btn btn-outline admin-qb-remove" disabled={imageUploading} onClick={()=>updateEditorDraft({...editorDraft,imageAttachments:(editorDraft.imageAttachments||[]).filter((_,i)=>i!==index)})}>Remove</button>
              </div>)}</div>
              <div className="admin-qb-image-options"><label>Image description (optional)
                <input type="text" maxLength={160} value={imageAlt} placeholder="e.g., Radar plotting diagram" onChange={event=>setImageAlt(event.target.value)} style={{width:'100%',marginTop:4}}/>
              </label>
              <label>Image placement
                <select aria-label="Image placement" value={imagePlacement} onChange={event=>setImagePlacement(event.target.value as 'question'|'explanation')} className="admin-qb-target-select">
                  <option value="question">Below question</option><option value="explanation">Below explanation</option>
                </select>
              </label></div>
              <input ref={imagePickerRef} aria-label="Attach question image" type="file" accept="image/webp,image/png,image/jpeg" hidden disabled={imageUploading || editorBusy || busy || (editorDraft.imageAttachments?.length || 0)>=QUESTION_MEDIA_LIMIT}
                onChange={event=>{
                  const file=event.target.files?.[0]
                  event.target.value=''
                  if(file)void attachImageToEditor(file)
                }}/>
              <button type="button" className="btn btn-outline" disabled={imageUploading || editorBusy || busy || (editorDraft.imageAttachments?.length || 0)>=QUESTION_MEDIA_LIMIT} onClick={()=>imagePickerRef.current?.click()}>
                {imageUploading ? 'Uploading image…' : editorDraft.imageAttachments?.length ? 'Add another image' : 'Choose image'}
              </button>
              {!!editorDraft.imageAttachments?.length && <p role="status" style={secondaryText}>{editorDraft.imageAttachments.length} {editorDraft.imageAttachments.length === 1 ? 'image attached' : 'images attached'} to this question’s draft.</p>}
              {imageProgress && <div>
                <progress aria-label="Image upload progress" max={100} value={imageProgress.stage === 'complete' ? 100 : imageProgress.stage === 'uploading' && imageProgress.total > 0 ? Math.round(imageProgress.loaded / imageProgress.total * 100) : undefined} style={{width:'100%',accentColor:'var(--accent)'}} />
                <p role="status" style={secondaryText}>{imageProgress.stage === 'preparing' ? 'Preparing image…' : imageProgress.stage === 'verifying' ? 'Verifying uploaded image…' : imageProgress.stage === 'complete' ? 'Image uploaded and verified.' : imageProgress.total > 0 ? `Uploading image… ${Math.round(imageProgress.loaded / imageProgress.total * 100)}%` : 'Uploading image…'}</p>
              </div>}
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={editorDraft.retired} disabled={selectedEditorQuestion.fixedLegacyRetirement} onChange={event => updateEditorDraft({ ...editorDraft, retired: event.target.checked })} />
              <strong>Retired (exclude from new study sessions)</strong>
            </label>
            {selectedEditorQuestion.fixedLegacyRetirement && <p style={secondaryText}>This is one of the three original C10 retirements, which remain enforced by the packaged Android application and cannot be restored here.</p>}
            <p style={secondaryText}>Retired questions stay in saved history but are excluded from new sessions.</p>
          </fieldset>}
          {!editorBank && allScope && <div className="admin-qb-empty-editor">Search by question number or text, then select a result to edit its original bank.</div>}
        </div>
        {editorBank && <div className="admin-qb-editor-actions" aria-label="Question editing actions">
          <button type="button" className="btn btn-primary" disabled={busy || editorBusy || imageUploading} onClick={queueEditorChanges}>Add edited files to publish queue</button>
          {editorFormDirty && selectedEditorQuestion && <button type="button" className="btn btn-outline admin-qb-discard" disabled={busy || editorBusy || imageUploading}
            onClick={() => {
              setEditorDraft({ questionText: selectedEditorQuestion.questionText, options: selectedEditorQuestion.options.slice(), correctAnswerIndex: selectedEditorQuestion.correctAnswerIndex, explanation: selectedEditorQuestion.explanation, retired: selectedEditorQuestion.retired, imageAttachments: selectedEditorQuestion.imageAttachments })
              setEditorError('')
              setEditorNotice({ kind: 'info', text: 'Form changes discarded. Previously queued draft edits are preserved locally; add them to the queue again when ready.' })
            }}>Discard changes</button>}
          {editorHasAppliedEdits && !editorDraftQueued && !editorFormDirty && <button type="button" className="btn btn-outline admin-qb-remove" disabled={busy || editorBusy || imageUploading} onClick={() => {
            setEditorText(''); setEditorOriginalText(''); setEditorBaseHead(''); setEditorRevision(''); setEditorDraft(null); setEditorOrdinal(0); setEditorError(''); setPreview(null)
            setMessage('Bank draft discarded. Reopen the bank or select a search result to load its current version.')
          }}>Discard bank draft</button>}
          {editorNotice && <div role={editorNotice.kind === 'error' ? 'alert' : 'status'} aria-live="polite"
            className={`admin-qb-editor-status is-${editorNotice.kind}`}>{editorNotice.text}</div>}
          {editorDraftQueued && <a className="admin-qb-editor-queue-link" href="#admin-qb-upload-queue">Review publish queue ↓</a>}
        </div>}
      </>}
      <details className="admin-qb-help"><summary>Website and Android updates</summary><p style={secondaryText}>Android installations still require a new app release to receive edited packaged bank content. The website receives the next verified bank revision automatically.</p></details>
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
          <h2 id="admin-qb-upload-queue" style={{ margin: 0, fontSize: '1.05rem', scrollMarginTop: 96 }}>Upload queue ({queue.length})</h2>
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
