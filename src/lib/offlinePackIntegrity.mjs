/**
 * Check whether a downloaded GMDSS free-sample question ID belongs to the
 * exact server-defined free quota for its source part.
 */
export function isGmdssFreeSampleQuestion(question) {
  if (!question || typeof question.id !== 'string') return false;
  const match = /^G-(C1|C2)-P(\d+)-(\d+)$/.exec(question.id);
  if (!match) return false;
  const competence = match[1];
  const part = Number(match[2]);
  const ordinal = Number(match[3]);
  if (!Number.isSafeInteger(part) || !Number.isSafeInteger(ordinal) || ordinal < 1) return false;
  if (competence === 'C1') return part >= 1 && part <= 10 && ordinal <= 90;
  return part >= 1 && part <= 2 && ordinal <= 65;
}

/**
 * Validate the manifest against the pack records actually present in IndexedDB.
 * A complete marker alone is not proof that every pack survived storage eviction.
 */
export function isOfflinePackSetComplete(manifest, packs) {
  if (!manifest || manifest.complete !== true || !Array.isArray(packs)) return false;
  if (!Number.isSafeInteger(manifest.questionCount) || manifest.questionCount < 1) return false;
  if (!Number.isSafeInteger(manifest.groupCount) || manifest.groupCount < 1) return false;
  if (packs.length !== manifest.groupCount) return false;
  // Deck OIC-NW's local free-sample selection changed to match the protected server.
  // Old unversioned packs cannot be trusted as the current free-reviewer sample.
  if ((manifest.track === 'DECK_OIC_NW' || manifest.track === 'GMDSS_GOC') && manifest.freeOnly === true && manifest.sampleVersion !== 2) return false;

  let count = 0;
  const seen = new Set();
  for (const pack of packs) {
    if (!pack || typeof pack.id !== 'string' || seen.has(pack.id)) return false;
    seen.add(pack.id);
    if (pack.track !== manifest.track || pack.freeOnly !== manifest.freeOnly) return false;
    if (!Number.isSafeInteger(pack.questionCount) || pack.questionCount < 1) return false;
    count += pack.questionCount;
  }
  return count === manifest.questionCount;
}
