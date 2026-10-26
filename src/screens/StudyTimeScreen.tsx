import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStudyTimeStore, formatDurationMs, type StudySegment } from '../stores/studyTimeStore'

type Tab = 'PERIOD' | 'DAY' | 'WEEK' | 'MONTH' | 'TREND'
const TABS: Tab[] = ['PERIOD', 'DAY', 'WEEK', 'MONTH', 'TREND']
const DAY_MS = 86_400_000
const TRACK_COLORS = ['#22c55e', '#06b6d4', '#f59e0b', '#a78bfa', '#f97316', '#e879f9']
const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
const dayLabel = (key: string) => {
  const date = new Date(`${key}T12:00:00`)
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}
const weekStart = (date: Date) => {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d
}
const fmtDate = (date: Date, options: Intl.DateTimeFormatOptions) => date.toLocaleDateString(undefined, options)

function Panel({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return <section className={`st-panel ${className}`}><h2 className="st-panel-title">{title}</h2>{children}</section>
}
function EmptyState() {
  return <div className="st-empty"><span className="st-empty-mark">◷</span><strong>NO STUDY TIME RECORDED</strong><span>Complete a practice, drill, or mock session to see your telemetry here.</span></div>
}
function Stat({ label, value }: { label: string; value: string }) {
  return <div className="st-stat"><span>{label}</span><strong>{value}</strong></div>
}
function DateNav({ title, onPrev, onNext }: { title: string; onPrev: () => void; onNext: () => void }) {
  return <div className="st-date-nav"><button type="button" aria-label="Previous period" onClick={onPrev}>‹</button><strong>{title}</strong><button type="button" aria-label="Next period" onClick={onNext}>›</button></div>
}
function DailyBars({ rows }: { rows: { label: string; ms: number }[] }) {
  const max = Math.max(1, ...rows.map(r => r.ms))
  return <div className="st-daily-bars">{rows.map((row, i) => <div className="st-daily-row" key={row.label + i}><span className="st-daily-label">{row.label}</span><div className="st-bar-track"><div className="st-bar-fill" style={{ width: `${row.ms / max * 100}%` }} /></div><span className="st-daily-value">{row.ms ? formatDurationMs(row.ms) : '—'}</span></div>)}</div>
}
function CumulativeChart({ segments, date }: { segments: StudySegment[]; date: Date }) {
  const points = useMemo(() => {
    const start = startOfDay(date)
    const values = Array.from({ length: 25 }, (_, hour) => {
      const edge = start + hour * 3_600_000
      return segments.reduce((sum, s) => {
        const segStart = s.at - s.durationMs
        const segEnd = s.at
        return sum + Math.max(0, Math.min(edge, segEnd) - Math.max(start, segStart))
      }, 0) / 60_000
    })
    const max = Math.max(1, ...values)
    return values.map((v, i) => ({ x: 36 + i * 4.5, y: 88 - (v / max) * 68, value: v }))
  }, [segments, date])
  const pointsString = points.map(p => `${p.x},${p.y}`).join(' ')
  return <div className="st-chart-wrap"><svg className="st-line-chart" viewBox="0 0 145 110" role="img" aria-label="Cumulative study time across 24 hours"><line x1="36" y1="20" x2="144" y2="20" className="st-gridline"/><line x1="36" y1="54" x2="144" y2="54" className="st-gridline"/><line x1="36" y1="88" x2="144" y2="88" className="st-gridline"/><text x="2" y="23" className="st-axis-label">{formatDurationMs(Math.max(0, ...points.map(p => p.value)) * 60_000)}</text><text x="2" y="57" className="st-axis-label">½ max</text><text x="2" y="91" className="st-axis-label">0m</text><polyline points={pointsString} className="st-chart-line"/>{points.filter((_,i)=>i%4===0).map(p=><circle key={p.x} cx={p.x} cy={p.y} r="1.6" className="st-chart-dot"/>) }{[0,6,12,18,24].map((h,i)=><text key={h} x={36+h*4.5} y="104" textAnchor={i===0?'start':i===4?'end':'middle'} className="st-axis-label">{String(h).padStart(2,'0')}:00</text>)}</svg></div>
}
function Donut({ segments }: { segments: StudySegment[] }) {
  const grouped = useMemo(() => {
    const map = new Map<string, number>()
    for (const s of segments) { const key = s.track || 'Unknown track'; map.set(key, (map.get(key) || 0) + s.durationMs) }
    return [...map.entries()].sort((a,b)=>b[1]-a[1]).map(([track,ms],i)=>({track,ms,color:TRACK_COLORS[i%TRACK_COLORS.length]}))
  }, [segments])
  const total = grouped.reduce((sum,g)=>sum+g.ms,0)
  let cursor = 0
  const gradient = grouped.map(g=>{const from=cursor; cursor += total ? g.ms/total*100 : 0; return `${g.color} ${from}% ${cursor}%`}).join(', ')
  if (!total) return <p className="st-muted">No track breakdown for this period.</p>
  return <div className="st-donut-layout"><div className="st-donut" style={{background:`conic-gradient(${gradient})`}} role="img" aria-label="Study time breakdown by track"><div className="st-donut-hole"><strong>{formatDurationMs(total)}</strong><span>TOTAL</span></div></div><div className="st-legend">{grouped.map(g=><div className="st-legend-row" key={g.track}><span className="st-legend-swatch" style={{background:g.color}}/><span className="st-legend-name">{g.track.replaceAll('_',' ')}</span><strong>{Math.round(g.ms/total*100)}%</strong><small>{formatDurationMs(g.ms)}</small></div>)}</div></div>
}
function HourGrid({ segments, date }: { segments: StudySegment[]; date: Date }) {
  const values = Array.from({length:24},(_,hour)=>{
    const a=startOfDay(date)+hour*3_600_000, b=a+3_600_000
    return segments.reduce((sum,s)=>sum+Math.max(0,Math.min(b,s.at)-Math.max(a,s.at-s.durationMs)),0)
  })
  const max=Math.max(1,...values)
  return <div className="st-hour-grid">{values.map((ms,h)=><div key={h} className="st-hour-cell" title={`${String(h).padStart(2,'0')}:00 · ${formatDurationMs(ms)}`} style={{background:ms? `color-mix(in srgb, var(--accent) ${Math.max(12,ms/max*100)}%, var(--bg-elevated))`: 'var(--bg-elevated)'}}><strong>{String(h).padStart(2,'0')}</strong><span>{ms?formatDurationMs(ms):'—'}</span></div>)}</div>
}

export default function StudyTimeScreen() {
  const navigate = useNavigate()
  const segments = useStudyTimeStore(s => s.segments)
  const clear = useStudyTimeStore(s => s.clear)
  const [tab,setTab] = useState<Tab>('DAY')
  const [selectedDate,setSelectedDate] = useState(()=>new Date())
  const [selectedMonth,setSelectedMonth] = useState(()=>new Date(new Date().getFullYear(),new Date().getMonth(),1))
  const totalMs=useMemo(()=>segments.reduce((sum,s)=>sum+s.durationMs,0),[segments])
  const selectedKey=dateKey(selectedDate)
  const selectedDay=useMemo(()=>segments.filter(s=>s.day===selectedKey),[segments,selectedKey])
  const selectedDayMs=selectedDay.reduce((sum,s)=>sum+s.durationMs,0)
  const week=weekStart(selectedDate)
  const weekEnd=new Date(week); weekEnd.setDate(week.getDate()+7)
  const weekSegments=useMemo(()=>segments.filter(s=>s.at>=startOfDay(week)&&s.at<startOfDay(weekEnd)),[segments,selectedKey])
  const monthStart=new Date(selectedMonth.getFullYear(),selectedMonth.getMonth(),1)
  const monthEnd=new Date(selectedMonth.getFullYear(),selectedMonth.getMonth()+1,1)
  const monthSegments=useMemo(()=>segments.filter(s=>s.at>=startOfDay(monthStart)&&s.at<startOfDay(monthEnd)),[segments,selectedMonth.getTime()])
  const allDays=useMemo(()=>new Set(segments.map(s=>s.day)).size,[segments])
  const dayStats=useMemo(()=>{
    if(!selectedDay.length) return {maxFocus:0,start:null as number|null,end:null as number|null}
    const sorted=[...selectedDay].sort((a,b)=>(a.at-a.durationMs)-(b.at-b.durationMs))
    let run=sorted[0].durationMs, maxFocus=run
    for(let i=1;i<sorted.length;i++){const prev=sorted[i-1],curr=sorted[i];const gap=(curr.at-curr.durationMs)-prev.at;run=gap>=0&&gap<=120_000?run+curr.durationMs:curr.durationMs;maxFocus=Math.max(maxFocus,run)}
    return {maxFocus,start:Math.min(...selectedDay.map(s=>s.at-s.durationMs)),end:Math.max(...selectedDay.map(s=>s.at))}
  },[selectedDay])
  const focusClock=(ts:number|null)=>ts==null?'—':new Date(ts).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})
  const last14=useMemo(()=>Array.from({length:14},(_,i)=>{const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()-i);const key=dateKey(d);return {label:key.slice(5),ms:segments.filter(s=>s.day===key).reduce((sum,s)=>sum+s.durationMs,0)}}).reverse(),[segments])
  const monthDays=Array.from({length:monthStart.getDay()},()=>null as number|null).concat(Array.from({length:new Date(monthStart.getFullYear(),monthStart.getMonth()+1,0).getDate()},(_,i)=>i+1))
  const monthTotal=monthSegments.reduce((sum,s)=>sum+s.durationMs,0)
  const periodGroups=useMemo(()=>{const map=new Map<string,number>();segments.forEach(s=>map.set(s.day,(map.get(s.day)||0)+s.durationMs));return [...map.entries()].sort((a,b)=>a[0].localeCompare(b[0]))},[segments])
  const changeDay=(delta:number)=>setSelectedDate(d=>{const n=new Date(d);n.setDate(n.getDate()+delta);return n})
  const displayTime=(ms:number)=>formatDurationMs(ms)
  const headingDate=fmtDate(selectedDate,{year:'numeric',month:'2-digit',day:'2-digit'}).replaceAll('/','.')+` (${fmtDate(selectedDate,{weekday:'short'}).toUpperCase()})`

  return <div className="screen st-screen">
    <style>{`
      .st-screen{width:100%;max-width:1200px;padding:clamp(.65rem,2.5vw,1.5rem);padding-bottom:6rem;margin:0 auto}
      .st-header{display:flex;align-items:center;justify-content:space-between;gap:1rem;margin:0 0 1rem;padding:.25rem 0 1rem;border-bottom:1px solid var(--border)}
      .st-eyebrow{color:var(--accent);font-size:.72rem;font-weight:800;letter-spacing:.12em;text-transform:uppercase}
      .st-screen .page-title{font-size:clamp(1.25rem,2.6vw,1.8rem);margin:0}
      .st-subtitle{font-size:.88rem;color:var(--text-muted);margin-top:.15rem}
      .st-tabs{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:2px;padding:3px;border:1px solid var(--border);background:var(--bg-card);margin-bottom:1rem}
      .st-tab{min-width:0;min-height:42px;padding:.55rem .2rem;color:var(--text-muted);font-size:clamp(.58rem,1.2vw,.75rem);font-weight:800;letter-spacing:.04em}
      .st-tab[aria-pressed=true]{background:var(--accent);color:#fff}
      .st-content{display:grid;grid-template-columns:minmax(0,1fr);gap:1rem}
      .st-panel{min-width:0;background:var(--bg-card);border:1px solid var(--border);padding:clamp(.85rem,2vw,1.25rem);overflow:hidden}
      .st-panel-title{font-size:.76rem;font-weight:850;letter-spacing:.07em;color:var(--text-muted);margin:0 0 1rem;text-transform:uppercase}
      .st-date-nav{display:grid;grid-template-columns:44px minmax(0,1fr) 44px;align-items:center;gap:.5rem;border:1px solid var(--border);background:var(--bg-card);margin-bottom:1rem;min-height:48px}
      .st-date-nav button{height:46px;font-size:1.8rem;color:var(--accent);touch-action:manipulation}
      .st-date-nav strong{text-align:center;font-size:clamp(.7rem,2.2vw,.9rem);font-variant-numeric:tabular-nums}
      .st-stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.65rem;margin-bottom:1rem}
      .st-stat{min-width:0;border:1px solid var(--border);background:var(--bg-card);padding:.85rem}
      .st-stat span{display:block;font-size:.65rem;letter-spacing:.06em;font-weight:800;color:var(--text-muted);margin-bottom:.35rem}
      .st-stat strong{display:block;color:var(--accent);font-size:clamp(1rem,3vw,1.4rem);overflow-wrap:anywhere;font-variant-numeric:tabular-nums}
      .st-chart-wrap{width:100%;min-width:0}.st-line-chart{width:100%;height:auto;display:block;overflow:visible}
      .st-gridline{stroke:var(--border);stroke-width:.5;stroke-dasharray:2 2}.st-chart-line{fill:none;stroke:var(--accent);stroke-width:1.8;stroke-linejoin:round;stroke-linecap:square}.st-chart-dot{fill:var(--accent)}.st-axis-label{font-size:3.2px;fill:var(--text-muted)}
      .st-donut-layout{display:grid;grid-template-columns:minmax(100px,.8fr) minmax(0,1.2fr);align-items:center;gap:1rem}
      .st-donut{width:min(100%,190px);aspect-ratio:1;border-radius:50%;display:grid;place-items:center;margin:auto}
      .st-donut-hole{width:62%;height:62%;border-radius:50%;background:var(--bg-card);display:flex;flex-direction:column;align-items:center;justify-content:center;min-width:0}
      .st-donut-hole strong{font-size:clamp(.7rem,2vw,1rem);text-align:center;overflow-wrap:anywhere}.st-donut-hole span{font-size:.55rem;color:var(--text-muted);font-weight:800}
      .st-legend{display:grid;gap:.65rem;min-width:0}.st-legend-row{display:grid;grid-template-columns:9px minmax(0,1fr) auto;gap:.4rem;align-items:center;font-size:.75rem}.st-legend-swatch{width:8px;height:8px}.st-legend-name{overflow-wrap:anywhere}.st-legend-row strong{font-variant-numeric:tabular-nums}.st-legend-row small{grid-column:2/4;color:var(--text-muted);font-size:.68rem}
      .st-hour-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:5px}.st-hour-cell{min-width:0;min-height:52px;border:1px solid var(--border);padding:.4rem;display:flex;flex-direction:column;justify-content:space-between}.st-hour-cell strong{font-size:.72rem}.st-hour-cell span{font-size:.64rem;color:var(--text-muted);overflow-wrap:anywhere}
      .st-daily-bars{display:grid;gap:.7rem}.st-daily-row{display:grid;grid-template-columns:44px minmax(0,1fr) minmax(48px,auto);align-items:center;gap:.6rem}.st-daily-label,.st-daily-value{font-size:.7rem;color:var(--text-muted);font-variant-numeric:tabular-nums}.st-daily-value{text-align:right}.st-bar-track{height:10px;background:var(--bg-elevated);overflow:hidden}.st-bar-fill{height:100%;background:var(--accent);min-width:0}
      .st-empty{border:1px dashed var(--border);background:var(--bg-card);padding:2.5rem 1rem;display:flex;flex-direction:column;align-items:center;text-align:center;gap:.6rem;color:var(--text-muted)}.st-empty-mark{font-size:2rem;color:var(--accent)}.st-empty strong{font-size:.8rem;letter-spacing:.06em;color:var(--text)}.st-empty span:last-child{font-size:.85rem;max-width:30rem}.st-muted{font-size:.82rem;color:var(--text-muted)}
      .st-calendar{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}.st-calendar button,.st-calendar span{min-width:0;aspect-ratio:1;display:grid;place-items:center;font-size:.78rem}.st-calendar button{border:1px solid var(--border);background:var(--bg-elevated);color:var(--text);position:relative}.st-calendar button[data-active=true]{outline:2px solid var(--accent);outline-offset:-2px}.st-calendar button[data-time=true]{background:var(--accent-soft)}.st-weekday{font-size:.65rem;color:var(--text-muted);font-weight:800}
      .st-toolbar{display:flex;align-items:center;justify-content:space-between;gap:.75rem;flex-wrap:wrap;margin-bottom:1rem}.st-toolbar button{border:1px solid var(--border);padding:.5rem .75rem;color:var(--text);min-height:40px}.st-toolbar strong{font-size:.9rem}
      .st-two-col{display:grid;grid-template-columns:minmax(0,1fr);gap:1rem}
      .st-footer-actions{display:flex;gap:.5rem;flex-wrap:wrap;margin-top:1rem}.st-footer-actions .btn{flex:1;min-width:150px}
      @media(min-width:560px){.st-stats{grid-template-columns:repeat(4,minmax(0,1fr))}.st-hour-grid{grid-template-columns:repeat(6,minmax(0,1fr))}.st-two-col{grid-template-columns:repeat(2,minmax(0,1fr))}.st-tabs{gap:4px}.st-tab{font-size:.75rem}}
      @media(min-width:900px){.st-content.st-day-layout{grid-template-columns:minmax(0,1.15fr) minmax(320px,.85fr)}.st-content.st-day-layout .st-day-wide{grid-column:1/-1}.st-hour-grid{grid-template-columns:repeat(8,minmax(0,1fr))}.st-two-col{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @media(min-width:1200px){.st-hour-grid{grid-template-columns:repeat(12,minmax(0,1fr))}}
      @media(max-width:380px){.st-donut-layout{grid-template-columns:minmax(85px,.75fr) minmax(0,1.25fr);gap:.55rem}.st-legend-row{font-size:.68rem}.st-hour-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.st-date-nav{grid-template-columns:36px minmax(0,1fr) 36px}}
    `}</style>
    <header className="st-header"><div><div className="st-eyebrow">Hyperion · Learning Analytics</div><h1 className="page-title">Study Time</h1><p className="st-subtitle">Telemetry &amp; Analytics · Actual recorded study sessions</p></div><div className="st-eyebrow">{segments.length} RECORDS</div></header>
    <div className="st-tabs" role="group" aria-label="Study time period">{TABS.map(t=><button key={t} type="button" className="st-tab" aria-pressed={tab===t} onClick={()=>setTab(t)}>{t}</button>)}</div>
    {segments.length===0 ? <><EmptyState/><div className="st-footer-actions"><button className="btn btn-outline" onClick={()=>navigate('/history')}>View session history</button></div></> : <>
      {tab==='DAY'&&<DateNav title={headingDate} onPrev={()=>changeDay(-1)} onNext={()=>changeDay(1)}/>}
      {tab==='WEEK'&&<DateNav title={`${fmtDate(week,{month:'short',day:'numeric'})} – ${fmtDate(new Date(week.getTime()+6*DAY_MS),{month:'short',day:'numeric',year:'numeric'})}`} onPrev={()=>changeDay(-7)} onNext={()=>changeDay(7)}/>}
      {tab==='MONTH'&&<DateNav title={fmtDate(selectedMonth,{month:'long',year:'numeric'})} onPrev={()=>setSelectedMonth(d=>new Date(d.getFullYear(),d.getMonth()-1,1))} onNext={()=>setSelectedMonth(d=>new Date(d.getFullYear(),d.getMonth()+1,1))}/>}
      {tab==='DAY'&&<div className="st-stats"><Stat label="TOTAL STUDY TIME" value={displayTime(selectedDayMs)}/><Stat label="MAX FOCUS TIME" value={displayTime(dayStats.maxFocus)}/><Stat label="START TIME" value={focusClock(dayStats.start)}/><Stat label="END TIME" value={focusClock(dayStats.end)}/></div>}
      {tab==='PERIOD'&&<div className="st-stats"><Stat label="ALL-TIME STUDY TIME" value={displayTime(totalMs)}/><Stat label="ACTIVE DAYS" value={String(allDays)}/><Stat label="RECORDED SEGMENTS" value={String(segments.length)}/><Stat label="DAILY AVERAGE" value={displayTime(allDays?totalMs/allDays:0)}/></div>}
      {tab==='WEEK'&&<div className="st-stats"><Stat label="WEEK TOTAL" value={displayTime(weekSegments.reduce((s,x)=>s+x.durationMs,0))}/><Stat label="ACTIVE DAYS" value={String(new Set(weekSegments.map(s=>s.day)).size)}/><Stat label="SESSIONS" value={String(weekSegments.length)}/><Stat label="DAILY AVERAGE" value={displayTime(weekSegments.reduce((s,x)=>s+x.durationMs,0)/Math.max(1,new Set(weekSegments.map(s=>s.day)).size))}/></div>}
      {tab==='MONTH'&&<div className="st-stats"><Stat label="MONTH TOTAL" value={displayTime(monthTotal)}/><Stat label="ACTIVE DAYS" value={String(new Set(monthSegments.map(s=>s.day)).size)}/><Stat label="SESSIONS" value={String(monthSegments.length)}/><Stat label="DAILY AVERAGE" value={displayTime(monthTotal/Math.max(1,new Set(monthSegments.map(s=>s.day)).size))}/></div>}
      {tab==='DAY'&&<div className="st-content st-day-layout"><Panel title="CUMULATIVE STUDY TIME · 24 HOURS" className="st-day-wide"><CumulativeChart segments={selectedDay} date={selectedDate}/></Panel><Panel title="BREAKDOWN BY TRACK"><Donut segments={selectedDay}/></Panel><Panel title="HOURLY TIMELINE · 24 HOURS" className="st-day-wide"><HourGrid segments={selectedDay} date={selectedDate}/></Panel></div>}
      {tab==='PERIOD'&&<div className="st-content st-two-col"><Panel title="ALL-TIME DAILY RECORD"><DailyBars rows={periodGroups.slice(-30).map(([day,ms])=>({label:day.slice(5),ms}))}/></Panel><Panel title="BREAKDOWN BY TRACK"><Donut segments={segments}/></Panel></div>}
      {tab==='WEEK'&&<div className="st-content st-two-col"><Panel title="WEEKLY DAILY TOTALS"><DailyBars rows={Array.from({length:7},(_,i)=>{const d=new Date(week);d.setDate(d.getDate()+i);const key=dateKey(d);return {label:fmtDate(d,{weekday:'short'}).toUpperCase(),ms:weekSegments.filter(s=>s.day===key).reduce((sum,s)=>sum+s.durationMs,0)}})}/></Panel><Panel title="BREAKDOWN BY TRACK"><Donut segments={weekSegments}/></Panel></div>}
      {tab==='MONTH'&&<div className="st-content"><Panel title={`CALENDAR · ${fmtDate(selectedMonth,{month:'long',year:'numeric'}).toUpperCase()}`}><div className="st-calendar">{['M','T','W','T','F','S','S'].map((d,i)=><span key={d+i} className="st-weekday">{d}</span>)}{monthDays.map((day,i)=>{if(day===null)return <span key={'blank'+i}/>;const date=new Date(selectedMonth.getFullYear(),selectedMonth.getMonth(),day);const key=dateKey(date);const ms=monthSegments.filter(s=>s.day===key).reduce((sum,s)=>sum+s.durationMs,0);return <button key={key} type="button" data-active={key===selectedKey} data-time={ms>0} title={`${key}: ${displayTime(ms)}`} onClick={()=>{setSelectedDate(date);setTab('DAY')}}>{day}</button>})}</div><p className="st-muted" style={{marginTop:12}}>Select a date to inspect its day telemetry. Monthly total: <strong>{displayTime(monthTotal)}</strong></p></Panel><Panel title="DAILY TOTALS"><DailyBars rows={Array.from({length:new Date(selectedMonth.getFullYear(),selectedMonth.getMonth()+1,0).getDate()},(_,i)=>{const d=new Date(selectedMonth.getFullYear(),selectedMonth.getMonth(),i+1);const key=dateKey(d);return {label:String(i+1),ms:monthSegments.filter(s=>s.day===key).reduce((sum,s)=>sum+s.durationMs,0)}})}/></Panel><Panel title="BREAKDOWN BY TRACK"><Donut segments={monthSegments}/></Panel></div>}
      {tab==='TREND'&&<div className="st-content st-two-col"><Panel title="LAST 14 DAYS · DAILY STUDY TIME"><DailyBars rows={last14}/></Panel><Panel title="TRACK BREAKDOWN · ALL TIME"><Donut segments={segments}/><p className="st-muted" style={{marginTop:12}}>Total recorded study time: <strong>{displayTime(totalMs)}</strong></p></Panel></div>}
      <div className="st-footer-actions"><button className="btn btn-outline" onClick={()=>navigate('/history')}>View session history</button>{totalMs>0&&<button className="btn btn-outline" style={{color:'var(--danger)'}} onClick={()=>{if(window.confirm('Reset all study time data on this device? This cannot be undone.'))clear()}}>Reset study time</button>}</div>
    </>}
  </div>
}
