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

const imageRef={sha256:'a'.repeat(64),mime:'image/png',placement:'question',alt:'Synthetic compass diagram'}
const encodeCell=value=>'"'+String(value).replace(/"/g,'""')+'"'
const mediaCsv=(metadata=JSON.stringify([imageRef]),column='HYPERION_MEDIA')=>
  'No,Question,A,B,C,D,Ans,Explanation,'+column+'\n'+
  '1,First question?,Port,Starboard,Ahead,Astern,A,,'+encodeCell(metadata)+'\n'+
  '2,Second question?,Port,Starboard,Ahead,Astern,A,,'
const withImages=mediaCsv()
assert.equal(toSearchQuestions(path,withImages)[0].imageAttachments.length,1)
assert.equal(validateQuestionChanges(path,withImages,withImages).changed,0)
const removedImage = validateQuestionChanges(path,withImages,mediaCsv(''))
assert.equal(removedImage.changed,1,'image-only edits must count as corrections')
assert.deepEqual(removedImage.corrections[0].before.imageAttachments,[imageRef])
assert.deepEqual(removedImage.corrections[0].after.imageAttachments,[])
const addedImage = validateQuestionChanges(path,previous,withImages)
assert.equal(addedImage.changed,1)
assert.deepEqual(addedImage.corrections[0].after.imageAttachments,[imageRef])

assert.throws(()=>validateQuestionChanges(path,withImages,previous),error=>
  error.status===409&&/HYPERION_MEDIA/.test(error.message)&&/explicit|intentional/i.test(error.message),
  'a legacy CSV must not silently remove existing photos')
assert.doesNotThrow(()=>validateQuestionChanges(path,withImages,withImages))
assert.doesNotThrow(()=>validateQuestionChanges(path,withImages,mediaCsv('')),
  'an explicit media column with empty cells permits intentional removal')
assert.doesNotThrow(()=>validateQuestionChanges(path,withImages,mediaCsv('',' hyperion_media ')))
assert.doesNotThrow(()=>validateQuestionChanges(path,withImages,mediaCsv('   ')))
assert.doesNotThrow(()=>validateQuestionChanges(path,previous,withImages),'legacy banks can acquire images')
for(const standardPath of ['deck/oic_nw_c1.csv.enc','deck_mgt/dm_c1.csv.enc','engine_mgt/em_c1.csv.enc']){
  assert.throws(()=>validateQuestionChanges(standardPath,withImages,previous),/HYPERION_MEDIA/)
}
assert.throws(()=>validateQuestionChanges(path,withImages,previous.replace('First question?','HYPERION_MEDIA')),
  /HYPERION_MEDIA/,'a media marker in question text is not a header')
for(const malformed of ['not JSON','[]',JSON.stringify({...imageRef}),
  JSON.stringify([{...imageRef,mime:'image/svg+xml'}]),JSON.stringify([imageRef,imageRef]),
  JSON.stringify([{...imageRef,alt:''}]),JSON.stringify([imageRef,{...imageRef,sha256:'bad'}])]){
  assert.throws(()=>validateQuestionChanges(path,withImages,mediaCsv(malformed)),
    /HYPERION_MEDIA.*invalid|invalid.*HYPERION_MEDIA/i,'malformed image metadata must not silently clear photos')
}
const c1Media='No,Question,A,B,C,D,Ans,Explanation,HYPERION_MEDIA\n'+
  '1,First question?,Port,Starboard,Ahead,Astern,A,Existing rationale,'+encodeCell(JSON.stringify([imageRef]))
const reconciledMedia=reconcileC1Explanations(c1Media,c1Media.replace('Existing rationale',''))
assert.equal(toSearchQuestions('deck/oic_nw_c1.csv.enc',reconciledMedia.text)[0].explanation,'Existing rationale')
assert.deepEqual(toSearchQuestions('deck/oic_nw_c1.csv.enc',reconciledMedia.text)[0].imageAttachments,[imageRef],
  'explanation reconciliation must preserve image metadata')

const gmdssPath='gmdss/c1_part1.csv.enc'
const gmdssHeader='Question,Choice,Option1,Option2,Option3,Option4,Option5,Option6,Explanation,Answer'
const gmdssRow='Which signal?,Choice,Port,Starboard,Ahead,Astern,Stop,Go,Rationale,A'
const gmdssBefore='Synthetic bank\nNotes\n\n'+gmdssHeader+',HYPERION_MEDIA\n'+gmdssRow+','+encodeCell(JSON.stringify([imageRef]))
assert.equal(toSearchQuestions(gmdssPath,gmdssBefore)[0].imageAttachments.length,1)
assert.throws(()=>validateQuestionChanges(gmdssPath,gmdssBefore,gmdssHeader+'\n'+gmdssRow),/HYPERION_MEDIA/)
assert.doesNotThrow(()=>validateQuestionChanges(gmdssPath,gmdssBefore,gmdssBefore))
assert.doesNotThrow(()=>validateQuestionChanges(gmdssPath,gmdssBefore,gmdssHeader+',HYPERION_MEDIA\n'+gmdssRow+','))

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

console.log('PASS: question positions and C1 explanations are preserved; accidental image removal and malformed media are rejected; explicit image removal and legacy banks remain supported.')

// Blank stems with answer labels still identify distinct scans by their prompt media.
const scannedCsv=(refs)=>'No,Question,A,B,C,D,Ans,Explanation,HYPERION_MEDIA\n'+refs.map((ref,index)=>`${index+1},,A,B,C,D,A,,${encodeCell(JSON.stringify([ref]))}`).join('\n')
const otherScan={...imageRef,sha256:'b'.repeat(64)}
const scans=scannedCsv([imageRef,otherScan])
assert.equal(validateQuestionChanges(path,scans,scans).changed,0)
assert.throws(()=>validateQuestionChanges(path,scans,scannedCsv([otherScan,imageRef])),/reorder|position/i,
  'different image-only questions must not be silently swapped')
assert.equal(validateQuestionChanges(path,scans,scannedCsv([{...imageRef,sha256:'c'.repeat(64)},otherScan])).changed,1,
  'correcting a single diagram in place remains supported')
