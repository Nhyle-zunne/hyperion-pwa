import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

type Asset = { path: string; label: string; track: string; competenceId: string; part: number | null; format: 'standard' | 'gmdss' }
type QueueStatus = 'ready' | 'publishing' | 'success' | 'error'
type QueueItem = { id: string; file: File; targetPath: string; status: QueueStatus; error?: string; questionCount?: number; backupPath?: string }
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
  const navigate = useNavigate()
  const pickerRef = useRef<HTMLInputElement>(null)
  const [assets, setAssets] = useState<Asset[]>([])
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [message, setMessage] = useState('')
  const [isError, setIsError] = useState(false)
  const [batchResult, setBatchResult] = useState<{ attempted: number; updated: number; failed: number } | null>(null)

  const call = useCallback(async (body: Record<string, unknown>) => {
    if (!supabase) throw new Error('Question-bank administration is not configured.')
    const { data, error } = await supabase.functions.invoke('question-bank', { body })
    if (error) throw error
    if (data?.error) throw new Error(data.error)
    return data
  }, [])

  const loadAssets = useCallback(async () => {
    setLoading(true)
    try {
      const result = await call({ action: 'list-update-assets' })
      const rows = Array.isArray(result.assets) ? result.assets as Asset[] : []
      setAssets(rows)
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
  useEffect(() => { void loadAssets() }, [loadAssets])

  const assetByPath = useMemo(() => new Map(assets.map(asset => [asset.path, asset])), [assets])
  const duplicatePaths = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of queue) if (item.targetPath && item.status !== 'success') counts.set(item.targetPath, (counts.get(item.targetPath) || 0) + 1)
    return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([target]) => target))
  }, [queue])
  const totalBytes = useMemo(() => queue.reduce((sum, item) => sum + item.file.size, 0), [queue])
  const successCount = queue.filter(item => item.status === 'success').length
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
    setBatchResult(null)
    setMessage('')
    setIsError(false)
    if (incoming.some(file => !csvFileSupported(file))) {
      setMessage('Only raw .csv and Hyperion-compatible .csv.enc files are supported.')
      setIsError(true)
    }
  }

  const updateTarget = (id: string, targetPath: string) => {
    setBatchResult(null)
    setQueue(old => old.map(item => item.id === id ? { ...item, targetPath, status: item.status === 'success' ? 'success' : 'ready', error: undefined } : item))
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
    if (!window.confirm('Publish ' + todo.length + ' CSV file(s)? Each private question set will be replaced only after its private rollback backup is saved.')) return

    setBusy(true)
    setBatchResult(null)
    setIsError(false)
    setMessage('Publishing ' + todo.length + ' file(s) one by one…')
    let completed = 0
    let failed = 0
    for (const item of todo) {
      setQueue(old => old.map(row => row.id === item.id ? { ...row, status: 'publishing', error: undefined } : row))
      try {
        const encrypted = isEncryptedCsv(item.file)
        const payload = encrypted
          ? { action: 'update-csv', path: item.targetPath, uploadFormat: 'encrypted', encryptedBase64: bytesToBase64(new Uint8Array(await item.file.arrayBuffer())) }
          : { action: 'update-csv', path: item.targetPath, uploadFormat: 'csv', csvText: await item.file.text() }
        const result = await call(payload)
        setQueue(old => old.map(row => row.id === item.id ? {
          ...row, status: 'success', questionCount: Number(result.questionCount) || 0,
          backupPath: result.backupPath, error: undefined
        } : row))
        completed++
      } catch (reason) {
        const explanation = reason instanceof Error ? reason.message : 'Publish failed.'
        setQueue(old => old.map(row => row.id === item.id ? { ...row, status: 'error', error: explanation } : row))
        failed++
      }
    }
    setBusy(false)
    setBatchResult({ attempted: todo.length, updated: completed, failed })
    setMessage(failed === 0 ? 'All ' + completed + ' file(s) in this run published successfully.' : 'Batch run finished: ' + completed + ' updated, ' + failed + ' failed. Review the failed rows and retry.')
    setIsError(failed > 0)
  }

  const card: React.CSSProperties = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '1rem', marginBottom: '1rem', minWidth: 0 }
  const secondaryText: React.CSSProperties = { color: 'var(--text-muted)', fontSize: '.84rem', lineHeight: 1.5 }
  const statusLabel: Record<QueueStatus, string> = { ready: 'READY', publishing: 'PUBLISHING…', success: 'PUBLISHED', error: 'FAILED' }

  return <div className="screen" style={{ width: 'min(calc(100% - 1rem), 1180px)', maxWidth: 1180, margin: '0 auto', paddingBottom: '2rem' }}>
    <style>{" .admin-qb-drop{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:190px;border:2px dashed var(--border);border-radius:10px;padding:1.25rem;text-align:center;background:var(--bg-elevated);transition:border-color .15s,background .15s}.admin-qb-drop.is-dragging{border-color:var(--accent);background:var(--bg-card)}.admin-qb-folder{border:1px solid var(--border);border-radius:8px;background:var(--bg-card);overflow:hidden}.admin-qb-folder-summary{display:flex;align-items:center;gap:.55rem;flex-wrap:wrap;list-style:none;cursor:pointer;padding:.7rem .8rem;min-height:28px}.admin-qb-folder-summary::-webkit-details-marker{display:none}.admin-qb-folder[open] .admin-qb-folder-summary{border-bottom:1px solid var(--border);background:var(--bg-elevated)}.admin-qb-folder-glyph{font-size:1rem}.admin-qb-folder-name{font-weight:850;font-size:.86rem}.admin-qb-folder-count{color:var(--text-muted);font-size:.78rem}.admin-qb-folder-state{margin-left:auto;font-size:.72rem;font-weight:850;color:var(--text-muted)}.admin-qb-folder-state.is-done{color:var(--success,#15803d)}.admin-qb-folder-state.has-error{color:var(--danger,#dc2626)}.admin-qb-folder-files{padding:.35rem .55rem}.admin-qb-file-row{display:grid;grid-template-columns:minmax(160px,1fr) minmax(200px,1.25fr) minmax(95px,.6fr) auto;gap:.55rem;align-items:center;padding:.5rem .35rem;border-bottom:1px solid var(--border);min-width:0}.admin-qb-file-row:last-child{border-bottom:0}.admin-qb-file-primary{display:flex;align-items:flex-start;gap:.45rem;min-width:0}.admin-qb-file-glyph{font-size:.9rem;margin-top:.05rem}.admin-qb-file-primary>div{display:flex;align-items:baseline;gap:.35rem .5rem;flex-wrap:wrap;min-width:0}.admin-qb-file-name{font-size:.8rem;overflow-wrap:anywhere}.admin-qb-file-size,.admin-qb-file-questions{font-size:.72rem;color:var(--text-muted)}.admin-qb-file-questions{color:var(--success,#15803d)}.admin-qb-target-label{font-size:.64rem;font-weight:850;color:var(--text-muted);min-width:0}.admin-qb-target-select{width:100%;margin-top:.18rem;background:var(--bg-elevated);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:.45rem;font:inherit;font-size:.76rem;min-width:0}.admin-qb-path{display:block;font-size:.67rem;font-weight:500;margin-top:.15rem;overflow-wrap:anywhere}.admin-qb-file-status{display:flex;flex-direction:column;align-items:flex-start;gap:.15rem;min-width:0}.admin-qb-status-pill{font-size:.67rem;font-weight:900}.admin-qb-status-pill.success{color:var(--success,#15803d)}.admin-qb-status-pill.error{color:var(--danger,#dc2626)}.admin-qb-status-pill.ready{color:var(--text-muted)}.admin-qb-status-pill.publishing{color:var(--accent)}.admin-qb-row-error{font-size:.68rem;color:var(--danger,#dc2626);overflow-wrap:anywhere}.admin-qb-backup-note{font-size:.66rem;color:var(--text-muted)}.admin-qb-remove{padding:.35rem .5rem;font-size:.72rem}.admin-qb-footer{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-top:.9rem;padding-top:.7rem;border-top:1px solid var(--border)}@media(max-width:800px){.admin-qb-file-row{grid-template-columns:minmax(0,1fr) auto;gap:.45rem}.admin-qb-target-label{grid-column:1/-1}.admin-qb-file-status{grid-column:1}.admin-qb-remove{grid-column:2;grid-row:3;justify-self:end}}"} </style>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: '.8rem' }}>
      <button type="button" onClick={() => navigate('/account')} style={{ color: 'var(--text-muted)' }}>← Account</button>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-outline" onClick={() => navigate('/admin/licenses')}>USER LICENSES</button>
        <button type="button" className="btn btn-outline" onClick={() => navigate('/admin/payments')}>PAYMENT SUBMISSIONS</button>
        <button type="button" className="btn btn-primary" onClick={() => navigate('/admin/questions')}>QUESTION BANK</button>
      </div>
    </div>
    <h1 className="page-title" style={{ textAlign: 'left' }}>Question Bank Update</h1>
    <p className="subtitle" style={{ textAlign: 'left' }}>Drag in raw .csv files or already-encrypted .csv.enc files, individually or in bulk. Hyperion matches filenames to question sets and validates each file before replacement.</p>
    {message && <div role="status" aria-live="polite" style={{ ...card, borderColor: isError ? 'var(--danger, #dc2626)' : 'var(--success, #15803d)' }}>{message}</div>}
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
          <button type="button" className="btn btn-outline" disabled={loading || busy} onClick={() => void loadAssets()}>Refresh question sets</button>
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
            ? 'Each replacement was validated and backed up privately. Refresh Hyperion to verify the changes.'
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
                    {target && <span className="admin-qb-path">{target.path}</span>}
                  </label>
                  <div className="admin-qb-file-status">
                    <span className={'admin-qb-status-pill ' + item.status}>{statusLabel[item.status]}</span>
                    {rowError && item.status !== 'success' && <span className="admin-qb-row-error">{rowError}</span>}
                    {item.backupPath && <span className="admin-qb-backup-note">Backup saved privately</span>}
                  </div>
                  <button type="button" className="btn btn-outline admin-qb-remove" disabled={busy} onClick={() => { setQueue(old => old.filter(row => row.id !== item.id)); setBatchResult(null) }} aria-label={'Remove ' + item.file.name}>Remove</button>
                </div>
              })}
            </div>
          </details>
        })}
      </div>}

      {!!queue.length && <div className="admin-qb-footer">
        <p style={{ ...secondaryText, margin: 0 }}>Each file publishes separately. Raw CSV limit: 700 KB; encrypted CSV limit: 1 MiB. One file per destination in each batch.</p>
        <button type="button" className="btn btn-primary" disabled={busy || loading || !queue.some(item => item.status !== 'success')}
          onClick={() => void publishBatch()}>
          {busy ? 'PUBLISHING BATCH…'
            : queue.length > 0 && queue.every(item => item.status === 'success') ? 'ALL FILES UPDATED ✓'
              : queue.some(item => item.status === 'error') && !queue.some(item => item.status === 'ready') ? 'RETRY FAILED FILES'
                : 'VALIDATE & PUBLISH BATCH'}
        </button>
      </div>}
    </section>
    <section style={{ ...card, background: 'var(--bg-elevated)' }}>
      <strong>Before publishing</strong>
      <p style={{ ...secondaryText, marginBottom: 0 }}>Publishing replaces the selected question set; it does not merge questions. Encrypted uploads are decrypted in memory only to validate the questions, then stored unchanged. The server checks row structure but cannot verify every answer’s factual correctness. Refresh Hyperion and test the updated questions. Students with offline packs must download the updated bank again.</p>
    </section>
  </div>
}
