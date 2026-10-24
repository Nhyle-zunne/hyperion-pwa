import { create } from 'zustand';
import type { Question, UserAnswer, TrackId } from '../types/question';
import { getQuestionsByCompetence, getQuestionsByTrack, freeSample } from '../lib/questionBank';
import { useLicenseStore } from './licenseStore';
import { useHistoryStore, type SessionMode } from './historyStore';
import { useVaultStore } from './vaultStore';
import { useStudyTimeStore } from './studyTimeStore';

interface PracticeState {
  questions: Question[];
  answers: Record<string, UserAnswer>;
  currentIndex: number;
  loading: boolean;
  error: string | null;
  track: TrackId | null;
  competenceId: string | null;
  finished: boolean;
  mode: SessionMode;
  startedAt: number;
  // Mock-only: time limit in seconds (0 = none)
  timeLimitSec: number;
  timeLeftSec: number;
  // Drill streak of consecutive correct
  streak: number;
  bestStreak: number;

  startSession: (opts: {
    mode: SessionMode;
    track: TrackId;
    competenceId?: string;
    limit?: number;
    timeLimitSec?: number;
    /** Force the FREE ACCESS sample even when the track is licensed */
    free?: boolean;
  }) => Promise<void>;
  selectAnswer: (index: number) => void;
  /** Mock: answer without revealing correctness UI still stores it */
  setAnswerSilent: (index: number) => void;
  toggleFlag: () => void;
  goTo: (index: number) => void;
  next: () => void;
  prev: () => void;
  finish: () => void;
  tick: () => void;
  reset: () => void;
  score: () => { correct: number; total: number; percent: number };
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function recordHistory(get: () => PracticeState) {
  const s = get();
  if (!s.track || s.questions.length === 0) return;
  let correct = 0;
  for (const q of s.questions) {
    const a = s.answers[q.id];
    if (a?.isCorrect) correct++;
    // Practice/Drill already record on wrong answer; Mock records on submit
    else if (s.mode === 'MOCK' && a && a.selectedIndex != null && !a.isCorrect) {
      useVaultStore.getState().addMistake(q, a.selectedIndex);
    }
  }
  const total = s.questions.length;
  const percent = total === 0 ? 0 : Math.round((correct / total) * 100);
  const finishedAt = Date.now();
  const durationMs = Math.max(0, finishedAt - (s.startedAt || finishedAt));
  useHistoryStore.getState().addEntry({
    mode: s.mode,
    track: s.track,
    competenceId: s.competenceId,
    correct,
    total,
    percent,
    durationMs,
    startedAt: s.startedAt || finishedAt,
    finishedAt
  });
  useStudyTimeStore.getState().addSegment({
    mode: s.mode,
    track: s.track,
    durationMs,
    at: finishedAt
  });
}

export const usePracticeStore = create<PracticeState>((set, get) => ({
  questions: [],
  answers: {},
  currentIndex: 0,
  loading: false,
  error: null,
  track: null,
  competenceId: null,
  finished: false,
  mode: 'PRACTICE',
  startedAt: 0,
  timeLimitSec: 0,
  timeLeftSec: 0,
  streak: 0,
  bestStreak: 0,

  startSession: async ({ mode, track, competenceId, limit, timeLimitSec, free }) => {
    const defaultLimit = mode === 'MOCK' ? 30 : mode === 'DRILL' ? 12 : 15;
    const finalLimit = limit ?? defaultLimit;
    const time =
      timeLimitSec ??
      (mode === 'MOCK' ? finalLimit * 60 : 0); // 1 min per question for mock default

    set({
      loading: true,
      error: null,
      finished: false,
      answers: {},
      currentIndex: 0,
      mode,
      streak: 0,
      bestStreak: 0,
      timeLimitSec: time,
      timeLeftSec: time,
      startedAt: Date.now()
    });

    try {
      // FREE ACCESS: without a license for this track (or when asked), only the free sample is served
      const lic = useLicenseStore.getState();
      const licensed = lic.isAllAccessUnlocked || lic.isTrackUnlocked(track);
      let qs: Question[];
      if (free || !licensed) {
        const sample = freeSample(await getQuestionsByTrack(track), track);
        qs = competenceId ? sample.filter((q) => q.competenceId === competenceId) : sample;
      } else {
        qs = competenceId
          ? await getQuestionsByCompetence(track, competenceId)
          : await getQuestionsByTrack(track);
      }

      if (qs.length === 0) {
        set({ loading: false, error: 'No questions available for this selection yet.' });
        return;
      }

      qs = shuffle(qs).slice(0, Math.min(finalLimit, qs.length));
      set({
        questions: qs,
        track,
        competenceId: competenceId ?? null,
        loading: false,
        startedAt: Date.now()
      });
    } catch {
      set({ loading: false, error: 'Failed to load questions.' });
    }
  },

  selectAnswer: (index) => {
    const { questions, currentIndex, answers, mode, streak, bestStreak } = get();
    const q = questions[currentIndex];
    if (!q) return;
    // In mock mode answers can be changed until submit
    if (mode !== 'MOCK' && answers[q.id]?.selectedIndex != null) return;

    const isCorrect = index === q.correctAnswerIndex;
    let nextStreak = streak;
    let nextBest = bestStreak;
    if (mode === 'DRILL' || mode === 'PRACTICE') {
      nextStreak = isCorrect ? streak + 1 : 0;
      nextBest = Math.max(bestStreak, nextStreak);
      if (!isCorrect) {
        useVaultStore.getState().addMistake(q, index);
      }
    }

    set({
      answers: {
        ...answers,
        [q.id]: {
          questionId: q.id,
          selectedIndex: index,
          isCorrect,
          isFlagged: answers[q.id]?.isFlagged ?? false
        }
      },
      streak: nextStreak,
      bestStreak: nextBest
    });
  },

  setAnswerSilent: (index) => {
    get().selectAnswer(index);
  },

  toggleFlag: () => {
    const { questions, currentIndex, answers } = get();
    const q = questions[currentIndex];
    if (!q) return;
    const prev = answers[q.id];
    set({
      answers: {
        ...answers,
        [q.id]: {
          questionId: q.id,
          selectedIndex: prev?.selectedIndex ?? null,
          isCorrect: prev?.isCorrect ?? false,
          isFlagged: !(prev?.isFlagged ?? false)
        }
      }
    });
  },

  goTo: (index) => {
    const { questions } = get();
    if (index >= 0 && index < questions.length) set({ currentIndex: index });
  },

  next: () => {
    const { currentIndex, questions, mode, finished } = get();
    if (finished) return;
    if (currentIndex < questions.length - 1) {
      set({ currentIndex: currentIndex + 1 });
    } else if (mode !== 'MOCK') {
      // Auto-finish practice/drill on last next
      recordHistory(get);
      set({ finished: true });
    }
  },

  prev: () => {
    const { currentIndex, mode } = get();
    // Drill is forward-only
    if (mode === 'DRILL') return;
    if (currentIndex > 0) set({ currentIndex: currentIndex - 1 });
  },

  finish: () => {
    if (get().finished) return;
    recordHistory(get);
    set({ finished: true });
  },

  tick: () => {
    const { timeLeftSec, finished, mode } = get();
    if (finished || mode !== 'MOCK' || timeLeftSec <= 0) return;
    const next = timeLeftSec - 1;
    if (next <= 0) {
      recordHistory(get);
      set({ timeLeftSec: 0, finished: true });
    } else {
      set({ timeLeftSec: next });
    }
  },

  reset: () =>
    set({
      questions: [],
      answers: {},
      currentIndex: 0,
      loading: false,
      error: null,
      track: null,
      competenceId: null,
      finished: false,
      mode: 'PRACTICE',
      startedAt: 0,
      timeLimitSec: 0,
      timeLeftSec: 0,
      streak: 0,
      bestStreak: 0
    }),

  score: () => {
    const { questions, answers } = get();
    let correct = 0;
    for (const q of questions) {
      if (answers[q.id]?.isCorrect) correct++;
    }
    const total = questions.length;
    return {
      correct,
      total,
      percent: total === 0 ? 0 : Math.round((correct / total) * 100)
    };
  }
}));
