import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
const { chromium } = createRequire(process.env.HYPERION_TEST_TOOLS || import.meta.url)('playwright')
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || chromium.executablePath(), args: ['--no-sandbox'] })
try {
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width === 390 })
    const errors = [], external = []
    await context.route('**/*', route => {
      if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(route.request().url()).hostname)) { external.push(route.request().url()); return route.abort() }
      return route.continue()
    })
    await context.addInitScript(() => {
      localStorage.setItem('hyperion-progress-owner', '11111111-1111-4111-8111-111111111111')
      localStorage.setItem('hyperion-practice-automations', JSON.stringify({ directAnswer: false, autoNextCorrect: false, autoNextWrong: false }))
    })
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(process.env.HYPERION_RECOVERY_TEST_URL)
    await page.waitForFunction(() => window.recoveryFixture?.settled())
    const cookies = page.getByRole('region', { name: 'Cookie preferences' })
    if (await cookies.count()) await cookies.getByRole('button', { name: 'Essential only', exact: true }).click()
    const start = async direct => {
      assert.equal(await page.evaluate(async direct => {
        window.recoveryFixture.license(true)
        window.recoveryFixture.keywords(true)
        const automations = { directAnswer: direct, autoNextCorrect: false, autoNextWrong: false }
        localStorage.setItem('hyperion-practice-automations', JSON.stringify(automations))
        window.dispatchEvent(new CustomEvent('hyperion:practice-settings', { detail: automations }))
        return window.recoveryFixture.practice().startCustomSession({
          track: 'DECK_OIC_NW', competenceId: 'C1', randomizeOrder: false, shuffleChoices: false,
          questions: [{ id: 'recovery-fixture-keywords-' + direct, track: 'DECK_OIC_NW', functionId: 'F1', competenceId: 'C1', topic: 'Synthetic keywords', questionText: 'Which vessel gives way: _____?', options: ['Port, not starboard.', 'Keep clear!'], correctAnswerIndex: 1, explanation: 'Synthetic explanation.', difficulty: 'EASY' }]
        })
      }, direct), true)
      await page.getByRole('link', { name: 'Runner fixture', exact: true }).click()
      await page.locator('.practice-quiz-screen').waitFor()
      await page.getByRole('button', { name: 'Edit Keyword', exact: true }).waitFor()
    }
    const edit = () => page.getByRole('button', { name: 'Edit Keyword', exact: true })
    const save = () => page.getByRole('button', { name: 'Save Keywords', exact: true })
    const answer = () => page.locator('.question-protected-options > button').first()
    const choice = () => page.locator('.question-protected-options > div').first()
    await start(false)
    await answer().click()
    await edit().click()
    assert.equal(await page.getByRole('button', { name: 'Check Answer', exact: true }).isDisabled(), true, 'An existing pending answer cannot be checked while editing')
    assert.equal(await page.locator('.question-protected-options > button').count(), 0)
    await choice().getByRole('button', { name: /^Highlight word 1: Port$/ }).click()
    await choice().getByRole('button', { name: /^Highlight symbol .*: ,$/ }).focus()
    await page.keyboard.press('Enter')
    assert.equal(await page.evaluate(() => Object.keys(window.recoveryFixture.practice().answers).length), 0)
    await save().click()
    await edit().waitFor()
    assert.deepEqual(await answer().locator('mark').allTextContents(), ['Port', ','])
    assert.equal(await page.getByRole('button', { name: 'Check Answer', exact: true }).isDisabled(), false)
    await page.getByRole('button', { name: 'Check Answer', exact: true }).click()
    assert.equal(await page.evaluate(() => Object.values(window.recoveryFixture.practice().answers)[0].selectedIndex), 0)
    // Answered cards still allow highlight editing, without changing the recorded answer.
    await edit().click()
    await choice().getByRole('button', { name: /^Highlight word 2: not$/ }).click()
    await save().click()
    await edit().waitFor()
    assert.deepEqual(await answer().locator('mark').allTextContents(), ['Port', ',', 'not'])
    await start(true)
    await edit().click()
    await choice().getByRole('button', { name: /^Highlight word 1: Port$/ }).click()
    assert.equal(await page.evaluate(() => Object.keys(window.recoveryFixture.practice().answers).length), 0, 'Direct Answer must not receive highlight taps')
    await save().click()
    await edit().waitFor()
    await answer().click()
    assert.equal(await page.evaluate(() => Object.values(window.recoveryFixture.practice().answers)[0].selectedIndex), 0)
    await page.evaluate(() => window.recoveryFixture.mockKeywords())
    await page.getByRole('link', { name: 'Mock fixture', exact: true }).click()
    await page.getByRole('radio').first().waitFor()
    await edit().click()
    assert.equal(await page.getByRole('radio').count(), 0, 'Continuous mock choices are highlight groups while editing')
    const mockChoice = page.getByRole('group', { name: 'Highlight answer choice', exact: true }).first()
    await mockChoice.getByRole('button', { name: /^Highlight word 1: Port$/ }).focus()
    await page.keyboard.press('Space')
    assert.equal(await page.evaluate(() => Object.keys(window.recoveryFixture.practice().answers).length), 0)
    await save().click()
    await edit().waitFor()
    await page.getByRole('radio').first().click()
    assert.equal(await page.evaluate(() => Object.values(window.recoveryFixture.practice().answers)[0].selectedIndex), 0)
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    assert.deepEqual(errors, [])
    assert.deepEqual(external, [])
    console.log(`PASS: actual PWA runner at ${width}px blocks pending-answer checks, pointer/keyboard answer selection and Direct Answer during editing; saves choice highlights and resumes answering, including continuous mock radio choices.`)
    await context.close()
  }
} finally { await browser.close() }
