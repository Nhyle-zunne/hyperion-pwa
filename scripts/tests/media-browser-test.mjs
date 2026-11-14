import { assertSquareCorners } from './square-corners-browser-helper.mjs'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chromium } from 'playwright'
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || chromium.executablePath(), args: ['--no-sandbox'] })
const failures = []
const base = process.env.HYPERION_MEDIA_TEST_URL || process.env.HYPERION_RECOVERY_TEST_URL
assert(base, 'Set HYPERION_MEDIA_TEST_URL or run through run-recovery-browser.mjs')
const defaultPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')
const syntheticImages = new Map()
for (let i = 0; i < 105; i++) {
  const bytes = Buffer.concat([defaultPng, Buffer.from([i & 255, (i >> 8) & 255])])
  syntheticImages.set(createHash('sha256').update(bytes).digest('hex'), bytes)
}
async function scenario(name, run) {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  page.setDefaultTimeout(5000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  let downloads = 0, failFirst = false
  const batches = []
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/question-bank/media') {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization,apikey' } })
      downloads++
      if (failFirst && downloads === 1) return route.fulfill({ status: 503, headers: { 'Access-Control-Allow-Origin': '*' }, body: 'Synthetic transient failure' })
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON()
        batches.push({ ...body, authorization: route.request().headers().authorization || null })
        const images = body.images.map(ref => ({ ...ref, data: (syntheticImages.get(ref.sha256) || defaultPng).toString('base64') }))
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ images }) })
      }
      const digest = url.searchParams.get('sha256')
      const png = syntheticImages.get(digest) || defaultPng
      const sha = createHash('sha256').update(png).digest('hex')
      return route.fulfill({ status: 200, contentType: 'image/png', headers: { 'X-Hyperion-Media-SHA256': sha, 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'X-Hyperion-Media-SHA256' }, body: png })
    }
    return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ? route.continue() : route.abort()
  })
  const open = async (screen, imageOnly = false) => { await page.goto(`${base}?screen=${screen}${imageOnly ? '&imageOnly=1' : ''}`); await page.waitForFunction(() => !!window.mediaFixture) }
  try { await run({ page, context, open, transient: () => { failFirst = true }, downloads: () => downloads, batches }); await assertSquareCorners(page); assert.deepEqual(errors, [], 'No runtime errors'); console.log(`PASS ${name}`) }
  catch (error) { failures.push(`${name}: ${error.message}`); console.error(`FAIL ${name}: ${error.message}\nPAGE: ${await page.locator('body').innerText()}`) }
  finally { await context.close() }
}
try {
  await scenario('Offline preparation batches verified paid images and reuses them without network or session', async ({ page, context, open, downloads, batches }) => {
    await open('gallery')
    await page.getByRole('img', { name: 'Synthetic question diagram' }).waitFor()
    const beforeAuth = await page.evaluate(() => window.mediaFixture.authCount())
    const result = await page.evaluate(() => window.mediaFixture.prepareMany(17))
    assert.equal(result.ready, true)
    assert.deepEqual(batches.map(batch => batch.images.length), [8, 8, 1])
    assert(batches.every(batch => batch.freeOnly === false && batch.authorization === 'Bearer synthetic-token'))
    assert.equal(await page.evaluate(() => window.mediaFixture.authCount()) - beforeAuth, 1, 'One session lookup for the full preparation')
    const beforeNetwork = downloads(), beforeOfflineAuth = await page.evaluate(() => window.mediaFixture.authCount())
    await context.setOffline(true)
    assert((await page.evaluate(hash => window.mediaFixture.loadMulti(hash), result.last)) > 0)
    assert.equal(downloads(), beforeNetwork)
    assert.equal(await page.evaluate(() => window.mediaFixture.authCount()), beforeOfflineAuth)
  })
  await scenario('Free offline packs skip premium images without extra network or auth; paid quota failures remain safe', async ({ page, open, batches, downloads }) => {
    await open('gallery')
    await page.getByRole('img', { name: 'Synthetic question diagram' }).waitFor()
    const paid = await page.evaluate(() => window.mediaFixture.prepareMany(2))
    assert.equal(paid.ready, true)
    const beforeAuth = await page.evaluate(() => window.mediaFixture.authCount()), beforeNetwork = downloads()
    const free = await page.evaluate(() => window.mediaFixture.prepareMany(2, true))
    assert.equal(free.ready, true, 'Free text questions are complete without premium images')
    assert.equal(batches.length, 1, 'Free preparation never downloads or caches premium images')
    assert.equal(downloads(), beforeNetwork)
    assert.equal(await page.evaluate(() => window.mediaFixture.authCount()), beforeAuth, 'Free preparation does not request an account session')
    const quota = await page.evaluate(() => window.mediaFixture.prepareMany(3, false, true))
    assert.equal(quota.rejected, true)
    assert.equal(quota.ready, false, 'Paid offline readiness still fails safely when image storage is unavailable')
  })
  await scenario('Track hub renders free-only modes, track-scoped upgrade popup, licensed modes and expiry changes', async ({ page, open }) => {
    await open('hub')
    const switchTracks = async (ids, verified = true) => page.evaluate(({ ids, verified }) => window.hubFixture.setLicenses(ids, verified), { ids, verified })
    const selectTrack = async key => page.evaluate(key => window.hubFixture.goTrack(key), key)
    const labels = () => page.locator('.hub-mode-card h3').allTextContents()
    const expectFree = async freeName => {
      await page.waitForFunction(expected => document.querySelectorAll('.hub-mode-card').length === 2 &&
        document.querySelector('.hub-mode-card h3')?.textContent === expected, freeName)
      assert.deepEqual(await labels(), [freeName, 'UNLOCK FULL REVIEWER'])
      await page.waitForFunction(() => document.querySelector('.hub-mode-free .hub-mode-count')?.textContent === '1' && document.querySelector('.hub-mode-unlock .hub-mode-count')?.textContent === '1,234')
      assert.equal(await page.locator('.hub-mode-metric').count(), 2, 'Free and full cards each show their own question count')
      assert.equal(await page.getByRole('button', { name: /PRACTICE ALL QUESTIONS/ }).count(), 0)
      assert.equal(await page.getByRole('button', { name: /QUICK SCAN MODE/ }).count(), 0)
      assert.equal(await page.getByRole('button', { name: /VIEW SUBSCRIPTION OPTIONS/ }).count(), 0)
      assert.equal(await page.locator('.hub-mode-card.is-locked').count(), 0, 'Hidden premium modes do not linger as locked cards')
    }
    const expectFull = async () => {
      await page.waitForFunction(() => document.querySelectorAll('.hub-mode-card').length === 7)
      const all = await labels()
      assert.equal(await page.locator('.hub-mode-metric').count(), 7, 'Every licensed mode makes use of its card with a relevant metric')
      assert.equal(await page.locator('.hub-mode-free').count(), 0, 'Licensed users do not see a sample-pool count')
      assert(all.includes('PRACTICE ALL QUESTIONS') && all.includes('QUICK SCAN MODE') && all.includes('TIMED MOCK EXAM'), 'Premium practice, Quick Scan and mock remain available')
      assert(all.includes('FLASHCARD REVISION') && all.includes('MISTAKES NOTEBOOK') && all.includes('SESSION LOG') && all.includes('SEARCH QUESTION BANK'), 'All existing licensed tools remain')
      assert(!all.includes('UNLOCK FULL REVIEWER') && !all.some(title => title.includes('FREE REVIEWER')), 'No redundant free or upgrade cards for licensed track')
    }
    await switchTracks([])
    await expectFree('OIC-NW FREE REVIEWER')
    await page.getByRole('button', { name: 'OIC-NW FREE REVIEWER' }).click()
    assert.equal(await page.getByTestId('hub-destination').innerText(), '/practice/competences?track=oic_nw&free=1')
    await selectTrack('oic_nw')
    assert.equal(await page.getByRole('button', { name: 'TIMED MOCK EXAM' }).count(), 0, 'No mock exam action for a free track')
    await selectTrack('oic_nw')
    await page.getByRole('button', { name: 'UNLOCK FULL REVIEWER' }).click()
    const deckPopup = page.getByRole('dialog', { name: 'Deck OIC-NW' })
    await deckPopup.waitFor()
    assert.match(await deckPopup.innerText(), /₱499/, 'Existing matching store card is opened with new pricing')
    await deckPopup.getByRole('button', { name: 'Close purchase dialog' }).click()

    await selectTrack('engine_mgt')
    await expectFree('ENGINE MGT FREE REVIEWER')
    await page.getByRole('button', { name: 'UNLOCK FULL REVIEWER' }).click()
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
    // The mock exam card describes the complete track exam plan, not bank size.
    for (const [track, title, expected] of [
      ['oic_nw', 'OIC-NW OPERATIONAL REVIEWER', 200],
      ['deck_mgt', 'DECK MANAGEMENT REVIEWER', 200],
      ['engine_mgt', 'ENGINE MANAGEMENT REVIEWER', 200],
      ['gmdss', 'GMDSS GOC REVIEWER', 100],
      ['engine_ew', 'ENGINE OIC-EW REVIEWER', 200],
    ]) {
      await selectTrack(track)
      await page.getByRole('heading', { name: title }).waitFor()
      const mockCard = page.getByRole('button', { name: 'TIMED MOCK EXAM' })
      assert.equal(await mockCard.locator('.hub-mode-count').innerText(), String(expected),
        track + ' shows its official total mock-exam questions instead of the full bank')
      assert.equal(await mockCard.locator('.hub-mode-count-label').innerText(), 'MOCK EXAM QUESTIONS')
      assert.equal(await page.getByRole('button', { name: 'PRACTICE ALL QUESTIONS' }).locator('.hub-mode-count').innerText(), '1,234',
        'Practice All retains the full bank count')
    }
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
      const cards = await page.locator('.hub-mode-card').evaluateAll(elements => elements.map(element => {
        const { x, y, width: cardWidth, height } = element.getBoundingClientRect()
        return { x, y, width: cardWidth, height }
      }))
      assert.equal(cards.length, 2, 'Only the two free-mode cards show at ' + width)
      assert(Math.abs(cards[0].y - cards[1].y) < 2, 'Free Reviewer and UNLOCK FULL REVIEWER share the original card row at ' + width)
      assert(Math.abs(cards[0].width - cards[1].width) < 2, 'Free Reviewer and UNLOCK FULL REVIEWER have matching grid widths at ' + width)
      assert(Math.abs(cards[0].height - cards[1].height) < 2, 'Free Reviewer and UNLOCK FULL REVIEWER have matching grid heights at ' + width)
      assert(cards[1].x > cards[0].x, 'UNLOCK FULL REVIEWER is immediately to the right at ' + width)
      for (const theme of ['light', 'dark']) {
        await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
        const metrics = await page.locator('.hub-mode-count').evaluateAll(els => els.map(el => ({ color: getComputedStyle(el).color, size: parseFloat(getComputedStyle(el).fontSize) })))
        assert(metrics.every(metric => metric.color === (theme === 'light' ? 'rgb(21, 128, 61)' : 'rgb(34, 197, 94)') && metric.size >= 28), 'Question counts use dashboard-style green emphasis at ' + width)
        assert.equal(await page.locator('.hub-mode-card').evaluateAll(cards => cards.every(card => card.scrollWidth <= card.clientWidth + 1)), true, 'Descriptions and counts fit their card width')
        await page.locator('.hub-mode-grid').screenshot({ path: `/tmp/hub-free-${theme}-${width}.png`, animations: 'disabled' })
      }

    }
    await selectTrack('oic_nw')
    await switchTracks(['DECK_OIC_NW'])
    await expectFull()
    await page.waitForFunction(() => document.querySelector('.hub-mode-count')?.textContent === '1,234')
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 840 })
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Licensed cards fit ' + width)
      for (const card of await page.locator('.hub-mode-card').all()) {
        const action = card.locator('.hub-mode-action')
        await action.scrollIntoViewIfNeeded()
        const bounds = await action.boundingBox()
        assert(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 841, 'Each licensed tool action is reachable by scrolling at ' + width)
        assert(await card.evaluate(el => el.scrollHeight <= el.clientHeight + 1), 'Licensed card descriptions and counts fit vertically')
      }

      await page.locator('.hub-mode-grid').screenshot({ path: `/tmp/hub-licensed-${width}.png`, animations: 'disabled' })
    }
    await page.getByRole('button', { name: 'SEARCH QUESTION BANK', exact: true }).click()
    assert.equal(await page.getByTestId('hub-destination').innerText(), '/search?track=oic_nw', 'The final licensed tool remains actionable')
  })
  await scenario('Direct mock URL denies unlicensed access before fetching questions', async ({ page, open }) => {
    await open('hub')
    await page.evaluate(() => window.hubFixture.setLicenses([]))
    await page.evaluate(() => window.hubFixture.goMock('oic_nw'))
    await page.getByText('An active license for OIC-NW OPERATIONAL TRACK is required.', { exact: false }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'START OFFICIAL TIMED MOCK EXAM' }).count(), 0, 'Free direct link cannot start timed mock')
    assert.equal(await page.getByRole('button', { name: 'UNLOCK FULL REVIEWER' }).count(), 1)
    await page.getByRole('button', { name: 'UNLOCK FULL REVIEWER' }).click()
    await page.getByRole('dialog', { name: 'Deck OIC-NW' }).waitFor()
    await page.getByRole('button', { name: 'Close purchase dialog' }).click()
    await page.evaluate(() => window.hubFixture.setLicenses(['DECK_OIC_NW']))
    await page.waitForFunction(() => document.body.textContent.includes('EXAMINATION PROTOCOL'))
    assert.equal(await page.getByRole('button', { name: 'UNLOCK FULL REVIEWER' }).count(), 0, 'Active track license unlocks direct mock screen')
    await page.evaluate(() => window.hubFixture.setLicenses([]))
    await page.getByText('An active license for OIC-NW OPERATIONAL TRACK is required.', { exact: false }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'START OFFICIAL TIMED MOCK EXAM' }).count(), 0, 'Revocation immediately gates the mock screen')
  })
  await scenario('Bond Store popup shares exact banner artwork, ten benefits and plan controls across tracks', async ({ page, open }) => {
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
      await page.getByRole('button', { name: 'UNLOCK FULL REVIEWER' }).click()
      const dialog = page.getByRole('dialog', { name: label })
      await dialog.waitFor()
      assert.equal(await dialog.locator('.product-art .store-banner-symbol').count(), symbols, label + ' reuses the original cropped Bond Store artwork')
      const logoStyle = await dialog.locator('.store-banner-symbol').first().evaluate(el => getComputedStyle(el).backgroundImage)
      assert(logoStyle.includes('/store-art/hyperion-banner-sprite.png'), label + ' points to the identical Bond Store sprite asset')
      assert((await dialog.locator('.product-art').innerText()).includes(caption), label + ' uses the matching category caption')
      assert.equal(await dialog.locator('.store-benefits-list li').count(), 10, label + ' contains all ten Bond Store premium benefits')
      assert(await dialog.getByText('Use your license across multiple devices, including the official Hyperion Android app.').count() === 1, 'Cross-device benefit is visible in purchase popup for ' + label)
      assert.equal(await dialog.locator('.store-benefits-toggle').count(), 0, label + ' popup shows all ten premium features without an expand button')
      const listState = await dialog.locator('.store-benefits-list').evaluate(el => ({ overflow: getComputedStyle(el).overflowY, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }))
      assert.equal(listState.overflow, 'visible', label + ' list is not clipped by the default collapsed height')
      assert(listState.scrollHeight <= listState.clientHeight + 2, label + ' all ten benefit rows occupy their full height')
      for (const [i, duration] of ['Weekly', 'Monthly', 'Yearly'].entries()) {
        const option = dialog.getByRole('button', { name: label + ' ' + duration + ' ₱' + prices[i] })
        await option.click()
        assert.equal(await option.getAttribute('aria-pressed'), 'true', duration + ' selection tracks on ' + label)
        assert((await dialog.locator('.product-price').innerText()).includes('₱' + prices[i]), duration + ' price matches Bond Store on ' + label)
      }
      const benefitsHeight = await dialog.locator('.store-benefits-list').evaluate(el => el.getBoundingClientRect().height)
      assert(benefitsHeight > 100, 'All ten benefits are visible by default inside ' + label)
      await dialog.getByRole('button', { name: 'Close purchase dialog' }).click()
      await dialog.waitFor({ state: 'hidden' })
    }
    await page.evaluate(key => window.hubFixture.goTrack(key), 'oic_nw')
    await page.getByRole('heading', { name: 'OIC-NW OPERATIONAL REVIEWER' }).waitFor()
    for (const [width, height] of [[320, 640], [390, 844], [768, 900], [1280, 800]]) {
      await page.setViewportSize({ width, height })
      await page.getByRole('button', { name: 'UNLOCK FULL REVIEWER' }).click()
      const dialog = page.getByRole('dialog', { name: 'Deck OIC-NW' })
      const rect = await dialog.evaluate(el => {
        const r = el.getBoundingClientRect()
        return { x: r.x, y: r.y, width: r.width, height: r.height }
      })
      assert(rect.x >= -1 && rect.x + rect.width <= width + 1 && rect.y >= -1 && rect.y + rect.height <= height + 1, 'Modal fits ' + width + '×' + height)
      const buy = dialog.getByRole('button', { name: 'BUY NOW' })
      assert(await buy.isVisible(), 'Buy Now is visible at ' + width)
      await page.mouse.move(0, 0)
      await page.waitForFunction(() => getComputedStyle(document.querySelector('.track-purchase-buy')).backgroundColor === 'rgb(20, 125, 67)')
      await assertSquareCorners(page)
      const purchaseStyle = await dialog.evaluate(el => {
        const action = el.querySelector('.track-purchase-buy')
        return { radius: getComputedStyle(el).borderRadius, innerBorder: getComputedStyle(el.querySelector('.track-purchase-card')).borderTopWidth, actionBg: getComputedStyle(action).backgroundColor, actionText: getComputedStyle(action).color }
      })
      assert.equal(purchaseStyle.radius, '0px', 'Purchase popup uses the shared square card corners')
      assert.equal(await dialog.locator('.product-art, .store-duration-option, .track-purchase-buy, .track-purchase-close').evaluateAll(els => els.every(el => getComputedStyle(el).borderRadius === '0px')), true, 'Purchase artwork and controls have square corners')
      assert.equal(purchaseStyle.innerBorder, '0px', 'Popup does not nest another outlined card')
      assert.equal(purchaseStyle.actionBg, 'rgb(20, 125, 67)', 'Purchase action uses Hyperion green')
      assert.equal(purchaseStyle.actionText, 'rgb(255, 255, 255)', 'Purchase action retains high contrast')

      const bounds = await buy.boundingBox()
      assert(bounds && bounds.y >= 0 && bounds.y + bounds.height <= height + 1, 'Buy Now is within viewport at ' + width)
      assert(await buy.isVisible(), 'CTA remains available with all ten visible by default at ' + width)
      // Verify ALL ten features can be read, not merely present in the DOM.
      const details = dialog.locator('.track-purchase-details-scroll')
      const features = dialog.locator('.store-benefits-list')
      assert.equal(await details.count(), 1, 'Feature content has its own scroll viewport at ' + width)
      const expandedList = await features.evaluate(el => {
        const css = getComputedStyle(el)
        return { overflow: css.overflowY, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }
      })
      assert.equal(expandedList.overflow, 'visible', 'Default ten-feature list never hides overflowing text at ' + width)
      assert(expandedList.scrollHeight <= expandedList.clientHeight + 2, 'All ten features fit their own list without expanding at ' + width)
      const lastFeature = features.locator('li').last()
      assert.equal(await features.locator('li').nth(8).innerText(), 'Study history and cross-device progress sync')
      assert.equal(await lastFeature.innerText(), 'Use your license across multiple devices, including the official Hyperion Android app.')
      await lastFeature.scrollIntoViewIfNeeded()
      const view = await details.boundingBox()
      const last = await lastFeature.boundingBox()
      const action = await dialog.locator('.track-purchase-actions').boundingBox()
      assert(view && last && action && last.y >= view.y - 2 && last.y + last.height <= view.y + view.height + 2,
        'The tenth feature is readable after scrolling within the modal at ' + width)
      assert(last.y + last.height <= action.y + 2, 'Sticky Buy Now never covers the tenth feature at ' + width)
      assert.equal(await dialog.locator('.store-benefits-toggle').count(), 0, 'No show-more interaction is required at ' + width)
      if (height >= 800) {
        const detailsState = await details.evaluate(el => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }))
        assert(detailsState.scrollHeight <= detailsState.clientHeight + 2,
          'All plan details and ten features should fit without scrolling at ' + width + '×' + height)
      }
      const visibleBuy = await buy.boundingBox()
      assert(visibleBuy && visibleBuy.y >= 0 && visibleBuy.y + visibleBuy.height <= height + 1,
        'Buy Now stays on screen after checking all ten features at ' + width)
      await dialog.screenshot({ path: `/tmp/hyperion-purchase-${width}.png`, animations: 'disabled' })
      if (width === 390 || width === 1280) {
        await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
        assert.equal(await buy.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(20, 125, 67)', 'Dark mode retains the same high-contrast purchase action')
        await assertSquareCorners(page)
        await dialog.screenshot({ path: `/tmp/hyperion-purchase-dark-${width}.png`, animations: 'disabled' })
        await page.evaluate(() => { document.documentElement.dataset.theme = 'light' })
      }

      await dialog.getByRole('button', { name: 'Close purchase dialog' }).click()
    }
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: 'UNLOCK FULL REVIEWER' }).click()
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
  await scenario('Question images open a centered, full-fit, scroll-free and draggable viewer on desktop and mobile', async ({ page, open }) => {
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
      assert(size.width <= Math.min(520, viewport.width * .75) + 5, 'Thumbnail is bounded at ' + viewport.width)
      assert(size.height <= Math.min(360, viewport.height * .38) + 1, 'Thumbnail height is viewport-bounded at ' + viewport.width)
      assert(size.centeredBy < 2, 'Thumbnail is centered at ' + viewport.width)
      assert.equal(await thumb.innerText(), '', 'No redundant Zoom label below a clickable diagram')
      assert.equal(await page.locator('figure figcaption').count(), 0, 'Do not display diagram metadata below thumbnail')
      await thumb.click()
      const dialog = page.getByRole('dialog', { name: 'Enlarged question diagram' })
      await dialog.waitFor()
      assert(await dialog.evaluate(el => el.parentElement === document.body), 'Lightbox uses the body-level portal')
      const view = dialog.getByLabel('Zoomable diagram viewport')
      const layout = await dialog.evaluate(el => {
        const rect = el.getBoundingClientRect()
        const stage = el.querySelector('[aria-label="Zoomable diagram viewport"]')
        const img = stage.querySelector('img')
        const styles = getComputedStyle(stage)
        return {
          cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2,
          dialogWidth: rect.width, dialogHeight: rect.height,
          stageWidth: stage.clientWidth, stageHeight: stage.clientHeight,
          overflowX: styles.overflowX, overflowY: styles.overflowY,
          touchAction: styles.touchAction, fit: getComputedStyle(img).objectFit,
          animation: getComputedStyle(el).animationName,
          scale: getComputedStyle(img).transform,
        }
      })
      assert(Math.abs(layout.cx - viewport.width / 2) < 3 && Math.abs(layout.cy - viewport.height / 2) < 3,
        'Viewer must center in the screen at ' + viewport.width)
      assert(layout.dialogWidth <= viewport.width && layout.dialogHeight <= viewport.height,
        'Viewer must fit screen at ' + viewport.width)
      assert(layout.stageWidth > viewport.width * .7 && layout.stageHeight > viewport.height * .5,
        'Image uses available viewport space at ' + viewport.width)
      assert.equal(layout.fit, 'contain', 'Whole diagram fits without cropping when opened')
      assert.equal(layout.overflowX, 'hidden', 'No horizontal image scrollbars')
      assert.equal(layout.overflowY, 'hidden', 'No vertical image scrollbars')
      assert.equal(layout.touchAction, 'none', 'Touch pan and pinch do not scroll the page')
      assert.notEqual(layout.animation, 'none', 'Image opens with smooth animation')
      assert.equal(await dialog.locator('figcaption, p').count(), 0, 'No diagram metadata repeated inside lightbox')
      const close = dialog.getByRole('button', { name: 'Close image' })
      assert(await close.evaluate(el => {
        const c = getComputedStyle(el).backgroundColor.match(/\d+/g)?.map(Number) || []
        return c[0] > 140 && c[1] < 130 && c[2] < 150
      }), 'Close image button is red')
      assert(await page.evaluate(() => getComputedStyle(document.body).overflow === 'hidden'), 'Background page cannot scroll with viewer open')
      const minus = dialog.getByRole('button', { name: 'Zoom out' })
      const plus = dialog.getByRole('button', { name: 'Zoom in' })
      const reset = dialog.getByRole('button', { name: 'Reset zoom' })
      assert(await minus.isDisabled(), 'Fit-to-screen starts at 100%')
      assert.equal(await dialog.getByLabel('Image zoom percentage').innerText(), '100%')
      for (let i = 0; i < 6; i++) await plus.click()
      assert.equal(await dialog.getByLabel('Image zoom percentage').innerText(), '250%')
      assert(await plus.isDisabled(), 'Zoom is bounded to 250%')
      const image = view.locator('img')
      const before = await image.evaluate(el => getComputedStyle(el).transform)
      const box = await view.boundingBox()
      assert(box, 'The diagram viewport exists')
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width / 2 + 55, box.y + box.height / 2 + 45, { steps: 5 })
      await page.mouse.up()
      const after = await image.evaluate(el => getComputedStyle(el).transform)
      assert.notEqual(after, before, 'Dragging an enlarged diagram pans it without scrollbars')
      assert.equal(await view.evaluate(el => getComputedStyle(el).overflow), 'hidden')
      await reset.click()
      assert.equal(await dialog.getByLabel('Image zoom percentage').innerText(), '100%')
      assert(await minus.isDisabled())
      if (viewport.width === 360) {
        await view.evaluate(el => {
          const r = el.getBoundingClientRect()
          const x = r.left + r.width / 2, y = r.top + r.height / 2
          const send = (type, id, dx) => el.dispatchEvent(new PointerEvent(type, {
            bubbles: true, pointerId: id, pointerType: 'touch', clientX: x + dx, clientY: y
          }))
          send('pointerdown', 71, -30)
          send('pointerdown', 72, 30)
          send('pointermove', 71, -65)
          send('pointermove', 72, 65)
          send('pointerup', 71, -65)
          send('pointerup', 72, 65)
        })
        await page.waitForFunction(() => Number(document.querySelector('.question-diagram-percentage')?.textContent?.replace('%', '')) > 100)
        assert(Number((await dialog.getByLabel('Image zoom percentage').innerText()).replace('%', '')) > 100,
          'Two touch pointers pinch to enlarge on a narrow screen')
        await reset.click()
      }
      await close.click()
      await dialog.waitFor({ state: 'hidden' })
      assert.equal(await page.evaluate(() => document.body.style.overflow), '', 'Background scrolling is restored')
      assert(await thumb.evaluate(el => el === document.activeElement), 'Closing image returns focus to thumbnail')
    }
  })
  await scenario('Unlicensed Free Reviewer shows unlock message and cannot read cached or network images', async ({ page, context, open, downloads }) => {
    await open('gallery')
    await page.getByAltText('Synthetic question diagram', { exact: true }).waitFor()
    const beforeNetwork = downloads()
    await page.evaluate(() => window.mediaFixture.license(false, null))
    await page.getByText('UNLOCK FULL REVIEWER TO VIEW IMAGES').waitFor()
    assert.equal(await page.getByAltText('Synthetic question diagram', { exact: true }).count(), 0)
    assert.equal(await page.getByTitle('Tap to enlarge diagram').count(), 0)
    assert.equal(downloads(), beforeNetwork, 'Losing the track license never fetches an image')
    await context.setOffline(true)
    assert.equal(await page.evaluate(() => window.mediaFixture.loadMulti(window.mediaFixture.sha, true).then(() => 'allowed', () => 'denied')), 'denied')
    assert.equal(await page.evaluate(() => window.mediaFixture.load().then(() => 'allowed', () => 'denied')), 'denied')
    assert.equal(downloads(), beforeNetwork, 'Cached and offline premium image bytes remain inaccessible')
    await page.evaluate(() => window.mediaFixture.license(true))
    await page.getByAltText('Synthetic question diagram', { exact: true }).waitFor()
    assert.equal(downloads(), beforeNetwork, 'License restoration reads cached media offline')
  })
  await scenario('Locked image notice opens the existing matching Bond Store popup for each track', async ({ page, open, downloads }) => {
    await open('gallery')
    await page.evaluate(() => window.mediaFixture.license(false, null))
    await page.getByRole('button', { name: 'UNLOCK FULL REVIEWER TO VIEW IMAGES' }).waitFor()
    const beforeClicks = downloads()
    const products = [
      ['DECK_OIC_NW', 'oic_nw', 'Deck OIC-NW'],
      ['GMDSS_GOC', 'gmdss', 'GMDSS GOC'],
      ['ENGINE_OIC_EW', 'engine_ew', 'Engine OIC-EW'],
      ['DECK_MGT', 'deck_mgt', 'Deck Management'],
      ['ENGINE_MGT', 'engine_mgt', 'Engine Management'],
    ]
    for (const [track, code, name] of products) {
      await page.evaluate(value => window.mediaFixture.changeTrack(value), track)
      const upgrade = page.getByRole('button', { name: 'UNLOCK FULL REVIEWER TO VIEW IMAGES' })
      await upgrade.waitFor()
      assert.equal(await upgrade.getAttribute('aria-haspopup'), 'dialog', 'Locked diagram is an accessible purchase control')
      await upgrade.click()
      const popup = page.getByRole('dialog', { name })
      await popup.waitFor()
      assert.equal(new URL(page.url()).searchParams.get('purchase_product'), code, 'Popup selects the diagram’s track, not the current route')
      await popup.getByRole('button', { name: 'Close purchase dialog' }).click()
      await popup.waitFor({ state: 'hidden' })
    }
    assert.equal(downloads(), beforeClicks, 'Clicking the paywall never fetches protected image bytes')
  })
  await scenario('All 105 separately referenced diagrams remain accessible offline without new image requests', async ({ page, context, open, downloads }) => {
    await open('gallery')
    const result = await page.evaluate(() => window.mediaFixture.prepareMany(105))
    assert.equal(result.ready, true, 'All 105 diagrams are verified and persisted before offline readiness')
    assert.equal(typeof result.last, 'string')
    const before = downloads()
    await context.setOffline(true)
    assert((await page.evaluate(hash => window.mediaFixture.loadMulti(hash), result.last)) > 0)
    assert.equal(downloads(), before, 'Previously unseen image 105 is read locally without network requests')
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
      const previousUrl = await page.locator('button[title="Tap to enlarge diagram"] img').getAttribute('src')
      await page.evaluate(kind => kind === 'owner' ? window.mediaFixture.license(true, '22222222-2222-4222-8222-222222222222') : kind === 'license' ? window.mediaFixture.license(false) : window.mediaFixture.changeRef(), mutation)
      await page.waitForFunction(previous => !document.querySelector('[role=dialog],dialog[open]') && document.querySelector('img')?.getAttribute('src') !== previous, previousUrl, { timeout: 1000 })
      assert.equal(await page.getByRole('dialog').count(), 0, `${mutation} removes zoom`)
      if (await page.locator('img').count()) assert.notEqual(await page.locator('img').getAttribute('src'), previousUrl, `${mutation} removes stale thumbnail`)
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
