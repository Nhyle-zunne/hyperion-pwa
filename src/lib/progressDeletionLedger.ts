export type ProgressDeletionCollection = 'bookmarks' | 'vault'

export interface ProgressItemMutation {
  at: number
  deleted: boolean
}

export interface ProgressDeletionLedger {
  version: 1
  bookmarks: Record<string, ProgressItemMutation>
  vault: Record<string, ProgressItemMutation>
}

export const PROGRESS_DELETIONS_KEY = 'hyperion-progress-deletions'

function emptyLedger(): ProgressDeletionLedger {
  return { version: 1, bookmarks: {}, vault: {} }
}

function parseLedger(raw: string | null | undefined): ProgressDeletionLedger {
  if (!raw) return emptyLedger()
  try {
    const parsed = JSON.parse(raw) as Partial<ProgressDeletionLedger>
    const ledger = emptyLedger()
    for (const collection of ['bookmarks', 'vault'] as const) {
      const source = parsed[collection]
      if (!source || typeof source !== 'object' || Array.isArray(source)) continue
      for (const [id, value] of Object.entries(source)) {
        if (!id || !value || typeof value !== 'object') continue
        const at = Number((value as ProgressItemMutation).at ?? 0)
        const deleted = (value as ProgressItemMutation).deleted === true
        if (Number.isFinite(at) && at > 0) ledger[collection][id] = { at, deleted }
      }
    }
    return ledger
  } catch {
    return emptyLedger()
  }
}

function persistLedger(ledger: ProgressDeletionLedger): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(PROGRESS_DELETIONS_KEY, JSON.stringify(ledger))
    }
  } catch {
    // Sync is best effort; the local collection remains usable when storage is unavailable.
  }
}

export function markProgressItemDeleted(collection: ProgressDeletionCollection, id: string): void {
  if (!id) return
  const ledger = parseLedger(
    typeof localStorage === 'undefined' ? null : localStorage.getItem(PROGRESS_DELETIONS_KEY)
  )
  const previous = ledger[collection][id]
  const at = Math.max(Date.now(), (previous?.at ?? 0) + 1)
  ledger[collection][id] = { at, deleted: true }
  persistLedger(ledger)
}

export function markProgressItemRestored(collection: ProgressDeletionCollection, id: string): void {
  if (!id) return
  const ledger = parseLedger(
    typeof localStorage === 'undefined' ? null : localStorage.getItem(PROGRESS_DELETIONS_KEY)
  )
  const previous = ledger[collection][id]
  if (!previous?.deleted) return
  ledger[collection][id] = { at: Math.max(Date.now(), previous.at + 1), deleted: false }
  persistLedger(ledger)
}

export function mergeProgressDeletionLedgers(
  localRaw: string | null,
  remoteRaw: string | null
): string {
  const local = parseLedger(localRaw)
  const remote = parseLedger(remoteRaw)
  const merged = emptyLedger()
  for (const collection of ['bookmarks', 'vault'] as const) {
    const ids = new Set([
      ...Object.keys(local[collection]),
      ...Object.keys(remote[collection])
    ])
    for (const id of ids) {
      const l = local[collection][id]
      const r = remote[collection][id]
      if (!l) merged[collection][id] = r
      else if (!r) merged[collection][id] = l
      else if (l.at > r.at) merged[collection][id] = l
      else if (r.at > l.at) merged[collection][id] = r
      else merged[collection][id] = { at: l.at, deleted: l.deleted || r.deleted }
    }
  }
  return JSON.stringify(merged)
}

export function filterProgressCollection(
  raw: string | null,
  ledgerRaw: string | null,
  collection: ProgressDeletionCollection,
  timestampKey: 'savedAt' | 'lastWrongAt'
): string | null {
  if (!raw) return raw
  try {
    const wrapper = JSON.parse(raw) as { state?: Record<string, unknown>; version?: number }
    const state = wrapper.state ?? {}
    const items = Array.isArray(state.items) ? state.items as Record<string, unknown>[] : []
    const ledger = parseLedger(ledgerRaw)
    const kept = items.filter(item => {
      const id = typeof item.id === 'string' ? item.id : ''
      const mutation = id ? ledger[collection][id] : undefined
      if (!mutation?.deleted) return true
      return Number(item[timestampKey] ?? 0) > mutation.at
    })
    return JSON.stringify({ ...wrapper, state: { ...state, items: kept } })
  } catch {
    return raw
  }
}
