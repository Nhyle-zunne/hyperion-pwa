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
  page.on('dialog', dialog => { void dialog.accept() })
  const url = process.env.HYPERION_RECOVERY_TEST_URL
  assert.ok(url, 'Fixture URL required')
  await page.goto(url)
  await page.getByRole('button', { name: 'Start OIC-NW C1 fixture' }).click()
  await page.getByText('OIC NW C1 refresh test question?', { exact: true }).waitFor()
  assert.match(page.url(), /[?&]resume=refresh-oic-c1(?:&|$)/,
    'A newly started C1 session must pin its exact ID in the URL')

  // Regression for the route-transition transform trapping fixed-position
  // children inside the scrollable quiz rather than the browser viewport.
  const assertFixedViewportLayer = async (selector, label) => {
    const bounds = await page.locator(selector).evaluate(element => {
      const r = element.getBoundingClientRect()
      return { top: r.top, left: r.left, right: r.right, bottom: r.bottom,
        viewportWidth: window.innerWidth, viewportHeight: window.innerHeight }
    })
    assert.ok(Math.abs(bounds.top) < 2 && Math.abs(bounds.left) < 2 &&
      Math.abs(bounds.right - bounds.viewportWidth) < 2 &&
      Math.abs(bounds.bottom - bounds.viewportHeight) < 2,
    label + ' must cover the full visual viewport, not the route content: ' + JSON.stringify(bounds))
  }
  const assertModalCentered = async (selector, label) => {
    const box = await page.locator(selector).boundingBox()
    assert.ok(box, label + ' must be visible')
    const viewport = page.viewportSize()
    assert.ok(box.x >= 0 && box.y >= 0 &&
      box.x + box.width <= viewport.width + 2 &&
      box.y + box.height <= viewport.height + 2,
    label + ' must remain fully inside the screen: ' + JSON.stringify(box))
    assert.ok(Math.abs((box.y + box.height / 2) - viewport.height / 2) < 3,
    label + ' must be vertically centered in the viewport: ' + JSON.stringify(box))
  }
  for (const size of [{ width: 1200, height: 880 }, { width: 390, height: 720 }]) {
    await page.setViewportSize(size)
    await page.evaluate(() => window.dispatchEvent(new Event('hyperion:request-exit-practice')))
    await page.getByRole('dialog', { name: 'Save your progress?' }).waitFor()
    await assertFixedViewportLayer('.exit-dialog-backdrop', 'Save Progress & Exit backdrop')
    await assertModalCentered('.exit-dialog', 'Save Progress & Exit dialog')
    await page.getByRole('button', { name: 'Continue Reviewing' }).click()
    await page.getByRole('button', { name: 'Question palette' }).click()
    await page.getByRole('dialog', { name: 'QUESTION PALETTE' }).waitFor()
    await assertFixedViewportLayer('.practice-quiz-screen [role="presentation"]', 'Question Palette backdrop')
    await assertModalCentered('.practice-quiz-screen [role="dialog"]', 'Question Palette dialog')
    await page.getByRole('button', { name: 'CLOSE', exact: true }).click()
    const footerBottom = await page.getByRole('button', { name: 'Question palette' }).evaluate(element =>
      element.parentElement.getBoundingClientRect().bottom)
    assert.ok(Math.abs(footerBottom - size.height) < 2,
      'Question navigation bar must dock to the visual viewport bottom, not route content')
  }
  await page.setViewportSize({ width: 1200, height: 880 })

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
  // Every registered competence on every track uses the same exact-session
  // restore code. Add a different latest History record to catch regressions.
  await page.goto(url)
  await page.getByRole('button', { name: 'Start OIC-NW C1 fixture' }).waitFor()
  const matrix = await page.evaluate(async () => {
    await window.practiceRefreshMatrix.seed()
    return window.practiceRefreshMatrix.cases
  })
  const tracks = [...new Set(matrix.map(item => item.track))]
  assert.deepEqual(tracks, ['DECK_OIC_NW', 'ENGINE_OIC_EW', 'DECK_MGT', 'ENGINE_MGT', 'GMDSS_GOC'])
  assert.ok(matrix.length >= 70, 'The suite must include every registered competence, extra GMDSS parts, free practice, drills, and mock exams')
  for (const item of matrix) {
    await page.evaluate(free => localStorage.setItem('fixture-license', free ? 'free' : 'licensed'), item.free)
    const suffix = '?resume=' + encodeURIComponent(item.id) + (item.mode === 'MOCK' ? '&runner=mock' : '')
    await page.goto(url + suffix)
    await page.getByText(item.text, { exact: true }).waitFor()
    await page.reload()
    await page.getByText(item.text, { exact: true }).waitFor()
    assert.equal(await page.getByText('GMDSS all questions wrong-track fixture?', { exact: true }).count(), 0,
      'A different track must never replace ' + item.track + ' ' + item.competenceId + ' ' + item.mode)
  }

  // A mismatched archived track/competence must fail closed while keeping the
  // source History record intact for investigation or manual recovery.
  await page.evaluate(() => localStorage.setItem('fixture-license', 'licensed'))
  await page.goto(url + '?resume=matrix-history-mismatch')
  await page.getByText(/does not match its track or competence in History/).waitFor()
  assert.equal(await page.getByText('Mismatched record must never be shown?', { exact: true }).count(), 0)
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('hyperion-history')).state.savedSessions.some(row => row.id === 'matrix-history-mismatch')), true)

  // An exact mock ID cannot be shown in the normal practice runner and vice versa.
  const mock = matrix.find(item => item.mode === 'MOCK')
  const practice = matrix.find(item => item.mode === 'PRACTICE' && !item.free)
  assert.ok(mock && practice)
  await page.goto(url + '?resume=' + encodeURIComponent(mock.id))
  await page.getByText('This saved session is a timed mock exam.', { exact: false }).waitFor()
  await page.goto(url + '?resume=' + encodeURIComponent(practice.id) + '&runner=mock')
  await page.getByText('This saved session is not a mock exam.', { exact: false }).waitFor()

  assert.deepEqual(errors, [], 'The all-track refresh fixture must not have browser exceptions')
  console.log('PASS: pinned hard refresh across ' + matrix.length + ' sessions from ' + tracks.length +
    ' track banks, every competence, free practice, drill, mock and GMDSS multipart; mismatches rejected without deletion.')
} finally {
  await browser.close()
}
