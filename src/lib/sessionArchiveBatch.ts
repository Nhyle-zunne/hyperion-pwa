// Durable local IndexedDB saves remain immediate. Coalesce normal paid-session
// cloud uploads to reduce one Edge Function invocation per answer/navigation.
// Completed exams are still immediate cloud checkpoints; hiding the app attempts
// an early best-effort flush. On every intermediate edit the encrypted IndexedDB
// snapshot is durable immediately, independent of cloud connectivity.
// Using one 30-second window from the first draft edit reduces short repeated
// uploads without indefinite debounce during continuous question navigation.
export const SESSION_ARCHIVE_CLOUD_BATCH_MS = 30_000

export function flushArchiveImmediately(finished: unknown): boolean {
  return finished === true
}

const TARGET_BYTES = 1024 * 1024

export function archiveBatches<T extends { sessionId: string; snapshot: unknown }>(entries: T[]): T[][] {
  const batches: T[][] = []
  let batch: T[] = [], bytes = 100
  for (const entry of entries) {
    const size = new TextEncoder().encode(JSON.stringify(entry)).byteLength + 1
    if (batch.length && (batch.length >= 10 || bytes + size > TARGET_BYTES)) {
      batches.push(batch); batch = []; bytes = 100
    }
    batch.push(entry); bytes += size
  }
  if (batch.length) batches.push(batch)
  return batches
}

export function archiveBatchAcknowledged(value: unknown, requested: string[]): boolean {
  const result = value as { ok?: boolean; sessionIds?: unknown }
  return result?.ok === true && Array.isArray(result.sessionIds) &&
    result.sessionIds.length === requested.length && new Set(result.sessionIds).size === requested.length &&
    requested.every(id => (result.sessionIds as unknown[]).includes(id))
}
