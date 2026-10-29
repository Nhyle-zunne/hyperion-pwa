/**
 * Stable question identity for saved-session authorization.
 *
 * Options are sorted with the correct answer attached to its option text, so
 * shuffling answer choices does not make an otherwise identical saved question
 * look like different content.
 */
export interface FingerprintableQuestion {
  questionText: string;
  options: string[];
  correctAnswerIndex: number;
}

export function questionFingerprintPayload(question: FingerprintableQuestion): string | null {
  if (
    typeof question.questionText !== 'string' ||
    !Array.isArray(question.options) ||
    !question.options.every((option) => typeof option === 'string') ||
    !Number.isInteger(question.correctAnswerIndex) ||
    question.correctAnswerIndex < 0 ||
    question.correctAnswerIndex >= question.options.length
  ) return null;

  const canonicalOptions = question.options
    .map((text, index) => ({ text, correct: index === question.correctAnswerIndex }))
    .sort((left, right) => {
      if (left.text < right.text) return -1;
      if (left.text > right.text) return 1;
      return Number(left.correct) - Number(right.correct);
    });

  return JSON.stringify([question.questionText, canonicalOptions]);
}

export async function fingerprintQuestion(question: FingerprintableQuestion): Promise<string | null> {
  const canonical = questionFingerprintPayload(question);
  if (canonical === null) return null;
  const payload = new TextEncoder().encode(canonical);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', payload));
  return Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
