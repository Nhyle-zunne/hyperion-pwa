import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { TrackId } from '../types/question'
import { deleteSessionSnapshot } from '../lib/sessionArchive'

export type SessionMode = 'PRACTICE' | 'DRILL' | 'MOCK'
export type HistoryItemKind = 'entry' | 'saved'
export const HISTORY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

export interface HistoryEntry {
  id: string
  mode: SessionMode
  track: TrackId
  competenceId: string | null
  part?: number | null
  correct: number
  total: number
  answered?: number
  percent: number
  durationMs: number
  startedAt: number
  finishedAt: number
  deletedAt?: number
}

export interface SavedSessionEntry {
  id: string
  mode: SessionMode
  track: TrackId
  competenceId: string | null
  part?: number | null
  currentIndex: number
  total: number
  answered: number
  correct?: number
  startedAt?: number
  savedAt: number
  deletedAt?: number
}

interface HistoryState {
  entries: HistoryEntry[]
  savedSessions: SavedSessionEntry[]
  addEntry: (entry: Omit<HistoryEntry, 'id' | 'deletedAt'> & { id?: string }) => string
  saveSession: (entry: Omit<SavedSessionEntry, 'deletedAt'>) => void
  markDeleted: (kind: HistoryItemKind, id: string) => void
  restoreDeleted: (kind: HistoryItemKind, id: string) => void
  permanentlyDelete: (kind: HistoryItemKind, id: string) => void
  removeSavedSession: (track?: TrackId | null, competenceId?: string | null) => void
  removeSavedSessionById: (id: string) => void
  clear: () => void
  purgeExpiredDeleted: () => void
  stats: () => {
    totalSessions: number
    avgPercent: number
    bestPercent: number
    byMode: Record<SessionMode, number>
  }
}

const isExpired = (deletedAt: number | undefined, now: number) =>
  deletedAt != null && now - deletedAt >= HISTORY_RETENTION_MS

function removeLegacySnapshotIfMatching(
  id: string,
  session?: { kind: HistoryItemKind; track: TrackId; competenceId: string | null; mode: SessionMode }
) {
  try {
    const raw = localStorage.getItem('hyperion-saved-practice')
    if (!raw) return
    const legacy = JSON.parse(raw) as {
      sessionId?: string; track?: TrackId; competenceId?: string | null; mode?: SessionMode
    }
    const sameId = typeof legacy.sessionId === 'string' && legacy.sessionId === id
    const sameLegacySavedSession = session?.kind === 'saved' && !legacy.sessionId &&
      legacy.track === session.track && (legacy.competenceId ?? null) === session.competenceId &&
      legacy.mode === session.mode
    if (sameId || sameLegacySavedSession) localStorage.removeItem('hyperion-saved-practice')
  } catch { /* Storage may be unavailable or contain old data. */ }
}

export const useHistoryStore = create<HistoryState>()(
  persist(
    (set, get) => ({
      entries: [],
      savedSessions: [],

      addEntry: (entry) => {
        const id = entry.id || `h-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const record: HistoryEntry = { ...entry, id }
        set((state) => ({
          entries: [record, ...state.entries.filter((item) => item.id !== id)].slice(0, 200)
        }))
        return id
      },

      saveSession: (entry) => {
        set((state) => {
          const existing = state.savedSessions.find((item) => item.id === entry.id)
          return {
            savedSessions: [
              { ...entry, deletedAt: existing?.deletedAt },
              ...state.savedSessions.filter((item) => item.id !== entry.id)
            ].slice(0, 200)
          }
        })
      },

      markDeleted: (kind, id) => {
        const deletedAt = Date.now()
        set((state) => kind === 'entry'
          ? { entries: state.entries.map((item) => item.id === id ? { ...item, deletedAt: item.deletedAt ?? deletedAt } : item) }
          : { savedSessions: state.savedSessions.map((item) => item.id === id ? { ...item, deletedAt: item.deletedAt ?? deletedAt } : item) })
      },

      restoreDeleted: (kind, id) => {
        set((state) => kind === 'entry'
          ? { entries: state.entries.map((item) => {
              if (item.id !== id) return item
              const restored = { ...item }
              delete restored.deletedAt
              return restored
            }) }
          : { savedSessions: state.savedSessions.map((item) => {
              if (item.id !== id) return item
              const restored = { ...item }
              delete restored.deletedAt
              return restored
            }) })
      },

      permanentlyDelete: (kind, id) => {
        const state = get()
        const entry = kind === 'entry' ? state.entries.find((item) => item.id === id) : undefined
        const saved = kind === 'saved' ? state.savedSessions.find((item) => item.id === id) : undefined
        const session = entry
          ? { kind, track: entry.track, competenceId: entry.competenceId, mode: entry.mode }
          : saved ? { kind, track: saved.track, competenceId: saved.competenceId, mode: saved.mode } : undefined
        removeLegacySnapshotIfMatching(id, session)
        set((current) => kind === 'entry'
          ? { entries: current.entries.filter((item) => item.id !== id) }
          : { savedSessions: current.savedSessions.filter((item) => item.id !== id) })
        void deleteSessionSnapshot(id)
      },

      removeSavedSession: (track, competenceId) => set((state) => ({
        savedSessions: state.savedSessions.filter((item) => {
          if (track == null) return false
          return !(item.track === track && (competenceId === undefined || item.competenceId === competenceId))
        })
      })),

      removeSavedSessionById: (id) => set((state) => ({
        savedSessions: state.savedSessions.filter((item) => item.id !== id)
      })),

      clear: () => {
        const deletedAt = Date.now()
        set((state) => ({
          entries: state.entries.map((item) => item.deletedAt ? item : { ...item, deletedAt }),
          savedSessions: state.savedSessions.map((item) => item.deletedAt ? item : { ...item, deletedAt })
        }))
      },

      purgeExpiredDeleted: () => {
        const now = Date.now()
        const state = get()
        const expiredEntries = state.entries.filter((item) => isExpired(item.deletedAt, now))
        const expiredSaved = state.savedSessions.filter((item) => isExpired(item.deletedAt, now))
        const expiredIds = new Set([...expiredEntries.map((item) => item.id), ...expiredSaved.map((item) => item.id)])
        if (expiredIds.size === 0) return
        expiredEntries.forEach((item) => removeLegacySnapshotIfMatching(item.id, {
          kind: 'entry', track: item.track, competenceId: item.competenceId, mode: item.mode
        }))
        expiredSaved.forEach((item) => removeLegacySnapshotIfMatching(item.id, {
          kind: 'saved', track: item.track, competenceId: item.competenceId, mode: item.mode
        }))
        set((current) => ({
          entries: current.entries.filter((item) => !isExpired(item.deletedAt, now)),
          savedSessions: current.savedSessions.filter((item) => !isExpired(item.deletedAt, now))
        }))
        expiredIds.forEach((id) => {
          const stillExists = get().entries.some((item) => item.id === id) || get().savedSessions.some((item) => item.id === id)
          if (!stillExists) void deleteSessionSnapshot(id)
        })
      },

      stats: () => {
        const entries = get().entries.filter((entry) => !entry.deletedAt)
        if (entries.length === 0) {
          return {
            totalSessions: 0,
            avgPercent: 0,
            bestPercent: 0,
            byMode: { PRACTICE: 0, DRILL: 0, MOCK: 0 }
          }
        }
        const sum = entries.reduce((total, entry) => total + entry.percent, 0)
        const best = Math.max(...entries.map((entry) => entry.percent))
        const byMode: Record<SessionMode, number> = { PRACTICE: 0, DRILL: 0, MOCK: 0 }
        for (const entry of entries) byMode[entry.mode]++
        return {
          totalSessions: entries.length,
          avgPercent: Math.round(sum / entries.length),
          bestPercent: best,
          byMode
        }
      }
    }),
    { name: 'hyperion-history' }
  )
)
