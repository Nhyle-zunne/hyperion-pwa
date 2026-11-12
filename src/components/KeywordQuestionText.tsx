import { createContext, Fragment, useContext, useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import type { Question } from '../types/question'
import { useKeywordSettings } from '../stores/keywordSettings'
import { readEncryptedPersistedValue, writeEncryptedPersistedValue } from '../lib/encryptedPersistStorage'
import { keywordTokens, readKeywordSelection, toggleKeywordToken } from '../lib/keywordTokens'

type Identity = Pick<Question, 'id' | 'track' | 'questionText'> & { options?: string[] }
type Selections = Record<string, Set<number>>
type Editor = {
  enabled: boolean; editing: boolean; saving: boolean; ready: boolean; error: string
  selected: Selections; choiceKeys: Map<string, string>
  toggle: (field: string, id: number, text: string) => void
  edit: () => void; save: () => Promise<void>
}
const KeywordContext = createContext<Editor | null>(null)
const digest = async (text: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(byte => byte.toString(16).padStart(2, '0')).join('')
function savedChoicePositions(raw: unknown): Record<string, number[]> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid keyword data')
  for (const [field, positions] of Object.entries(raw)) {
    if (!/^[a-f0-9]{64}$/.test(field) || !Array.isArray(positions) || positions.some(id => !Number.isSafeInteger(id) || id < 0)) throw new Error('Invalid keyword data')
  }
  return raw as Record<string, number[]>
}

/** One draft and save operation for a question and all of its choices. */
export function KeywordQuestionScope({ question, children, onEditingChange }: { question: Identity; children: ReactNode; onEditingChange?: (editing: boolean) => void }) {
  const enabled = useKeywordSettings(state => state.enabled)
  const choices = JSON.stringify([...new Set(question.options || [])].sort())
  return <KeywordSession key={JSON.stringify([question.track, question.id, question.questionText, choices, enabled])} question={question} choices={choices} enabled={enabled} onEditingChange={onEditingChange}>{children}</KeywordSession>
}

function KeywordSession({ question, choices, enabled, children, onEditingChange }: { question: Identity; choices: string; enabled: boolean; children: ReactNode; onEditingChange?: (editing: boolean) => void }) {
  const [selected, setSelected] = useState<Selections>({ question: new Set() })
  const [savedChoices, setSavedChoices] = useState<Record<string, number[]>>({})
  const [choiceKeys, setChoiceKeys] = useState(new Map<string, string>())
  const [storageKey, setStorageKey] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const { id, track, questionText: text } = question
  useEffect(() => { onEditingChange?.(editing); return () => onEditingChange?.(false) }, [editing, onEditingChange])
  useEffect(() => {
    if (!enabled) return
    let active = true
    void (async () => {
      try {
        // Retain the old key and accept the old array format for stem highlights.
        const key = 'hyperion-keywords:' + await digest(JSON.stringify([track, id, text]))
        const keys = new Map<string, string>(await Promise.all((JSON.parse(choices) as string[]).map(async choice => [choice, await digest(JSON.stringify(['choice', choice]))] as const)))
        const raw = await readEncryptedPersistedValue(key)
        const saved = raw === null ? [] : JSON.parse(raw)
        if (!Array.isArray(saved) && (saved?.version !== 2 || !Array.isArray(saved.question) || !saved.choices || typeof saved.choices !== 'object' || Array.isArray(saved.choices))) throw new Error('Invalid keyword data')
        const previousChoices = Array.isArray(saved) ? {} : savedChoicePositions(saved.choices)
        const next: Selections = { question: readKeywordSelection(Array.isArray(saved) ? saved : saved.question, text, Array.isArray(saved)) }
        for (const [choice, field] of keys) next[field] = readKeywordSelection(previousChoices[field] ?? [], choice)
        if (active) { setSelected(next); setSavedChoices(previousChoices); setChoiceKeys(keys); setStorageKey(key) }
      } catch {
        if (active) setError('Saved keywords could not be loaded. Please try reopening this question.')
      }
    })()
    return () => { active = false }
  }, [enabled, id, track, text, choices])

  const save = async () => {
    if (!storageKey || saving) return
    setSaving(true)
    setError('')
    try {
      const positions = (field: string) => [...(selected[field] || [])].sort((a, b) => a - b)
      // Retain other exact choice revisions used by historical sessions.
      const latestRaw = await readEncryptedPersistedValue(storageKey)
      const latest = latestRaw === null ? [] : JSON.parse(latestRaw)
      const latestChoices = Array.isArray(latest) ? {} : savedChoicePositions(latest.choices)
      const choices = { ...savedChoices, ...latestChoices, ...Object.fromEntries([...choiceKeys.values()].map(field => [field, positions(field)])) }
      await writeEncryptedPersistedValue(storageKey, JSON.stringify({ version: 2, question: positions('question'), choices }))
      setSavedChoices(choices)
      setEditing(false)
    } catch {
      setError('Keywords could not be saved. Your selections are still here; please try again.')
    } finally { setSaving(false) }
  }
  const editor: Editor = {
    enabled, editing, saving, error, selected, choiceKeys, ready: storageKey !== null,
    edit: () => setEditing(true), save,
    toggle: (field, token, text) => {
      if (!editing || saving) return
      setSelected(old => ({ ...old, [field]: toggleKeywordToken(old[field] || new Set(), token, text) }))
    }
  }
  return <KeywordContext.Provider value={editor}>{children}</KeywordContext.Provider>
}

function KeywordText({ text, field }: { text: string; field: string }) {
  const editor = useContext(KeywordContext)
  if (!editor?.enabled) return <>{text}</>
  let cursor = 0
  const content = keywordTokens(text).map(token => {
    const prefix = text.slice(cursor, token.start)
    cursor = token.end
    const highlighted = editor.selected[field]?.has(token.id) === true
    const style = { background: highlighted ? '#ffdf70' : 'transparent', color: highlighted ? '#171717' : 'inherit' }
    return <Fragment key={token.start}>{prefix}{editor.editing ? <button
      type="button" aria-label={`Highlight ${token.kind} ${token.id + 1}: ${token.label}`} aria-pressed={highlighted} disabled={editor.saving}
      style={{ ...style, display: 'inline', font: 'inherit', lineHeight: 'inherit', letterSpacing: 'inherit', border: 0, borderRadius: 0, padding: 0, margin: 0, cursor: 'pointer', textAlign: 'inherit' }}
      onClick={() => editor.toggle(field, token.id, text)}
    >{token.text}</button> : highlighted ? <mark style={style}>{token.text}</mark> : token.text}</Fragment>
  })
  return <>{content}{text.slice(cursor)}</>
}

export function KeywordChoiceText({ text }: { text: string }) {
  const editor = useContext(KeywordContext)
  const field = editor?.choiceKeys.get(text)
  return field ? <KeywordText text={text} field={field} /> : <>{text}</>
}

/** Editing uses a non-answer container, never buttons nested inside answer buttons. */
export function KeywordAnswerChoice({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  const editor = useContext(KeywordContext)
  return editor?.editing
    ? <div className={props.className} style={props.style} role="group" aria-label="Highlight answer choice">{children}</div>
    : <button {...props}>{children}</button>
}

function KeywordStem({ question, headingId }: { question: Identity; headingId?: string }) {
  const editor = useContext(KeywordContext)!
  return <>
    {editor.enabled && editor.editing && <p style={{ fontSize: '.8rem', color: 'var(--text-muted)', margin: '0 0 .5rem' }}>Tap words or punctuation in the question and choices to highlight or remove highlights. Save Keywords to answer.</p>}
    <div id={headingId} role={headingId ? 'heading' : undefined} aria-level={headingId ? 2 : undefined}><KeywordText text={question.questionText} field="question" /></div>
    {editor.enabled && <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
      <button type="button" className={editor.editing ? 'btn btn-primary' : 'btn btn-outline'} disabled={!editor.ready || editor.saving} style={{ fontSize: '.8rem', padding: '.35rem .6rem', ...(editor.editing ? { background: '#15803d', borderColor: '#15803d', color: '#ffffff' } : {}) }} onClick={() => editor.editing ? void editor.save() : editor.edit()}>
        {editor.saving ? 'Saving…' : editor.editing ? 'Save Keywords' : 'Edit Keyword'}
      </button>
    </div>}
    {editor.error && <p role="alert" style={{ fontSize: '.8rem', color: 'var(--danger)' }}>{editor.error}</p>}
  </>
}

export default function KeywordQuestionText(props: { question: Identity; headingId?: string }) {
  const editor = useContext(KeywordContext)
  return editor ? <KeywordStem {...props} /> : <KeywordQuestionScope question={props.question}><KeywordStem {...props} /></KeywordQuestionScope>
}
