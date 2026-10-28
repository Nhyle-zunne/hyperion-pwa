import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { encryptedPersistStorage } from '../lib/encryptedPersistStorage';
import type { Question, TrackId } from '../types/question';

export interface BookmarkedQuestion {
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
  savedAt: number;
  /** False only when explicitly bookmarked from free-sample content. */
  paidAtSave?: boolean;
}

interface BookmarksState {
  items: BookmarkedQuestion[];
  isBookmarked: (id: string) => boolean;
  toggle: (q: Question, paidAtSave?: boolean) => void;
  purgePaidForTracks: (tracks: TrackId[]) => void;
  remove: (id: string) => void;
  clear: () => void;
  asQuestions: () => Question[];
}

export const useBookmarksStore = create<BookmarksState>()(
  persist(
    (set, get) => ({
      items: [],

      isBookmarked: (id) => get().items.some((i) => i.id === id),

      toggle: (q, paidAtSave = true) => {
        const exists = get().items.some((i) => i.id === q.id);
        if (exists) {
          set({ items: get().items.filter((i) => i.id !== q.id) });
        } else {
          const entry: BookmarkedQuestion = {
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
            savedAt: Date.now(),
            paidAtSave
          };
          set({ items: [entry, ...get().items].slice(0, 500) });
        }
      },

      remove: (id) => set({ items: get().items.filter((i) => i.id !== id) }),

      purgePaidForTracks: (tracks) => {
        const denied = new Set(tracks);
        set((state) => ({ items: state.items.filter(item => !denied.has(item.track) || item.paidAtSave === false) }));
      },

      clear: () => set({ items: [] }),

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
    { name: 'hyperion-bookmarks', storage: createJSONStorage(() => encryptedPersistStorage) }
  )
);
