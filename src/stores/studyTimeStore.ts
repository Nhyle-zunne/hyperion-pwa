import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { TrackId } from '../types/question';
import type { SessionMode } from './historyStore';

function dayKey(ts = Date.now()) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export interface StudySegment {
  id: string;
  day: string;
  mode: SessionMode;
  track: TrackId | null;
  durationMs: number;
  at: number;
}

interface StudyTimeState {
  segments: StudySegment[];
  addSegment: (opts: {
    mode: SessionMode;
    track: TrackId | null;
    durationMs: number;
    at?: number;
  }) => void;
  clear: () => void;
  todayMs: () => number;
  weekMs: () => number;
  totalMs: () => number;
  byDay: (lastN?: number) => { day: string; ms: number }[];
}

export const useStudyTimeStore = create<StudyTimeState>()(
  persist(
    (set, get) => ({
      segments: [],

      addSegment: ({ mode, track, durationMs, at }) => {
        if (durationMs < 1000) return;
        const ts = at ?? Date.now();
        const seg: StudySegment = {
          id: `st-${ts}-${Math.random().toString(36).slice(2, 7)}`,
          day: dayKey(ts),
          mode,
          track,
          durationMs,
          at: ts
        };
        set({ segments: [seg, ...get().segments].slice(0, 400) });
      },

      clear: () => set({ segments: [] }),

      todayMs: () => {
        const key = dayKey();
        return get()
          .segments.filter((s) => s.day === key)
          .reduce((a, s) => a + s.durationMs, 0);
      },

      weekMs: () => {
        const now = Date.now();
        const weekAgo = now - 7 * 86_400_000;
        return get()
          .segments.filter((s) => s.at >= weekAgo)
          .reduce((a, s) => a + s.durationMs, 0);
      },

      totalMs: () => get().segments.reduce((a, s) => a + s.durationMs, 0),

      byDay: (lastN = 14) => {
        const map = new Map<string, number>();
        for (const s of get().segments) {
          map.set(s.day, (map.get(s.day) || 0) + s.durationMs);
        }
        const days: { day: string; ms: number }[] = [];
        for (let i = 0; i < lastN; i++) {
          const d = new Date(Date.now() - i * 86_400_000);
          const key = dayKey(d.getTime());
          days.push({ day: key, ms: map.get(key) || 0 });
        }
        return days;
      }
    }),
    { name: 'hyperion-study-time' }
  )
);

export function formatDurationMs(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}
