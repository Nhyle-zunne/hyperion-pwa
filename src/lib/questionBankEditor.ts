import { parseCsvText } from './csvParser'

/**
 * Editing changes the original CSV cell in-place. Never delete, sort, or
 * renumber question rows: question IDs, history and bookmarks depend on slots.
 */
export const RETIREMENT_COLUMN = 'HYPERION_STATUS'

export type EditableQuestion = {
  ordinal: number
  rowIndex: number
  numberLabel: string
  questionText: string
  options: string[]
  correctAnswerIndex: number
  explanation: string
  retired: boolean
  fixedLegacyRetirement: boolean
}

export type EditableBank = {
  path: string
  csvText: string
  headerIndex: number
  statusIndex: number
  questions: EditableQuestion[]
  format: 'standard' | 'gmdss'
}

const isGmdss = (path: string) => path.startsWith('gmdss/')
const validPath = (path: string) =>
  /^(?:deck|deck_mgt|engine_ew|engine_mgt)\/[a-z0-9_]+\.csv\.enc$/.test(path) ||
  /^gmdss\/c[12]_part\d+\.csv\.enc$/.test(path)

function findHeader(rows: string[][], gmdss: boolean): number {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const row = rows[i].map(cell => cell.trim().toLowerCase())
    if (gmdss ? (row.includes('question') && row.includes('option1'))
      : (row.includes('question') && (row.some(cell => cell.includes('correct')) || row.includes('a')))) return i
  }
  return gmdss ? 3 : 0
}

function originalC10Retirement(path: string, ordinal: number) {
  return path === 'engine_mgt/em_c10.csv.enc' && [182, 373, 406].includes(ordinal)
}

function keyedAnswer(value: string, optionCount: number) {
  const key = String(value || '').trim().toUpperCase()
  const index = 'ABCDEF'.indexOf(key)
  const numeric = /^[1-6]$/.test(key) ? Number(key) - 1 : -1
  const result = index < 0 ? numeric : index
  return Math.max(0, Math.min(optionCount - 1, result < 0 ? 0 : result))
}

export function readEditableBank(path: string, csvText: string): EditableBank {
  if (!validPath(path)) throw Error('This question-bank destination is not supported.')
  if (new TextEncoder().encode(csvText).byteLength > 700000) throw Error('The question bank is too large for direct editing.')
  const rows = parseCsvText(csvText)
  const format = isGmdss(path) ? 'gmdss' : 'standard'
  const headerIndex = findHeader(rows, format === 'gmdss')
  const header = rows[headerIndex] || []
  const statusIndex = header.findIndex(value => value.trim().toUpperCase() === RETIREMENT_COLUMN)
  const questions: EditableQuestion[] = []
  const seen = new Set<number>()
  const deckLimit = path.match(/^deck\/oic_nw_c(7|9|10|11|12|13|17)\.csv\.enc$/)
  const numberedDeckLimits: Record<string, number> = { '7':533, '9':508, '10':610, '11':421, '12':351, '13':888, '17':628 }
  const strict = path.startsWith('deck_mgt/') || path.startsWith('engine_mgt/') || path.startsWith('engine_ew/')
  for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex]
    let questionText = '', options: string[] = [], numberLabel = '', answer = '', explanation = ''
    if (format === 'standard') {
      const numbered = (row[0] || '').trim()
      if (!/^\d+$/.test(numbered) || Number(numbered) < 1 || row.length < 7) continue
      if (deckLimit && Number(numbered) > numberedDeckLimits[deckLimit[1]]) continue
      if ((strict || deckLimit) && seen.has(Number(numbered))) continue
      questionText = (row[1] || '').trim()
      const all = row.slice(2, 6).map(cell => (cell || '').trim())
      options = all.filter(Boolean)
      if (!questionText || questionText.toLowerCase() === 'question' || options.length < 2 ||
        (options.length === 4 && options.every((text, i) => text === 'ABCD'[i]))) continue
      if (strict) {
        const key = (row[6] || '').trim().toUpperCase()
        const k = 'ABCD'.indexOf(key)
        const n = /^[1-4]$/.test(key) ? Number(key) - 1 : k
        if (n < 0 || !all[n]) continue
      }
      seen.add(Number(numbered))
      numberLabel = numbered
      answer = row[6] || ''
      explanation = row[7] || ''
    } else {
      if (row.length < 10) continue
      questionText = (row[0] || '').trim()
      options = row.slice(2, 8).map(v => (v || '').trim()).filter(Boolean)
      if (!questionText || questionText.toLowerCase() === 'question' || options.length < 2) continue
      numberLabel = String(questions.length + 1)
      answer = row[9] || ''
      explanation = row[8] || ''
    }
    const ordinal = questions.length + 1
    const status = statusIndex >= 0 ? (row[statusIndex] || '').trim().toUpperCase() : ''
    const legacy = originalC10Retirement(path, ordinal)
    questions.push({
      ordinal, rowIndex, numberLabel, questionText, options,
      correctAnswerIndex: keyedAnswer(answer, options.length),
      explanation, retired: status === 'RETIRED' || legacy,
      fixedLegacyRetirement: legacy
    })
  }
  if (!questions.length) throw Error(format === 'gmdss'
    ? 'This GMDSS part uses a legacy flattened layout that cannot safely be edited in-place. Use the existing CSV publisher until this part is normalized.'
    : 'No editable questions were found. Keep the original CSV structure.')
  return { path, csvText, headerIndex, statusIndex, questions, format }
}

export type QuestionEdit = Pick<EditableQuestion, 'questionText' | 'options' | 'correctAnswerIndex' | 'explanation' | 'retired'>

function serializeCsv(rows: string[][]) {
  const cell = (value: string) => /[",\r\n]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value
  return rows.map(row => row.map(cell).join(',')).join('\r\n')
}

export function editBankQuestion(bank: EditableBank, ordinal: number, edit: QuestionEdit): string {
  const source = bank.questions.find(question => question.ordinal === ordinal)
  if (!source) throw Error('That question is no longer present in this question bank.')
  if (source.fixedLegacyRetirement && !edit.retired) throw Error('The three original C10 retirement IDs are protected by the Android/PWA legacy policy. They cannot be restored from this editor.')
  const maxOptions = bank.format === 'gmdss' ? 6 : 4
  if (edit.options.length < 2 || edit.options.length > maxOptions ||
      edit.options.some(option => !option.trim()) ||
      !Number.isInteger(edit.correctAnswerIndex) ||
      edit.correctAnswerIndex < 0 || edit.correctAnswerIndex >= edit.options.length ||
      !edit.questionText.trim()) throw Error('Provide a question, at least two filled choices and one valid correct answer.')
  const rows = parseCsvText(bank.csvText).map(row => row.slice())
  const row = rows[source.rowIndex]
  if (!row) throw Error('The original question position changed.')
  const questionColumn = bank.format === 'gmdss' ? 0 : 1
  const choiceColumn = bank.format === 'gmdss' ? 2 : 2
  const answerColumn = bank.format === 'gmdss' ? 9 : 6
  const explanationColumn = bank.format === 'gmdss' ? 8 : 7
  if ((row[questionColumn] || '').trim() !== source.questionText) throw Error('The source question changed. Reload this set.')
  row[questionColumn] = edit.questionText
  for (let i = 0; i < maxOptions; i++) row[choiceColumn + i] = edit.options[i] || ''
  row[answerColumn] = 'ABCDEF'[edit.correctAnswerIndex]
  row[explanationColumn] = edit.explanation
  let statusIndex = bank.statusIndex
  if (statusIndex < 0) {
    const header = rows[bank.headerIndex]
    statusIndex = Math.max(bank.format === 'gmdss' ? 12 : 8, ...rows.map(item => item.length))
    while (header.length <= statusIndex) header.push('')
    header[statusIndex] = RETIREMENT_COLUMN
  }
  while (row.length <= statusIndex) row.push('')
  row[statusIndex] = edit.retired ? 'RETIRED' : 'ACTIVE'
  return serializeCsv(rows)
}
