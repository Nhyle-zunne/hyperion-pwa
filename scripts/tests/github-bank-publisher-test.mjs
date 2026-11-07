import assert from 'node:assert/strict'
import { reconcileC1Explanations, validateQuestionChanges } from '../../worker/githubBankPublisher.ts'
import { toSearchQuestions } from '../../supabase/functions/_shared/bankCodec.ts'
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

const c1='deck/oic_nw_c1.csv.enc'
const header='No,Question,A,B,C,D,Ans,Explanation'
const row=(number,question,answer,explanation,options=['North','South','East','West'])=>
  [number,question,...options,answer,explanation].map(value=>String(value).includes(',')?'"'+String(value).replace(/"/g,'""')+'"':value).join(',')
const oldC1=[header,
  row(1,'What is the compass error?', 'A', 'Compare true and compass bearings.'),
  row(2,'Which chart symbol means safe water?', 'B', 'Read the official chart legend.'),
  row(3,'When is the ETA?', 'A', 'Calculate distance divided by speed.'),
  row(4,'What is leeway?', 'C', 'Leeway is caused by wind.')
].join('\n')
const newC1=[header,
  row(1,'What is the compass error?', 'A', ''), // identical: keep old explanation
  row(2,'Which chart symbol means safe water!', 'B', 'Read the official chart legend.'), // punctuation changed
  row(3,'When is the ETA?', 'B', 'Calculate distance divided by speed.'), // keyed answer changed
  row(4,'What is leeway?', 'C', 'Wind pushes the vessel sideways.') // newly written explanation
].join('\n')
const checked=reconcileC1Explanations(oldC1,newC1)
const explanations=toSearchQuestions(c1,checked.text).map(q=>q.explanation)
assert.equal(checked.preserved,1)
assert.equal(checked.cleared,2)
assert.deepEqual(explanations,[
 'Compare true and compass bearings.', '', '', 'Wind pushes the vessel sideways.'
])
const keys=toSearchQuestions(c1,checked.text).map(q=>q.correctAnswerIndex)
assert.deepEqual(keys,[0,1,1,2],'reconciliation must never change keyed answers')
const originals=toSearchQuestions(c1,newC1)
const reconciled=toSearchQuestions(c1,checked.text)
assert.deepEqual(reconciled.map(q=>[q.questionText,q.options,q.correctAnswerIndex]),originals.map(q=>[q.questionText,q.options,q.correctAnswerIndex]),'question content and answer keys must be untouched')
const changedOptions=[header,row(1,'What is the compass error?','A','Compare true and compass bearings.',['North','South','Southeast','West']),...newC1.split('\n').slice(2)].join('\n')
assert.equal(toSearchQuestions(c1,reconcileC1Explanations(oldC1,changedOptions).text)[0].explanation,'','changed choices must never retain a copied old explanation')
assert.equal(reconcileC1Explanations(oldC1,oldC1).preserved,0,'explicit unchanged explanations stay untouched')

console.log('PASS: appended/corrected questions retain positions; removals, reordering, invalid CSV and paths are rejected.')
