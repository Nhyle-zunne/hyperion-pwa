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
 * @property {unknown} [imageAttachments]
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

  const payload = [question.questionText, canonicalOptions];
  if (!question.questionText.trim()) {
    const refs = question.imageAttachments;
    if (!Array.isArray(refs) || refs.length < 1 || refs.length > 4 ||
        !refs.every(ref => ref && typeof ref === 'object' && !Array.isArray(ref) &&
          Object.keys(ref).length === 4 && typeof ref.sha256 === 'string' && /^[a-f0-9]{64}$/.test(ref.sha256) &&
          ['image/webp', 'image/png', 'image/jpeg'].includes(ref.mime) &&
          ['question', 'explanation'].includes(ref.placement) &&
          typeof ref.alt === 'string' && ref.alt.trim().length > 0 && ref.alt.length <= 160 && !/[\x00-\x1F\x7F]/.test(ref.alt)) ||
        JSON.stringify(refs).length > 2048 ||
        new Set(refs.map(ref => `${ref.sha256}:${ref.placement}`)).size !== refs.length) return null;
    const prompts = refs.filter(ref => ref.placement === 'question').map(ref => [ref.sha256, ref.mime]).sort((left, right) => {
      if (left[0] !== right[0]) return left[0] < right[0] ? -1 : 1;
      return left[1] < right[1] ? -1 : left[1] > right[1] ? 1 : 0;
    });
    if (!prompts.length) return null;
    payload.push(prompts);
  }
  return JSON.stringify(payload);
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
