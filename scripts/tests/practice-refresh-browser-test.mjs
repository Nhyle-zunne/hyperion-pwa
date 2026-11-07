import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || chromium.executablePath(),
  args: ['--no-sandbox']
})
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 880 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const url = process.env.HYPERION_RECOVERY_TEST_URL
  assert.ok(url, 'Fixture URL required')
  await page.goto(url)
  await page.getByRole('button', { name: 'Start OIC-NW C1 fixture' }).click()
  await page.getByText('OIC NW C1 refresh test question?', { exact: true }).waitFor()
  assert.match(page.url(), /[?&]resume=refresh-oic-c1(?:&|$)/,
    'A newly started C1 session must pin its exact ID in the URL')
  const latest = await page.evaluate(() => {
    const history = JSON.parse(localStorage.getItem('hyperion-history') || '{}')
    return [...(history.state?.savedSessions || [])].sort((a, b) => b.savedAt - a.savedAt)[0]?.id
  })
  assert.equal(latest, 'refresh-gmdss-all', 'A different track must be the newest saved session')

  await page.reload()
  await page.getByText('OIC NW C1 refresh test question?', { exact: true }).waitFor()
  assert.equal(await page.getByText('GMDSS all questions wrong-track fixture?', { exact: true }).count(), 0,
    'Reloading C1 must not replace it with the most recent GMDSS session')

  // An old/unqualified quiz URL must not arbitrarily resume another track.
  await page.goto(url)
  await page.getByText('No session active. Open History to select the correct saved session.').waitFor()
  assert.equal(await page.getByText('GMDSS all questions wrong-track fixture?', { exact: true }).count(), 0)

  // Explicitly selecting GMDSS should still work, including a subsequent reload.
  await page.goto(url + '?resume=refresh-gmdss-all')
  await page.getByText('GMDSS all questions wrong-track fixture?', { exact: true }).waitFor()
  await page.reload()
  await page.getByText('GMDSS all questions wrong-track fixture?', { exact: true }).waitFor()
  assert.deepEqual(errors, [], 'The practice reload fixture must not have browser exceptions')
  console.log('PASS: OIC-NW C1 stays selected after hard refresh despite newer GMDSS; bare URLs never select unrelated sessions.')
} finally {
  await browser.close()
}
