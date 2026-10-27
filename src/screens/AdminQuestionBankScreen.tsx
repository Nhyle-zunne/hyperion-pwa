import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

type Asset = { path:string; label:string; track:string; competenceId:string; part:number|null; format:'standard'|'gmdss' }
const TRACKS = [['DECK_OIC_NW','Deck OIC-NW'],['GMDSS_GOC','GMDSS GOC'],['ENGINE_OIC_EW','Engine OIC-EW'],['DECK_MGT','Deck Management'],['ENGINE_MGT','Engine Management']] as const

export default function AdminQuestionBankScreen() {
  const navigate = useNavigate()
  const [assets,setAssets] = useState<Asset[]>([])
  const [path,setPath] = useState('')
  const [csv,setCsv] = useState('')
  const [loading,setLoading] = useState(true)
  const [busy,setBusy] = useState(false)
  const [message,setMessage] = useState('')
  const [isError,setIsError] = useState(false)
  const [published,setPublished] = useState<{path:string;questionCount:number;backupPath:string;updatedAt:string}|null>(null)
  const call = useCallback(async (body:Record<string,unknown>) => {
    if (!supabase) throw new Error('Question-bank administration is not configured.')
    const {data,error} = await supabase.functions.invoke('question-bank',{body})
    if (error) throw error
    if (data?.error) throw new Error(data.error)
    return data
  },[])
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await call({action:'list-update-assets'})
      const rows = Array.isArray(result.assets) ? result.assets as Asset[] : []
      setAssets(rows)
      setPath(old => rows.some(row=>row.path===old) ? old : (rows[0]?.path||''))
      setIsError(false)
    } catch (e) {
      setIsError(true); setMessage(e instanceof Error ? e.message : 'Could not load question sets.')
    } finally { setLoading(false) }
  },[call])
  useEffect(()=>{void load()},[load])
  const selected = useMemo(()=>assets.find(a=>a.path===path)||null,[assets,path])
  const bytes = useMemo(()=>new TextEncoder().encode(csv).length,[csv])
  const publish = async () => {
    if (!selected || !csv.trim()) {setMessage('Choose a question set and paste its CSV first.');setIsError(true);return}
    if (bytes>700000) {setMessage('CSV is over 700 KB. Reduce its size first.');setIsError(true);return}
    if (!window.confirm('Replace '+selected.label+' with the pasted CSV? The previous encrypted file will be backed up privately first.')) return
    setBusy(true);setMessage('');setIsError(false);setPublished(null)
    try {
      const result = await call({action:'update-csv',path:selected.path,csvText:csv})
      setPublished({path:result.path,questionCount:Number(result.questionCount)||0,backupPath:result.backupPath,updatedAt:result.updatedAt})
      setMessage('Published successfully. Refresh Hyperion and verify the updated questions.')
      setCsv('')
    } catch (e) {setIsError(true);setMessage(e instanceof Error?e.message:'Could not publish CSV.')}
    finally {setBusy(false)}
  }
  const card:React.CSSProperties={background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:10,padding:'1rem',marginBottom:'1rem',minWidth:0}
  const field:React.CSSProperties={width:'100%',boxSizing:'border-box',padding:'.75rem',marginTop:'.35rem',background:'var(--bg-elevated)',color:'var(--text)',border:'1px solid var(--border)',borderRadius:7,font:'inherit',minWidth:0}
  return <div className="screen" style={{width:'min(calc(100% - 1rem), 1180px)',maxWidth:1180,margin:'0 auto',paddingBottom:'2rem'}}>
    <style>{'.admin-qb-text{width:100%;min-height:350px;resize:vertical;font-family:ui-monospace,Consolas,monospace;font-size:.82rem;line-height:1.45;white-space:pre}@media(max-width:700px){.admin-qb-text{min-height:250px}}'}</style>
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,flexWrap:'wrap',marginBottom:'.8rem'}}>
      <button type="button" onClick={()=>navigate('/account')} style={{color:'var(--text-muted)'}}>← Account</button>
      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
        <button type="button" className="btn btn-outline" onClick={()=>navigate('/admin/licenses')}>USER LICENSES</button>
        <button type="button" className="btn btn-outline" onClick={()=>navigate('/admin/payments')}>PAYMENT SUBMISSIONS</button>
        <button type="button" className="btn btn-primary" onClick={()=>navigate('/admin/questions')}>QUESTION BANK</button>
      </div>
    </div>
    <h1 className="page-title" style={{textAlign:'left'}}>Question Bank Update</h1>
    <p className="subtitle" style={{textAlign:'left'}}>Paste CSV text below. Hyperion validates and encrypts it on the server before replacing the private question file.</p>
    {message&&<div role="status" aria-live="polite" style={{...card,borderColor:isError?'var(--danger, #dc2626)':'var(--success, #15803d)'}}>{message}</div>}
    {published&&<section style={{...card,background:'var(--bg-elevated)'}}>
      <strong>Published and backed up</strong>
      <p>Asset: <code>{published.path}</code></p>
      <p>Question rows validated: <strong>{published.questionCount}</strong></p>
      <p style={{overflowWrap:'anywhere'}}>Private backup: <code>{published.backupPath}</code></p>
      <p>Published: {new Date(published.updatedAt).toLocaleString()}</p>
    </section>}
    <section style={card}>
      <h2 style={{marginTop:0,fontSize:'1.05rem'}}>1. Choose question set</h2>
      <label style={{display:'block',fontWeight:800,fontSize:'.82rem',color:'var(--text-muted'}}>TRACK / COMPETENCE / PART
        <select value={path} disabled={loading||busy} onChange={e=>{setPath(e.target.value);setPublished(null)}} style={field}>
          {TRACKS.map(([track,label])=><optgroup key={track} label={label}>{assets.filter(a=>a.track===track).map(a=><option key={a.path} value={a.path}>{a.label}</option>)}</optgroup>)}
        </select>
      </label>
      <p style={{color:'var(--text-muted)',fontSize:'.82rem'}}>{loading?'Loading supported question sets…':assets.length+' supported files · '+(path||'No file selected')}</p>
      <button type="button" className="btn btn-outline" disabled={loading||busy} onClick={()=>void load()}>Refresh question sets</button>
    </section>
    <section style={card}>
      <div style={{display:'flex',justifyContent:'space-between',gap:8,flexWrap:'wrap',alignItems:'center'}}>
        <h2 style={{margin:0,fontSize:'1.05rem'}}>2. Paste CSV</h2>
        <span style={{fontSize:'.8rem',color:'var(--text-muted)'}}>{bytes.toLocaleString()} bytes</span>
      </div>
      <p style={{color:'var(--text-muted)',fontSize:'.86rem',lineHeight:1.5}}>Copy all CSV text, including the header row, then click the box and press Ctrl+V. Publishing replaces the selected competence/part; it does not merge rows.</p>
      <textarea className="admin-qb-text" value={csv} disabled={busy} onChange={e=>{setCsv(e.target.value);setPublished(null)}} placeholder="Paste complete CSV content here…" spellCheck={false} style={field}/>
      <p style={{color:'var(--text-muted)',fontSize:'.82rem',lineHeight:1.5}}>The server checks for valid question rows, backs up the previous encrypted object privately, then encrypts and publishes your CSV. Maximum paste: 700 KB. Offline packs must be downloaded again to get updates.</p>
      <button type="button" className="btn btn-primary" disabled={busy||loading||!selected||!csv.trim()} onClick={()=>void publish()}>{busy?'Validating & publishing…':'VALIDATE & PUBLISH'}</button>
    </section>
    <section style={{...card,background:'var(--bg-elevated)'}}>
      <strong>Before publishing</strong>
      <p style={{color:'var(--text-muted)',fontSize:'.86rem',lineHeight:1.5,marginBottom:0}}>Double-check the track and competence. Structure is validated, but answers are not checked for factual correctness. After publishing, refresh Hyperion and test the edited questions. Existing offline downloads do not automatically change.</p>
    </section>
  </div>
}
