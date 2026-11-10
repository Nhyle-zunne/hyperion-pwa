import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  questionBankPickerLabel,
  searchQuestionBankAssets,
  type QuestionBankPickerAsset
} from '../lib/questionBankPicker'
import './QuestionBankCombobox.css'

type Props = {
  assets: QuestionBankPickerAsset[]
  tracks: ReadonlyArray<readonly [string, string]>
  value: string
  disabled?: boolean
  onChange: (path: string) => void
}

export default function QuestionBankCombobox({ assets, tracks, value, disabled = false, onChange }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)

  const selected = assets.find(asset => asset.path === value)
  const matches = useMemo(() => searchQuestionBankAssets(assets, query), [assets, query])
  const groups = useMemo(() => tracks.map(([track, label]) => ({
    track, label, items: matches.filter(asset => asset.track === track)
  })).filter(group => group.items.length > 0), [matches, tracks])
  const visible = useMemo(() => groups.flatMap(group => group.items), [groups])

  useEffect(() => {
    if (!open) return
    function closeOnOutsideClick(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick)
  }, [open])

  useEffect(() => {
    if (disabled) {
      setOpen(false)
      setQuery('')
    }
  }, [disabled])

  function openSearch() {
    if (disabled) return
    setQuery('')
    setActiveIndex(0)
    setOpen(true)
  }

  function choose(asset: QuestionBankPickerAsset) {
    onChange(asset.path)
    setOpen(false)
    setQuery('')
    setActiveIndex(0)
  }

  function handleKeys(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      if (open) {
        event.preventDefault()
        setOpen(false)
        setQuery('')
      }
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) {
        openSearch()
      } else if (visible.length) {
        setActiveIndex(index => (index + (event.key === 'ArrowDown' ? 1 : -1) + visible.length) % visible.length)
      }
      return
    }
    if (event.key === 'Enter' && open) {
      event.preventDefault()
      if (visible[activeIndex]) choose(visible[activeIndex])
    }
    if (event.key === 'Tab' && open) {
      setOpen(false)
      setQuery('')
    }
  }

  return <div ref={rootRef} className={'admin-bank-picker' + (disabled ? ' admin-bank-picker--disabled' : '')}>
    <div className="admin-bank-picker__control">
      <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 5 5" />
      </svg>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-label="Search track, competence or question bank"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && visible[activeIndex] ? listId + '-option-' + activeIndex : undefined}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        placeholder="Search a track or competence (e.g. Engine C10)"
        value={open ? query : selected ? questionBankPickerLabel(selected) : ''}
        onFocus={() => { if (!open) openSearch() }}
        onClick={() => { if (!open) openSearch() }}
        onChange={event => {
          setQuery(event.target.value)
          setActiveIndex(0)
          setOpen(true)
          // The typed text is not an actual selection. Never let Open Question Bank
          // use the previous path while the administrator searches for a new bank.
          if (value) onChange('')
        }}
        onKeyDown={handleKeys}
      />
      {value && !open && !disabled && <button className="admin-bank-picker__clear" type="button"
        title="Clear selected bank" aria-label="Clear selected question bank"
        onClick={() => { onChange(''); setQuery(''); inputRef.current?.focus() }}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="M5 5 19 19M19 5 5 19" /></svg>
      </button>}
      <button type="button" disabled={disabled} className={'admin-bank-picker__toggle' + (open ? ' is-open' : '')}
        aria-label={open ? 'Close question bank choices' : 'Show question bank choices'}
        aria-expanded={open}
        onClick={() => {
          if (open) {
            setOpen(false)
            setQuery('')
          } else {
            inputRef.current?.focus()
            openSearch()
          }
        }}>
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>
    </div>
    {open && !disabled && <div className="admin-bank-picker__list" id={listId} role="listbox" aria-label="Available question banks">
      <div className="admin-bank-picker__hint">SELECT TRACK &amp; COMPETENCE <span>{visible.length} result{visible.length === 1 ? '' : 's'}</span></div>
      {groups.map(group => <div key={group.track} role="group" aria-label={group.label}>
        <div className="admin-bank-picker__group-title" role="presentation">{group.label} <span>{group.items.length}</span></div>
        {group.items.map(asset => {
          const index = visible.indexOf(asset)
          return <button key={asset.path} type="button" role="option"
            id={listId + '-option-' + index}
            aria-selected={value === asset.path}
            className={'admin-bank-picker__option' + (index === activeIndex ? ' is-active' : '')}
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => choose(asset)}>
            <span className="admin-bank-picker__option-name">{asset.competenceId}{asset.part != null ? ' · Part ' + asset.part : ''}</span>
            <span className="admin-bank-picker__option-description">{asset.label}</span>
            {value === asset.path && <span className="admin-bank-picker__chosen" aria-label="Selected">✓</span>}
          </button>
        })}
      </div>)}
      {!visible.length && <div className="admin-bank-picker__empty">No matching question banks. Try a track name, competence number, or GMDSS part.</div>}
    </div>}
    <p className="admin-bank-picker__tip">Type to filter by track, competence, or part. Use ↑ ↓ and Enter to select.</p>
  </div>
}
