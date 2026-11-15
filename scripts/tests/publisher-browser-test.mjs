import {chromium} from 'playwright'
import assert from 'node:assert/strict'
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']})
try {
 const page=await browser.newPage({viewport:{width:1191,height:800}}),calls=[];let configured=true,failValidation=false,failPublishOnce=true
 const editorCsv = [
  'No.,Question,A,B,C,D,Correct Answer,Explanation,HYPERION_STATUS',
  '1,Active sample?,Port,Starboard,Ahead,Astern,A,,ACTIVE',
  '2,Retired sample?,Port,Starboard,Ahead,Astern,B,,RETIRED'
 ].join('\\n')
 const externalRequests=[]
 await page.route('**/*',route=>{
  const host=new URL(route.request().url()).hostname
  if(!['localhost','127.0.0.1','[::1]'].includes(host)){externalRequests.push(host);return route.abort()}
  return route.continue()
 })
 await page.route('**/api/question-bank/admin',async route=>{
  const body=route.request().postDataJSON();calls.push(body)
  assert.equal(route.request().headers().authorization.startsWith('Bearer fixture-'),true)
  let result
  if(body.action==='inventory')result={configured,source:'github',assets:[{path:'engine_ew/ew_c1.csv.enc',track:'ENGINE_OIC_EW',competenceId:'C1',part:null,format:'standard',repositoryPath:'app/src/main/assets/questions/engine_ew/ew_c1.csv.enc'}]}
  if(body.action==='editor-load')result={path:body.path,csvText:editorCsv,baseHead:'1'.repeat(40),bankRevision:'2'.repeat(40)}
  if(body.action==='editor-search')result={results:[
   {path:'engine_ew/ew_c1.csv.enc',ordinal:1,questionText:'Active sample?',track:'ENGINE_OIC_EW',competenceId:'C1',part:null,isRetired:false},
   {path:'engine_ew/ew_c1.csv.enc',ordinal:2,questionText:'Retired sample?',track:'ENGINE_OIC_EW',competenceId:'C1',part:null,isRetired:true}
  ],truncated:false,nextCursor:null,bankRevision:'2'.repeat(40)}
  if(body.action==='validate'){
   if(failValidation){await route.fulfill({status:400,json:{error:'Reordered questions are not allowed.'}});return}
   result={preview:{requestId:body.requestId,baseHead:'1'.repeat(40),validationId:'a'.repeat(64),files:[{path:body.files[0].path,questionCount:3,previousCount:2,changed:1,appended:1,corrections:[{number:1,before:{questionText:'Before correction?',options:['Port','Starboard'],correctAnswerIndex:0},after:{questionText:'After correction?',options:['Port','Starboard'],correctAnswerIndex:1}}]}]}}
  }
  if(body.action==='publish'&&failPublishOnce){failPublishOnce=false;await route.fulfill({status:502,json:{error:'Synthetic interrupted publication. Retry this same batch.'}});return}
  if(body.action==='publish'){assert.equal(body.expectedHead,'1'.repeat(40));assert.equal(body.validationId,'a'.repeat(64));result={repository:'Nhyle-zunne/hyperion-reviewer',commit:'b'.repeat(40),revision:'c'.repeat(40)}}
  await route.fulfill({json:result})
 })
 await page.goto(process.env.HYPERION_RECOVERY_TEST_URL)
 await page.getByRole('button',{name:'CHOOSE CSV FILES',exact:true}).waitFor()
 const upload=()=>page.locator('input[type=file]').setInputFiles({name:'ew_c1.csv',mimeType:'text/csv',buffer:Buffer.from('No,Question,A,B,C,D,Ans\n1,Synthetic?,Port,Starboard,Ahead,Astern,A')})
 await upload();await page.getByRole('button',{name:'VALIDATE BATCH',exact:true}).click()
 await page.getByRole('region',{name:'Validated question-bank changes'}).waitFor()
 const publish=page.getByRole('button',{name:'PUBLISH VERIFIED BATCH TO GITHUB',exact:true});await publish.waitFor()
 assert.equal(calls.some(call=>call.action==='publish'),false,'Review never publishes automatically')
 await page.getByText(/engine_ew\/ew_c1.csv.enc.*3 questions/).click()
 await page.getByText('Before correction?',{exact:true}).waitFor();await page.getByText('After correction?',{exact:true}).waitFor()
 await publish.click();await page.getByRole('status').getByText(/Synthetic interrupted publication/).waitFor();await publish.click();await page.getByRole('status').getByText(/Published directly to the Android/).waitFor()
 const completed=page.getByRole('button',{name:'ALL FILES UPDATED ✓',exact:true})
 await completed.waitFor()
 assert.equal(await completed.isDisabled(),true,'Completed batch must disable its primary action')
 const completedStyle=await completed.evaluate(element=>({opacity:getComputedStyle(element).opacity,cursor:getComputedStyle(element).cursor,pointerEvents:getComputedStyle(element).pointerEvents}))
 assert.equal(completedStyle.opacity,'0.45','Completed button must look inactive')
 assert.equal(completedStyle.cursor,'not-allowed','Completed button must not imply a click action')
 assert.equal(completedStyle.pointerEvents,'none','Completed button must have no hover/click behavior')
 await completed.evaluate(element=>element.click())
 assert.deepEqual(calls.map(call=>call.action),['inventory','validate','publish','publish'],'Disabled completed button must not send another publishing request')
 assert.equal(calls[2].requestId,calls[3].requestId,'A retry keeps its idempotent publication ID')
 assert.equal(calls[2].validationId,calls[3].validationId)
 assert.equal(await page.getByRole('link',{name:'View the published GitHub commit'}).getAttribute('href'),'https://github.com/Nhyle-zunne/hyperion-reviewer/commit/'+'b'.repeat(40))
 await page.setViewportSize({width:375,height:812});await page.screenshot({path:'/tmp/hyperion-publisher-mobile.png'})
 await upload();assert.equal(await page.getByRole('button',{name:'VALIDATE BATCH',exact:true}).isEnabled(),true,'Adding another file re-enables publishing')
 configured=false;await page.reload();await upload();await page.getByRole('status').getByText(/GITHUB_BANK_WRITE_TOKEN/).waitFor();assert.equal(await page.getByRole('button',{name:'VALIDATE BATCH',exact:true}).isDisabled(),true)
 configured=true;failValidation=true;await page.reload();await upload();await page.getByRole('button',{name:'VALIDATE BATCH',exact:true}).click();await page.getByRole('status').getByText('Reordered questions are not allowed.').waitFor();assert.equal(calls.filter(call=>call.action==='publish').length,2)
 // Retirement status must be visible in global search before opening any bank.
 failValidation=false
 await page.reload()
 await page.getByRole('button',{name:'Search all tracks and competences'}).click()
 await page.getByRole('textbox',{name:'Search questions across selected banks'}).fill('sample')
 await page.getByRole('button',{name:'Search questions',exact:true}).click()
 const globalRetired=page.locator('.admin-qb-question-results button.is-retired')
 await globalRetired.waitFor()
 assert.match(await globalRetired.innerText(),/RETIRED/)
 assert.equal(await page.locator('.admin-qb-question-results button.is-retired').count(),1)
 const globalActive=page.locator('.admin-qb-question-results button:not(.is-retired)').first()
 assert.notEqual(await globalRetired.evaluate(el=>getComputedStyle(el).backgroundColor),
  await globalActive.evaluate(el=>getComputedStyle(el).backgroundColor),'Retired global search rows need a distinguishable tinted fill')
 await globalRetired.click()
 const editor=page.locator('.admin-qb-question-form.is-retired')
 await editor.waitFor()
 await editor.getByText('RETIRED',{exact:true}).waitFor()
 await editor.getByText(/excluded from new study sessions/).waitFor()
 assert.equal(await editor.evaluate(el=>getComputedStyle(el).borderLeftStyle),'solid')
 // Test a directly opened bank as well as the protected cross-bank search.
 await page.reload()
 await page.getByRole('button',{name:'Filter Engine OIC-EW question banks'}).click()
 await page.getByRole('combobox',{name:'Search track, competence or question bank'}).click()
 await page.locator('.admin-bank-picker__option:not(.admin-bank-picker__option--all)').first().click()
 await page.getByRole('button',{name:'OPEN QUESTION BANK'}).click()
 const localRetired=page.locator('.admin-qb-question-results button.is-retired')
 await localRetired.waitFor()
 assert.match(await localRetired.innerText(),/RETIRED/)
 const localActive=page.locator('.admin-qb-question-results button:not(.is-retired)').first()
 assert.notEqual(await localRetired.evaluate(el=>getComputedStyle(el).backgroundColor),
  await localActive.evaluate(el=>getComputedStyle(el).backgroundColor),'Retired local search rows need a translucent red fill')
 assert.equal(await localRetired.evaluate(el=>getComputedStyle(el).borderTopLeftRadius),'0px','Retired rows use Hyperion square corners')
 await localRetired.click()
 await page.locator('.admin-qb-question-form.is-retired .admin-qb-retired-notice').waitFor()
 await page.getByRole('checkbox',{name:'Retired (exclude from new study sessions)'}).uncheck()
 assert.equal(await page.locator('.admin-qb-question-form.is-retired').count(),0,'Unretiring the draft removes the warning immediately')
 assert.equal(await page.locator('.admin-qb-question-form .admin-qb-retired-chip').count(),0)
 assert.equal(calls.filter(call=>call.action==='publish').length,2,'Retirement styling must not publish changes automatically')
 assert.deepEqual(externalRequests,[],'Publisher fixture must never contact production')
 console.log('PASS: mapped GitHub upload, validation preview with answer corrections, explicit publish, commit link, missing-secret guard and validation failure preservation.')
}finally{await browser.close()}
