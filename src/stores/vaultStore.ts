import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { encryptedPersistStorage } from '../lib/encryptedPersistStorage';
import { markProgressItemDeleted, markProgressItemRestored } from '../lib/progressDeletionLedger';
import type { Question, TrackId } from '../types/question';

export interface VaultItem {
  id: string;
  track: TrackId;
  functionId: string;
  competenceId: string;
  topic: string;
  questionText: string;
  options: string[];
  correctAnswerIndex: number;
  explanation: string;
  difficulty: string;
  wrongCount: number;
  consecutiveCorrect: number;
  lastWrongAt: number;
  lastSelectedIndex: number | null;
  /** True only when this mistake was saved from a permitted free reviewer/mock pool. */
  isFreeSession?: boolean;
}

interface VaultState {
  items: VaultItem[];
  addMistake: (q: Question, selectedIndex: number | null, isFreeSession?: boolean) => void;
  recordCorrectAttempt: (questionId: string, requiredPasses?: number) => void;
  purgePaidForTracks: (tracks: TrackId[]) => void;
  remove: (id: string) => void;
  clear: () => void;
  asQuestions: () => Question[];
}

export const useVaultStore = create<VaultState>()(
  persist(
    (set, get) => ({
      items: [],

      addMistake: (q, selectedIndex, isFreeSession = false) => {
        markProgressItemRestored('vault', q.id);
        const existing = get().items.find((i) => i.id === q.id);
        if (existing) {
          set({
            items: get().items.map((i) =>
              i.id === q.id
                ? {
                    ...i,
                    wrongCount: i.wrongCount + 1,
                    consecutiveCorrect: 0,
                    lastWrongAt: Date.now(),
                    lastSelectedIndex: selectedIndex,
                    isFreeSession: i.isFreeSession === true || isFreeSession === true
                  }
                : i
            )
          });
          return;
        }
        const entry: VaultItem = {
          id: q.id,
          track: q.track,
          functionId: q.functionId,
          competenceId: q.competenceId,
          topic: q.topic,
          questionText: q.questionText,
          options: q.options,
          correctAnswerIndex: q.correctAnswerIndex,
          explanation: q.explanation,
          difficulty: q.difficulty,
          wrongCount: 1,
          consecutiveCorrect: 0,
          lastWrongAt: Date.now(),
          lastSelectedIndex: selectedIndex,
          isFreeSession: isFreeSession === true
        };
        set({ items: [entry, ...get().items].slice(0, 500) });
      },

      recordCorrectAttempt: (questionId, requiredPasses = 2) => {
        const threshold = Math.min(5, Math.max(1, Math.floor(requiredPasses)));
        const existing = get().items.find(item => item.id === questionId);
        if (!existing) return;
        const next = (existing.consecutiveCorrect || 0) + 1;
        if (next >= threshold) {
          markProgressItemDeleted('vault', questionId);
          set({ items: get().items.filter(item => item.id !== questionId) });
        } else {
          set({ items: get().items.map(item => item.id === questionId ? { ...item, consecutiveCorrect: next } : item) });
        }
      },

      purgePaidForTracks: (tracks) => {
        const denied = new Set(tracks);
        // Legacy entries without explicit free-session provenance are treated as paid.
        set((state) => ({ items: state.items.filter(item => !denied.has(item.track) || item.isFreeSession === true) }));
      },

      remove: (id) => {
        if (get().items.some(item => item.id === id)) markProgressItemDeleted('vault', id);
        set({ items: get().items.filter((i) => i.id !== id) });
      },

      clear: () => {
        get().items.forEach(item => markProgressItemDeleted('vault', item.id));
        set({ items: [] });
      },

      asQuestions: () =>
        get().items.map((i) => ({
          id: i.id,
          track: i.track,
          functionId: i.functionId,
          competenceId: i.competenceId,
          topic: i.topic,
          questionText: i.questionText,
          options: i.options,
          correctAnswerIndex: i.correctAnswerIndex,
          explanation: i.explanation,
          difficulty: i.difficulty as Question['difficulty']
        }))
    }),
    { name: 'hyperion-vault', storage: createJSONStorage(() => encryptedPersistStorage) }
  )
);
