import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePracticeStore } from '../stores/practiceStore'
import { useBookmarksStore } from '../stores/bookmarksStore'

export default function PracticeQuizScreen() {
  const navigate = useNavigate()
  const {
    questions,
    currentIndex,
    answers,
    loading,
    error,
    finished,
    mode,
    streak,
    bestStreak,
    selectAnswer,
    next,
    prev,
    score,
    reset,
    saveProgress,
    restoreSavedProgress
  } = usePracticeStore()

  const [showExitDialog, setShowExitDialog] = useState(false)
  const [textScale, setTextScale] = useState(() => Number(localStorage.getItem('hyperion-question-text-scale')) || 100)
  const [pendingAnswer, setPendingAnswer] = useState<number | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [jumpNumber, setJumpNumber] = useState('')
  const [automations, setAutomations] = useState(() => { try { return JSON.parse(localStorage.getItem('hyperion-practice-automations') || '{"directAnswer":false,"autoNextCorrect":false,"autoNextWrong":false}') as {directAnswer:boolean;autoNextCorrect:boolean;autoNextWrong:boolean} } catch { return {directAnswer:false,autoNextCorrect:false,autoNextWrong:false} } })
  useEffect(() => { const settings = (e: Event) => setAutomations((e as CustomEvent).detail); const scale = (e: Event) => setTextScale((e as CustomEvent<number>).detail); window.addEventListener('hyperion:practice-settings', settings); window.addEventListener('hyperion:text-scale', scale); return () => { window.removeEventListener('hyperion:practice-settings', settings); window.removeEventListener('hyperion:text-scale', scale) } }, [])
  const updateAutomation = (key: 'directAnswer' | 'autoNextCorrect' | 'autoNextWrong', value: boolean) => {
    setAutomations((old) => {
      const updated = { ...old, [key]: value }
      localStorage.setItem('hyperion-practice-automations', JSON.stringify(updated))
      return updated
    })
  }

  useEffect(() => {
    if (questions.length === 0) restoreSavedProgress()
  }, [])

  useEffect(() => {
    const requestExit = () => setShowExitDialog(true)
    window.addEventListener('hyperion:request-exit-practice', requestExit)
    const trapBack = () => {
      window.history.pushState({ hyperionPractice: true }, '')
      setShowExitDialog(true)
    }
    window.history.pushState({ hyperionPractice: true }, '')
    window.addEventListener('popstate', trapBack)
    return () => {
      window.removeEventListener('hyperion:request-exit-practice', requestExit)
      window.removeEventListener('popstate', trapBack)
    }
  }, [])
  const isBookmarked = useBookmarksStore((s) => s.isBookmarked)
  const toggleBookmark = useBookmarksStore((s) => s.toggle)

  if (loading) {
    return (
      <div className="screen">
        <p>Loading questions…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="screen">
        <p style={{ color: 'var(--danger)' }}>{error}</p>
        <button className="btn btn-outline" onClick={() => navigate(-1)}>
          Back
        </button>
      </div>
    )
  }

  if (questions.length === 0) {
    return (
      <div className="screen">
        <p>No session active.</p>
        <button className="btn btn-primary" onClick={() => navigate('/tracks')}>
          Select Track
        </button>
      </div>
    )
  }

  if (finished) {
    const s = score()
    return (
      <div className="screen">
        <h1 className="page-title">Results</h1>
        <div className="card" style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          <div style={{ fontSize: '2.5rem', fontWeight: 700, color: 'var(--accent)' }}>
            {s.percent}%
          </div>
          <div style={{ color: 'var(--text-muted)' }}>
            {s.correct} / {s.total} correct
          </div>
          {mode === 'DRILL' && (
            <div style={{ marginTop: 8, fontSize: '0.9rem', color: 'var(--text-muted)' }}>
              Best streak: {bestStreak}
            </div>
          )}
        </div>
        <button
          className="btn btn-primary"
          style={{ width: '100%', marginBottom: 8 }}
          onClick={() => {
            reset()
            navigate(mode === 'DRILL' ? '/drill' : mode === 'MOCK' ? '/mock' : '/practice')
          }}
        >
          Try Again
        </button>
        <button
          className="btn btn-outline"
          style={{ width: '100%', marginBottom: 8 }}
          onClick={() => {
            reset()
            navigate('/history')
          }}
        >
          View History
        </button>
        <button
          className="btn btn-outline"
          style={{ width: '100%' }}
          onClick={() => {
            reset()
            navigate('/')
          }}
        >
          Home
        </button>
      </div>
    )
  }

  const q = questions[currentIndex]
  const answer = answers[q.id]
  const hasAnswered = answer?.selectedIndex != null
  const confirmAnswer = () => { if (pendingAnswer != null) { selectAnswer(pendingAnswer); setPendingAnswer(null) } }
  const showFeedback = mode !== 'MOCK' && hasAnswered
  const bookmarked = isBookmarked(q.id)
  const jumpTo = (index: number) => { if (index >= 0 && index < questions.length) { const delta = index - currentIndex; if (delta > 0) for (let i = 0; i < delta; i++) next(); else for (let i = 0; i > delta; i--) prev(); setPendingAnswer(null); setPaletteOpen(false) } }

  return (
    <div className="screen" style={{ paddingBottom: "6rem", fontSize: `${textScale}%` }}>
      {showExitDialog && (
        <div className="exit-dialog-backdrop" role="presentation">
          <section className="exit-dialog" role="dialog" aria-modal="true" aria-labelledby="exit-practice-title">
            <h2 id="exit-practice-title">Save your progress?</h2>
            <p>Your current question and answers will be saved so you can continue reviewing later.</p>
            <button className="btn btn-primary" style={{ width: '100%', marginTop: 12 }} onClick={() => { saveProgress(); setShowExitDialog(false); navigate('/practice') }}>Save Progress &amp; Exit</button>
            <button className="btn btn-outline" style={{ width: '100%', marginTop: 8 }} onClick={() => setShowExitDialog(false)}>Continue Reviewing</button>
          </section>
        </div>
      )}
      <header style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:6,margin:'-0.5rem -0.25rem 1rem',padding:'0.4rem 0',borderBottom:'3px solid var(--accent)'}}>
        <button className="btn btn-outline" onClick={() => setShowExitDialog(true)} aria-label="Back">← Back</button>
        <div style={{minWidth:0,flex:1,textAlign:'center'}}>
          <div style={{fontWeight:800,lineHeight:1.2}}>Question {currentIndex + 1} of {questions.length}</div>
          <div style={{fontSize:'0.82rem',color:'var(--accent)',fontWeight:700}}>{q.track} · {q.competenceId}</div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:2}}>
          <button className="btn btn-outline" style={{padding:'0.5rem',minWidth:38}} onClick={() => toggleBookmark(q)} aria-label="Bookmark question" title="Bookmark">{bookmarked ? '🔖' : '♧'}</button>
          <button className="btn btn-outline" style={{padding:'0.5rem',minWidth:38}} onClick={() => setSettingsOpen(v => !v)} aria-label="Display settings" title="Display settings">⚙</button>
        </div>
      </header>
      {settingsOpen && <section className="card" style={{marginBottom:'1rem',padding:'1rem'}}>
        <strong style={{display:'block',marginBottom:10}}>DISPLAY SETTINGS</strong>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,marginBottom:12}}>
          <span>Ｔ Text Size <strong>{textScale}%</strong></span>
          <div style={{display:'flex',gap:4}}>
            <button className="btn btn-outline" onClick={() => {const n=Math.max(70,textScale-10);setTextScale(n);localStorage.setItem('hyperion-question-text-scale',String(n))}}>A−</button>
            <button className="btn btn-outline" onClick={() => {setTextScale(100);localStorage.setItem('hyperion-question-text-scale','100')}}>100%</button>
            <button className="btn btn-outline" onClick={() => {const n=Math.min(150,textScale+10);setTextScale(n);localStorage.setItem('hyperion-question-text-scale',String(n))}}>A+</button>
          </div>
        </div>
        <strong style={{display:'block',marginBottom:6}}>PRACTICE AUTOMATIONS</strong>
        {([{key:'directAnswer',label:'Direct Answer',desc:'Confirm without Check button'},{key:'autoNextCorrect',label:'Auto-Next (Correct)',desc:'Advance when correct'},{key:'autoNextWrong',label:'Auto-Next (Wrong)',desc:'Advance when incorrect'}] as const).map(item => <label key={item.key} style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,padding:'0.6rem 0',borderTop:'1px solid var(--border)'}}><span><strong>{item.label}</strong><small style={{display:'block',color:'var(--text-muted)'}}>{item.desc}</small></span><input type="checkbox" checked={automations[item.key]} onChange={e => updateAutomation(item.key,e.target.checked)} /></label>)}
      </section>}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1rem',fontSize:'0.85rem',color:'var(--text-muted)'}}>
        <span>Q {currentIndex + 1} / {questions.length}</span>
        <span>{mode === 'DRILL' && streak > 0 ? 'Streak ' + streak + ' · ' : ''}{q.competenceId}{mode !== 'DRILL' ? ' · ' + q.difficulty : ''}</span>
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 6 }}>
          {q.topic}
        </div>
        <div style={{ fontSize: '1.05rem', lineHeight: 1.55 }}>{q.questionText}</div>
      </div>

      <div style={{ display: 'grid', gap: '0.6rem' }}>
        {q.options.map((opt, idx) => {
          let border = 'var(--border)'
          let bg = 'var(--bg-card)'
          if (showFeedback) {
            if (idx === q.correctAnswerIndex) {
              border = 'var(--success)'
              bg = 'rgba(34,197,94,0.12)'
            } else if (idx === answer!.selectedIndex && !answer!.isCorrect) {
              border = 'var(--danger)'
              bg = 'rgba(239,68,68,0.12)'
            }
          } else if (
            (hasAnswered && idx === answer!.selectedIndex) ||
            (!hasAnswered && pendingAnswer === idx)
          ) {
            border = 'var(--accent)'
            bg = 'rgba(56,189,248,0.12)'
          }
          return (
            <button
              key={idx}
              onClick={() => {
                if (mode === 'MOCK') selectAnswer(idx); else if (!hasAnswered) { if (automations.directAnswer) selectAnswer(idx); else setPendingAnswer(idx) }
              }}
              disabled={mode !== 'MOCK' && hasAnswered}
              style={{
                textAlign: 'left',
                padding: '0.9rem 1rem',
                borderRadius: 10,
                border: `1px solid ${border}`,
                background: bg,
                color: 'var(--text)',
                fontSize: '0.95rem',
                cursor: mode !== 'MOCK' && hasAnswered ? 'default' : 'pointer'
              }}
            >
              <span style={{ fontWeight: 600, marginRight: 8 }}>
                {String.fromCharCode(65 + idx)}.
              </span>
              {opt}
            </button>
          )
        })}
      </div>

      {showFeedback && q.explanation && (
        <div
          className="card"
          style={{ marginTop: '1rem', fontSize: '0.9rem', color: 'var(--text-muted)' }}
        >
          <strong style={{ color: 'var(--text)' }}>Explanation</strong>
          <p style={{ marginTop: 4 }}>{q.explanation}</p>
        </div>
      )}

      {paletteOpen && <div role="presentation" onClick={() => setPaletteOpen(false)} style={{position:'fixed',inset:0,zIndex:1000,background:'rgba(0,0,0,0.72)',display:'flex',alignItems:'center',justifyContent:'center',padding:'1rem'}}>
        <section role="dialog" aria-modal="true" aria-labelledby="question-palette-title" onClick={e => e.stopPropagation()} className="card" style={{width:'min(100%,480px)',maxHeight:'85dvh',display:'flex',flexDirection:'column',padding:'1rem',borderTop:'3px solid var(--accent)',boxShadow:'0 20px 60px rgba(0,0,0,.4)'}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}><h2 id="question-palette-title" style={{margin:0,fontSize:'1.15rem'}}>QUESTION PALETTE</h2><button className="btn btn-outline" onClick={() => setPaletteOpen(false)} aria-label="Close question palette">✕</button></div>
          <p style={{color:'var(--text-muted)',fontWeight:700,letterSpacing:1,margin:'0.7rem 0'}}>{questions.length.toLocaleString()} TOTAL QUESTIONS</p>
          <div style={{overflowY:'auto',display:'grid',gridTemplateColumns:'repeat(5,minmax(0,1fr))',gap:6,padding:'2px 2px 1rem'}}>
            {questions.map((item,index) => { const saved = answers[item.id]; const current = index === currentIndex; return <button key={item.id} onClick={() => jumpTo(index)} aria-label={'Go to question ' + (index + 1)} style={{aspectRatio:'1',minWidth:0,border:'1px solid ' + (current?'var(--accent)':'var(--border)'),background:current?'var(--accent)':saved?'rgba(34,197,94,.18)':'var(--bg-card)',color:current?'white':'var(--text)',fontWeight:800,borderRadius:4}}>{index + 1}</button> })}
          </div>
          <form onSubmit={e => { e.preventDefault(); const n = Number(jumpNumber); if (Number.isInteger(n) && n >= 1 && n <= questions.length) jumpTo(n - 1) }} style={{display:'flex',gap:8,alignItems:'stretch',marginTop:8}}>
            <label style={{flex:1,color:'var(--text-muted)',fontSize:'.8rem',fontWeight:700}}>GO TO QUESTION NO.<input className="input" type="number" min="1" max={questions.length} value={jumpNumber} onChange={e => setJumpNumber(e.target.value)} placeholder={'1–' + questions.length} style={{display:'block',width:'100%',marginTop:6}} /></label>
            <button className="btn btn-primary" type="submit" disabled={!jumpNumber || Number(jumpNumber)<1 || Number(jumpNumber)>questions.length}>GO</button>
          </form>
          <button className="btn btn-primary" style={{width:'100%',marginTop:12}} onClick={() => setPaletteOpen(false)}>CLOSE</button>
        </section>
      </div>}
      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          padding: '0.75rem 1rem calc(0.75rem + env(safe-area-inset-bottom))',
          background: 'var(--bg-card)',
          borderTop: '1px solid var(--border)',
          display: 'flex',
          gap: '0.6rem',
          maxWidth: 720,
          margin: '0 auto'
        }}
      >
        <button className="btn btn-outline" style={{ flex: 1, minWidth: 0 }} onClick={prev} disabled={currentIndex === 0}>← Previous</button>
        <button className="btn btn-outline" style={{ minWidth: 54, padding: '0.65rem' }} onClick={() => { setPaletteOpen(true); setJumpNumber('') }} aria-label="Question palette" title="Question palette">▦</button>
        {mode === 'MOCK' ? <button className="btn btn-primary" style={{ flex: 1.5, minWidth: 0 }} onClick={() => next()} disabled={!hasAnswered}>{currentIndex === questions.length - 1 ? 'Finish' : 'Next'}</button> : hasAnswered ? <button className="btn btn-primary" style={{ flex: 1.5, minWidth: 0 }} onClick={() => next()}>{currentIndex === questions.length - 1 ? 'Finish' : 'Next'}</button> : <button className="btn btn-primary" style={{ flex: 1.5, minWidth: 0 }} onClick={confirmAnswer} disabled={pendingAnswer == null || automations.directAnswer}>Check Answer</button>}
      </div>
    </div>
  )
}
