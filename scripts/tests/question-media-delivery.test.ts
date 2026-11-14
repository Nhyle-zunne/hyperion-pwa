import assert from 'node:assert/strict'
import { readGithubQuestionImage } from '../../worker/questionMediaDelivery.ts'
import { deriveKeyBytes } from '../../supabase/functions/_shared/bankCodec.ts'
import { sha256 } from '../../supabase/functions/question-media/policy.ts'

const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='), c => c.charCodeAt(0))
const digest = await sha256(png)
const key = await crypto.subtle.importKey('raw', Uint8Array.from(deriveKeyBytes()), 'AES-GCM', false, ['encrypt'])
const nonce = Uint8Array.from({ length: 12 }, (_, i) => i)
const body = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, png))
const ciphertext = Uint8Array.from([...nonce, ...body])
const asset = 'question-media/ENGINE_MGT/' + digest + '.png.enc'
let requests = 0
const fetcher = (async (url: string | URL | Request) => {
  requests++
  assert.match(String(url), /question-media\/ENGINE_MGT\/[a-f0-9]{64}\.(?:png|jpg)\.enc/)
  return new Response(Uint8Array.from(ciphertext))
}) as typeof fetch

assert.deepEqual(await readGithubQuestionImage(fetcher, 'ENGINE_MGT', digest, 'image/png'), png)
assert.equal(requests, 1)
await assert.rejects(() => readGithubQuestionImage(fetcher, 'ENGINE_MGT', 'a'.repeat(64), 'image/png'), /integrity/i)
await assert.rejects(() => readGithubQuestionImage(fetcher, 'ENGINE_MGT', digest, 'image/jpeg'), /integrity/i)
await assert.rejects(() => readGithubQuestionImage(fetcher, '../ENGINE_MGT' as never, digest, 'image/png'), /Invalid question image reference/)
const broken = (async () => new Response(Uint8Array.from(ciphertext.slice(0, -1)))) as typeof fetch
await assert.rejects(() => readGithubQuestionImage(broken, 'ENGINE_MGT', digest, 'image/png'))
const oversized = (async () => new Response(Uint8Array.from(new Uint8Array(524288 + 30)))) as typeof fetch
await assert.rejects(() => readGithubQuestionImage(oversized, 'ENGINE_MGT', digest, 'image/png'))
console.log('GitHub encrypted question-media delivery and integrity tests passed.')
