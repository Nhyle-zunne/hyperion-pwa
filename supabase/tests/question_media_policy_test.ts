import { assert, assertEquals } from 'jsr:@std/assert@1'
import {
  MAX_IMAGE_BYTES, mediaObjectPath, imageSignatureMatches,
  validTrack, activePaidTrackRows, sha256, isConfiguredQuestionBankAdmin
} from '../functions/question-media/policy.ts'

const digest = 'a'.repeat(64)
const user = '11111111-1111-4111-8111-111111111111'
const other = '22222222-2222-4222-8222-222222222222'

Deno.test('only exact tracks, lowercase content hashes and image MIME are valid', () => {
  assertEquals(mediaObjectPath('DECK_OIC_NW',digest,'image/webp'),
    'DECK_OIC_NW/' + digest + '.webp')
  assertEquals(mediaObjectPath('GMDSS_GOC',digest,'image/png'),
    'GMDSS_GOC/' + digest + '.png')
  for(const path of ['../secret','DECK_OIC_NW/../../secret','GMDSS_GOC/other']) {
    assertEquals(mediaObjectPath(path,digest,'image/png'),null)
  }
  assertEquals(mediaObjectPath('DECK_OIC_NW','../secret','image/png'),null)
  assertEquals(mediaObjectPath('DECK_OIC_NW',digest.toUpperCase(),'image/png'),null)
  assertEquals(mediaObjectPath('DECK_OIC_NW',digest,'text/html'),null)
  assert(!validTrack('ADMIN'))
})

Deno.test('image signatures prevent HTML/SVG uploads disguised as image files', async () => {
  const webp = new Uint8Array(16)
  webp.set(new TextEncoder().encode('RIFF'),0)
  webp.set(new TextEncoder().encode('WEBP'),8)
  assert(imageSignatureMatches(webp,'image/webp'))
  assert(!imageSignatureMatches(new TextEncoder().encode('<svg onload=alert(1)>'),'image/webp'))
  assert(!imageSignatureMatches(new Uint8Array(MAX_IMAGE_BYTES+1),'image/webp'))
  const png = new Uint8Array([137,80,78,71,13,10,26,10,...new Array(9).fill(0)])
  assert(imageSignatureMatches(png,'image/png'))
  const jpeg = new Uint8Array([255,216,255,...new Array(12).fill(0),255,217])
  assert(imageSignatureMatches(jpeg,'image/jpeg'))
  const h = await sha256(webp)
  assertEquals(h.length,64)
  assert(h !== digest)
})

Deno.test('license authorization is specific to authenticated owner, track, expiry and status', () => {
  const later = new Date(Date.now()+86400000).toISOString()
  const earlier = new Date(Date.now()-86400000).toISOString()
  const granted = [{user_id:user,track_id:'DECK_OIC_NW',expires_at:later}]
  assert(activePaidTrackRows(granted,user,'DECK_OIC_NW'))
  assert(!activePaidTrackRows(granted,other,'DECK_OIC_NW'))
  assert(!activePaidTrackRows(granted,user,'ENGINE_MGT'))
  assert(!activePaidTrackRows([{user_id:user,track_id:'DECK_OIC_NW',expires_at:earlier}],user,'DECK_OIC_NW'))
  assert(!activePaidTrackRows(null,user,'DECK_OIC_NW'))
  assert(!activePaidTrackRows([{user_id:user,track_id:'DECK_OIC_NW',expires_at:'bad'}],user,'DECK_OIC_NW'))
})

Deno.test('private media upload accepts the same administrator email list syntax as question banks', () => {
  const valid = 'Admin@example.com; admin2@example.org, admin3@example.net\nother@example.com'
  for (const email of ['admin@example.com','ADMIN2@example.org','admin3@example.net','other@example.com']) {
    assert(isConfiguredQuestionBankAdmin(email, valid))
  }
  assert(!isConfiguredQuestionBankAdmin('unknown@example.com', valid))
  assert(!isConfiguredQuestionBankAdmin(undefined, valid))
  assert(!isConfiguredQuestionBankAdmin('admin@example.com', ''))
})
