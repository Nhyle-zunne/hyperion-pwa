import { Fragment, useEffect, useState } from 'react'
import type { Question } from '../types/question'
import { useKeywordSettings } from '../stores/keywordSettings'
import { readEncryptedPersistedValue, writeEncryptedPersistedValue } from '../lib/encryptedPersistStorage'

type Identity = Pick<Question, 'id' | 'track' | 'questionText'>

export default function KeywordQuestionText({ question, headingId }: { question: Identity; headingId?: string }) {
  const enabled = useKeywordSettings(state => state.enabled)
  // Remount the draft when navigating or toggling; unsaved changes never leak.
  return <KeywordEditor key={JSON.stringify([question.track, question.id, question.questionText, enabled])} question={question} enabled={enabled} headingId={headingId} />
}

function KeywordEditor({ question, enabled, headingId }: { question: Identity; enabled: boolean; headingId?: string }) {
  const text = question.questionText
  const words = [...text.matchAll(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu)]
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [storageKey, setStorageKey] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!enabled) return
    let active = true
    void (async () => {
      try {
        const identity = JSON.stringify([question.track, question.id, text])
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity))
        const key = 'hyperion-keywords:' + [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
        const raw = await readEncryptedPersistedValue(key)
        const saved: unknown = raw === null ? [] : JSON.parse(raw)
        if (!Array.isArray(saved)) throw new Error('Invalid keyword data')
        if (active) {
          setSelected(new Set(saved.filter((index): index is number => Number.isInteger(index) && index >= 0 && index < words.length)))
          setStorageKey(key)
        }
      } catch {
        if (active) setError('Saved keywords could not be loaded. Please try reopening this question.')
      }
    })()
    return () => { active = false }
  }, [enabled, question.id, question.track, text, words.length])

  const save = async () => {
    if (!storageKey) return
    setSaving(true)
    setError('')
    try {
      await writeEncryptedPersistedValue(storageKey, JSON.stringify([...selected].sort((a, b) => a - b)))
      setEditing(false)
    } catch {
      setError('Keywords could not be saved. Your selections are still here; please try again.')
    } finally {
      setSaving(false)
    }
  }
  let cursor = 0
  const content = words.map((word, index) => {
    const prefix = text.slice(cursor, word.index)
    cursor = word.index! + word[0].length
    const highlighted = enabled && selected.has(index)
    const wordStyle = { background: highlighted ? '#ffdf70' : 'transparent', color: highlighted ? '#171717' : 'inherit' }
    return <Fragment key={index}>{prefix}{enabled && editing ? <button
      type="button" aria-label={`Highlight word ${index + 1}: ${word[0]}`} aria-pressed={highlighted} disabled={saving}
      style={{ ...wordStyle, display: 'inline', font: 'inherit', lineHeight: 'inherit', letterSpacing: 'inherit', border: 0, borderRadius: 0, padding: 0, margin: 0, cursor: 'pointer', textAlign: 'inherit' }}
      onClick={() => setSelected(old => {
        const next = new Set(old)
        if (next.has(index)) next.delete(index)
        else next.add(index)
        return next
      })}
    >{word[0]}</button> : highlighted ? <mark style={wordStyle}>{word[0]}</mark> : word[0]}</Fragment>
  })
  return <>
    {enabled && editing && <p style={{ fontSize: '.8rem', color: 'var(--text-muted)', margin: '0 0 .5rem' }}>Tap words to highlight or remove highlights.</p>}
    <div id={headingId} role={headingId ? 'heading' : undefined} aria-level={headingId ? 2 : undefined}>{content}{text.slice(cursor)}</div>
    {enabled && <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
      <button type="button" className={editing ? 'btn btn-primary' : 'btn btn-outline'} disabled={!storageKey || saving} style={{ fontSize: '.8rem', padding: '.35rem .6rem', ...(editing ? { background: '#15803d', borderColor: '#15803d', color: '#ffffff' } : {}) }} onClick={() => editing ? void save() : setEditing(true)}>
        {saving ? 'Saving…' : editing ? 'Save Keywords' : 'Edit Keyword'}
      </button>
    </div>}
    {error && <p role="alert" style={{ fontSize: '.8rem', color: 'var(--danger)' }}>{error}</p>}
  </>
}
