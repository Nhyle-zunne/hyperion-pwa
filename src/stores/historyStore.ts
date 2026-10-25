import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { TrackId } from '../types/question';

export type SessionMode = 'PRACTICE' | 'DRILL' | 'MOCK';

export interface HistoryEntry {
  id: string;
  mode: SessionMode;
  track: TrackId;
  competenceId: string | null;
  correct: number;
  total: number;
  percent: number;
  durationMs: number;
  startedAt: number;
  finishedAt: number;
}

export interface SavedSessionEntry {
  id: string;
  mode: SessionMode;
  track: TrackId;
  competenceId: string | null;
  currentIndex: number;
  total: number;
  answered: number;
  savedAt: number;
}

interface HistoryState {
  entries: HistoryEntry[];
  savedSessions: SavedSessionEntry[];
  addEntry: (entry: Omit<HistoryEntry, 'id'>) => void;
  saveSession: (entry: Omit<SavedSessionEntry, 'id'>) => void;
  removeSavedSession: (track?: TrackId | null, competenceId?: string | null) => void;
  clear: () => void;
  stats: () => {
    totalSessions: number;
    avgPercent: number;
    bestPercent: number;
    byMode: Record<SessionMode, number>;
  };
}

export const useHistoryStore = create<HistoryState>()(
  persist(
    (set, get) => ({
      entries: [],
      savedSessions: [],

      addEntry: (entry) => {
        const id = `h-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        set((s) => ({
          entries: [{ ...entry, id }, ...s.entries].slice(0, 100)
        }));
      },

      saveSession: (entry) => {
        const id = `saved-${entry.track}-${entry.competenceId ?? 'all'}-${entry.mode}`;
        set((s) => ({
          savedSessions: [{ ...entry, id }, ...s.savedSessions.filter((item) => item.id !== id)].slice(0, 100)
        }));
      },

      removeSavedSession: (track, competenceId) => set((s) => ({
        savedSessions: s.savedSessions.filter((item) => {
          if (track == null) return false;
          return !(item.track === track && (competenceId === undefined || item.competenceId === competenceId));
        })
      })),

      clear: () => set({ entries: [], savedSessions: [] }),

      stats: () => {
        const entries = get().entries;
        if (entries.length === 0) {
          return {
            totalSessions: 0,
            avgPercent: 0,
            bestPercent: 0,
            byMode: { PRACTICE: 0, DRILL: 0, MOCK: 0 }
          };
        }
        const sum = entries.reduce((a, e) => a + e.percent, 0);
        const best = Math.max(...entries.map((e) => e.percent));
        const byMode: Record<SessionMode, number> = { PRACTICE: 0, DRILL: 0, MOCK: 0 };
        for (const e of entries) byMode[e.mode]++;
        return {
          totalSessions: entries.length,
          avgPercent: Math.round(sum / entries.length),
          bestPercent: best,
          byMode
        };
      }
    }),
    { name: 'hyperion-history' }
  )
);
