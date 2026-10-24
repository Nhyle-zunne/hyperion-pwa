export type TrackId =
  | 'DECK_OIC_NW'
  | 'GMDSS_GOC'
  | 'ENGINE_OIC_EW'
  | 'DECK_MGT'
  | 'ENGINE_MGT';

export type Difficulty = 'EASY' | 'MODERATE' | 'DIFFICULT';

export interface Question {
  id: string;
  track: TrackId;
  functionId: string;
  competenceId: string;
  topic: string;
  questionText: string;
  options: string[];
  correctAnswerIndex: number;
  explanation: string;
  difficulty: Difficulty;
}

export interface UserAnswer {
  questionId: string;
  selectedIndex: number | null;
  isCorrect: boolean;
  isFlagged: boolean;
}

export interface PracticeSession {
  id: string;
  track: TrackId;
  competenceId?: string;
  mode: 'PRACTICE' | 'DRILL' | 'MOCK';
  questions: Question[];
  answers: Record<string, UserAnswer>;
  currentIndex: number;
  startedAt: number;
  finishedAt?: number;
}
