import { test, expect } from 'bun:test'
import { parseQuestionImageRefs, serializeQuestionImageRefs, parseQuestionImageRefsFromCsv } from '../../src/lib/questionMedia'
import { readEditableBank, editBankQuestion } from '../../src/lib/questionBankEditor'
import { toSearchQuestions, validQuestionCount } from '../../supabase/functions/_shared/bankCodec'

const hash='a'.repeat(64)
const image={sha256:hash,mime:'image/webp' as const,placement:'question' as const,alt:'Radar chart'}
const path='engine_ew/ew_c1.csv.enc'
const input='No.,Question,A,B,C,D,Correct Answer,Explanation\r\n1,Plot vessel bearing?,North,South,East,West,A,Simple radar explanation\r\n2,Read chart?,True,False,Maybe,Never,A,Explanation'
test('metadata is strict: no URL, oversized JSON, bad paths, duplicate references',()=>{
 const value=serializeQuestionImageRefs([image])
 expect(parseQuestionImageRefs(value)).toEqual([image])
 expect(parseQuestionImageRefsFromCsv(['No.','HYPERION_MEDIA'],['1',value])).toEqual([image])
 for(const bad of ['', '[]','../secret',' '.repeat(2049),JSON.stringify([{...image,url:'https://untrusted.example'}]),JSON.stringify([{...image,sha256:'../private'}]),JSON.stringify([image,image])]){
  expect(parseQuestionImageRefs(bad)).toEqual([])
 }
})
test('admin image edit preserves IDs, answer, retirement and question counts',()=>{
 const bank=readEditableBank(path,input)
 expect(bank.questions).toHaveLength(2)
 const edited=editBankQuestion(bank,1,{...bank.questions[0],imageAttachments:[image]})
 const after=readEditableBank(path,edited)
 expect(after.questions).toHaveLength(2)
 expect(after.questions[0].imageAttachments).toEqual([image])
 expect(after.questions[1].imageAttachments).toEqual([])
 const delivered=toSearchQuestions(path,edited)
 expect(delivered[0].imageAttachments).toEqual([image])
 expect(delivered[0].id).toBe('EW-C1-001')
 expect(delivered[1].id).toBe('EW-C1-002')
 expect(validQuestionCount(path,edited,false)).toBe(2)
 const removed=editBankQuestion(after,1,{...after.questions[0],imageAttachments:[]})
 expect(toSearchQuestions(path,removed)[0].imageAttachments).toBeUndefined()
})

test('image-only prompt keeps IDs, counts and answer choices through edit and delivery',()=>{
 for(const bankPath of ['engine_ew/ew_c1.csv.enc','engine_mgt/em_c1.csv.enc','deck_mgt/dm_c1.csv.enc','deck/oic_nw_c1.csv.enc','deck/oic_nw_c7.csv.enc']) {
  const bank=readEditableBank(bankPath,input)
  const edited=editBankQuestion(bank,1,{...bank.questions[0],questionText:'',imageAttachments:[image]})
  const after=readEditableBank(bankPath,edited)
  expect(after.questions).toHaveLength(2)
  expect(after.questions[0].questionText).toBe('')
  expect(after.questions[0].imageAttachments).toEqual([image])
  const before=toSearchQuestions(bankPath,input), delivered=toSearchQuestions(bankPath,edited)
  expect(delivered.map(q=>q.id)).toEqual(before.map(q=>q.id))
  expect(delivered[0].questionText).toBe('')
  expect(delivered[0].options).toEqual(before[0].options)
  expect(delivered[0].correctAnswerIndex).toBe(before[0].correctAnswerIndex)
  expect(validQuestionCount(bankPath,edited,false)).toBe(2)
  expect(()=>editBankQuestion(after,1,{...after.questions[0],imageAttachments:[]})).toThrow()
  expect(()=>editBankQuestion(after,1,{...after.questions[0],imageAttachments:[{...image,placement:'explanation'}]})).toThrow()
  // Omitting the optional attachment edit preserves existing prompt media.
  const {imageAttachments: _,...textOnlyEdit}=after.questions[0]
  expect(readEditableBank(bankPath,editBankQuestion(after,1,textOnlyEdit)).questions).toHaveLength(2)
 }
})

test('blank prompt needs valid question-placement media; explanation or malformed media cannot replace it',()=>{
 const bank=readEditableBank(path,input)
 for(const images of [[],[{...image,placement:'explanation' as const}],[{...image,sha256:'bad'}]]) {
  expect(()=>editBankQuestion(bank,1,{...bank.questions[0],questionText:'  ',imageAttachments:images})).toThrow()
 }
 const cell=(value:string)=>'"'+value.replaceAll('"','""')+'"'
 for(const refs of [[],[{...image,placement:'explanation'}],[{...image,sha256:'bad'}]]) {
  const csv='No.,Question,A,B,C,D,Correct Answer,Explanation,HYPERION_MEDIA\n1,,North,South,East,West,A,,'+cell(JSON.stringify(refs))
  expect(toSearchQuestions(path,csv)).toHaveLength(0)
  expect(()=>readEditableBank(path,csv)).toThrow()
 }
})

test('GMDSS image-only prompt preserves following question identity and supports re-edit',()=>{
 const bankPath='gmdss/c1_part1.csv.enc'
 const csv='Synthetic bank\nNotes\n\nQuestion,Choice,Option1,Option2,Option3,Option4,Option5,Option6,Explanation,Answer\nWhich diagram?,Choice,North,South,East,West,Stop,Go,Reason,A\nNext question?,Choice,Yes,No,Maybe,Never,Stop,Go,Reason,B'
 const bank=readEditableBank(bankPath,csv)
 const edited=editBankQuestion(bank,1,{...bank.questions[0],questionText:'',imageAttachments:[image]})
 const after=readEditableBank(bankPath,edited), delivered=toSearchQuestions(bankPath,edited)
 expect(after.questions).toHaveLength(2)
 expect(delivered).toHaveLength(2)
 expect(delivered[0].questionText).toBe('')
 expect(delivered.map(q=>q.id)).toEqual(toSearchQuestions(bankPath,csv).map(q=>q.id))
 expect(validQuestionCount(bankPath,edited,false)).toBe(2)
})


test('image-only scans can use A/B/C/D choices while legacy text placeholders stay rejected',()=>{
 const bank=readEditableBank(path,input)
 const edited=editBankQuestion(bank,1,{...bank.questions[0],questionText:'',options:['A','B','C','D'],imageAttachments:[image]})
 expect(readEditableBank(path,edited).questions[0].options).toEqual(['A','B','C','D'])
 expect(toSearchQuestions(path,edited)).toHaveLength(2)
 expect(()=>editBankQuestion(bank,1,{...bank.questions[0],options:['A','B','C','D'],imageAttachments:[image]})).toThrow()
})

test('short normalized GMDSS CSV retains image-only first slot without a preamble',()=>{
 const bankPath='gmdss/c1_part1.csv.enc'
 const cell=(value:string)=>'"'+value.replaceAll('"','""')+'"'
 const header='Question,Choice,Option1,Option2,Option3,Option4,Option5,Option6,Explanation,Answer,HYPERION_MEDIA'
 const first=',Choice,North,South,East,West,Stop,Go,,A,'+cell(JSON.stringify([image]))
 for(const csv of [header+'\n'+first, header+'\n'+first+'\nNext question?,Choice,Yes,No,Maybe,Never,Stop,Go,Reason,B,']) {
  expect(toSearchQuestions(bankPath,csv)[0].questionText).toBe('')
  expect(toSearchQuestions(bankPath,csv)[0].imageAttachments).toEqual([image])
  expect(readEditableBank(bankPath,csv).questions.length).toBe(csv.split('\n').length-1)
  expect(validQuestionCount(bankPath,csv,false)).toBe(csv.split('\n').length-1)
 }
})
