import { create } from 'zustand';
import type { Question, UserAnswer, TrackId } from '../types/question';
import { authorizeQuestionSetAccess, getQuestionsByCompetence } from '../lib/questionBank';
import { useLicenseStore } from './licenseStore';
import { useHistoryStore, type SessionMode } from './historyStore';
import { useVaultStore } from './vaultStore';
import { useStudyTimeStore } from './studyTimeStore';
import { deleteSessionSnapshot, getSessionSnapshot, saveSessionSnapshot, type SessionSnapshot } from '../lib/sessionArchive';

interface PracticeState {
  questions: Question[];
  answers: Record<string, UserAnswer>;
  currentIndex: number;
  loading: boolean;
  error: string | null;
  track: TrackId | null;
  competenceId: string | null;
  part: number | null;
  isFreeSession: boolean;
  sessionId: string | null;
  finished: boolean;
  mode: SessionMode;
  startedAt: number;
  timeLimitSec: number;
  timeLeftSec: number;
  streak: number;
  bestStreak: number;

  startCustomSession: (opts: { questions: Question[]; track: TrackId; competenceId?: string | null }) => Promise<boolean>;
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
  selectMockAnswer: (questionId: string, index: number) => void;
  setAnswerSilent: (index: number) => void;
  toggleFlag: () => void;
  goTo: (index: number) => void;
  next: () => void;
  prev: () => void;
  finish: () => void;
  tick: () => void;
  reset: () => void;
  score: () => { correct: number; total: number; percent: number };
  saveProgress: () => Promise<boolean>;
  restoreSavedProgress: (sessionId?: string) => Promise<boolean>;
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

function makeSessionId() {
  return 'session-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
}

const LEGACY_SAVED_PRACTICE_KEY = 'hyperion-saved-practice'
let legacySavedPracticeMigration: Promise<void> | null = null

async function migrateLegacyLocalStorageSavedPractice(): Promise<void> {
  if (!legacySavedPracticeMigration) {
    legacySavedPracticeMigration = (async () => {
      let raw: string | null
      try {
        raw = localStorage.getItem(LEGACY_SAVED_PRACTICE_KEY)
      } catch {
        return
      }
      if (!raw) return

      let saved: Partial<SessionSnapshot> & { questions?: Question[]; track?: TrackId; sessionId?: string }
      try {
        saved = JSON.parse(raw)
      } catch {
        try { localStorage.removeItem(LEGACY_SAVED_PRACTICE_KEY) } catch { /* storage can be unavailable */ }
        return
      }

      if (!Array.isArray(saved.questions) || saved.questions.length === 0 || typeof saved.track !== 'string') {
        try { localStorage.removeItem(LEGACY_SAVED_PRACTICE_KEY) } catch { /* storage can be unavailable */ }
        return
      }

      try {
        const sessionId = typeof saved.sessionId === 'string' && saved.sessionId ? saved.sessionId : makeSessionId()
        const snapshot: SessionSnapshot = {
          sessionId,
          questions: saved.questions,
          answers: saved.answers ?? {},
          currentIndex: Math.min(Math.max(0, saved.currentIndex ?? 0), saved.questions.length - 1),
          track: saved.track,
          competenceId: saved.competenceId ?? null,
          part: saved.part ?? null,
          mode: saved.mode ?? 'PRACTICE',
          isFreeSession: saved.isFreeSession === true,
          startedAt: saved.startedAt ?? Date.now(),
          timeLimitSec: saved.timeLimitSec ?? 0,
          timeLeftSec: saved.timeLeftSec ?? 0,
          streak: saved.streak ?? 0,
          bestStreak: saved.bestStreak ?? 0,
          finished: false
        }

        // Prefer an existing encrypted archive entry for this session if present.
        const existing = await getSessionSnapshot(sessionId)
        const migratedSnapshot = existing ?? snapshot
        if (!existing) await saveSessionSnapshot(sessionId, snapshot)

        const answered = migratedSnapshot.questions.reduce((count, question) =>
          count + (migratedSnapshot.answers[question.id]?.selectedIndex != null ? 1 : 0), 0)
        const correct = migratedSnapshot.questions.reduce((count, question) =>
          count + (migratedSnapshot.answers[question.id]?.isCorrect ? 1 : 0), 0)
        if (!migratedSnapshot.finished) {
          useHistoryStore.getState().saveSession({
            id: sessionId,
            mode: migratedSnapshot.mode,
            track: migratedSnapshot.track,
            competenceId: migratedSnapshot.competenceId,
            part: migratedSnapshot.part,
            currentIndex: migratedSnapshot.currentIndex,
            total: migratedSnapshot.questions.length,
            answered,
            correct,
            startedAt: migratedSnapshot.startedAt,
            savedAt: Date.now(),
            isFreeSession: migratedSnapshot.isFreeSession
          })
        }
        // Remove the legacy cleartext copy only after encrypted storage is confirmed.
        localStorage.removeItem(LEGACY_SAVED_PRACTICE_KEY)
      } catch {
        // Retain the old copy for a later migration attempt, but never load it directly.
      }
    })().finally(() => {
      legacySavedPracticeMigration = null
    })
  }
  await legacySavedPracticeMigration
}

function snapshotFromState(s: PracticeState, finished = s.finished): SessionSnapshot | null {
  if (!s.sessionId || !s.track || s.questions.length === 0) return null;
  return {
    sessionId: s.sessionId, questions: s.questions, answers: s.answers,
    currentIndex: s.currentIndex, track: s.track, competenceId: s.competenceId,
    part: s.part, mode: s.mode, isFreeSession: s.isFreeSession, startedAt: s.startedAt,
    timeLimitSec: s.timeLimitSec, timeLeftSec: s.timeLeftSec,
    streak: s.streak, bestStreak: s.bestStreak, finished
  };
}

function persistActiveSession(s: PracticeState) {
  const snapshot = snapshotFromState(s, false);
  if (!snapshot || s.finished) return;
  const answered = s.questions.reduce((count, q) => count + (s.answers[q.id]?.selectedIndex != null ? 1 : 0), 0);
  const correct = s.questions.reduce((count, q) => count + (s.answers[q.id]?.isCorrect ? 1 : 0), 0);

  // Write the encrypted question snapshot first; only advertise a resumable History row
  // after IndexedDB confirms the write succeeded.
  void saveSessionSnapshot(snapshot.sessionId, snapshot).then(() => {
    const latest = usePracticeStore.getState();
    // Avoid resurrecting a History row after this session was reset or finished while saving.
    if (latest.sessionId !== snapshot.sessionId || latest.finished || latest.questions.length === 0) return;
    useHistoryStore.getState().saveSession({
      id: snapshot.sessionId,
      mode: s.mode,
      track: s.track!,
      competenceId: s.competenceId,
      part: s.part,
      currentIndex: s.currentIndex,
      total: s.questions.length,
      answered,
      correct,
      startedAt: s.startedAt,
      savedAt: Date.now(),
      isFreeSession: s.isFreeSession
    });
  }).catch(() => {
    // Do not create a History entry when the encrypted question snapshot could not be stored.
  });
}

function recordHistory(get: () => PracticeState) {
  const s = get();
  if (!s.track || s.questions.length === 0) return;
  let correct = 0;
  for (const q of s.questions) {
    const answer = s.answers[q.id];
    if (answer?.isCorrect) correct++;
    else if (s.mode === 'MOCK' && answer && answer.selectedIndex != null && !answer.isCorrect) {
      useVaultStore.getState().addMistake(q, answer.selectedIndex, s.isFreeSession);
    }
  }
  const total = s.questions.length;
  const answered = s.questions.reduce((count, q) => count + (s.answers[q.id]?.selectedIndex != null ? 1 : 0), 0);
  const percent = total === 0 ? 0 : Math.round((correct / total) * 100);
  const finishedAt = Date.now();
  const startedAt = s.startedAt || finishedAt;
  const durationMs = Math.max(0, finishedAt - startedAt);
  const sessionId = s.sessionId || makeSessionId();
  const snapshot = snapshotFromState({
    ...s,
    sessionId,
    timeLeftSec: s.mode === 'MOCK' && s.timeLeftSec <= 1 ? 0 : s.timeLeftSec
  }, true);

  useHistoryStore.getState().removeSavedSessionById(sessionId);
  const historyId = useHistoryStore.getState().addEntry({
    id: sessionId, mode: s.mode, track: s.track, competenceId: s.competenceId,
    part: s.part, isFreeSession: s.isFreeSession, correct, total, answered, percent, durationMs, startedAt, finishedAt
  });
  if (snapshot) void saveSessionSnapshot(historyId, { ...snapshot, sessionId: historyId, finished: true }).catch(() => undefined);

  try {
    const raw = localStorage.getItem('hyperion-saved-practice');
    if (raw) {
      const legacy = JSON.parse(raw) as { sessionId?: string; track?: TrackId; competenceId?: string | null; mode?: SessionMode };
      if (legacy.sessionId === sessionId || (!legacy.sessionId && legacy.track === s.track && legacy.competenceId === s.competenceId && legacy.mode === s.mode)) {
        localStorage.removeItem('hyperion-saved-practice');
      }
    }
  } catch { /* storage may be unavailable or contain an older payload */ }

  useStudyTimeStore.getState().addSegment({ mode: s.mode, track: s.track, durationMs, at: finishedAt });
}

export const usePracticeStore = create<PracticeState>((set, get) => ({
  questions: [],
  answers: {},
  currentIndex: 0,
  loading: false,
  error: null,
  track: null,
  competenceId: null,
  part: null,
  isFreeSession: false,
  sessionId: null,
  finished: false,
  mode: 'PRACTICE',
  startedAt: 0,
  timeLimitSec: 0,
  timeLeftSec: 0,
  streak: 0,
  bestStreak: 0,

  startCustomSession: async ({ questions, track, competenceId }) => {
    if (questions.length === 0) return false;
    await useLicenseStore.getState().refreshCloudEntitlements();
    const access = await authorizeQuestionSetAccess(track, questions);
    if (!access) {
      set({ loading: false, error: 'These saved questions are no longer available for this account. Renew the track license or use the free reviewer sample.' });
      return false;
    }
    const selected = shuffle(questions);
    const startedAt = Date.now();
    const sessionId = makeSessionId();
    set({
      questions: selected,
      answers: {},
      currentIndex: 0,
      loading: false,
      error: null,
      track,
      competenceId: competenceId ?? null,
      part: null,
      isFreeSession: access === 'free-sample',
      sessionId,
      finished: false,
      mode: 'PRACTICE',
      startedAt,
      timeLimitSec: 0,
      timeLeftSec: 0,
      streak: 0,
      bestStreak: 0
    });
    persistActiveSession(get());
    return true;
  },

  startSession: async ({ mode, track, competenceId, limit, timeLimitSec, free, randomizeOrder, shuffleChoices, startItem, part }) => {
    const defaultLimit = mode === 'MOCK' ? 30 : mode === 'DRILL' ? 12 : 15;
    const finalLimit = Math.max(1, Math.floor(limit ?? defaultLimit));
    const time = Math.max(0, Math.floor(timeLimitSec ?? (mode === 'MOCK' ? finalLimit * 60 : 0)));
    const sessionId = makeSessionId();
    const startedAt = Date.now();

    set({
      loading: true, error: null, finished: false, questions: [], answers: {}, currentIndex: 0,
      track, competenceId: competenceId ?? null, part: part ?? null, isFreeSession: false, sessionId, mode,
      streak: 0, bestStreak: 0, timeLimitSec: time, timeLeftSec: time, startedAt
    });

    try {
      await useLicenseStore.getState().refreshCloudEntitlements();
      const lic = useLicenseStore.getState();
      const licensed = lic.isAllAccessUnlocked || lic.cloudTrackIds.includes('ALL') || lic.isTrackUnlocked(track);
      // Only the explicitly launched Free Reviewer may use a free pool in PRACTICE mode.
      // Drill and full Practice All Questions always require an active track entitlement.
      const isFreeReviewerSession = mode === 'PRACTICE' && free === true;
      if (mode !== 'MOCK' && !licensed && !isFreeReviewerSession) {
        set({
          loading: false,
          sessionId: null,
          questions: [],
          isFreeSession: false,
          error: 'An active license is required for Practice All Questions and Drill. Use Free Reviewer or Timed Mock Exam for free access.'
        });
        return;
      }
      const isFreeSession = mode === 'MOCK' ? !licensed : isFreeReviewerSession;
      if (!competenceId) {
        set({ loading: false, sessionId: null, questions: [], error: 'Select a competence before starting practice.' });
        return;
      }
      const itemStart = Math.max(1, Math.floor(startItem ?? 1));
      const qs = await getQuestionsByCompetence(
        track,
        competenceId,
        part,
        isFreeSession,
        mode === 'MOCK' ? 1 : itemStart,
        finalLimit,
        mode === 'MOCK'
      );

      if (mode === 'MOCK' && qs.length < finalLimit) {
        set({
          loading: false,
          error: `This mock competence requires ${finalLimit} questions, but only ${qs.length} are available in your authorized question pool. The exam was not shortened. Please refresh the question bank or contact support.`,
          sessionId: null,
          questions: []
        });
        return;
      }

      if (qs.length === 0) {
        set({ loading: false, error: 'No questions available for this selection yet.', sessionId: null, questions: [] });
        return;
      }

      // Mock exams always draw a random sample from the entire selected competence
      // pool, then shuffle every question's choices. This keeps the exam independent
      // of CSV ordering and prevents the sample from always coming from the first rows.
      let selected: Question[];
      let delivered: Question[];
      if (mode === 'MOCK') {
        selected = shuffle(qs).slice(0, finalLimit);
        delivered = selected.map(shuffleQuestionChoices);
      } else {
        // Practice modes retain their configured item range and optional shuffling.
        const range = qs;
        selected = randomizeOrder === false ? range : shuffle(range);
        delivered = shuffleChoices ? selected.map(shuffleQuestionChoices) : selected;
      }

      if (delivered.length === 0) {
        set({ loading: false, error: 'The selected item range contains no questions. Please adjust the range.', sessionId: null, questions: [] });
        return;
      }

      set({ questions: delivered, track, competenceId: competenceId ?? null, part: part ?? null, isFreeSession, sessionId, loading: false, startedAt });
      persistActiveSession(get());
    } catch {
      set({ loading: false, error: 'Failed to load questions.' });
    }
  },

  selectAnswer: (index) => {
    const { questions, currentIndex, answers, mode, streak, bestStreak, isFreeSession } = get();
    const q = questions[currentIndex];
    if (!q) return;
    if (mode !== 'MOCK' && answers[q.id]?.selectedIndex != null) return;

    const isCorrect = index === q.correctAnswerIndex;
    let nextStreak = streak;
    let nextBest = bestStreak;
    if (mode === 'DRILL' || mode === 'PRACTICE') {
      nextStreak = isCorrect ? streak + 1 : 0;
      nextBest = Math.max(bestStreak, nextStreak);
      if (!isCorrect) useVaultStore.getState().addMistake(q, index, isFreeSession);
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
    persistActiveSession(get());
  },

  // Continuous-scroll mock exams must save each choice by the question being clicked,
  // not by currentIndex (which belongs to the single-question practice layout).
  selectMockAnswer: (questionId, index) => {
    const { questions, answers, mode, finished } = get();
    if (mode !== 'MOCK' || finished) return;
    const question = questions.find((item) => item.id === questionId);
    if (!question || index < 0 || index >= question.options.length) return;

    set({
      answers: {
        ...answers,
        [question.id]: {
          questionId: question.id,
          selectedIndex: index,
          isCorrect: index === question.correctAnswerIndex,
          isFlagged: answers[question.id]?.isFlagged ?? false
        }
      }
    });
    persistActiveSession(get());
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
    persistActiveSession(get());
  },

  goTo: (index) => {
    const { questions } = get();
    if (index >= 0 && index < questions.length) {
      set({ currentIndex: index });
      persistActiveSession(get());
    }
  },

  next: () => {
    const { currentIndex, questions, finished } = get();
    if (finished) return;
    if (currentIndex < questions.length - 1) {
      set({ currentIndex: currentIndex + 1 });
      persistActiveSession(get());
    } else {
      recordHistory(get);
      set({ finished: true });
    }
  },

  prev: () => {
    const { currentIndex, mode } = get();
    if (mode === 'DRILL') return;
    if (currentIndex > 0) {
      set({ currentIndex: currentIndex - 1 });
      persistActiveSession(get());
    }
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
      set({ timeLeftSec: 0 });
      recordHistory(get);
      set({ finished: true });
    } else {
      set({ timeLeftSec: next });
      if (next % 15 === 0) persistActiveSession(get());
    }
  },

  reset: () => {
    const current = get();
    const history = useHistoryStore.getState();
    if (current.sessionId) {
      history.removeSavedSessionById(current.sessionId);
      const alreadyCompleted = history.entries.some((entry) => entry.id === current.sessionId);
      if (!alreadyCompleted) void deleteSessionSnapshot(current.sessionId);
    }
    try {
      const raw = localStorage.getItem('hyperion-saved-practice');
      if (raw) {
        const legacy = JSON.parse(raw) as { sessionId?: string; track?: TrackId; competenceId?: string | null; mode?: SessionMode };
        if (legacy.sessionId === current.sessionId || (!legacy.sessionId && legacy.track === current.track && legacy.competenceId === current.competenceId && legacy.mode === current.mode)) {
          localStorage.removeItem('hyperion-saved-practice');
        }
      }
    } catch { /* storage can be unavailable */ }
    set({
      questions: [], answers: {}, currentIndex: 0, loading: false, error: null,
      track: null, competenceId: null, part: null, isFreeSession: false, sessionId: null, finished: false,
      mode: 'PRACTICE', startedAt: 0, timeLimitSec: 0, timeLeftSec: 0, streak: 0, bestStreak: 0
    });
  },

  saveProgress: async () => {
    const current = get();
    const snapshot = snapshotFromState(current, false);
    if (!snapshot || !current.track) return false;

    try {
      // Save and confirm the question-bearing snapshot before advertising a resumable History entry.
      await saveSessionSnapshot(snapshot.sessionId, snapshot);
    } catch {
      return false;
    }

    const answered = current.questions.reduce(
      (count, question) => count + (current.answers[question.id]?.selectedIndex != null ? 1 : 0),
      0
    );
    const correct = current.questions.reduce(
      (count, question) => count + (current.answers[question.id]?.isCorrect ? 1 : 0),
      0
    );
    try {
      useHistoryStore.getState().saveSession({
        id: snapshot.sessionId,
        mode: current.mode,
        track: current.track,
        competenceId: current.competenceId,
        part: current.part,
        currentIndex: current.currentIndex,
        total: current.questions.length,
        answered,
        correct,
        startedAt: current.startedAt,
        savedAt: Date.now(),
        isFreeSession: current.isFreeSession
      });
    } catch {
      await deleteSessionSnapshot(snapshot.sessionId).catch(() => undefined);
      return false;
    }

    window.dispatchEvent(new Event('hyperion:practice-progress-saved'));
    return true;
  },

  restoreSavedProgress: async (requestedSessionId) => {
    await migrateLegacyLocalStorageSavedPractice();
    const historyState = useHistoryStore.getState();
    const selectedSaved = requestedSessionId
      ? historyState.savedSessions.find((item) => item.id === requestedSessionId && !item.deletedAt)
      : historyState.savedSessions.filter((item) => !item.deletedAt).sort((a, b) => b.savedAt - a.savedAt)[0];

    set({ loading: true, error: null });
    if (selectedSaved) {
      const snapshot = await getSessionSnapshot(selectedSaved.id);
      if (snapshot && snapshot.questions.length > 0 && snapshot.track) {
        // A full entitlement refresh makes multiple network requests and can stall
        // indefinitely while Airplane Mode is enabled. Offline authorization below
        // verifies the signed local lease; online authorization is checked directly
        // by the protected question-bank endpoint.
        if (typeof navigator === 'undefined' || navigator.onLine !== false) {
          await useLicenseStore.getState().refreshCloudEntitlements();
        }
        const access = await authorizeQuestionSetAccess(snapshot.track, snapshot.questions);
        if (!access) {
          set({ questions: [], answers: {}, currentIndex: 0, track: null, competenceId: null, part: null, isFreeSession: false, sessionId: null, loading: false, error: 'These saved questions require an active license unless they are part of the free reviewer sample.' });
          return false;
        }
        set({
          ...snapshot,
          sessionId: selectedSaved.id,
          isFreeSession: access === 'free-sample',
          loading: false,
          error: null,
          finished: false,
          currentIndex: Math.min(Math.max(0, snapshot.currentIndex || 0), snapshot.questions.length - 1)
        });
        persistActiveSession(get());
        return true;
      }
    }

    set({ loading: false, error: 'The saved question snapshot is unavailable. Start a new session to continue.' });
    return false;
  },

  score: () => {
    const { questions, answers } = get();
    const correct = questions.reduce((count, q) => count + (answers[q.id]?.isCorrect ? 1 : 0), 0);
    const total = questions.length;
    return { correct, total, percent: total === 0 ? 0 : Math.round((correct / total) * 100) };
  }
}));
