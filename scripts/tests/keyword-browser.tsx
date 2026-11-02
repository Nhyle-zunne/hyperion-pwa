// Test-only entry; never imported by the application production entry.
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import KeywordHighlightSetting from '../../src/components/KeywordHighlightSetting'
import KeywordQuestionText from '../../src/components/KeywordQuestionText'
import type { TrackId } from '../../src/types/question'
registerSW({ immediate: true })
function Fixture() {
  const [id, setId] = useState('question-a')
  const [track, setTrack] = useState<TrackId>('DECK_OIC_NW')
  const [questionText, setText] = useState('Vessel gives way; vessel stays clear.')
  return <main>
    <KeywordHighlightSetting />
    <button onClick={() => setId(old => old === 'question-a' ? 'question-b' : 'question-a')}>Change question</button>
    <button onClick={() => setTrack(old => old === 'DECK_OIC_NW' ? 'ENGINE_MGT' : 'DECK_OIC_NW')}>Change track</button>
    <button onClick={() => setText('Revised question text.')}>Revise question</button>
    <KeywordQuestionText question={{ id, track, questionText }} />
  </main>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture /></React.StrictMode>)
