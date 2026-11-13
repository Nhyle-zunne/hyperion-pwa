import assert from 'node:assert/strict'
import { chromium } from 'playwright'
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || chromium.executablePath(), args: ['--no-sandbox'] })
const failures = []
const base = process.env.HYPERION_MEDIA_TEST_URL || process.env.HYPERION_RECOVERY_TEST_URL
assert(base, 'Set HYPERION_MEDIA_TEST_URL or run through run-recovery-browser.mjs')
async function scenario(name, run) {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  page.setDefaultTimeout(5000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  let downloads = 0, failFirst = false
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.hostname === 'media-fixture.invalid' && url.pathname === '/functions/v1/question-media') {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization,apikey' } })
      downloads++
      if (failFirst && downloads === 1) return route.fulfill({ status: 503, headers: { 'Access-Control-Allow-Origin': '*' }, body: 'Synthetic transient failure' })
      const { png, sha } = await page.evaluate(() => ({ png: window.mediaFixture.png, sha: window.mediaFixture.sha }))
      return route.fulfill({ status: 200, contentType: 'image/png', headers: { 'X-Hyperion-Media-SHA256': sha, 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'X-Hyperion-Media-SHA256' }, body: Buffer.from(png) })
    }
    return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ? route.continue() : route.abort()
  })
  const open = async (screen, imageOnly = false) => { await page.goto(`${base}?screen=${screen}${imageOnly ? '&imageOnly=1' : ''}`); await page.waitForFunction(() => !!window.mediaFixture) }
  try { await run({ page, context, open, transient: () => { failFirst = true }, downloads: () => downloads }); assert.deepEqual(errors, [], 'No runtime errors'); console.log(`PASS ${name}`) }
  catch (error) { failures.push(`${name}: ${error.message}`); console.error(`FAIL ${name}: ${error.message}\nPAGE: ${await page.locator('body').innerText()}`) }
  finally { await context.close() }
}
try {
  await scenario('Transient download has Retry, accessible portal zoom and Escape focus return', async ({ page, open, transient }) => {
    transient(); await open('gallery')
    await page.getByRole('alert').waitFor()
    await page.getByRole('button', { name: 'Retry image', exact: true }).click()
    const thumbnail = page.getByTitle('Tap to enlarge diagram')
    await page.getByAltText('Synthetic question diagram', { exact: true }).waitFor()
    assert(await page.getByAltText('Synthetic question diagram', { exact: true }).evaluate(img => img.complete && img.naturalWidth > 0), 'Synthetic PNG is decoded by the real browser')
    await thumbnail.click()
    const dialog = page.getByRole('dialog', { name: 'Enlarged question diagram' })
    await dialog.waitFor()
    assert(await dialog.evaluate(el => el.parentElement === document.body), 'Zoom is portaled outside transformed/clipped readers')
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
    assert(await thumbnail.evaluate(el => el === document.activeElement), 'Escape returns focus to image trigger')
  })
  await scenario('Cached read rechecks license after asynchronous digest', async ({ page, open }) => {
    await open('gallery'); await page.getByAltText('Synthetic question diagram', { exact: true }).waitFor()
    assert.deepEqual(await page.evaluate(() => window.mediaFixture.revokeDuringCachedDigest()), { rejected: true, revoked: true })
  })
  await scenario('Cancelled cached read cannot return verified image bytes', async ({ page, open }) => {
    await open('gallery'); await page.getByAltText('Synthetic question diagram', { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.mediaFixture.abortDuringCachedDigest()), true)
  })
  await scenario('Offline cached image and immediate owner/access/reference invalidation', async ({ page, context, open, downloads }) => {
    await open('gallery'); await page.getByAltText('Synthetic question diagram', { exact: true }).waitFor()
    const initial = downloads(); await context.setOffline(true)
    assert((await page.evaluate(() => window.mediaFixture.load())) > 0)
    assert.equal(downloads(), initial, 'Offline read uses owner-scoped verified cache')
    for (const mutation of ['owner', 'license', 'ref']) {
      await context.setOffline(false); await open('gallery')
      await page.getByTitle('Tap to enlarge diagram').click()
      await page.getByRole('dialog', { name: 'Enlarged question diagram' }).waitFor()
      await page.evaluate(kind => kind === 'owner' ? window.mediaFixture.license(true, '22222222-2222-4222-8222-222222222222') : kind === 'license' ? window.mediaFixture.license(false) : window.mediaFixture.changeRef(), mutation)
      await page.waitForFunction(() => !document.querySelector('[role=dialog],dialog[open]') && !document.querySelector('img'), undefined, { timeout: 1000 })
      assert.equal(await page.getByRole('dialog').count(), 0, `${mutation} removes zoom`)
      assert.equal(await page.locator('img').count(), 0, `${mutation} removes stale thumbnail`)
    }
  })
  await scenario('Saved question references survive encrypted persistence and question conversion', async ({ page, open }) => {
    await open('gallery')
    const refs = await page.evaluate(() => window.mediaFixture.savedRefs())
    assert.equal(refs.bookmarks?.length, 2, 'Bookmark question roundtrip retains prompt and explanation references')
    assert.equal(refs.vault?.length, 2, 'Mistake question roundtrip retains prompt and explanation references')
  })
  await scenario('Untrusted oversized response body is bounded and cancelled', async ({ page, open }) => {
    await open('gallery'); await page.getByAltText('Synthetic question diagram', { exact: true }).waitFor()
    const result = await page.evaluate(() => window.mediaFixture.boundedStream())
    assert(result.rejected, 'Oversized body is rejected')
    assert(result.cancelled, 'Oversized stream is actively cancelled')
    assert(result.chunks <= 10, 'Reader stops at the 512KiB bound plus one queued chunk')
  })
  await scenario('Mock exam displays prompt diagram without revealing explanation', async ({ page, open }) => {
    await open('mock', true); await page.getByAltText('Synthetic question diagram', { exact: true }).waitFor()
    assert.equal(await page.getByAltText('Synthetic explanation diagram', { exact: true }).count(), 0)
  })

  await scenario('Image-only prompt survives saved reload and renders in mock without a text stem', async ({ page }) => {
    await page.goto(`${base}?screen=mock&promptOnly=1`)
    await page.waitForFunction(() => !!window.mediaFixture)
    await page.getByAltText('Synthetic question diagram', { exact: true }).waitFor()
    assert.equal(await page.getByAltText('Synthetic explanation diagram', { exact: true }).count(), 0)
    const refs = await page.evaluate(() => window.mediaFixture.savedRefs())
    assert.equal(refs.bookmarks?.length, 2)
    assert.equal(refs.vault?.length, 2)
    assert.equal(await page.getByText('Synthetic vessel diagram question?', { exact: true }).count(), 0)
  })
  await scenario('Flashcard diagrams respect prompt/reveal and image tap does not flip', async ({ page, open }) => {
    await open('flashcards', true); await page.getByRole('button', { name: /All questions/ }).click()
    await page.getByAltText('Synthetic question diagram', { exact: true }).waitFor()
    assert.equal(await page.getByAltText('Synthetic explanation diagram', { exact: true }).count(), 0)
    await page.getByTitle('Tap to enlarge diagram').click()
    await page.getByRole('dialog', { name: 'Enlarged question diagram' }).waitFor()
    await page.keyboard.press('Escape')
    assert.equal(await page.getByRole('button', { name: 'Reveal answer', exact: true }).count(), 1, 'Image tap leaves question side active')
    await page.getByRole('button', { name: 'Reveal answer', exact: true }).click()
    await page.getByAltText('Synthetic explanation diagram', { exact: true }).waitFor()
  })
  for (const screen of ['bookmarks', 'vault']) await scenario(`Expanded ${screen} displays prompt and explanation diagrams`, async ({ page, open }) => {
    await open(screen, true)
    await page.locator('button[aria-expanded="false"]').first().click()
    await page.locator('button[aria-expanded="false"]').first().click()
    await page.getByRole('button', { name: /View question/ }).click()
    await page.getByAltText('Synthetic question diagram', { exact: true }).waitFor()
    await page.getByAltText('Synthetic explanation diagram', { exact: true }).waitFor()
  })
  await scenario('Search expanded result displays both diagrams', async ({ page, open }) => {
    await open('search', true); await page.getByPlaceholder('e.g. COLREG, ECDIS, SART…').fill('diagram')
    await page.getByRole('button', { name: 'Go', exact: true }).click()
    await page.getByRole('button', { name: /Synthetic vessel diagram question/ }).click()
    await page.getByAltText('Synthetic question diagram', { exact: true }).waitFor()
    await page.getByAltText('Synthetic explanation diagram', { exact: true }).waitFor()
  })
  await scenario('History audit displays both diagrams', async ({ page, open }) => {
    await open('history', true); await page.locator('article[role="button"]').first().click()
    await page.getByAltText('Synthetic question diagram', { exact: true }).waitFor()
    await page.getByAltText('Synthetic explanation diagram', { exact: true }).waitFor()
  })
  await scenario('Completed results question review displays both diagrams', async ({ page, open }) => {
    await open('results', true); await page.getByRole('tab', { name: /Question Review/ }).click()
    await page.getByAltText('Synthetic question diagram', { exact: true }).waitFor()
    await page.getByAltText('Synthetic explanation diagram', { exact: true }).waitFor()
  })

} finally { await browser.close() }
assert.deepEqual(failures, [], 'Synthetic media browser regressions (readers also cover image-only explanations)')
