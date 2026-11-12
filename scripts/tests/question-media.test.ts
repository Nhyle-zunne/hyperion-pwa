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
