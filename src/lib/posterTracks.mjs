const marineDeck = 'Bachelor of Science in Marine Transportation'
const marineEngine = 'Bachelor of Science in Marine Engineering'
const deckExam = 'MARINA LICENSURE EXAMINATION\nFOR MARINE DECK OFFICERS'
const engineExam = 'MARINA LICENSURE EXAMINATION\nFOR MARINE ENGINE OFFICERS'

export const POSTER_TRACKS = Object.freeze([
  { id: 'oic_nw', label: 'OIC-NW', prefix: 'OIC-NW', defaultDegree: marineDeck, examTitle: deckExam },
  { id: 'oic_ew', label: 'OIC-EW', prefix: 'OIC-EW', defaultDegree: marineEngine, examTitle: engineExam },
  { id: 'chief_mate', label: 'Chief Mate', prefix: 'C/M', defaultDegree: marineDeck, examTitle: deckExam },
  { id: 'master_mariner', label: 'Master Mariner', prefix: 'CAPT.', defaultDegree: marineDeck, examTitle: deckExam },
  { id: 'second_engineer', label: 'Second Engineer', prefix: '2/E', defaultDegree: marineEngine, examTitle: engineExam },
  { id: 'chief_engineer', label: 'Chief Engineer', prefix: 'C/E', defaultDegree: marineEngine, examTitle: engineExam },
  { id: 'gmdss', label: 'GMDSS GOC', prefix: '', defaultDegree: '', examTitle: 'GLOBAL MARITIME DISTRESS AND SAFETY SYSTEM\n(GMDSS) RADIO OPERATORS LICENSURE EXAMINATION' },
])

export function fullPosterName(trackId, name) {
  const clean = String(name || '').trim().replace(/\s+/g, ' ')
  if (!clean) return ''
  const prefix = POSTER_TRACKS.find(track => track.id === trackId)?.prefix
  return !prefix || clean.toUpperCase().startsWith(`${prefix} `) ? clean : `${prefix} ${clean}`
}

export function formatPosterDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return ''
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return ''
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' }).format(date)
}
