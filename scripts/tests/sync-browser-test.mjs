import assert from 'node:assert/strict'
import { chromium } from 'playwright'
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] })
try {
  const context = await browser.newContext()
  const external = []
  await context.route('**/*', route => {
    if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(route.request().url()).hostname)) { external.push(new URL(route.request().url()).origin); return route.abort() }
    return route.continue()
  })
  await context.addInitScript(() => {
    const user = '11111111-1111-4111-8111-111111111111'
    if (localStorage.getItem('fixture-user')) return
    localStorage.setItem('fixture-user', user)
    localStorage.setItem('hyperion-progress-owner', user)
    localStorage.setItem('fixture-cloud:' + user, JSON.stringify({ data: { version: 1, savedAt: Date.now(), activeSessionChangedAt: 0, changedSections: [], storage: {}, activeSession: null }, updated_at: new Date().toISOString() }))
  })
  const page = await context.newPage()
  await page.clock.install()
  await page.goto(process.env.HYPERION_RECOVERY_TEST_URL)
  await page.waitForFunction(() => window.syncFixture?.calls.some(c => c.action === 'read'))
  const ids = await page.evaluate(() => window.syncFixture.seed('batch-', 23))
  await page.evaluate(ids => { window.syncFixture.pause(); window.firstUpload = window.syncFixture.upload(ids.slice(0, 10)) }, ids)
  await page.waitForFunction(() => window.syncFixture.calls.some(c => c.action.startsWith('write-session')))
  await page.evaluate(ids => {
    window.secondUpload = window.syncFixture.upload(ids.slice(10, 18))
    window.thirdUpload = window.syncFixture.upload(ids.slice(18))
    window.syncFixture.release()
  }, ids)
  await page.evaluate(() => Promise.all([window.firstUpload, window.secondUpload, window.thirdUpload]))
  assert.equal(await page.evaluate(ids => ids.filter(id => localStorage.getItem(`fixture-archive:${window.syncFixture.users.a}:${id}`)).length, ids), 23, 'Queued sync requests must union every ID')
  assert.equal(await page.evaluate(() => window.syncFixture.calls.filter(c => c.action === 'write-sessions').length), 3, '23 archives should use three bounded writes')
  const writes = await page.evaluate(() => window.syncFixture.calls.filter(c => c.action.startsWith('write-session')).length)
  await page.evaluate(ids => window.syncFixture.upload(ids), ids)
  assert.equal(await page.evaluate(() => window.syncFixture.calls.filter(c => c.action.startsWith('write-session')).length), writes, 'Unchanged archives send no new writes')

  await page.evaluate(() => window.syncFixture.seedCloud('downloaded'))
  await page.evaluate(() => Promise.all([window.syncFixture.download('downloaded'), window.syncFixture.download('downloaded')]))
  assert.equal(await page.evaluate(() => window.syncFixture.calls.filter(c => c.action === 'read-session' && c.sessionId === 'downloaded').length), 1)
  await page.evaluate(() => window.syncFixture.upload(['downloaded']))
  assert.equal(await page.evaluate(() => window.syncFixture.calls.filter(c => c.action.startsWith('write-session')).length), writes, 'Downloaded archives are not uploaded back unchanged')

  const retryIds = await page.evaluate(() => window.syncFixture.seed('retry-', 3))
  await page.evaluate(async ids => { localStorage.setItem('fixture-archive-error', '400'); await window.syncFixture.upload(ids); await window.syncFixture.upload(ids) }, retryIds)
  assert.equal(await page.evaluate(() => window.syncFixture.calls.filter(c => c.action === 'write-sessions').length), 4)
  assert.equal(await page.evaluate(async ids => (await Promise.all(ids.map(id => window.syncFixture.local(id)))).filter(Boolean).length, retryIds), 3)
  await page.clock.fastForward(901000)
  await page.evaluate(async ids => { localStorage.removeItem('fixture-archive-error'); await window.syncFixture.upload(ids) }, retryIds)
  assert.equal(await page.evaluate(ids => ids.filter(id => localStorage.getItem(`fixture-archive:${window.syncFixture.users.a}:${id}`)).length, retryIds), 3)

  const recoveries = await page.evaluate(() => window.syncFixture.calls.filter(c => c.action === 'recover-saved').length)
  await page.evaluate(() => { for (let i = 0; i < 8; i++) window.dispatchEvent(new Event('online')) })
  await page.waitForTimeout(100)
  assert.equal(await page.evaluate(() => window.syncFixture.calls.filter(c => c.action === 'recover-saved').length), recoveries, 'Successful recovery is not repeated by reconnects')
  await page.clock.fastForward(31000)
  const reads = await page.evaluate(() => window.syncFixture.calls.filter(c => c.action === 'read').length)
  await page.evaluate(() => { localStorage.setItem('fixture-progress-error', 'yes'); window.dispatchEvent(new Event('online')) })
  await page.waitForTimeout(100)
  await page.clock.fastForward(29000)
  assert.equal(await page.evaluate(() => window.syncFixture.calls.filter(c => c.action === 'read').length), reads + 1, 'Outages must not retry every five/eight seconds')
  await page.clock.fastForward(2000)
  await page.waitForTimeout(100)
  assert.equal(await page.evaluate(() => window.syncFixture.calls.filter(c => c.action === 'read').length), reads + 2)
  await page.evaluate(() => localStorage.removeItem('fixture-progress-error'))
  await page.clock.fastForward(61000)
  await page.waitForTimeout(100)
  assert.equal(await page.evaluate(() => window.syncFixture.calls.filter(c => c.action === 'recover-saved').length), recoveries)
  await page.reload()
  await page.waitForFunction(() => window.syncFixture?.calls.some(c => c.action === 'read'))
  assert.equal(await page.evaluate(() => window.syncFixture.calls.filter(c => c.action === 'recover-saved').length), 0, 'Recovery completion survives a browser restart')
  await page.waitForTimeout(250)
  for (const restart of [false, true]) {
    const before = await page.evaluate(() => window.syncFixture.calls.filter(c => c.action === 'read').length)
    await page.evaluate(() => { window.syncFixture.holdRead(); window.dispatchEvent(new Event('online')) })
    await page.waitForFunction(before => window.syncFixture.calls.filter(c => c.action === 'read').length === before + 1, before)
    await page.evaluate(restart => {
      if (restart) window.syncFixture.restart()
      else { window.syncFixture.switchUser(window.syncFixture.users.b); window.syncFixture.switchUser(window.syncFixture.users.a) }
    }, restart)
    await page.waitForTimeout(250)
    assert.equal(await page.evaluate(() => window.syncFixture.calls.filter(c => c.action === 'read').length), before + 2, 'A fresh auth epoch must not adopt an invalidated initialization')
    await page.evaluate(() => window.syncFixture.releaseRead())
    await page.waitForTimeout(100)
  }
  const privateId = (await page.evaluate(() => window.syncFixture.seed('owner-private-', 1)))[0]
  await page.evaluate(id => { window.syncFixture.pause(); window.lateUpload = window.syncFixture.upload([id]) }, privateId)
  await page.waitForFunction(id => window.syncFixture.calls.some(c => c.action === 'write-sessions' && c.sessionIds?.includes(id)), privateId)
  await page.evaluate(() => window.syncFixture.switchUser(window.syncFixture.users.b))
  await page.waitForFunction(() => localStorage.getItem('hyperion-progress-owner') === window.syncFixture.users.b)
  await page.evaluate(async () => { window.syncFixture.release(); await window.lateUpload })
  assert.equal(await page.evaluate(id => localStorage.getItem(`hyperion-archive-synced:${window.syncFixture.users.a}:${id}`), privateId), null)
  assert.equal(await page.evaluate(id => localStorage.getItem(`fixture-archive:${window.syncFixture.users.b}:${id}`), privateId), null)
  // IndexedDB is the local source of truth. Saving the *same* draft twice
  // must neither encrypt/rewrite it nor trigger another cloud-sync wakeup.
  const beforeEvents = await page.evaluate(() => window.syncFixture.archiveEvents.length)
  await page.evaluate(async () => {
    await window.syncFixture.saveDraft('idb-noop', 1)
    await window.syncFixture.saveDraft('idb-noop', 1)
    await window.syncFixture.saveDraft('idb-noop', 0)
  })
  const newEvents = await page.evaluate(start => window.syncFixture.archiveEvents.slice(start), beforeEvents)
  assert.deepEqual(newEvents.map(event => event.id), ['idb-noop', 'idb-noop'], 'Only the first and genuinely changed draft emit sync events')
  const ownerB = await page.evaluate(() => window.syncFixture.users.b)
  assert(newEvents.every(event => event.ownerId === ownerB), 'Events never leak across signed-in accounts')
  const savedDraft = await page.evaluate(() => window.syncFixture.local('idb-noop'))
  assert.equal(savedDraft.answers[savedDraft.questions[0].id].selectedIndex, 0, 'Encrypted IndexedDB retains the latest answer after a skipped no-op write')
  assert.equal(savedDraft.finished, false, 'Draft remains locally resumable')

  assert.deepEqual(external, [], 'Synthetic browser tests must not contact production services')
  console.log('PASS: coalesced archive unions, three writes for 23 archives, no-op downloads, retry preservation, versioned recovery and bounded restore retries.')
} finally { await browser.close() }
