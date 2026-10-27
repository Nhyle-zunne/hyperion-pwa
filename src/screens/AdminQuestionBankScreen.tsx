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
function rawCsvName(path: string) {
  const name = path.split('/').pop() || ''
  return name.endsWith('.enc') ? name.slice(0, -4).toLowerCase() : name.toLowerCase()
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
        const match = rows.find(asset => rawCsvName(asset.path) === item.file.name.toLowerCase())
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
  const problemCount = queue.filter(item => !item.targetPath || duplicatePaths.has(item.targetPath) || item.file.size > MAX_FILE_BYTES || !!item.error).length

  const addFiles = (list: FileList | File[]) => {
    const incoming = Array.from(list)
    if (!incoming.length) return
    const additions: QueueItem[] = incoming.map((file, index) => {
      const match = assets.find(asset => rawCsvName(asset.path) === file.name.toLowerCase())
      const isCsv = file.name.toLowerCase().endsWith('.csv')
      return {
        id: file.name + '-' + file.size + '-' + file.lastModified + '-' + Date.now() + '-' + index,
        file,
        targetPath: isCsv ? (match?.path || '') : '',
        status: 'ready',
        error: isCsv ? undefined : 'Not a CSV file. Choose the editable raw CSV, not an encrypted file.'
      }
    })
    setQueue(old => [...old, ...additions])
    setMessage('')
    setIsError(false)
    if (incoming.some(file => !file.name.toLowerCase().endsWith('.csv'))) {
      setMessage('Only raw CSV files are supported. Do not upload encrypted .csv.enc files here.')
      setIsError(true)
    }
  }

  const updateTarget = (id: string, targetPath: string) => {
    setQueue(old => old.map(item => item.id === id ? { ...item, targetPath, status: item.status === 'success' ? 'success' : 'ready', error: undefined } : item))
  }

  const publishBatch = async () => {
    const todo = queue.filter(item => item.status !== 'success')
    if (!todo.length) {
      setMessage('All files in this queue are already published.')
      setIsError(false)
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
    const overLimit = todo.filter(item => item.file.size > MAX_FILE_BYTES)
    if (overLimit.length) {
      setMessage('These files exceed the 700 KB limit: ' + overLimit.map(item => item.file.name).join(', '))
      setIsError(true)
      return
    }
    if (!window.confirm('Publish ' + todo.length + ' CSV file(s)? Each private question set will be replaced only after its private rollback backup is saved.')) return

    setBusy(true)
    setIsError(false)
    setMessage('Publishing ' + todo.length + ' file(s) one by one…')
    let completed = 0
    let failed = 0
    for (const item of todo) {
      setQueue(old => old.map(row => row.id === item.id ? { ...row, status: 'publishing', error: undefined } : row))
      try {
        const csvText = await item.file.text()
        const result = await call({ action: 'update-csv', path: item.targetPath, csvText })
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
    setMessage('Bulk publish finished: ' + completed + ' updated, ' + failed + ' failed. Review each file result below.')
    setIsError(failed > 0)
  }

  const card: React.CSSProperties = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '1rem', marginBottom: '1rem', minWidth: 0 }
  const secondaryText: React.CSSProperties = { color: 'var(--text-muted)', fontSize: '.84rem', lineHeight: 1.5 }
  const field: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '.65rem', marginTop: '.3rem', background: 'var(--bg-elevated)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 7, font: 'inherit', minWidth: 0 }
  const statusLabel: Record<QueueStatus, string> = { ready: 'READY', publishing: 'PUBLISHING…', success: 'PUBLISHED', error: 'FAILED' }

  return <div className="screen" style={{ width: 'min(calc(100% - 1rem), 1180px)', maxWidth: 1180, margin: '0 auto', paddingBottom: '2rem' }}>
    <style>{".admin-qb-drop{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:190px;border:2px dashed var(--border);border-radius:10px;padding:1.25rem;text-align:center;background:var(--bg-elevated);transition:border-color .15s,background .15s}.admin-qb-drop.is-dragging{border-color:var(--accent);background:var(--bg-card)}.admin-qb-queue-row{display:grid;grid-template-columns:minmax(180px,1.1fr) minmax(220px,1.5fr) minmax(105px,.55fr) auto;gap:.7rem;align-items:center;border:1px solid var(--border);border-radius:8px;padding:.7rem;margin-top:.5rem;min-width:0}.admin-qb-filename{font-weight:800;overflow-wrap:anywhere}@media(max-width:800px){.admin-qb-queue-row{grid-template-columns:1fr;gap:.4rem}}"} </style>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: '.8rem' }}>
      <button type="button" onClick={() => navigate('/account')} style={{ color: 'var(--text-muted)' }}>← Account</button>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-outline" onClick={() => navigate('/admin/licenses')}>USER LICENSES</button>
        <button type="button" className="btn btn-outline" onClick={() => navigate('/admin/payments')}>PAYMENT SUBMISSIONS</button>
        <button type="button" className="btn btn-primary" onClick={() => navigate('/admin/questions')}>QUESTION BANK</button>
      </div>
    </div>
    <h1 className="page-title" style={{ textAlign: 'left' }}>Question Bank Update</h1>
    <p className="subtitle" style={{ textAlign: 'left' }}>Drag in one CSV or a whole batch. Hyperion matches filenames to question sets, validates each file, encrypts it on the server, and saves a private backup before replacing anything.</p>
    {message && <div role="status" aria-live="polite" style={{ ...card, borderColor: isError ? 'var(--danger, #dc2626)' : 'var(--success, #15803d)' }}>{message}</div>}
    <section style={card}>
      <div className={'admin-qb-drop' + (dragging ? ' is-dragging' : '')}
        onDragOver={event => { event.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={event => { event.preventDefault(); setDragging(false); addFiles(event.dataTransfer.files) }}>
        <strong style={{ fontSize: '1.05rem' }}>Drag and drop CSV files here</strong>
        <p style={{ ...secondaryText, margin: '.4rem 0 .8rem' }}>Drop several files at once, or choose multiple files from your computer.</p>
        <button type="button" className="btn btn-primary" disabled={loading || busy} onClick={() => pickerRef.current?.click()}>CHOOSE CSV FILES</button>
        <input ref={pickerRef} type="file" accept=".csv,text/csv" multiple hidden disabled={loading || busy}
          onChange={event => { if (event.currentTarget.files) addFiles(event.currentTarget.files); event.currentTarget.value = '' }} />
      </div>
      <p style={secondaryText}>Use the editable raw CSV files, not encrypted files. Names such as <code>oic_nw_c1.csv</code>, <code>dm_c6.csv</code>, <code>ew_c4.csv</code>, <code>em_c3.csv</code>, and <code>c1_part1.csv</code> are matched automatically. You can choose the target manually if a filename differs.</p>
    </section>
    <section style={card}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Upload queue ({queue.length})</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-outline" disabled={loading || busy} onClick={() => void loadAssets()}>Refresh question sets</button>
          <button type="button" className="btn btn-outline" disabled={busy || !queue.length} onClick={() => { setQueue([]); setMessage(''); setIsError(false) }}>Clear queue</button>
        </div>
      </div>
      {loading && <p style={secondaryText}>Loading supported question sets…</p>}
      {!loading && !queue.length && <p style={secondaryText}>No files added yet. Drop your CSV files above to get started.</p>}
      {!!queue.length && <p style={secondaryText}>{queue.length} file(s) · {(totalBytes / 1024).toFixed(1)} KB combined · {successCount} published · {problemCount} need attention</p>}
      {queue.map(item => {
        const target = assetByPath.get(item.targetPath)
        const duplicate = !!item.targetPath && duplicatePaths.has(item.targetPath) && item.status !== 'success'
        const tooLarge = item.file.size > MAX_FILE_BYTES
        const rowError = item.error || (tooLarge ? 'Over 700 KB per file.' : duplicate ? 'Duplicate target. Keep one file per question set.' : !item.targetPath ? 'No automatic match. Select the correct target.' : '')
        return <div key={item.id} className="admin-qb-queue-row">
          <div>
            <div className="admin-qb-filename">{item.file.name}</div>
            <div style={secondaryText}>{(item.file.size / 1024).toFixed(1)} KB</div>
            {item.questionCount != null && <div style={{ fontSize: '.78rem', color: 'var(--success, #15803d)', marginTop: '.2rem' }}>{item.questionCount.toLocaleString()} question rows</div>}
          </div>
          <label style={{ fontSize: '.76rem', fontWeight: 800, color: 'var(--text-muted)' }}>REPLACE QUESTION SET
            <select value={item.targetPath} disabled={busy || item.status === 'success'} onChange={event => updateTarget(item.id, event.target.value)} style={field}>
              <option value="">Choose target…</option>
              {TRACKS.map(([track, label]) => <optgroup key={track} label={label}>
                {assets.filter(asset => asset.track === track).map(asset => <option key={asset.path} value={asset.path}>{asset.label}</option>)}
              </optgroup>)}
            </select>
            {target && <div style={{ fontWeight: 500, marginTop: '.2rem', overflowWrap: 'anywhere' }}>{target.path}</div>}
          </label>
          <div>
            <strong style={{ fontSize: '.76rem', color: item.status === 'success' ? 'var(--success, #15803d)' : item.status === 'error' || rowError ? 'var(--danger, #dc2626)' : 'var(--text-muted)' }}>{statusLabel[item.status]}</strong>
            {rowError && item.status !== 'success' && <div style={{ fontSize: '.74rem', color: 'var(--danger, #dc2626)', marginTop: '.2rem' }}>{rowError}</div>}
            {item.status === 'error' && item.error && <div style={{ fontSize: '.74rem', marginTop: '.2rem' }}>{item.error}</div>}
            {item.backupPath && <div style={{ fontSize: '.72rem', color: 'var(--text-muted)', overflowWrap: 'anywhere', marginTop: '.2rem' }}>Backup saved privately</div>}
          </div>
          <button type="button" className="btn btn-outline" disabled={busy} onClick={() => setQueue(old => old.filter(row => row.id !== item.id))} aria-label={'Remove ' + item.file.name} style={{ padding: '.5rem .65rem' }}>REMOVE</button>
        </div>
      })}
      {!!queue.length && <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: '1rem' }}>
        <p style={{ ...secondaryText, margin: 0 }}>Files publish one by one, so one failure won’t stop the rest. Maximum 700 KB per CSV. Only one file per target in each batch.</p>
        <button type="button" className="btn btn-primary" disabled={busy || loading || !queue.some(item => item.status !== 'success')} onClick={() => void publishBatch()}>{busy ? 'PUBLISHING BATCH…' : 'VALIDATE & PUBLISH BATCH'}</button>
      </div>}
    </section>
    <section style={{ ...card, background: 'var(--bg-elevated)' }}>
      <strong>Before publishing</strong>
      <p style={{ ...secondaryText, marginBottom: 0 }}>Publishing replaces the selected question set; it does not merge questions. The server checks that valid question rows exist, but it cannot verify every answer’s factual correctness. Refresh Hyperion and test the updated questions. Students with offline packs must download the updated bank again.</p>
    </section>
  </div>
}
