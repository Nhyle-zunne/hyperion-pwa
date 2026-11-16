import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  filterQuestionBankAssets,
  isAllQuestionBankScope,
  questionBankPickerLabel,
  questionBankScopeTrack,
  showAllQuestionBankOption,
  sortQuestionBankAssets,
  type QuestionBankPickerAsset
} from '../lib/questionBankPicker'
import './QuestionBankCombobox.css'

type Props = {
  assets: QuestionBankPickerAsset[]
  tracks: ReadonlyArray<readonly [string, string]>
  value: string
  disabled?: boolean
  onChange: (value: string) => void
}

export default function QuestionBankCombobox({ assets, tracks, value, disabled = false, onChange }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [trackFilter, setTrackFilter] = useState<string | null>(() => questionBankScopeTrack(value))

  const selected = assets.find(asset => asset.path === value)
  const matches = useMemo(() => filterQuestionBankAssets(assets, trackFilter, query), [assets, trackFilter, query])
  const groups = useMemo(() => {
    const sorted = sortQuestionBankAssets(matches, tracks)
    return [...new Set(sorted.map(asset => asset.track))].map(track => ({
      track, label: tracks.find(([id]) => id === track)?.[1] || track,
      items: sorted.filter(asset => asset.track === track)
    }))
  }, [matches, tracks])
  const visible = useMemo(() => groups.flatMap(group => group.items), [groups])
  const showAllOption = showAllQuestionBankOption(query)
  const assetOptionOffset = showAllOption ? 1 : 0
  const optionCount = visible.length + assetOptionOffset
  const allCompetencesValue = trackFilter ? '@all:' + trackFilter : '@all'
  const scopeTrack = questionBankScopeTrack(value)
  const scopeLabel = (scopeTrack ? tracks.find(([track]) => track === scopeTrack)?.[1] || scopeTrack : 'All tracks') + ' · All competences'

  useEffect(() => {
    if (isAllQuestionBankScope(value)) setTrackFilter(questionBankScopeTrack(value))
  }, [value])

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

  function selectTrack(track: string | null) {
    if (disabled) return
    // Clicking an active preset deselects it. A filter is not a competence
    // selection: changing tracks must not retain an incompatible bank path.
    const nextTrack = track === trackFilter ? null : track
    if (nextTrack && value && selected?.track !== nextTrack) onChange('')
    setTrackFilter(nextTrack)
    setQuery('')
    setActiveIndex(0)
    // The preset is independent of search visibility. Do not focus the input
    // or open/close the list: preserve whichever state the user left it in.
  }

  function choose(nextValue: string) {
    onChange(nextValue)
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
      } else if (optionCount) {
        setActiveIndex(index => (index + (event.key === 'ArrowDown' ? 1 : -1) + optionCount) % optionCount)
      }
      return
    }
    if (event.key === 'Enter' && open) {
      event.preventDefault()
      if (showAllOption && activeIndex === 0) choose(allCompetencesValue)
      else if (visible[activeIndex - assetOptionOffset]) choose(visible[activeIndex - assetOptionOffset].path)
    }
    if (event.key === 'Tab' && open) {
      setOpen(false)
      setQuery('')
    }
  }

  return <div ref={rootRef} className={'admin-bank-picker' + (disabled ? ' admin-bank-picker--disabled' : '')}>
    <div className="admin-bank-picker__preset-heading">
      <strong>CHOOSE A TRACK</strong>
    </div>
    <div className="admin-bank-picker__presets" role="group" aria-label="Choose examination track">
      <button type="button" disabled={disabled}
        className={'admin-bank-picker__preset' + (value === '@all' ? ' is-selected' : '')}
        aria-label="Search all tracks and competences" aria-pressed={value === '@all'}
        onClick={() => { setTrackFilter(null); choose('@all') }}>
        <span>All tracks</span>
        <span className="admin-bank-picker__preset-count" aria-hidden="true">{assets.length}</span>
      </button>
      {tracks.map(([track, label]) => <button key={track} type="button" disabled={disabled}
        className={'admin-bank-picker__preset' + (trackFilter === track ? ' is-selected' : '')}
        aria-label={`Filter ${label} question banks`} aria-pressed={trackFilter === track}
        onClick={() => selectTrack(track)}>
        <span>{label}</span>
        <span className="admin-bank-picker__preset-count" aria-hidden="true">{assets.filter(asset => asset.track === track).length}</span>
      </button>)}
    </div>
    <p className="admin-bank-picker__preset-instruction" aria-live="polite">{trackFilter
      ? `${tracks.find(([track]) => track === trackFilter)?.[1] || trackFilter} selected · ${matches.length} matching question set${matches.length === 1 ? '' : 's'}. Choose a competence or part below.`
      : 'Select a track above, then choose a competence or part. Or search all tracks below.'}</p>
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
        aria-activedescendant={open && activeIndex < optionCount ? listId + '-option-' + activeIndex : undefined}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        placeholder={trackFilter ? 'Search competence or part (e.g. C10 or Part 2)' : 'Search a track or competence (e.g. Engine C10)'}
        value={open ? query : isAllQuestionBankScope(value) ? scopeLabel : selected ? questionBankPickerLabel(selected) : ''}
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
      <div className="admin-bank-picker__hint">{trackFilter ? 'SELECT COMPETENCE / PART' : 'SELECT TRACK & COMPETENCE'} <span>{visible.length} result{visible.length === 1 ? '' : 's'}</span></div>
      {showAllOption && <button type="button" role="option" tabIndex={-1}
        id={listId + '-option-0'} aria-selected={value === allCompetencesValue}
        className={'admin-bank-picker__option admin-bank-picker__option--all' + (activeIndex === 0 ? ' is-active' : '')}
        onMouseEnter={() => setActiveIndex(0)} onClick={() => choose(allCompetencesValue)}>
        <span className="admin-bank-picker__option-name">All competences</span>
        <span className="admin-bank-picker__option-description">{trackFilter
          ? tracks.find(([track]) => track === trackFilter)?.[1] || trackFilter
          : 'All tracks'}</span>
        {value === allCompetencesValue && <span className="admin-bank-picker__chosen" aria-label="Selected">✓</span>}
      </button>}
      {groups.map(group => <div key={group.track} role="group" aria-label={group.label}>
        <div className="admin-bank-picker__group-title" role="presentation">{group.label} <span>{group.items.length}</span></div>
        {group.items.map(asset => {
          const index = visible.indexOf(asset) + assetOptionOffset
          return <button key={asset.path} type="button" role="option" tabIndex={-1}
            id={listId + '-option-' + index}
            aria-selected={value === asset.path}
            className={'admin-bank-picker__option' + (index === activeIndex ? ' is-active' : '')}
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => choose(asset.path)}>
            <span className="admin-bank-picker__option-name">{asset.competenceId}{asset.part != null ? ' · Part ' + asset.part : ''}</span>
            <span className="admin-bank-picker__option-description">{asset.label}</span>
            {value === asset.path && <span className="admin-bank-picker__chosen" aria-label="Selected">✓</span>}
          </button>
        })}
      </div>)}
      {!visible.length && <div className="admin-bank-picker__empty">{trackFilter ? 'No matching competences or parts for this track. Try another search or Show all tracks.' : 'No matching question banks. Try a track name, competence number, or GMDSS part.'}</div>}
    </div>}
    <p className="admin-bank-picker__tip">Choose a preset track or type to search. Use ↑ ↓ and Enter to select a question set.</p>
  </div>
}
