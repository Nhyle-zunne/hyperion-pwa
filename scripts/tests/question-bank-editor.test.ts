import { expect, test } from 'bun:test'
import { editBankQuestion, readEditableBank } from '../../src/lib/questionBankEditor'
import { toSearchQuestions, validQuestionCount } from '../../supabase/functions/_shared/bankCodec'

const path = 'engine_mgt/em_c10.csv.enc'
const escapeCsv = (value: string) => /[",\n]/.test(value) ? '"' + value.replaceAll('"','""') + '"' : value
const initial = ['No.,Question,A,B,C,D,Correct Answer,Explanation',
  ...Array.from({ length: 416 }, (_, index) =>
    [String(index + 1), 'Question #' + (index + 1) + '?',
      'Correct ' + (index + 1), 'Wrong B', 'Wrong C', 'Wrong D', 'A',
      'Reason ' + (index + 1)].map(escapeCsv).join(','))
].join('\r\n')

test('edit keeps 416 original C10 IDs and answer choice corrections', () => {
  const bank = readEditableBank(path, initial)
  expect(bank.questions).toHaveLength(416)
  expect(bank.questions[181].retired).toBe(true)
  expect(bank.questions[372].retired).toBe(true)
  expect(bank.questions[405].retired).toBe(true)
  const edited = editBankQuestion(bank, 41, {
    questionText: 'Question #41? corrected',
    options: ['Other A', 'Correct answer with, comma', 'Wrong C', 'Wrong D'],
    correctAnswerIndex: 1, explanation: 'Rewritten explanation', retired: false
  })
  const result = readEditableBank(path, edited)
  const published = toSearchQuestions(path, edited)
  expect(published).toHaveLength(416)
  expect(published[40].id).toBe('EM-C10-041')
  expect(published[40].correctAnswerIndex).toBe(1)
  expect(published[40].options[1]).toBe('Correct answer with, comma')
  expect(published[41].questionText).toBe('Question #42?')
  expect(published[415].id).toBe('EM-C10-416')
  expect(result.questions[181].retired).toBe(true)
  expect(validQuestionCount(path, edited, false)).toBe(416)
})

test('retire and restore a newly selected Engine Management question', () => {
  const retired = editBankQuestion(readEditableBank(path, initial), 42, {
    questionText: 'Question #42?',
    options: ['Correct 42', 'Wrong B', 'Wrong C', 'Wrong D'],
    correctAnswerIndex: 0, explanation: 'Reason 42', retired: true
  })
  const changed = readEditableBank(path, retired)
  expect(changed.questions[41].retired).toBe(true)
  expect(changed.questions[42].retired).toBe(false)
  expect(toSearchQuestions(path, retired)[41].isRetired).toBe(true)
  expect(validQuestionCount(path, retired, false)).toBe(415)
  const restored = editBankQuestion(changed, 42, {
    questionText: 'Question #42?',
    options: ['Correct 42', 'Wrong B', 'Wrong C', 'Wrong D'],
    correctAnswerIndex: 0, explanation: 'Reason 42', retired: false
  })
  expect(readEditableBank(path, restored).questions[41].retired).toBe(false)
  expect(validQuestionCount(path, restored, false)).toBe(416)
})

test('status column stays outside choices and text in standard banks', () => {
  const bank = readEditableBank('engine_ew/ew_c1.csv.enc', initial)
  const text = editBankQuestion(bank, 1, {
    questionText: 'A revised question?',
    options: ['A', 'B', 'C', 'D'], correctAnswerIndex: 2,
    explanation: 'No deletion of question 2', retired: true
  })
  expect(readEditableBank('engine_ew/ew_c1.csv.enc', text).questions).toHaveLength(416)
  expect(toSearchQuestions('engine_ew/ew_c1.csv.enc', text)[0].isRetired).toBe(true)
})

test('reject empty questions and invalid answer indexing', () => {
  expect(() => editBankQuestion(readEditableBank(path, initial), 10, {
    questionText: '', options: ['A', 'B'], correctAnswerIndex: 7,
    explanation: '', retired: false
  })).toThrow()
})

test('GMDSS row-based format can retire without shifting part-local IDs', () => {
  const gmdss = [
    'Question,Type,Option1,Option2,Option3,Option4,Option5,Option6,Explanation,Answer,Point,Section',
    'What is DSC?,Choice,Digital Selective Calling,Wrong A,Wrong B,Wrong C,,,Expl,A,1,1',
    'What is GOC?,Choice,General Operator Certificate,Wrong A,Wrong B,Wrong C,,,Expl,A,1,1'
  ].join('\r\n')
  const gPath = 'gmdss/c1_part1.csv.enc'
  const bank = readEditableBank(gPath, gmdss)
  expect(bank.questions).toHaveLength(2)
  const output = editBankQuestion(bank, 1, {
    questionText: 'What is DSC?', options: bank.questions[0].options,
    correctAnswerIndex: 0, explanation: 'Expl', retired: true
  })
  expect(readEditableBank(gPath, output).questions).toHaveLength(2)
  expect(toSearchQuestions(gPath, output)[0].isRetired).toBe(true)
  expect(toSearchQuestions(gPath, output)[1].isRetired).toBe(false)
})
