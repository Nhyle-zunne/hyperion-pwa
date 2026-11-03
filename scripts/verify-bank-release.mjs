// Public delivery checks plus secret-name metadata; never read or print secret values.
const base='https://hyperionmaritime.org'
const source=await (await fetch(base+'/api/question-bank/source',{signal:AbortSignal.timeout(20000)})).json()
if(source.source!=='github'||source.root!=='app/src/main/assets/questions'||source.files!==69||!/^[a-f0-9]{40}$/.test(source.revision||''))throw Error('Production must use the shared Android GitHub question assets.')
for(const freeOnly of [true,false]){
 const response=await fetch(base+'/api/question-bank/questions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({track:'GMDSS_GOC',competenceId:'C1',freeOnly,offset:0,limit:1,bankRevision:source.revision}),signal:AbortSignal.timeout(25000)})
 if(freeOnly){const result=await response.json();if(response.status!==200||result.source!=='github'||result.bankRevision!==source.revision||result.questions?.length!==1)throw Error('Shared Android bank free delivery failed.')}
 else if(![401,403].includes(response.status))throw Error('Unlicensed full-bank access must remain denied.')
}
console.log('Verified shared Android bank delivery, immutable release revision and paid access denial.')
if(process.env.CLOUDFLARE_API_TOKEN){
 const response=await fetch('https://api.cloudflare.com/client/v4/accounts/e4f2b51a3c1a61a5ba56a7d5cf1d8f45/workers/scripts/hyperion-pwa/secrets',{headers:{Authorization:`Bearer ${process.env.CLOUDFLARE_API_TOKEN}`},signal:AbortSignal.timeout(15000)})
 if(!response.ok)throw Error(`Could not verify publisher secret metadata (HTTP ${response.status}).`)
 const value=await response.json()
 if(value.success!==true||!value.result?.some(binding=>binding.name==='GITHUB_BANK_WRITE_TOKEN'&&binding.type==='secret_text'))throw Error('The production Worker is missing GITHUB_BANK_WRITE_TOKEN. Configure its secret before using the updater.')
 console.log('Verified the production publisher secret is configured (value not read).')
}
