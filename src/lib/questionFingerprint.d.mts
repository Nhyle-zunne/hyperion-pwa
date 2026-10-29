export interface FingerprintableQuestion {
  questionText: string;
  options: string[];
  correctAnswerIndex: number;
}
export declare function questionFingerprintPayload(question: FingerprintableQuestion): string | null;
export declare function fingerprintQuestion(question: FingerprintableQuestion): Promise<string | null>;
