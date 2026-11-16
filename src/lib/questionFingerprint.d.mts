export interface FingerprintableQuestion {
  questionText: string;
  options: string[];
  correctAnswerIndex: number;
  imageAttachments?: unknown;
}
export declare function questionFingerprintPayload(question: FingerprintableQuestion): string | null;
export declare function fingerprintQuestion(question: FingerprintableQuestion): Promise<string | null>;
