import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || chromium.executablePath(), args: ['--no-sandbox'] })
try {
  const page = await browser.newPage({ viewport: { width: 1531, height: 900 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route => ['localhost', '127.0.0.1', '[::1]'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
  const basket = [{ code: 'gmdss', term: 'month' }]
  await page.addInitScript(() => localStorage.setItem('hyperion-account-basket-v1', JSON.stringify([{ code: 'oic_nw', term: 'year' }])))
  await page.goto(process.env.HYPERION_RECOVERY_TEST_URL)
  const sidebar = page.locator('.account-sidebar')
  await page.getByRole('heading', { name: 'Checkout', exact: true }).waitFor()
  await sidebar.getByRole('heading', { name: 'Synthetic Member', exact: true }).waitFor()
  assert.equal((await sidebar.innerText()).includes('PayMongo'), false, 'Profile copy uses provider-neutral checkout wording')
  assert((await sidebar.boundingBox()).height < 540, 'Desktop profile is compact')
  assert.equal(await sidebar.getByLabel('Full name', { exact: true }).inputValue(), 'Synthetic Member')
  assert.equal(await sidebar.getByLabel('Full name', { exact: true }).getAttribute('readonly'), '')
  await sidebar.getByRole('button', { name: 'EDIT PROFILE', exact: true }).click()
  await sidebar.getByLabel('Full name', { exact: true }).fill('Updated Member')
  await sidebar.getByRole('button', { name: 'SAVE CHANGES', exact: true }).click()
  await sidebar.getByRole('heading', { name: 'Updated Member', exact: true }).waitFor()
  await sidebar.getByRole('button', { name: 'EDIT PROFILE', exact: true }).click()
  await sidebar.getByLabel('Full name', { exact: true }).fill('Unsaved Name')
  await sidebar.getByRole('button', { name: 'CANCEL', exact: true }).click()
  assert.equal(await sidebar.getByLabel('Full name', { exact: true }).inputValue(), 'Updated Member')
  for (const width of [1531, 870, 390]) {
    await page.setViewportSize({ width, height: 900 })
    const profileBox = await sidebar.boundingBox()
    const contentBox = await page.locator('.account-main').boundingBox()
    assert(contentBox)
    if (width > 800) {
      assert(profileBox && profileBox.x + profileBox.width <= contentBox.x, `Desktop checkout profile stays alongside the content at ${width}px`)
    } else {
      assert.equal(profileBox, null, 'Mobile checkout omits the redundant account profile')
    }
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No overflow at ${width}px`)
    const tabs = page.getByRole('navigation', { name: 'Account and subscriptions' }).getByRole('button')
    assert.equal(await tabs.count(), width > 800 ? 3 : 0, 'Account navigation is condensed away on mobile checkout only')
    if (width > 800) {
      const tabWidths = await tabs.evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().width))
      assert(Math.max(...tabWidths) - Math.min(...tabWidths) < 1, `Equal tab widths at ${width}px`)
    }
    assert.equal(await page.getByRole('button', { name: 'Shopping cart', exact: true }).count(), 0, 'Checkout has no floating cart')
    if (width === 390) {
      const action = page.locator('.basket-checkout-action.is-payable')
      assert.equal(await action.evaluate(el => getComputedStyle(el).position), 'fixed', 'Mobile checkout total and payment action dock above the bottom navigation')
      assert.equal(await page.getByRole('button', { name: 'Checkout', exact: true }).count(), 1, 'Mobile shows exactly one checkout button')
      const checkoutRect = await action.boundingBox()
      assert(checkoutRect && checkoutRect.y >= 0 && checkoutRect.y + checkoutRect.height <= 900 - 48, `Docked payment controls remain within the visible area above bottom navigation: ${JSON.stringify(checkoutRect)}`)
      assert((await page.locator('.basket-selected-card').boundingBox()).y < 220, 'Selected tracks appear near the top without redundant profile and tabs')
    }
    await page.screenshot({ path: `account-checkout-${width}.png`, fullPage: true })
  }
  await page.setViewportSize({ width: 1531, height: 900 })
  await page.getByRole('button', { name: 'Orders & payment history', exact: true }).click()
  await page.getByRole('heading', { name: 'Orders & payment history', exact: true }).waitFor()
  await sidebar.getByRole('heading', { name: 'Updated Member', exact: true }).waitFor()
  await page.setViewportSize({ width: 870, height: 900 })
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Orders fits beside the profile')
  await page.screenshot({ path: 'account-orders-870.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 900 })
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Orders fits on mobile')
  await page.screenshot({ path: 'account-orders-390.png', fullPage: true })
  for (const width of [1531, 870, 390]) {
    await page.setViewportSize({ width, height: 900 })
    const cart = page.getByRole('button', { name: 'Shopping cart', exact: true })
    assert.equal(await cart.evaluate(button => getComputedStyle(button).position), 'fixed')
    const cartBox = await cart.boundingBox()
    assert(cartBox.x + cartBox.width <= width && cartBox.x > width - 100, 'Cart stays near the right viewport edge')
    assert(cartBox.y + cartBox.height <= 900 - (width < 900 ? 80 : 16), 'Cart clears mobile navigation and viewport edges')
    await page.evaluate(() => window.scrollTo(0, 200))
    assert(Math.abs((await cart.boundingBox()).y - cartBox.y) < 1, 'Cart stays fixed while account content scrolls')
    await page.evaluate(() => window.scrollTo(0, 0))
    assert.equal(await cart.evaluate(button => getComputedStyle(button).backgroundColor), 'rgb(255, 255, 255)', 'Cart circle is white')
    await cart.hover()
    assert.equal(await cart.evaluate(button => getComputedStyle(button).transform), 'none', 'Circle stays still on hover')
    const icon = cart.locator('span')
    const animation = await icon.evaluate(element => getComputedStyle(element).animationName)
    assert.notEqual(animation, 'none', 'Cart icon has an attention animation')
    const timing = await icon.evaluate(element => {
      const style = getComputedStyle(element)
      return { duration: parseFloat(style.animationDuration), delay: parseFloat(style.animationDelay), iterations: style.animationIterationCount }
    })
    assert.equal(timing.iterations, 'infinite', 'Cart icon repeats its attention animation')
    const frames = await icon.evaluate(element => {
      const animation = element.getAnimations()[0]
      animation.pause()
      const { duration, delay } = animation.effect.getTiming()
      const transforms = []
      for (const progress of [0.03, 0.5, 1.03, 1.5]) {
        animation.currentTime = delay + Number(duration) * progress
        transforms.push(getComputedStyle(element).transform)
      }
      return transforms
    })
    assert.notEqual(frames[0], frames[1], 'The cart wiggles, then pauses')
    assert.equal(frames[0], frames[2], 'The next cycle repeats the wiggle')
    assert.equal(frames[1], frames[3], 'Each cycle includes a stationary pause')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    assert.equal(await icon.evaluate(element => getComputedStyle(element).animationName), 'none', 'Reduced motion disables the icon shake')
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.mouse.move(0, 0)
  }
  await page.getByRole('button', { name: 'Shopping cart', exact: true }).click()
  await page.getByRole('heading', { name: 'Checkout', exact: true }).waitFor()
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('hyperion-account-basket-v1'))), basket, 'Navigation preserves the saved cart')
  const calls = await page.evaluate(() => window.accountFixtureCalls)
  assert.equal(calls.filter(call => call.action === 'table:google_play_entitlements').length, 0, 'Profile layout must not load store entitlements')
  assert.equal(calls.filter(call => call.action === 'verify-checkout:').length, 0, 'Profile layout must not duplicate payment verification')
  assert.deepEqual(calls.find(call => call.action === 'update-profile').data, { full_name: 'Updated Member', company: 'Fixture Company', school: 'Fixture School' })
  // Checkout intentionally hides account tabs on phones; restore desktop
  // before using the desktop tab navigation to return to the store.
  await page.setViewportSize({ width: 1531, height: 900 })
  await page.getByRole('button', { name: 'Bond Store', exact: true }).click()
  await page.getByRole('heading', { name: 'Available reviewer tracks', exact: true }).waitFor()
  for (const [width, height, expectedColumns] of [[1650, 900, 5], [1531, 900, 5], [1366, 768, 5], [1280, 768, 5], [1024, 900, 3], [870, 900, 2], [390, 900, 1]]) {
    await page.setViewportSize({ width, height })
    await page.evaluate(() => window.scrollTo(0, 0))
    const boxes = await page.locator('.account-product-card').evaluateAll(cards => cards.map(card => {
      const rect = card.getBoundingClientRect()
      const button = card.querySelector('button.btn-primary')?.getBoundingClientRect()
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, bottom: rect.bottom, buyButtonBottom: button?.bottom }
    }))
    assert.equal(boxes.length, 5, 'All five track cards render')
    assert.equal(boxes.filter(box => Math.abs(box.y - boxes[0].y) < 2).length, expectedColumns, `Responsive store has ${expectedColumns} columns at ${width}px`)
    assert(boxes.every(box => box.width >= 140 && box.x >= 0 && box.x + box.width <= width + 1), `Store cards have usable widths and no horizontal overflow at ${width}px`)
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Bond Store has no horizontal scroll at ${width}px`)
    if (width >= 1280) {
      assert(boxes.every(box => box.bottom < height - 12), `All five default desktop track cards fit above the fold at ${width}x${height}`)
      assert(boxes.every(box => box.buyButtonBottom && box.buyButtonBottom < height - 12), 'All desktop buy buttons remain visible without scrolling')
    }
    if (width === 1366 || width === 390) await page.screenshot({ path: `account-store-${width}.png`, fullPage: true })
  }
  await page.setViewportSize({ width: 1531, height: 900 })
  await page.evaluate(() => window.scrollTo(0, 0))
  const tabsAndProfile = await page.evaluate(() => ({
    profileY: document.querySelector('.account-sidebar').getBoundingClientRect().top,
    tabsY: document.querySelector('.account-section-tabs').getBoundingClientRect().top,
    rowY: document.querySelector('.account-layout').getBoundingClientRect().top,
    shellWidth: document.querySelector('.account-page').getBoundingClientRect().width
  }))
  // In this standalone test fixture there is no top navigation, so the profile's sticky top:80px can lift it above the row.
  assert(Math.abs(tabsAndProfile.tabsY - tabsAndProfile.rowY) < 2, 'Store tabs begin at the top of the account row')
  assert(Math.abs(tabsAndProfile.profileY - Math.max(tabsAndProfile.rowY, 80)) < 2, 'Profile card aligns with the row or its sticky safe offset')
  assert(tabsAndProfile.shellWidth > 1450, 'Desktop account shell has enough width for readable track cards')
  const cards = page.locator('.account-product-card')
  assert.equal(await cards.count(), 5)
  assert.equal(await cards.first().locator('.store-benefits-list li').count(), 9, 'Each card retains all nine premium features')
  assert.equal(await cards.last().locator('.store-benefits-list li').count(), 9)
  assert.equal(await cards.first().locator('.product-art .store-banner-symbol').count(), 3, 'Operational cards use original anchor, track, and level symbols')
  assert.equal(await cards.nth(1).locator('.product-art .store-banner-symbol').count(), 2, 'GMDSS card uses original anchor and radio symbol')
  const asset = await page.request.get(new URL('/store-art/hyperion-banner-sprite.png', page.url()).href)
  assert.equal(asset.status(), 200, 'Supplied Hyperion banner artwork is served as a local asset')
  assert((await asset.body()).length > 1000, 'Cropped transparent symbol sprite is present')
  const oicCard = cards.first()
  const readCard = async card => card.evaluate(el => {
    const r = el.getBoundingClientRect()
    const list = el.querySelector('.store-benefits-list').getBoundingClientRect()
    const cta = el.querySelector('button.btn-primary').getBoundingClientRect()
    return { top: r.top, bottom: r.bottom, width: r.width, listHeight: list.height, ctaBottom: cta.bottom, scroll: document.documentElement.scrollHeight, matrix: getComputedStyle(el).transform }
  })
  const reveal = oicCard.getByRole('button', { name: 'See all 9 premium features' })
  const collapse = oicCard.getByRole('button', { name: 'Show fewer features ↑' })
  await page.mouse.move(0, 0)
  const baseCard = await readCard(oicCard)
  await oicCard.hover()
  await page.waitForTimeout(400)
  const hover = await readCard(oicCard)
  assert(hover.matrix !== 'none' && Number(hover.matrix.match(/^matrix\(([^,]+)/)?.[1]) > 1.02, 'Desktop hover lifts and enlarges the card')
  assert(hover.width > baseCard.width + 28, 'Hovered card gains width for legibility')
  assert(hover.listHeight <= baseCard.listHeight + 5, 'Hover does not reveal features by itself; See all has a meaningful action')
  assert.equal(await reveal.getAttribute('aria-expanded'), 'false', 'A hovered card still advertises its collapsed features')
  assert.equal(await page.locator('.store-benefits-popover').count(), 0, 'No dark popup covers account navigation')
  // Switch between neighboring raised cards repeatedly. The old card must
  // animate back from the same anchored layer instead of snapping to flow.
  const gmdssCard = cards.nth(1)
  const cardCenter = card => card.evaluate(el => {
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width * .65, y: r.top + Math.min(48, r.height * .2) }
  })
  for (let switchIndex = 0; switchIndex < 3; switchIndex++) {
    // Use direct pointer travel; locator.hover() waits for CSS stability and
    // can consume the entire 320 ms exit transition before we inspect it.
    const gmdssPoint = await cardCenter(gmdssCard)
    await page.mouse.move(gmdssPoint.x, gmdssPoint.y, { steps: 3 })
    await page.waitForTimeout(45)
    assert.equal(await page.locator('.account-product-slot.is-hovered').count(), 1, 'Only the destination card is hovered')
    assert.equal(await gmdssCard.locator('..').evaluate(el => el.classList.contains('is-hovered')), true, 'GMDSS activates during handoff')
    assert.equal(await oicCard.locator('..').evaluate(el => getComputedStyle(el.querySelector('.account-product-card')).position), 'absolute', 'Exiting OIC card stays in an anchored layer during the exit animation')
    await page.waitForTimeout(360)
    assert.equal(await oicCard.locator('..').evaluate(el => el.style.height), '', 'Old card releases its frozen grid height after settling')
    assert.equal(await page.locator('.account-product-slot[data-store-lift="settling"]').count(), 0, 'No exiting card remains stuck after handoff')
    const oicPoint = await cardCenter(oicCard)
    await page.mouse.move(oicPoint.x, oicPoint.y, { steps: 3 })
    await page.waitForTimeout(360)
    assert.equal(await page.locator('.account-product-slot.is-hovered').count(), 1, 'Returning hover activates exactly one card')
    assert.equal(await gmdssCard.locator('..').evaluate(el => el.style.height), '', 'Neighbor returns to normal grid flow after switching back')
    const switched = await readCard(oicCard)
    assert(switched.ctaBottom < 900 - 8 && switched.scroll <= baseCard.scroll + 1, 'Repeated card switches keep Buy Now visible without new scrolling')
  }
  await reveal.click()
  await page.waitForTimeout(400)
  const opened = await readCard(oicCard)
  assert.equal(await collapse.getAttribute('aria-expanded'), 'true', 'Clicking See all explicitly expands nine features')
  assert(opened.listHeight > hover.listHeight + 60, 'Click reveals all nine features inside the white card')
  assert(opened.top < hover.top - 45, 'Clicked card grows upward from the original bottom edge')
  assert(opened.ctaBottom < 900 - 8 && opened.ctaBottom <= baseCard.ctaBottom + 8, 'Buy Now remains visible and never shifts down when features open')
  assert(opened.scroll <= baseCard.scroll + 1, 'Opening features adds no vertical page scrolling')
  await page.mouse.move(0, 0)
  await page.waitForTimeout(110)
  assert.equal(await collapse.getAttribute('aria-expanded'), 'true', 'Explicitly opened features stay open after the mouse leaves')
  assert((await readCard(oicCard)).listHeight > hover.listHeight + 60, 'The expanded card remains raised after mouseleave')
  await collapse.click()
  await page.mouse.move(0, 0)
  await page.waitForTimeout(350)
  assert.equal(await reveal.getAttribute('aria-expanded'), 'false', 'Show fewer reverses the expansion')
  assert((await readCard(oicCard)).listHeight <= baseCard.listHeight + 5, 'Show fewer restores the compact card')
  // Repeat to catch the intermittent click/hover state bug reported by the user.
  for (let repeat = 0; repeat < 3; repeat++) {
    await reveal.click()
    await page.mouse.move(0, 0)
    await page.waitForTimeout(350)
    assert.equal(await collapse.getAttribute('aria-expanded'), 'true', 'Repeated See all clicks keep the card open')
    await collapse.click()
    await page.mouse.move(0, 0)
    await page.waitForTimeout(350)
    assert.equal(await reveal.getAttribute('aria-expanded'), 'false', 'Repeated Show fewer clicks restore the card')
  }
  for (const [width, height] of [[1366, 768], [1280, 768], [1531, 900]]) {
    await page.setViewportSize({ width, height })
    await page.mouse.move(0, 0)
    await page.waitForTimeout(80)
    await page.evaluate(() => window.scrollTo(0, 0))
    const compact = await readCard(oicCard)
    await oicCard.hover()
    await page.waitForTimeout(360)
    const hoverOnly = await readCard(oicCard)
    assert(hoverOnly.listHeight <= compact.listHeight + 5, `Hover keeps the benefits preview compact at ${width}×${height}`)
    await reveal.click()
    await page.waitForTimeout(400)
    const expanded = await readCard(oicCard)
    assert(expanded.listHeight > compact.listHeight + 50, `Click reveals full benefits at ${width}×${height}`)
    assert(expanded.ctaBottom < height - 8, `Buy Now stays on screen at ${width}×${height}`)
    assert(expanded.ctaBottom <= compact.ctaBottom + 8, `Buy Now does not move down at ${width}×${height}`)
    assert(expanded.scroll <= compact.scroll + 1, `Click expansion adds no scrolling at ${width}×${height}`)
    await page.mouse.move(0, 0)
    await page.waitForTimeout(120)
    assert((await readCard(oicCard)).listHeight > compact.listHeight + 50, `Expanded state persists after hover ends at ${width}×${height}`)
    await collapse.click()
    await page.mouse.move(0, 0)
    await page.waitForTimeout(350)
    assert.equal(await reveal.getAttribute('aria-expanded'), 'false', `Toggle closes cleanly at ${width}×${height}`)
    assert((await readCard(oicCard)).listHeight <= compact.listHeight + 5, `Compact state restored after close at ${width}×${height}`)
  }
  // Mobile uses normal document flow, but the tap must open and close reliably.
  await page.setViewportSize({ width: 390, height: 900 })
  await page.mouse.move(0, 0)
  await page.evaluate(() => window.scrollTo(0, 0))
  await reveal.click()
  await page.waitForTimeout(350)
  assert.equal(await collapse.getAttribute('aria-expanded'), 'true', 'Mobile tap expands the feature list')
  assert.equal(await oicCard.locator('.store-benefits-list li').count(), 9, 'All nine features remain present on mobile')
  await collapse.click()
  await page.waitForTimeout(350)
  assert.equal(await reveal.getAttribute('aria-expanded'), 'false', 'Mobile tap collapses the feature list')
  await page.setViewportSize({ width: 1531, height: 900 })
  await page.mouse.move(0, 0)
  await oicCard.getByRole('button', { name: 'Deck OIC-NW Weekly ₱20' }).click()
  assert.equal(await oicCard.getByRole('button', { name: 'Deck OIC-NW Weekly ₱20' }).getAttribute('aria-pressed'), 'true', 'Weekly selection remains functional')
  assert((await oicCard.locator('.product-price').innerText()).includes('₱20'), 'Changing duration updates the track price')
  await page.getByRole('button', { name: 'Shopping cart', exact: true }).waitFor()
  await page.getByRole('button', { name: 'My licenses', exact: true }).click()
  await page.getByRole('heading', { name: 'Active licenses', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Shopping cart', exact: true }).click()
  await page.getByRole('heading', { name: 'Checkout', exact: true }).waitFor()
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('hyperion-account-basket-v1'))), basket, 'Floating cart navigation preserves saved selections across all account tabs')
  // Navigate away from Checkout while its account tabs are visible on desktop,
  // then exercise the normal account tabs on successively smaller screens.
  for (const width of [1531, 870, 390]) {
    await page.setViewportSize({ width, height: 900 })
    for (const tab of ['Bond Store', 'My licenses', 'Orders & payment history']) {
      await page.getByRole('button', { name: tab, exact: true }).click()
      await sidebar.getByRole('heading', { name: 'Updated Member', exact: true }).waitFor()
      const topGap = await page.locator('.account-page').evaluate(element =>
        element.querySelector('.account-layout').getBoundingClientRect().top - element.getBoundingClientRect().top)
      assert(topGap >= 0 && topGap <= 16, `${tab} has only a compact top inset at ${width}px, got ${topGap}px`)
    }
  }
  await page.setViewportSize({ width: 870, height: 900 })
  await page.evaluate(() => localStorage.setItem('fixture-hold-payment', 'yes'))
  await page.goto(`${process.env.HYPERION_RECOVERY_TEST_URL}?section=payment`)
  await page.getByRole('dialog', { name: 'Verifying your payment…' }).waitFor()
  assert.equal(await page.locator('.account-cart-fab').count(), 0, 'Checkout has no floating cart during payment verification')
  assert.equal(await page.getByRole('button', { name: 'Shopping cart', exact: true }).count(), 0, 'Modal removes cart from keyboard and accessibility navigation')
  assert.equal(await page.evaluate(() => window.accountFixtureCalls.filter(call => call.action === 'verify-checkout:').length), 1, 'Checkout owns exactly one held payment verification')
  await page.evaluate(() => localStorage.removeItem('fixture-hold-payment'))
  await page.goto(process.env.HYPERION_RECOVERY_TEST_URL)
  await page.getByRole('heading', { name: 'Checkout', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Shopping cart', exact: true }).count(), 0)
  await page.goto(`${process.env.HYPERION_RECOVERY_TEST_URL}?section=basket`)
  await page.getByRole('heading', { name: 'Checkout', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Shopping cart', exact: true }).count(), 0, 'Basket alias also hides the floating cart')
  await page.setViewportSize({ width: 390, height: 900 })
  const checkout = page.getByRole('button', { name: 'Checkout', exact: true })
  await page.waitForFunction(() => { const button = document.querySelector('.checkout-pay-button'); return button && !button.disabled })
  await page.getByRole('button', { name: 'Remove', exact: true }).click()
  await page.getByText('Your checkout is empty', { exact: true }).waitFor()
  assert.equal(await checkout.isDisabled(), true, 'Empty checkout cannot be activated')
  const callsBefore = await page.evaluate(() => window.accountFixtureCalls.length)
  await checkout.evaluate(button => button.click())
  assert.equal(await page.evaluate(() => window.accountFixtureCalls.length), callsBefore, 'Empty checkout starts no payment request')
  assert(Number(await checkout.evaluate(button => getComputedStyle(button).opacity)) < 1, 'Empty checkout looks disabled')
  assert.equal(await checkout.evaluate(button => getComputedStyle(button).cursor), 'not-allowed', 'Empty checkout does not show an active pointer')
  await page.screenshot({ path: 'account-empty-checkout-390.png', fullPage: true })
  await page.goto(process.env.HYPERION_RECOVERY_TEST_URL)
  await page.waitForFunction(() => { const button = document.querySelector('.checkout-pay-button'); return button && !button.disabled })
  assert.equal(await checkout.isEnabled(), true, 'Selecting a track enables checkout again')
  await page.waitForFunction(() => !document.querySelector('.hyperion-top-loader.is-visible'))
  await page.evaluate(() => {
    window.finishFirstLoading = window.beginFixtureLoading('Loading preview')
    window.finishSecondLoading = window.beginFixtureLoading('Loading more content')
  })
  await page.getByRole('status', { name: 'Loading more content', exact: true }).waitFor()
  const loader = page.locator('.hyperion-top-loader.is-visible')
  const cube = loader.locator('.hyperion-top-loader__cube')
  await cube.waitFor()
  assert.equal(await cube.evaluate(element => getComputedStyle(element).transformStyle), 'preserve-3d', 'Logo has real 3D faces')
  const poses = await cube.evaluate(element => {
    const animation = element.getAnimations()[0]
    animation.pause()
    const duration = Number(animation.effect.getTiming().duration)
    return [0, .25, .5].map(progress => {
      animation.currentTime = duration * progress
      return getComputedStyle(element).transform
    })
  })
  assert.equal(new Set(poses).size, 3, 'Logo turns through distinct 3D poses')
  assert.equal(await loader.evaluate(element => getComputedStyle(element).pointerEvents), 'none', 'Loader leaves the page interactive')
  await page.waitForFunction(() => [...document.querySelectorAll('.hyperion-top-loader img')].every(image => image.complete && image.naturalWidth > 0))
  assert.equal(await loader.locator('img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0 && new URL(image.src).pathname === '/logo.png')), true, 'All logo faces load the existing local asset')
  await page.screenshot({ path: 'account-3d-loader-390.png', fullPage: true })
  await page.evaluate(() => window.finishSecondLoading())
  await page.getByRole('status', { name: 'Loading preview', exact: true }).waitFor()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  assert.equal(await cube.evaluate(element => getComputedStyle(element).animationName), 'none', 'Reduced motion stops cube rotation')
  assert.equal(await loader.locator('.hyperion-top-loader__shadow').evaluate(element => getComputedStyle(element).animationName), 'none', 'Reduced motion stops the shadow')
  await page.evaluate(() => window.finishFirstLoading())
  await page.waitForFunction(() => !document.querySelector('.hyperion-top-loader'))
  const activeOnly = page.getByRole('button', { name: /Active licenses only/ })
  const toolbarGeometry = () => page.evaluate(() => {
    const origin = document.querySelector('.admin-users-toolbar').getBoundingClientRect()
    const controls = [...document.querySelectorAll('.admin-license-filters select, .admin-license-filters > button')].map(control => {
      const box = control.getBoundingClientRect()
      return { x: box.x - origin.x, y: box.y - origin.y, width: box.width, height: box.height }
    })
    return { controls, listTop: document.querySelector('.admin-user-grid').getBoundingClientRect().y - origin.y }
  })
  for (const width of [1536, 1140, 1024, 900, 760, 390]) {
    await page.setViewportSize({ width, height: 900 })
    // Load each viewport independently so this checks filtering, not a resize transition.
    await page.goto(`${process.env.HYPERION_RECOVERY_TEST_URL}?section=admin`)
    await page.getByRole('heading', { name: 'Registered users (2)', exact: true }).waitFor()
    const before = await toolbarGeometry()
    assert.equal(before.controls.length, 4, 'All four admin filter controls are measured')
    await activeOnly.click()
    assert.equal(await activeOnly.getAttribute('aria-pressed'), 'true')
    assert.equal(await page.locator('.admin-user-card').count(), 1, 'Filter shows only the licensed synthetic user')
    const after = await toolbarGeometry()
    for (let i = 0; i < before.controls.length; i++) {
      for (const axis of ['x', 'y', 'width', 'height']) {
        assert(Math.abs(after.controls[i][axis] - before.controls[i][axis]) < .5, `Filter control ${i} keeps its ${axis} at ${width}px: ${JSON.stringify({ before, after })}`)
      }
    }
    assert(Math.abs(after.listTop - before.listTop) < .5, `Filter keeps list aligned at ${width}px`)
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Admin filters fit at ${width}px`)
    if ([1536,390].includes(width)) await page.screenshot({ path: `account-admin-active-${width}.png`, fullPage: true })
    await activeOnly.click()
    assert.equal(await page.locator('.admin-user-card').count(), 2, 'Clearing the filter restores both synthetic users')
  }
  // Exercise real screen integration using synthetic pending checkouts and a browser clock.
  const pollingPage = await browser.newPage()
  await pollingPage.route('**/*', route => ['localhost', '127.0.0.1', '[::1]'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
  await pollingPage.addInitScript(() => localStorage.setItem('fixture-pending-orders', 'yes'))
  await pollingPage.clock.install()
  const verificationIds = () => pollingPage.evaluate(() => window.accountFixtureCalls.filter(call => call.action === 'verify-checkout:').map(call => call.data.orderId))
  for (const section of ['orders', 'basket', 'account']) {
    await pollingPage.goto(`${process.env.HYPERION_RECOVERY_TEST_URL}?section=${section}`)
    await pollingPage.waitForFunction(() => window.accountFixtureCalls.some(call => call.action === 'verify-checkout:'))
    assert.deepEqual(await verificationIds(), ['recent-checkout'], `${section}: old orders are excluded from automatic checks`)
    await pollingPage.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await pollingPage.clock.runFor(60_000)
    assert.equal((await verificationIds()).length, 1, `${section}: hidden page sends no payment checks`)
    await pollingPage.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('focus'))
    })
    await pollingPage.waitForFunction(() => window.accountFixtureCalls.filter(call => call.action === 'verify-checkout:').length === 2)
  }
  await pollingPage.goto(`${process.env.HYPERION_RECOVERY_TEST_URL}?section=orders`)
  await pollingPage.waitForFunction(() => window.accountFixtureCalls.some(call => call.action === 'verify-checkout:'))
  await pollingPage.getByRole('button', { name: 'Refresh status', exact: true }).click()
  await pollingPage.waitForFunction(() => window.accountFixtureCalls.some(call => call.action === 'verify-checkout:' && call.data.orderId === 'old-checkout'))
  assert((await verificationIds()).includes('old-checkout'), 'Manual refresh still verifies older pending orders')
  await pollingPage.evaluate(() => localStorage.setItem('fixture-multiple-pending', 'yes'))
  await pollingPage.goto(`${process.env.HYPERION_RECOVERY_TEST_URL}?section=orders`)
  await pollingPage.waitForFunction(() => window.accountFixtureCalls.filter(call => call.action === 'verify-checkout:').length === 2)
  await pollingPage.clock.runFor(540_000)
  await pollingPage.evaluate(() => localStorage.setItem('fixture-payment-paid', 'yes'))
  await pollingPage.clock.runFor(60_000)

  await pollingPage.getByText('Payment confirmed automatically. Activated: Deck OIC-NW.', { exact: true }).waitFor()
  assert.equal(await pollingPage.evaluate(() => localStorage.getItem('fixture-recent-confirmed')), 'yes', 'Server confirmation still refreshes the displayed order')
  const afterConfirmation = (await verificationIds()).length
  await pollingPage.clock.runFor(120_000)
  assert.equal((await verificationIds()).length, afterConfirmation, 'Clearing one batch near the deadline does not renew polling for the remaining batch')
  await pollingPage.close()
  const historyPage = await browser.newPage()
  await historyPage.route('**/*', route => ['localhost', '127.0.0.1', '[::1]'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
  await historyPage.addInitScript(() => {
    localStorage.setItem('fixture-large-history', 'yes')
    localStorage.setItem('fixture-history-epoch', String(Date.now()))
  })
  await historyPage.clock.install()
  await historyPage.goto(`${process.env.HYPERION_RECOVERY_TEST_URL}?section=orders`)
  await historyPage.waitForFunction(() => document.querySelectorAll('.orders-entry').length === 25)
  await historyPage.waitForFunction(() => window.accountFixtureCalls.some(call => call.action === 'verify-checkout:' && call.data.orderId === '00000000-0000-4000-8000-000000000959'))
  const pageQuery = await historyPage.evaluate(() => window.accountFixtureCalls.find(call => call.action === 'select:orders' && !call.data.filters.some(filter => filter.key === 'status')).data)
  assert.equal(pageQuery.limit, 26, 'Initial history requests one small page plus lookahead')
  const pendingQuery = await historyPage.evaluate(() => window.accountFixtureCalls.find(call => call.action === 'select:orders' && call.data.filters.some(filter => filter.key === 'status')).data)
  assert.equal(pendingQuery.columns, 'id,checkout_batch_id,status,payment_method,created_at', 'Off-page payment checks transfer only their required fields')
  await historyPage.evaluate(() => localStorage.setItem('fixture-fail-older-orders', 'yes'))
  await historyPage.getByRole('button', { name: 'Load older orders', exact: true }).click()
  await historyPage.getByText('Unable to load your orders and payment history. Please try again.', { exact: true }).waitFor()
  assert.equal(await historyPage.locator('.orders-entry').count(), 25, 'Page failure keeps existing history visible')
  await historyPage.evaluate(() => localStorage.removeItem('fixture-fail-older-orders'))
  await historyPage.getByRole('button', { name: 'Load older orders', exact: true }).click()
  await historyPage.waitForFunction(() => document.querySelectorAll('.orders-entry').length === 50)
  await historyPage.getByRole('button', { name: 'Load older orders', exact: true }).click()
  await historyPage.waitForFunction(() => document.querySelectorAll('.orders-entry').length === 65)
  assert.equal(await historyPage.getByRole('button', { name: 'Load older orders', exact: true }).count(), 0, 'End of history has no extra-page control')
  const references = await historyPage.locator('.orders-entry').evaluateAll(entries => entries.map(entry => entry.textContent.match(/history-reference-\d+/)[0]))
  assert.equal(new Set(references).size, 65, 'Every historical order remains accessible exactly once')
  await historyPage.evaluate(() => localStorage.setItem('fixture-history-paid', 'yes'))
  await historyPage.clock.runFor(60_000)
  await historyPage.getByText('Payment confirmed automatically. Activated: Deck OIC-NW.', { exact: true }).waitFor()
  await historyPage.waitForFunction(() => window.accountFixtureCalls.some(call => call.action === 'question-bank:offline-license'))
  assert.equal(await historyPage.locator('.orders-entry').count(), 65, 'Automatic paid refresh retains history already loaded by the user')
  await historyPage.getByRole('button', { name: 'Refresh status', exact: true }).click()
  await historyPage.waitForFunction(() => document.querySelectorAll('.orders-entry').length === 25)
  await historyPage.getByRole('button', { name: 'Refresh status', exact: true }).waitFor()
  await historyPage.evaluate(() => localStorage.setItem('fixture-hold-entitlements', 'yes'))
  await historyPage.getByRole('button', { name: 'Refresh status', exact: true }).click()
  await historyPage.waitForFunction(() => window.accountFixtureCalls.some(call => call.action === 'fixture-entitlements-held'))
  await historyPage.evaluate(() => window.switchFixtureAccount())
  await historyPage.getByText('No orders yet', { exact: true }).waitFor()
  await historyPage.evaluate(() => window.releaseFixtureEntitlements())
  await historyPage.waitForTimeout(100)
  assert.equal(await historyPage.getByText('PayMongo has not confirmed all pending checkouts as paid yet. No additional license was granted.', { exact: true }).count(), 0, 'Previous account payment results cannot appear after an account switch')
  assert.equal(await historyPage.locator('.orders-entry').count(), 0, 'Previous account history stays hidden after a delayed refresh completes')
  assert.equal(await historyPage.locator('.orders-history-page > [role="status"]').count(), 0, 'No delayed payment banner is published to the next account')
  await historyPage.close()
  await page.route('**/api/question-bank/admin', route => {
    assert.equal(route.request().postDataJSON().action, 'inventory', 'Navigation only reads the synthetic inventory')
    return route.fulfill({ json: { configured: true, assets: [] } })
  })
  for (const width of [320, 390, 570, 760, 1024, 1536]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto(`${process.env.HYPERION_RECOVERY_TEST_URL}?section=admin`)
    const navigation = page.getByRole('navigation', { name: 'Administration', exact: true })
    let previousHeight = null
    for (const [label, heading] of [['USER LICENSES', 'User License Management'], ['PAYMENT SUBMISSIONS', 'Payment Submissions'], ['QUESTION BANK', 'Question Bank Update'], ['USER LICENSES', 'User License Management']]) {
      await navigation.getByRole('link', { name: label, exact: true }).click()
      await page.getByRole('heading', { name: heading, exact: true }).waitFor()
      assert.equal(await navigation.getByRole('link', { name: label, exact: true }).getAttribute('aria-current'), 'page')
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)))
      const boxes = await navigation.getByRole('link').evaluateAll(links => links.map(link => {
        const box = link.getBoundingClientRect()
        return { y: box.y, width: box.width, height: box.height, fits: link.scrollWidth <= link.clientWidth + 1 && link.scrollHeight <= link.clientHeight + 1 }
      }))
      assert.equal(boxes.length, 3)
      for (const box of boxes) {
        assert(Math.abs(box.y - boxes[0].y) < .5, `All admin sections share one row at ${width}px`)
        assert(Math.abs(box.width - boxes[0].width) < .5 && Math.abs(box.height - boxes[0].height) < .5, 'Admin section buttons have equal sizes')
        assert(box.height >= 44 && box.fits, 'Admin section labels fit inside accessible touch targets')
      }
      if (previousHeight !== null) assert(Math.abs(previousHeight - boxes[0].height) < .5, 'Changing admin sections preserves navigation height')
      previousHeight = boxes[0].height
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Admin navigation fits at ${width}px`)
      if (width === 390) await navigation.screenshot({ path: `admin-nav-${label.split(' ')[0].toLowerCase()}-390.png` })
    }
  }
  assert.deepEqual(errors, [])
  console.log('PASS: checkout/orders shared profile, profile edit/cancel, responsive placement, cart preservation, and isolated commerce effects')
} finally {
  await browser.close()
}
