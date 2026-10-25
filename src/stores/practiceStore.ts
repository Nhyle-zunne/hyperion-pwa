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
  timeLimitSec: number;
  timeLeftSec: number;
  streak: number;
  bestStreak: number;

  startSession: (opts: {
    mode: SessionMode;
    track: TrackId;
    competenceId?: string;
    limit?: number;
    timeLimitSec?: number;
    free?: boolean;
    randomizeOrder?: boolean;
    shuffleChoices?: boolean;
    startItem?: number;
    part?: number;
  }) => Promise<void>;
  selectAnswer: (index: number) => void;
  setAnswerSilent: (index: number) => void;
  toggleFlag: () => void;
  goTo: (index: number) => void;
  next: () => void;
  prev: () => void;
  finish: () => void;
  tick: () => void;
  reset: () => void;
  score: () => { correct: number; total: number; percent: number };
  saveProgress: () => void;
  restoreSavedProgress: () => boolean;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function shuffleQuestionChoices(question: Question): Question {
  const options = question.options.map((text, originalIndex) => ({ text, originalIndex }));
  const shuffled = shuffle(options);
  return {
    ...question,
    options: shuffled.map((option) => option.text),
    correctAnswerIndex: shuffled.findIndex((option) => option.originalIndex === question.correctAnswerIndex)
  };
}

function recordHistory(get: () => PracticeState) {
  const s = get();
  if (!s.track || s.questions.length === 0) return;
  let correct = 0;
  for (const q of s.questions) {
    const a = s.answers[q.id];
    if (a?.isCorrect) correct++;
    else if (s.mode === 'MOCK' && a && a.selectedIndex != null && !a.isCorrect) {
      useVaultStore.getState().addMistake(q, a.selectedIndex);
    }
  }
  const total = s.questions.length;
  const percent = total === 0 ? 0 : Math.round((correct / total) * 100);
  const finishedAt = Date.now();
  const durationMs = Math.max(0, finishedAt - (s.startedAt || finishedAt));
  useHistoryStore.getState().removeSavedSession(s.track, s.competenceId);
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

  startSession: async ({ mode, track, competenceId, limit, timeLimitSec, free, randomizeOrder, shuffleChoices, startItem, part }) => {
    const defaultLimit = mode === 'MOCK' ? 30 : mode === 'DRILL' ? 12 : 15;
    const finalLimit = Math.max(1, Math.floor(limit ?? defaultLimit));
    const time = Math.max(0, Math.floor(timeLimitSec ?? (mode === 'MOCK' ? finalLimit * 60 : 0)));

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

      if (track === 'GMDSS_GOC' && part != null) {
        qs = qs.filter((q) => q.id.includes(`-P${part}-`));
      }

      if (qs.length === 0) {
        set({ loading: false, error: 'No questions available for this selection yet.' });
        return;
      }

      // Apply the configured item range first, then optionally randomize only that range.
      const start = Math.max(1, Math.floor(startItem ?? 1)) - 1;
      const range = qs.slice(start, start + finalLimit);
      const selected = randomizeOrder === false ? range : shuffle(range);
      const delivered = shuffleChoices ? selected.map(shuffleQuestionChoices) : selected;

      if (delivered.length === 0) {
        set({ loading: false, error: 'The selected item range contains no questions. Please adjust the range.' });
        return;
      }

      set({
        questions: delivered,
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
    if (mode !== 'MOCK' && answers[q.id]?.selectedIndex != null) return;

    const isCorrect = index === q.correctAnswerIndex;
    let nextStreak = streak;
    let nextBest = bestStreak;
    if (mode === 'DRILL' || mode === 'PRACTICE') {
      nextStreak = isCorrect ? streak + 1 : 0;
      nextBest = Math.max(bestStreak, nextStreak);
      if (!isCorrect) useVaultStore.getState().addMistake(q, index);
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

  setAnswerSilent: (index) => get().selectAnswer(index),

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
    if (currentIndex < questions.length - 1) set({ currentIndex: currentIndex + 1 });
    else if (mode !== 'MOCK') {
      recordHistory(get);
      set({ finished: true });
    }
  },

  prev: () => {
    const { currentIndex, mode } = get();
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
    } else set({ timeLeftSec: next });
  },

  reset: () => {
    const current = get();
    try { localStorage.removeItem('hyperion-saved-practice'); } catch { /* storage can be unavailable */ }
    useHistoryStore.getState().removeSavedSession(current.track, current.competenceId);
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
    })
  },

  saveProgress: () => {
    const { questions, answers, currentIndex, track, competenceId, finished, mode, startedAt, timeLimitSec, timeLeftSec, streak, bestStreak } = get();
    if (!questions.length || !track) return;
    try {
      localStorage.setItem('hyperion-saved-practice', JSON.stringify({ questions, answers, currentIndex, track, competenceId, finished, mode, startedAt, timeLimitSec, timeLeftSec, streak, bestStreak }));
    } catch { /* storage can be unavailable */ }
    if (track && questions.length) {
      useHistoryStore.getState().saveSession({
        mode, track, competenceId,
        currentIndex,
        total: questions.length,
        answered: questions.reduce((count, q) => count + (answers[q.id]?.selectedIndex != null ? 1 : 0), 0),
        savedAt: Date.now()
      });
    }
  },

  restoreSavedProgress: () => {
    try {
      const raw = localStorage.getItem('hyperion-saved-practice');
      if (!raw) return false;
      const saved = JSON.parse(raw);
      if (!Array.isArray(saved.questions) || !saved.questions.length || !saved.track) return false;
      set({ ...saved, loading: false, error: null, currentIndex: Math.min(Math.max(0, saved.currentIndex || 0), saved.questions.length - 1) });
      return true;
    } catch { return false; }
  },

  score: () => {
    const { questions, answers } = get();
    const correct = questions.reduce((count, q) => count + (answers[q.id]?.isCorrect ? 1 : 0), 0);
    const total = questions.length;
    return { correct, total, percent: total === 0 ? 0 : Math.round((correct / total) * 100) };
  }
}));
