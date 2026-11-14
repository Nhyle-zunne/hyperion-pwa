import { sourceInfo, toSearchQuestions, deriveKeyBytes } from '../supabase/functions/_shared/bankCodec.ts'
import { readBounded } from '../supabase/functions/_shared/githubBankSource.ts'
import { mediaObjectPath, validTrack, MAX_IMAGE_BYTES, imageSignatureMatches, sha256 } from '../supabase/functions/question-media/policy.ts'
import type { BuildImage, BuildAsset } from '../supabase/functions/question-media-build/build.ts'
import { PublisherError } from './githubBankPublisher.ts'
export type MediaBundler = (images: BuildImage[]) => Promise<BuildAsset[]>
const MAX_MEDIA_BYTES = 10 * 1024 * 1024
export function collectBankImages(banks: { path: string; text: string }[]): BuildImage[] {
  const refs = new Map<string, BuildImage>()
  for (const bank of banks) {
    const info = sourceInfo(bank.path)
    if (!info || !validTrack(info.track)) throw new PublisherError('Cannot determine the question image track.')
    for (const question of toSearchQuestions(bank.path, bank.text)) {
      if (!Array.isArray(question.imageAttachments)) continue
      for (const ref of question.imageAttachments) {
        const path = mediaObjectPath(info.track, ref.sha256, ref.mime)
        if (!path) throw new PublisherError('Invalid question image reference.')
        refs.set(path, { track: info.track, sha256: ref.sha256, mime: ref.mime })
      }
    }
  }
  return [...refs.values()]
}
export function checkPublishBudget(bankCount: number, imageCount: number) {
  // Includes config/admin checks, release integrity reads, blob writes, and ref update.
  // Reserve two subrequests below the Free plan limit for platform bookkeeping.
  if (14 + 2 * bankCount + imageCount + Math.ceil(imageCount / 20) > 48) {
    throw new PublisherError('This batch exceeds the publishing request limit. Publish a smaller batch of banks with images.', 413)
  }
}
export async function checkMediaAssets(images: BuildImage[], body: unknown): Promise<BuildAsset[]> {
  const assets = (body as { assets?: unknown })?.assets
  if (!Array.isArray(assets) || assets.length !== images.length) throw new PublisherError('The image build returned an incomplete asset bundle.', 502)
  const expected = new Map(images.map(ref => ['question-media/' + mediaObjectPath(ref.track, ref.sha256, ref.mime) + '.enc', ref]))
  let total = 0
  const key = await crypto.subtle.importKey('raw', Uint8Array.from(deriveKeyBytes()), 'AES-GCM', false, ['decrypt'])
  for (const asset of assets) {
    const ref = asset && expected.get(asset.path)
    if (!ref || asset.track !== ref.track || asset.sha256 !== ref.sha256 || asset.mime !== ref.mime ||
      typeof asset.ciphertext !== 'string' || asset.ciphertext.length > Math.ceil((MAX_IMAGE_BYTES + 28) / 3) * 4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(asset.ciphertext)) {
      throw new PublisherError('The image build returned invalid encrypted media.', 502)
    }
    expected.delete(asset.path)
    try {
      const bytes = Uint8Array.from(atob(asset.ciphertext), c => c.charCodeAt(0))
      total += bytes.length
      if (bytes.length < 44 || total > MAX_MEDIA_BYTES) throw new Error('size')
      const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12), tagLength: 128 }, key, bytes.slice(12)))
      if (!imageSignatureMatches(plain, ref.mime) || await sha256(plain) !== ref.sha256) throw new Error('integrity')
    } catch { throw new PublisherError('The image build failed encryption or integrity validation.', 502) }
  }
  return assets
}
export function createMediaBundler(fetcher: typeof fetch, supabaseUrl: string, apikey: string, authorization: string): MediaBundler {
  return async images => {
    const assets: BuildAsset[] = []
    let total = 0
    for (let i = 0; i < images.length; i += 20) {
      const batch = images.slice(i, i + 20)
      let response: Response
      try {
        response = await fetcher(supabaseUrl + '/functions/v1/question-media-build', {
          method: 'POST', headers: { Authorization: authorization, apikey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ images: batch }), signal: AbortSignal.timeout(30000)
        })
      } catch { throw new PublisherError('Question images could not be bundled. Retry publication safely.', 503) }
      if (!response.ok) throw new PublisherError('Question images could not be bundled. Verify administrator access and private image storage before publishing.', 503)
      let body: unknown
      try { body = JSON.parse(new TextDecoder().decode(await readBounded(response.body, 15 * 1024 * 1024))) }
      catch { throw new PublisherError('The image build response is invalid or oversized.', 502) }
      const built = await checkMediaAssets(batch, body)
      for (const asset of built) {
        total += atob(asset.ciphertext).length
        if (total > MAX_MEDIA_BYTES) throw new PublisherError('Bundled images exceed the combined 10 MiB limit.', 413)
        assets.push(asset)
      }
    }
    return assets
  }
}
