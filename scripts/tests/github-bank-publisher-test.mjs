import assert from 'node:assert/strict'
import { validateQuestionChanges } from '../../worker/githubBankPublisher.ts'
const path='engine_ew/ew_c1.csv.enc'
const csv=rows=>'No,Question,A,B,C,D,Ans\n'+rows.map((q,i)=>`${i+1},${q},Port,Starboard,Ahead,Astern,A`).join('\n')
assert.equal(typeof validateQuestionChanges,'function')
const previous=csv(['First question?','Second question?'])
const appended=validateQuestionChanges(path,previous,csv(['First question?','Second question?','Third question?']))
assert.equal(appended.appended,1);assert.equal(appended.changed,0)
const corrected=validateQuestionChanges(path,previous,csv(['Corrected first question?','Second question?']))
assert.equal(corrected.changed,1)
assert.throws(()=>validateQuestionChanges(path,previous,csv(['First question?'])),/remov|shorter/i)
assert.throws(()=>validateQuestionChanges(path,previous,csv(['Second question?','First question?'])),/reorder|position/i)
assert.throws(()=>validateQuestionChanges(path,previous,'broken'),/question|CSV/i)
assert.throws(()=>validateQuestionChanges('../../secrets',previous,previous),/path|destination/i)
console.log('PASS: appended/corrected questions retain positions; removals, reordering, invalid CSV and paths are rejected.')
