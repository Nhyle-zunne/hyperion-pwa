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
    assert(profileBox && contentBox)
    assert(width > 800 ? profileBox.x + profileBox.width <= contentBox.x : profileBox.y + profileBox.height <= contentBox.y, `Profile placement at ${width}px`)
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No overflow at ${width}px`)
    if (width === 390) {
      const toggle = sidebar.getByRole('button', { name: /^Edit profile/ })
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false')
      await toggle.click()
      assert.equal(await sidebar.getByRole('button', { name: /^Hide profile/ }).getAttribute('aria-expanded'), 'true')
      await sidebar.getByRole('button', { name: /^Hide profile/ }).click()
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
  await page.getByRole('button', { name: 'Shopping cart', exact: true }).click()
  await page.getByRole('heading', { name: 'Checkout', exact: true }).waitFor()
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('hyperion-account-basket-v1'))), basket, 'Navigation preserves the saved cart')
  const calls = await page.evaluate(() => window.accountFixtureCalls)
  assert.equal(calls.filter(call => call.action === 'table:google_play_entitlements').length, 0, 'Profile layout must not load store entitlements')
  assert.equal(calls.filter(call => call.action === 'verify-checkout:').length, 0, 'Profile layout must not duplicate payment verification')
  assert.deepEqual(calls.find(call => call.action === 'update-profile').data, { full_name: 'Updated Member', company: 'Fixture Company', school: 'Fixture School' })
  assert.deepEqual(errors, [])
  console.log('PASS: checkout/orders shared profile, profile edit/cancel, responsive placement, cart preservation, and isolated commerce effects')
} finally {
  await browser.close()
}
