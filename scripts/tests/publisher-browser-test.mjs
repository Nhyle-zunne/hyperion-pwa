import {chromium} from 'playwright'
import assert from 'node:assert/strict'
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']})
try {
 const page=await browser.newPage({viewport:{width:1191,height:800}}),calls=[];let configured=true,failValidation=false,failPublishOnce=true
 await page.route('**/api/question-bank/admin',async route=>{
  const body=route.request().postDataJSON();calls.push(body)
  assert.equal(route.request().headers().authorization.startsWith('Bearer fixture-'),true)
  let result
  if(body.action==='inventory')result={configured,source:'github',assets:[{path:'engine_ew/ew_c1.csv.enc',track:'ENGINE_OIC_EW',competenceId:'C1',part:null,format:'standard',repositoryPath:'app/src/main/assets/questions/engine_ew/ew_c1.csv.enc'}]}
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
 assert.deepEqual(calls.map(call=>call.action),['inventory','validate','publish','publish'])
 assert.equal(calls[2].requestId,calls[3].requestId,'A retry keeps its idempotent publication ID')
 assert.equal(calls[2].validationId,calls[3].validationId)
 assert.equal(await page.getByRole('link',{name:'View the published GitHub commit'}).getAttribute('href'),'https://github.com/Nhyle-zunne/hyperion-reviewer/commit/'+'b'.repeat(40))
 await page.setViewportSize({width:375,height:812});await page.screenshot({path:'/tmp/hyperion-publisher-mobile.png'})
 configured=false;await page.reload();await upload();await page.getByRole('status').getByText(/GITHUB_BANK_WRITE_TOKEN/).waitFor();assert.equal(await page.getByRole('button',{name:'VALIDATE BATCH',exact:true}).isDisabled(),true)
 configured=true;failValidation=true;await page.reload();await upload();await page.getByRole('button',{name:'VALIDATE BATCH',exact:true}).click();await page.getByRole('status').getByText('Reordered questions are not allowed.').waitFor();assert.equal(calls.filter(call=>call.action==='publish').length,2)
 console.log('PASS: mapped GitHub upload, validation preview with answer corrections, explicit publish, commit link, missing-secret guard and validation failure preservation.')
}finally{await browser.close()}
