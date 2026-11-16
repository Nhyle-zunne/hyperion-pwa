/**
 * Select local encrypted offline groups that can be reused without asking the
 * server for their (potentially thousands of) question rows again.
 *
 * The manifest is only a version hint. The caller must first verify the user's
 * entitlement, read/decrypt the local AES-GCM groups, pin remote pagination to
 * one bankRevision and atomically commit the complete replacement set.
 */
export function planSmartBankReuse(previous, remote, groupSources, cachedGroups) {
  const none = { reused: [], download: groupSources.slice(), allCurrent: false }
  if (!previous?.complete || !remote ||
      previous.sourceVersionFormat !== remote.versionFormat ||
      !previous.sourceVersions || !remote.sourceVersions ||
      !groupSources.length || !Array.isArray(cachedGroups)) return none

  const token = value => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value)
  const keys = Object.keys(remote.sourceVersions)
  if (!keys.length || keys.some(path => !token(remote.sourceVersions[path]))) return none
  const priorKeys = Object.keys(previous.sourceVersions)
  if (priorKeys.some(path => !token(previous.sourceVersions[path]))) return none

  const groupKey = group => group.competenceId + ':' + (group.part == null ? 'all' : group.part)
  const available = new Map()
  for (const group of cachedGroups) {
    if (!group || !Array.isArray(group.questions)) return none
    const id = groupKey(group)
    if (available.has(id)) return none
    available.set(id, group)
  }
  const reused = [], download = []
  const seen = new Set()
  for (const group of groupSources) {
    const id = groupKey(group)
    if (seen.has(id)) return none
    seen.add(id)
    const cached = available.get(id)
    const comparable = typeof group.path === 'string' &&
      token(remote.sourceVersions[group.path]) &&
      previous.sourceVersions[group.path] === remote.sourceVersions[group.path] &&
      !group.forceDownload &&
      cached?.questions?.length === group.count && group.count > 0
    if (comparable) reused.push({ ...group, questions: cached.questions })
    else download.push(group)
  }
  // Only a complete set with exactly the current source paths can be described
  // as fully up to date; removed/additional paths require a new atomic commit.
  const allCurrent = download.length === 0 && priorKeys.length === keys.length &&
    priorKeys.every(path => remote.sourceVersions[path] === previous.sourceVersions[path]) &&
    available.size === groupSources.length
  return { reused, download, allCurrent }
}
