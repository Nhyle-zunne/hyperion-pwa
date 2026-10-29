/**
 * Stable question identity for saved-session authorization.
 *
 * Options are sorted with the correct answer attached to its option text, so
 * shuffling answer choices does not make an otherwise identical saved question
 * look like different content.
 *
 * @typedef {Object} FingerprintableQuestion
 * @property {string} questionText
 * @property {string[]} options
 * @property {number} correctAnswerIndex
 */

/** @param {FingerprintableQuestion} question */
export function questionFingerprintPayload(question) {
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

// Saved sessions and downloaded packs repeatedly validate the same in-memory
// question objects. Cache by object identity and canonical payload so the first
// integrity check remains cryptographic, while repeated checks avoid re-hashing.
const fingerprintCache = new WeakMap();

 /** @param {FingerprintableQuestion} question */
export async function fingerprintQuestion(question) {
  const canonical = questionFingerprintPayload(question);
  if (canonical === null) return null;
  const cached = fingerprintCache.get(question);
  if (cached && cached.canonical === canonical) return cached.hash;
  const payload = new TextEncoder().encode(canonical);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', payload));
  const hex = Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('');
  fingerprintCache.set(question, { canonical, hash: hex });
  return hex;
}
