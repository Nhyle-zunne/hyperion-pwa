import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { TrackId } from '../types/question';
import type { SessionMode } from './historyStore';

const legacyTargetDate = () => {
  try {
    const value = typeof localStorage !== 'undefined' ? localStorage.getItem('hyperion-target-date') : null;
    return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
  } catch {
    return '';
  }
};

const dayKey = (ts = Date.now()) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const previousDayKey = (dateKey: string) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  date.setDate(date.getDate() - 1);
  return dayKey(date.getTime());
};

export interface StudySegment {
  id: string;
  day: string;
  mode: SessionMode;
  track: TrackId | null;
  durationMs: number;
  /** End timestamp of this segment. Duration is measured backwards from this instant. */
  at: number;
}

interface StudyTimeState {
  segments: StudySegment[];
  /** Consecutive app-open check-in streak; dates are local calendar dates and sync with account progress. */
  dailyCheckInStartDate: string;
  dailyCheckInLastDate: string;
  dailyCheckInCount: number;
  dailyCheckInUpdatedAt: number;
  recordDailyCheckIn: () => void;
  /** Calendar date selected in Study Time, synced through the signed-in account. */
  selectedDate: string;
  selectedDateUpdatedAt: number;
  setSelectedDate: (date: string) => void;
  /** MARINA exam target date from the dashboard, synced between signed-in devices. */
  targetDate: string;
  targetDateUpdatedAt: number;
  setTargetDate: (date: string) => void;
  addSegment: (opts: { mode: SessionMode; track: TrackId | null; durationMs: number; at?: number }) => void;
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
      dailyCheckInStartDate: '',
      dailyCheckInLastDate: '',
      dailyCheckInCount: 0,
      dailyCheckInUpdatedAt: 0,
      recordDailyCheckIn: () => {
        const today = dayKey();
        const current = get();
        // Reopening the app multiple times in one calendar day is one check-in.
        if (current.dailyCheckInLastDate === today && current.dailyCheckInCount > 0) return;

        const continuesStreak = current.dailyCheckInLastDate === previousDayKey(today)
          && current.dailyCheckInStartDate !== ''
          && current.dailyCheckInCount > 0;
        if (continuesStreak) {
          set({
            dailyCheckInLastDate: today,
            dailyCheckInCount: current.dailyCheckInCount + 1,
            dailyCheckInUpdatedAt: Date.now()
          });
        } else {
          // A first visit, or a visit after at least one missed calendar day, starts over at Day 1.
          set({
            dailyCheckInStartDate: today,
            dailyCheckInLastDate: today,
            dailyCheckInCount: 1,
            dailyCheckInUpdatedAt: Date.now()
          });
        }
      },
      selectedDate: dayKey(),
      selectedDateUpdatedAt: 0,
      setSelectedDate: (date) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || get().selectedDate === date) return;
        set({ selectedDate: date, selectedDateUpdatedAt: Date.now() });
      },
      targetDate: legacyTargetDate(),
      targetDateUpdatedAt: 0,
      setTargetDate: (date) => {
        const current = get();
        if ((date !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(date)) || (current.targetDate === date && current.targetDateUpdatedAt > 0)) return;
        try {
          if (date) localStorage.setItem('hyperion-target-date', date);
          else localStorage.removeItem('hyperion-target-date');
        } catch { /* persisted store remains available if legacy storage is restricted */ }
        set({ targetDate: date, targetDateUpdatedAt: Date.now() });
      },
      addSegment: ({ mode, track, durationMs, at }) => {
        if (!Number.isFinite(durationMs) || durationMs < 1000) return;
        const end = Number.isFinite(at) ? (at as number) : Date.now();
        const start = end - Math.floor(durationMs);
        if (!Number.isFinite(start) || end <= start) return;

        // Split a finished session at each local midnight, matching Android telemetry.
        // Each record's end timestamp lets hourly overlap calculations stay exact.
        const created: StudySegment[] = [];
        let cursor = start;
        while (cursor < end) {
          const current = new Date(cursor);
          const nextMidnight = new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1).getTime();
          const partEnd = Math.min(end, nextMidnight);
          const partDuration = partEnd - cursor;
          if (partDuration >= 1000) {
            created.push({
              id: `st-${cursor}-${Math.random().toString(36).slice(2, 9)}`,
              day: dayKey(cursor),
              mode,
              track,
              durationMs: partDuration,
              at: partEnd
            });
          }
          cursor = partEnd;
        }
        if (created.length) set({ segments: [...created.reverse(), ...get().segments].slice(0, 400) });
      },
      clear: () => set({ segments: [] }),
      todayMs: () => {
        const key = dayKey();
        return get().segments.filter(s => s.day === key).reduce((sum, s) => sum + s.durationMs, 0);
      },
      weekMs: () => {
        const now = Date.now();
        const monday = new Date(now);
        monday.setHours(0, 0, 0, 0);
        monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
        const start = monday.getTime();
        return get().segments.filter(s => s.at > start && s.at <= now).reduce((sum, s) => sum + s.durationMs, 0);
      },
      totalMs: () => get().segments.reduce((sum, s) => sum + s.durationMs, 0),
      byDay: (lastN = 14) => {
        const map = new Map<string, number>();
        for (const s of get().segments) map.set(s.day, (map.get(s.day) || 0) + s.durationMs);
        const days: { day: string; ms: number }[] = [];
        for (let i = 0; i < lastN; i++) {
          const d = new Date();
          d.setHours(0, 0, 0, 0);
          d.setDate(d.getDate() - i);
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
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}
