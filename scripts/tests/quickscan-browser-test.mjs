import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
const { chromium } = createRequire(process.env.HYPERION_TEST_TOOLS || import.meta.url)('playwright')
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] })
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(process.env.HYPERION_QUICKSCAN_TEST_URL || 'http://127.0.0.1:4179/scripts/tests/quickscan-browser.html')
  // The first-visit consent banner can cover navigation controls on 390px screens.
  // Dismiss it through the real user-facing control before exercising the reader.
  await page.getByRole('button', { name: 'Essential only' }).click()
  const header = page.getByRole('banner', { name: 'Question navigation' })
  const gear = () => header.getByRole('button', { name: 'Question settings', exact: true })
  const edit = () => page.getByRole('button', { name: 'Edit Keyword', exact: true })
  const save = () => page.getByRole('button', { name: 'Save Keywords', exact: true })
  const ready = () => page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent?.trim() === 'Edit Keyword' && !button.disabled))
  await page.getByText('Vessel fixture 1 gives way.', { exact: true }).waitFor()
  assert.equal(await page.locator('.nav-theme-toggle').count(), 0)
  assert.equal(await header.getByText('QUICK SCAN', { exact: true }).count(), 1)
  await header.getByRole('button', { name: 'Bookmark question', exact: true }).click()
  assert.equal(await header.getByRole('button', { name: 'Remove bookmark', exact: true }).getAttribute('aria-pressed'), 'true')
  await page.getByRole('button', { name: 'Next →', exact: true }).click()
  await page.getByText('Vessel fixture 2 gives way.', { exact: true }).waitFor()
  assert.equal(await header.getByRole('button', { name: 'Bookmark question', exact: true }).getAttribute('aria-pressed'), 'false')
  await page.getByRole('button', { name: '← Previous', exact: true }).click()
  await header.getByRole('button', { name: 'Remove bookmark', exact: true }).waitFor()
  await gear().click()
  await header.getByRole('switch', { name: 'Night Mode' }).click()
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark')
  await header.getByRole('switch', { name: 'Night Mode' }).click()
  await header.getByRole('switch', { name: 'Highlight Keywords' }).check()
  await header.getByRole('button', { name: 'A+', exact: true }).click()
  await gear().click()
  assert.ok(await page.locator('.quick-scan-screen').getByText('Vessel fixture 1 gives way.', { exact: true }).evaluate(e => parseFloat(getComputedStyle(e).fontSize)) > 17)
  await ready()
  await edit().click()
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent?.trim() === 'Save Keywords' && getComputedStyle(button).backgroundColor === 'rgb(21, 128, 61)'))
  assert.equal(await save().evaluate(e => getComputedStyle(e).backgroundColor), 'rgb(21, 128, 61)')
  await page.getByRole('button', { name: 'Highlight word 1: Vessel', exact: true }).click()
  await save().click()
  await ready()
  assert.deepEqual(await page.locator('mark').allTextContents(), ['Vessel'])
  const quickWidth = (await page.locator('.quick-scan-screen').boundingBox()).width
  assert.ok(quickWidth > 560)
  await page.getByRole('link', { name: 'Practice fixture', exact: true }).click()
  await ready()
  assert.deepEqual(await page.locator('mark').allTextContents(), ['Vessel'])
  assert.equal(await header.getByRole('button', { name: 'Remove bookmark', exact: true }).getAttribute('aria-pressed'), 'true')
  assert.equal((await page.locator('.practice-quiz-screen').boundingBox()).width, quickWidth)
  await header.getByRole('button', { name: 'Remove bookmark', exact: true }).click()
  await edit().click()
  await page.getByRole('button', { name: 'Highlight word 2: fixture', exact: true }).click()
  await save().click()
  await ready()
  await page.getByRole('link', { name: 'Quick Scan fixture', exact: true }).click()
  await ready()
  assert.deepEqual(await page.locator('mark').allTextContents(), ['Vessel', 'fixture'])
  assert.equal(await header.getByRole('button', { name: 'Bookmark question', exact: true }).getAttribute('aria-pressed'), 'false')
  const correctOption = page.locator('.quick-scan-screen .card').filter({ hasText: 'Starboard' })
  assert.match(await correctOption.innerText(), /✓/)
  await page.getByRole('button', { name: 'Next →', exact: true }).click()
  await ready()
  assert.deepEqual(await page.locator('mark').allTextContents(), [])
  page.once('dialog', dialog => dialog.accept('51'))
  await page.getByRole('button', { name: 'Jump to Question' }).click()
  await page.getByText('Vessel fixture 51 gives way.', { exact: true }).waitFor()
  await page.getByRole('button', { name: '← Previous', exact: true }).click()
  await page.getByText('Vessel fixture 50 gives way.', { exact: true }).waitFor()
  await ready()
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await gear().click()
    assert.ok((await header.getByRole('switch', { name: 'Night Mode' }).boundingBox()).x >= 0)
    await gear().click()
  }
  // Quick Scan reader must persist *only* a small position in local IndexedDB.
  // Returning through the header immediately after jumping must not race a
  // pending IDB write, and the position must survive a hard reload.
  page.once('dialog', dialog => dialog.accept('51'))
  await page.getByRole('button', { name: 'Jump to Question' }).click()
  await page.getByText('Vessel fixture 51 gives way.', { exact: true }).waitFor()
  await page.waitForFunction(async () => {
    const request = indexedDB.open('hyperion-quick-scan-reading-position')
    const db = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const tx = db.transaction('positions', 'readonly')
    const get = tx.objectStore('positions').getAll()
    const rows = await new Promise((resolve, reject) => {
      get.onsuccess = () => resolve(get.result)
      get.onerror = () => reject(get.error)
    })
    db.close()
    return rows.some(row => row.track === 'DECK_OIC_NW' && row.competenceId === 'C1' &&
      row.questionIndex === 50 && row.questionId === 'quickscan-fixture-51')
  })

  const goBack = async () => {
    await header.getByRole('button', { name: 'Back to Quick Scan competences' }).click()
    await page.getByText('Select Competence', { exact: true }).waitFor()
  }
  await goBack()
  await page.getByText('RESUME QUICK SCAN', { exact: true }).waitFor()
  await page.getByRole('button', { name: /GO BACK TO WHERE YOU LEFT OFF/ }).click()
  await page.getByText('Vessel fixture 51 gives way.', { exact: true }).waitFor()

  // Reopening the same competence normally asks whether to resume, just as
  // the Android viewer does. A reload must not silently reset the cursor to Q1.
  await page.reload()
  const resumeDialog = page.getByRole('dialog', { name: 'RESUME PREVIOUS READING?' })
  await resumeDialog.waitFor()
  await resumeDialog.getByRole('button', { name: 'YES, GO TO Q #51' }).click()
  await page.getByText('Vessel fixture 51 gives way.', { exact: true }).waitFor()
  await goBack()
  await page.getByRole('button', { name: /C1.*OPEN/i }).first().click()
  await resumeDialog.waitFor()
  await resumeDialog.getByRole('button', { name: 'NO, START AT Q #1' }).click()
  await page.getByText('Vessel fixture 1 gives way.', { exact: true }).waitFor()
  await goBack()
  assert.equal(await page.getByText('RESUME QUICK SCAN', { exact: true }).count(), 0)

  // Bank revision: inserting a question before the saved item must use its
  // stable ID rather than silently resuming at a now-different item number.
  await page.getByRole('button', { name: /C1.*OPEN/i }).first().click()
  await page.getByText('Vessel fixture 1 gives way.', { exact: true }).waitFor()
  page.once('dialog', dialog => dialog.accept('20'))
  await page.getByRole('button', { name: 'Jump to Question' }).click()
  await page.getByText('Vessel fixture 20 gives way.', { exact: true }).waitFor()
  await goBack()
  await page.evaluate(() => localStorage.setItem('hyperion-quickscan-fixture-bank-mode', 'insert-before-20'))
  await page.getByRole('button', { name: /GO BACK TO WHERE YOU LEFT OFF/ }).click()
  await page.getByText('Vessel fixture 20 gives way.', { exact: true }).waitFor()
  await page.getByText('ITEM 21 OF 121', { exact: true }).waitFor()
  await page.getByText(/changed position after a question-bank update/).waitFor()
  await goBack()

  // Restore the original bank; the same immutable ID must move safely back.
  await page.evaluate(() => localStorage.removeItem('hyperion-quickscan-fixture-bank-mode'))
  await page.getByRole('button', { name: /GO BACK TO WHERE YOU LEFT OFF/ }).click()
  await page.getByText('Vessel fixture 20 gives way.', { exact: true }).waitFor()
  await page.getByText('ITEM 20 OF 120', { exact: true }).waitFor()
  page.once('dialog', dialog => dialog.accept('51'))
  await page.getByRole('button', { name: 'Jump to Question' }).click()
  await page.getByText('Vessel fixture 51 gives way.', { exact: true }).waitFor()
  await goBack()

  // A retired question must never map to Q52 merely because its old numeric
  // position still exists. Restart at Q1 with a visible reason.
  await page.evaluate(() => localStorage.setItem('hyperion-quickscan-fixture-bank-mode', 'remove-51'))
  await page.getByRole('button', { name: /GO BACK TO WHERE YOU LEFT OFF/ }).click()
  await page.getByText('Vessel fixture 1 gives way.', { exact: true }).waitFor()
  await page.getByText(/previous question could not be matched/).waitFor()
  await goBack()
  await page.evaluate(() => localStorage.removeItem('hyperion-quickscan-fixture-bank-mode'))

  // Switching local account scopes must not expose another account's cursor,
  // even though IndexedDB physically holds the previous account's tiny row.
  const separation = await page.evaluate(async () => {
    const t = window.__hyperionQuickScanTest
    const original = localStorage.getItem('hyperion-progress-owner')
    const own = await t.getQuickScanPosition('DECK_OIC_NW', 'C1')
    localStorage.setItem('hyperion-progress-owner', 'isolated-synthetic-account')
    const foreign = await t.getQuickScanPosition('DECK_OIC_NW', 'C1')
    const foreignList = await t.listQuickScanPositions('DECK_OIC_NW')
    if (original === null) localStorage.removeItem('hyperion-progress-owner')
    else localStorage.setItem('hyperion-progress-owner', original)
    const restored = await t.getQuickScanPosition('DECK_OIC_NW', 'C1')
    return { own: own?.questionIndex, foreign, foreignListSize: foreignList.length, restored: restored?.questionIndex }
  })
  assert.equal(separation.own, 0)
  assert.equal(separation.foreign, null)
  assert.equal(separation.foreignListSize, 0)
  assert.equal(separation.restored, 0)

  // The browser may temporarily deny IDB and recover later. A newer
  // localStorage fallback must migrate into IDB, not be shadowed by an older
  // IDB record; a delayed cross-tab write must not overwrite it.
  const recovery = await page.evaluate(async () => {
    const t = window.__hyperionQuickScanTest
    const old = await t.getQuickScanPosition('DECK_OIC_NW', 'C1')
    const replacement = {
      ...old, questionIndex: 77, questionId: 'quickscan-fixture-78', savedAt: Date.now() + 500
    }
    const fallbackKey = 'hyperion:quick-scan-reading:v1:' + replacement.id
    localStorage.setItem(fallbackKey, JSON.stringify(replacement))
    const restored = await t.getQuickScanPosition('DECK_OIC_NW', 'C1')
    const idb = await new Promise((resolve, reject) => {
      const req = indexedDB.open('hyperion-quick-scan-reading-position')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    const stored = await new Promise((resolve, reject) => {
      const req = idb.transaction('positions', 'readonly').objectStore('positions').get(replacement.id)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    idb.close()
    const fallbackCleared = localStorage.getItem(fallbackKey) === null
    const originalNow = Date.now
    try {
      Date.now = () => replacement.savedAt - 100
      await t.saveQuickScanPosition('DECK_OIC_NW', 'C1', 5, 'quickscan-fixture-6')
    } finally {
      Date.now = originalNow
    }
    const afterStaleWrite = await t.getQuickScanPosition('DECK_OIC_NW', 'C1')
    return {
      restored: restored?.questionIndex,
      persisted: stored?.questionIndex,
      fallbackCleared,
      afterStaleWrite: afterStaleWrite?.questionIndex
    }
  })
  assert.deepEqual(recovery, {
    restored: 77, persisted: 77, fallbackCleared: true, afterStaleWrite: 77
  })

  // If a protected question page fails, the viewer must provide a usable
  // retry path rather than trapping the reader on a blank page.
  await page.evaluate(() => localStorage.setItem('hyperion-quickscan-fixture-bank-mode', 'fail-load'))
  await page.getByRole('button', { name: /C1.*OPEN/i }).first().click()
  const failurePrompt = page.getByRole('dialog', { name: 'RESUME PREVIOUS READING?' })
  await failurePrompt.waitFor()
  await failurePrompt.getByRole('button', { name: 'NO, START AT Q #1' }).click()
  await page.getByRole('button', { name: 'Retry opening Quick Scan' }).waitFor()
  await page.evaluate(() => localStorage.removeItem('hyperion-quickscan-fixture-bank-mode'))
  await page.getByRole('button', { name: 'Retry opening Quick Scan' }).click()
  await page.getByRole('dialog', { name: 'RESUME PREVIOUS READING?' }).waitFor()
  await page.getByRole('dialog').getByRole('button', { name: 'NO, START AT Q #1' }).click()
  await page.getByText('Vessel fixture 1 gives way.', { exact: true }).waitFor()

  assert.deepEqual(errors, [])
  console.log('PASS: shared Quick Scan UI, bookmarks/highlights, page boundary and Jump, local IndexedDB cursor, resume card, reload, resume/start-over, and Back without Supabase writes.')
} finally { await browser.close() }
