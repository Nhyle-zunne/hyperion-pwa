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
  await scenario('Track hub renders free-only modes, track-scoped upgrade popup, licensed modes and expiry changes', async ({ page, open }) => {
    await open('hub')
    const switchTracks = async (ids, verified = true) => page.evaluate(({ ids, verified }) => window.hubFixture.setLicenses(ids, verified), { ids, verified })
    const selectTrack = async key => page.evaluate(key => window.hubFixture.goTrack(key), key)
    const labels = () => page.locator('.hub-mode-card h3').allTextContents()
    const expectFree = async freeName => {
      await page.waitForFunction(expected => document.querySelectorAll('.hub-mode-card').length === 3 &&
        document.querySelector('.hub-mode-card h3')?.textContent === expected, freeName)
      assert.deepEqual(await labels(), [freeName, 'TIMED MOCK EXAM', 'Unlock FULL reviewer'])
      assert.equal(await page.getByRole('button', { name: /PRACTICE ALL QUESTIONS/ }).count(), 0)
      assert.equal(await page.getByRole('button', { name: /QUICK SCAN MODE/ }).count(), 0)
      assert.equal(await page.getByRole('button', { name: /VIEW SUBSCRIPTION OPTIONS/ }).count(), 0)
      assert.equal(await page.locator('.hub-mode-card.is-locked').count(), 0, 'Hidden premium modes do not linger as locked cards')
    }
    const expectFull = async () => {
      await page.waitForFunction(() => document.querySelectorAll('.hub-mode-card').length === 7)
      const all = await labels()
      assert(all.includes('PRACTICE ALL QUESTIONS') && all.includes('QUICK SCAN MODE') && all.includes('TIMED MOCK EXAM'), 'Premium practice, Quick Scan and mock remain available')
      assert(all.includes('FLASHCARD REVISION') && all.includes('MISTAKES NOTEBOOK') && all.includes('SESSION LOG') && all.includes('SEARCH QUESTION BANK'), 'All existing licensed tools remain')
      assert(!all.includes('Unlock FULL reviewer') && !all.some(title => title.includes('FREE REVIEWER')), 'No redundant free or upgrade cards for licensed track')
    }
    await switchTracks([])
    await expectFree('OIC-NW FREE REVIEWER')
    await page.getByRole('button', { name: 'OIC-NW FREE REVIEWER' }).click()
    assert.equal(await page.getByTestId('hub-destination').innerText(), '/practice/competences?track=oic_nw&free=1')
    await selectTrack('oic_nw')
    await page.getByRole('button', { name: 'TIMED MOCK EXAM' }).click()
    assert.equal(await page.getByTestId('hub-destination').innerText(), '/mock?track=oic_nw')
    await selectTrack('oic_nw')
    await page.getByRole('button', { name: 'Unlock FULL reviewer' }).click()
    const deckPopup = page.getByRole('dialog', { name: 'Deck OIC-NW' })
    await deckPopup.waitFor()
    assert.match(await deckPopup.innerText(), /₱499/, 'Existing matching store card is opened with new pricing')
    await deckPopup.getByRole('button', { name: 'Close purchase dialog' }).click()

    await selectTrack('engine_mgt')
    await expectFree('ENGINE MGT FREE REVIEWER')
    await page.getByRole('button', { name: 'Unlock FULL reviewer' }).click()
    const enginePopup = page.getByRole('dialog', { name: 'Engine Management' })
    await enginePopup.waitFor()
    assert.match(await enginePopup.innerText(), /₱999/, 'Different track opens its own matching purchase card')
    await enginePopup.getByRole('button', { name: 'Close purchase dialog' }).click()

    await switchTracks(['DECK_OIC_NW'])
    await expectFree('ENGINE MGT FREE REVIEWER')
    await selectTrack('oic_nw')
    await expectFull()
    await selectTrack('engine_ew')
    await expectFree('ENGINE OIC-EW FREE REVIEWER')
    await switchTracks(['ALL'])
    await expectFull()
    await switchTracks([])
    await expectFree('ENGINE OIC-EW FREE REVIEWER')
    await switchTracks(['GMDSS_GOC'])
    await selectTrack('gmdss')
    await expectFull()
    await selectTrack('deck_mgt')
    await expectFree('DECK MGT FREE REVIEWER')
    await switchTracks([], false)
    await expectFree('DECK MGT FREE REVIEWER')
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 840 })
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Free-mode cards do not overflow ' + width)
    }
  })
  await scenario('Bond Store popup shares exact banner artwork, nine benefits and plan controls across tracks', async ({ page, open }) => {
    await open('hub')
    await page.evaluate(() => window.hubFixture.setLicenses([]))
    const tracks = [
      ['oic_nw', 'Deck OIC-NW', 'DECK · OPERATIONAL', [29, 79, 499], 3],
      ['gmdss', 'GMDSS GOC', 'GMDSS · RADIO', [25, 59, 399], 2],
      ['engine_ew', 'Engine OIC-EW', 'ENGINE · OPERATIONAL', [29, 79, 499], 3],
      ['deck_mgt', 'Deck Management', 'DECK · MANAGEMENT', [59, 149, 999], 3],
      ['engine_mgt', 'Engine Management', 'ENGINE · MANAGEMENT', [59, 149, 999], 3],
    ]
    for (const [code, label, caption, prices, symbols] of tracks) {
      await page.evaluate(key => window.hubFixture.goTrack(key), code)
      await page.waitForFunction(key => {
        const trackTitles = {
          oic_nw: 'OIC-NW OPERATIONAL REVIEWER',
          gmdss: 'GMDSS GOC REVIEWER',
          engine_ew: 'ENGINE OIC-EW REVIEWER',
          deck_mgt: 'DECK MANAGEMENT REVIEWER',
          engine_mgt: 'ENGINE MANAGEMENT REVIEWER',
        }
        return document.querySelector('.hub-hero h1')?.textContent === trackTitles[key]
      }, code)
      await page.getByRole('button', { name: 'Unlock FULL reviewer' }).click()
      const dialog = page.getByRole('dialog', { name: label })
      await dialog.waitFor()
      assert.equal(await dialog.locator('.product-art .store-banner-symbol').count(), symbols, label + ' reuses the original cropped Bond Store artwork')
      const logoStyle = await dialog.locator('.store-banner-symbol').first().evaluate(el => getComputedStyle(el).backgroundImage)
      assert(logoStyle.includes('/store-art/hyperion-banner-sprite.png'), label + ' points to the identical Bond Store sprite asset')
      assert((await dialog.locator('.product-art').innerText()).includes(caption), label + ' uses the matching category caption')
      assert.equal(await dialog.locator('.store-benefits-list li').count(), 9, label + ' contains all nine Bond Store premium benefits')
      assert.equal(await dialog.getByRole('button', { name: 'See all 9 premium features' }).count(), 1, label + ' offers the same reveal control')
      for (const [i, duration] of ['Weekly', 'Monthly', 'Yearly'].entries()) {
        const option = dialog.getByRole('button', { name: label + ' ' + duration + ' ₱' + prices[i] })
        await option.click()
        assert.equal(await option.getAttribute('aria-pressed'), 'true', duration + ' selection tracks on ' + label)
        assert((await dialog.locator('.product-price').innerText()).includes('₱' + prices[i]), duration + ' price matches Bond Store on ' + label)
      }
      await dialog.getByRole('button', { name: 'See all 9 premium features' }).click()
      assert.equal(await dialog.getByRole('button', { name: 'Show fewer features ↑' }).getAttribute('aria-expanded'), 'true')
      await page.waitForFunction(() => {
        const list = document.querySelector('.track-purchase-card .store-benefits-list')
        return list && list.getBoundingClientRect().height > 100
      })
      const benefitsHeight = await dialog.locator('.store-benefits-list').evaluate(el => el.getBoundingClientRect().height)
      assert(benefitsHeight > 100, 'Expanded benefits are not clipped inside ' + label)
      await dialog.getByRole('button', { name: 'Show fewer features ↑' }).click()
      await dialog.getByRole('button', { name: 'Close purchase dialog' }).click()
      await dialog.waitFor({ state: 'hidden' })
    }
    await page.evaluate(key => window.hubFixture.goTrack(key), 'oic_nw')
    await page.getByRole('heading', { name: 'OIC-NW OPERATIONAL REVIEWER' }).waitFor()
    for (const [width, height] of [[320, 640], [390, 844], [768, 900], [1280, 800]]) {
      await page.setViewportSize({ width, height })
      await page.getByRole('button', { name: 'Unlock FULL reviewer' }).click()
      const dialog = page.getByRole('dialog', { name: 'Deck OIC-NW' })
      const rect = await dialog.evaluate(el => {
        const r = el.getBoundingClientRect()
        return { x: r.x, y: r.y, width: r.width, height: r.height }
      })
      assert(rect.x >= -1 && rect.x + rect.width <= width + 1 && rect.y >= -1 && rect.y + rect.height <= height + 1, 'Modal fits ' + width + '×' + height)
      const buy = dialog.getByRole('button', { name: 'BUY NOW' })
      assert(await buy.isVisible(), 'Buy Now is visible at ' + width)
      const bounds = await buy.boundingBox()
      assert(bounds && bounds.y >= 0 && bounds.y + bounds.height <= height + 1, 'Buy Now is within viewport at ' + width)
      await dialog.getByRole('button', { name: 'See all 9 premium features' }).click()
      assert(await buy.isVisible(), 'CTA remains available with all perks expanded on ' + width)
      const grownBounds = await buy.boundingBox()
      assert(grownBounds && grownBounds.y + grownBounds.height <= height + 1, 'Expanded perks cannot push Buy Now off-screen at ' + width)
      // Verify ALL nine features can be read, not merely present in the DOM.
      const details = dialog.locator('.track-purchase-details-scroll')
      const features = dialog.locator('.store-benefits-list')
      assert.equal(await details.count(), 1, 'Feature content has its own scroll viewport at ' + width)
      const expandedList = await features.evaluate(el => {
        const css = getComputedStyle(el)
        return { overflow: css.overflowY, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }
      })
      assert.equal(expandedList.overflow, 'visible', 'Expanded feature list never hides overflowing text at ' + width)
      assert(expandedList.scrollHeight <= expandedList.clientHeight + 2, 'All nine features fit their own list at ' + width)
      const lastFeature = features.locator('li').last()
      assert.equal(await lastFeature.innerText(), 'Study history and cross-device progress sync')
      await lastFeature.scrollIntoViewIfNeeded()
      const view = await details.boundingBox()
      const last = await lastFeature.boundingBox()
      const action = await dialog.locator('.track-purchase-actions').boundingBox()
      assert(view && last && action && last.y >= view.y - 2 && last.y + last.height <= view.y + view.height + 2,
        'The ninth feature is readable after scrolling within the modal at ' + width)
      assert(last.y + last.height <= action.y + 2, 'Sticky Buy Now never covers the ninth feature at ' + width)
      const toggle = dialog.getByRole('button', { name: 'Show fewer features ↑' })
      await toggle.scrollIntoViewIfNeeded()
      assert(await toggle.isVisible(), 'Collapse button stays reachable below all nine features at ' + width)
      const visibleBuy = await buy.boundingBox()
      assert(visibleBuy && visibleBuy.y >= 0 && visibleBuy.y + visibleBuy.height <= height + 1,
        'Buy Now stays on screen after scrolling through all nine features at ' + width)
      await dialog.getByRole('button', { name: 'Close purchase dialog' }).click()
    }
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: 'Unlock FULL reviewer' }).click()
    const dialog = page.getByRole('dialog', { name: 'Deck OIC-NW' })
    await dialog.getByRole('button', { name: 'Deck OIC-NW Monthly ₱79' }).click()
    await dialog.getByRole('button', { name: 'BUY NOW' }).click()
    await page.getByTestId('hub-destination').waitFor()
    assert.equal(await page.getByTestId('hub-destination').innerText(), '/checkout?buy_product=oic_nw&buy_term=month')
    const basket = await page.evaluate(() => JSON.parse(localStorage.getItem('hyperion-account-basket-v1') || '[]'))
    assert.deepEqual(basket, [{ code: 'oic_nw', term: 'month' }], 'Popup checkout retains selected product and price term')
  })
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
  await scenario('Responsive centered thumbnails and bounded, accessible percentage zoom', async ({ page, open }) => {
    await open('gallery')
    for (const viewport of [{ width: 360, height: 700 }, { width: 768, height: 1024 }, { width: 1280, height: 800 }]) {
      await page.setViewportSize(viewport)
      const thumb = page.getByTitle('Tap to enlarge diagram')
      await thumb.waitFor()
      const size = await thumb.evaluate(el => {
        const rect = el.getBoundingClientRect()
        const parent = el.parentElement.getBoundingClientRect()
        const img = el.querySelector('img').getBoundingClientRect()
        return { width: rect.width, height: img.height, centeredBy: Math.abs(rect.left + rect.width / 2 - (parent.left + parent.width / 2)) }
      })
      assert(size.width <= Math.min(520, viewport.width * .75) + 5, 'Thumbnail is relative to its container and bounded on ' + viewport.width)
      assert(size.height <= Math.min(360, viewport.height * .38) + 1, 'Thumbnail height is viewport-bounded on ' + viewport.width)
      assert(size.centeredBy < 2, 'Thumbnail is horizontally centered on ' + viewport.width)
    }
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByTitle('Tap to enlarge diagram').click({ position: { x: 8, y: 8 } })
    const dialog = page.getByRole('dialog', { name: 'Enlarged question diagram' })
    await dialog.waitFor()
    const minus = dialog.getByRole('button', { name: 'Zoom out' })
    const plus = dialog.getByRole('button', { name: 'Zoom in' })
    const reset = dialog.getByRole('button', { name: 'Reset zoom' })
    assert(await minus.isDisabled(), 'Zoom cannot shrink below 100%')
    assert.equal(await dialog.getByLabel('Image zoom percentage').innerText(), '100%')
    for (let i = 0; i < 6; i++) await plus.click()
    assert.equal(await dialog.getByLabel('Image zoom percentage').innerText(), '250%')
    assert(await plus.isDisabled(), 'Zoom cannot exceed 250%')
    assert(await dialog.getByLabel('Zoomable diagram viewport').evaluate(el => el.scrollWidth > el.clientWidth && el.scrollHeight > el.clientHeight), 'Zoomed content remains scrollable inside the bounded viewer')
    const dimensions = await dialog.getByLabel('Zoomable diagram viewport').evaluate(el => {
      const r = el.getBoundingClientRect()
      return { width: r.width, height: r.height, x: r.x, y: r.y }
    })
    assert(dimensions.width < 390 && dimensions.height < 844 && dimensions.x >= 0 && dimensions.y >= 0, 'Zoom viewer stays within the mobile viewport')
    await reset.click()
    assert.equal(await dialog.getByLabel('Image zoom percentage').innerText(), '100%')
    assert(await minus.isDisabled())
    await plus.click()
    await minus.click()
    assert.equal(await dialog.getByLabel('Image zoom percentage').innerText(), '100%')
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
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
