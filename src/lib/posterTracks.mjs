const marineDeck = 'Bachelor of Science in Marine Transportation'
const marineEngine = 'Bachelor of Science in Marine Engineering'
const examHeading = 'MARINA LICENSURE EXAMINATION'
const examTitle = description => examHeading + '\n' + description

export const POSTER_DEGREES = Object.freeze([
  { label: 'Marine Transportation', value: marineDeck },
  { label: 'Marine Engineering', value: marineEngine },
])

export const POSTER_TRACKS = Object.freeze([
  { id: 'oic_nw', label: 'OIC-NW', prefix: 'OIC-NW', defaultDegree: marineDeck, examTitle: examTitle('FOR MARINE DECK OFFICERS') },
  { id: 'gmdss', label: 'GMDSS GOC', prefix: '', defaultDegree: marineDeck, examTitle: examTitle('FOR GMDSS RADIO OPERATORS') },
  { id: 'oic_ew', label: 'OIC-EW', prefix: 'OIC-EW', defaultDegree: marineEngine, examTitle: examTitle('FOR MARINE ENGINEERS') },
  { id: 'master_mariner', label: 'CAPT.', prefix: 'CAPT.', defaultDegree: marineDeck, examTitle: examTitle('FOR DECK MANAGEMENT LEVEL') },
  { id: 'chief_engineer', label: 'C/E', prefix: 'C/E', defaultDegree: marineEngine, examTitle: examTitle('FOR ENGINE MANAGEMENT LEVEL') },
])

export function fullPosterName(trackId, name) {
  const clean = String(name || '').trim().replace(/\s+/g, ' ')
  if (!clean) return ''
  const prefix = POSTER_TRACKS.find(track => track.id === trackId)?.prefix
  return !prefix || clean.toUpperCase().startsWith(prefix + ' ') ? clean : prefix + ' ' + clean
}

export function formatPosterDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return ''
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return ''
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' }).format(date)
}
