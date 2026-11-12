// Test-only entry; never imported by the application production entry.
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import KeywordHighlightSetting from '../../src/components/KeywordHighlightSetting'
import KeywordQuestionText, { KeywordQuestionScope, KeywordChoiceText, KeywordAnswerChoice } from '../../src/components/KeywordQuestionText'
import { writeEncryptedPersistedValue } from '../../src/lib/encryptedPersistStorage'
import type { TrackId } from '../../src/types/question'
registerSW({ immediate: true })
function Fixture() {
  const [id, setId] = useState('question-a')
  const [track, setTrack] = useState<TrackId>('DECK_OIC_NW')
  const [questionText, setText] = useState('Vessel gives way; vessel stays clear.')
  const [options, setOptions] = useState(['Port, not starboard.', "Keep clear: _____! ship's give-way"])
  const [legacySeeded, setLegacySeeded] = useState(false)
  const [answer, setAnswer] = useState('No answer')
  const question = { id, track, questionText, options }
  return <main>
    <KeywordHighlightSetting />
    <button onClick={async () => {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([track, id, questionText])))
      const key = 'hyperion-keywords:' + [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
      await writeEncryptedPersistedValue(key, JSON.stringify([0, 2]))
      setLegacySeeded(true)
    }}>Seed legacy highlights</button>
    {legacySeeded && <output>Legacy highlights seeded</output>}
    <button onClick={() => setId(old => old === 'question-a' ? 'question-b' : 'question-a')}>Change question</button>
    <button onClick={() => setTrack(old => old === 'DECK_OIC_NW' ? 'ENGINE_MGT' : 'DECK_OIC_NW')}>Change track</button>
    <button onClick={() => setText('Revised question text.')}>Revise question</button>
    <button onClick={() => setOptions(old => [...old].reverse())}>Shuffle choices</button>
    <button onClick={() => setOptions(old => old.map(text => text === 'Port, not starboard.' ? 'Revised choice?' : text))}>Revise choice</button>
    <output aria-label="Selected answer">{answer}</output>
    <KeywordQuestionScope question={question}>
      <div id="stem"><KeywordQuestionText question={question} /></div>
      {options.map(text => <KeywordAnswerChoice key={text} className="fixture-choice" onClick={() => setAnswer(text)}>
        <KeywordChoiceText text={text} />
      </KeywordAnswerChoice>)}
    </KeywordQuestionScope>
  </main>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture /></React.StrictMode>)
