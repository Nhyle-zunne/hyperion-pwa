/**
 * Validate the manifest against the pack records actually present in IndexedDB.
 * A complete marker alone is not proof that every pack survived storage eviction.
 */
export function isOfflinePackSetComplete(manifest, packs) {
  if (!manifest || manifest.complete !== true || !Array.isArray(packs)) return false;
  if (!Number.isSafeInteger(manifest.questionCount) || manifest.questionCount < 1) return false;
  if (!Number.isSafeInteger(manifest.groupCount) || manifest.groupCount < 1) return false;
  if (packs.length !== manifest.groupCount) return false;

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
