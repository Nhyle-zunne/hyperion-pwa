import { expect, test } from 'bun:test'
import { archiveBatches, archiveBatchAcknowledged, SESSION_ARCHIVE_CLOUD_BATCH_MS, flushArchiveImmediately } from '../../src/lib/sessionArchiveBatch'

test('archives split at ten items without dropping or duplicating IDs', () => {
  const items = Array.from({ length: 23 }, (_, i) => ({ sessionId: 's' + i, snapshot: { value: i } }))
  const batches = archiveBatches(items)
  expect(batches.map(batch => batch.length)).toEqual([10, 10, 3])
  expect(batches.flat().map(item => item.sessionId)).toEqual(items.map(item => item.sessionId))
})
test('UTF-8 byte limits split eligible uploads while retaining a single oversized archive', () => {
  const items = [{ sessionId: 'a', snapshot: '航'.repeat(200000) }, { sessionId: 'b', snapshot: '航'.repeat(200000) }, { sessionId: 'large', snapshot: 'x'.repeat(1100000) }]
  const batches = archiveBatches(items)
  expect(batches.map(batch => batch.map(item => item.sessionId))).toEqual([['a'], ['b'], ['large']])
})
test('only a complete explicit acknowledgement may advance sync markers', () => {
  expect(archiveBatchAcknowledged({ ok: true, sessionIds: ['b', 'a'] }, ['a', 'b'])).toBe(true)
  for (const result of [{ ok: true }, { ok: true, sessionIds: ['a'] }, { ok: true, sessionIds: ['a', 'a'] }, { ok: true, sessionIds: ['a', 'other'] }, { ok: false, sessionIds: ['a', 'b'] }]) {
    expect(archiveBatchAcknowledged(result, ['a', 'b'])).toBe(false)
  }
})

test('paid cloud archives coalesce frequent draft saves while completed exam audits flush immediately', () => {
  expect(SESSION_ARCHIVE_CLOUD_BATCH_MS).toBeGreaterThanOrEqual(10000)
  expect(SESSION_ARCHIVE_CLOUD_BATCH_MS).toBeLessThanOrEqual(30000)
  expect(flushArchiveImmediately(true)).toBe(true)
  expect(flushArchiveImmediately(false)).toBe(false)
  expect(flushArchiveImmediately(undefined)).toBe(false)
  expect(flushArchiveImmediately('true')).toBe(false)
})
