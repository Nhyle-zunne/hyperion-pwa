import assert from 'node:assert/strict'
import { planSmartBankReuse } from '../../src/lib/smartBankDownloadPlan.mjs'

const sha = value => value.repeat(64)
const groups = [
  { competenceId: 'C1', part: null, path: 'deck/oic_nw_c1.csv.enc', count: 2 },
  { competenceId: 'C2', part: null, path: 'deck/oic_nw_c2.csv.enc', count: 1 },
  { competenceId: 'C3', part: null, path: 'deck/oic_nw_c3.csv.enc', count: 3 }
]
const versions = Object.fromEntries(groups.map((g, i) => [g.path, sha(String(i + 1))]))
const cached = groups.map(g => ({ ...g, questions: Array.from({ length: g.count }, (_, i) => ({
  id: g.competenceId + '-' + i, track: 'DECK_OIC_NW', competenceId: g.competenceId
})) }))
const previous = { complete: true, sourceVersionFormat: 'github-content-sha256-v1', sourceVersions: versions }
const remote = { versionFormat: 'github-content-sha256-v1', sourceVersions: versions }

const current = planSmartBankReuse(previous, remote, groups, cached)
assert.equal(current.allCurrent, true, 'All current ciphertext groups are locally reusable')
assert.deepEqual(current.download, [])
assert.equal(current.reused.length, 3)

const singleEdit = planSmartBankReuse(previous,
  { ...remote, sourceVersions: { ...versions, [groups[1].path]: sha('f') } }, groups, cached)
assert.equal(singleEdit.allCurrent, false)
assert.deepEqual(singleEdit.download.map(g => g.competenceId), ['C2'],
  'A correction to C2 must never force C1 and C3 to download again')
assert.deepEqual(singleEdit.reused.map(g => g.competenceId), ['C1', 'C3'])

const missingCache = planSmartBankReuse(previous, remote, groups, cached.slice(1))
assert.deepEqual(missingCache.download.map(g => g.competenceId), ['C1'])
assert.equal(missingCache.allCurrent, false)

const wrongCount = planSmartBankReuse(previous, remote,
  [{...groups[0], count: 3}, ...groups.slice(1)], cached)
assert.deepEqual(wrongCount.download.map(g => g.competenceId), ['C1'])

const unavailableVersion = planSmartBankReuse(
  { ...previous, sourceVersions: { ...versions, [groups[0].path]: undefined } },
  remote, groups, cached
)
assert.equal(unavailableVersion.reused.length, 0,
  'An invalid prior hash requires the conservative full-download fallback')

assert.equal(planSmartBankReuse({ ...previous, complete: false }, remote, groups, cached).reused.length, 0,
  'An incomplete pack must not be reused')
assert.equal(planSmartBankReuse(previous, { ...remote, versionFormat: 'storage-metadata-v1' }, groups, cached).reused.length, 0,
  'Hashes from different algorithms are not interchangeable')
assert.equal(planSmartBankReuse(previous, remote, [{...groups[0], path: 'unknown.csv.enc'}], cached).reused.length, 0,
  'Unknown manifest paths are never blindly accepted')
assert.equal(planSmartBankReuse(previous, remote, groups, [...cached, cached[0]]).reused.length, 0,
  'Duplicate local ciphertext groups must fail closed')

const parts = [
  {competenceId:'C1',part:1,path:'gmdss/c1_part1.csv.enc',count:1},
  {competenceId:'C1',part:2,path:'gmdss/c1_part2.csv.enc',count:1}
]
const oldParts = {'gmdss/c1_part1.csv.enc':sha('a'),'gmdss/c1_part2.csv.enc':sha('b')}
const newParts = {...oldParts, 'gmdss/c1_part2.csv.enc':sha('c')}
const partPlan = planSmartBankReuse(
  {complete:true,sourceVersionFormat:'github-content-sha256-v1',sourceVersions:oldParts},
  {versionFormat:'github-content-sha256-v1',sourceVersions:newParts},
  parts, parts.map(g=>({...g,questions:[{id:g.path}]}))
)
assert.deepEqual(partPlan.reused.map(g=>g.part),[1])
assert.deepEqual(partPlan.download.map(g=>g.part),[2],
  'Only the updated GMDSS part is fetched')

const removed = planSmartBankReuse(previous, {
  ...remote,sourceVersions: Object.fromEntries(Object.entries(versions).slice(0,2))
},groups.slice(0,2),cached.slice(0,2))
assert.equal(removed.allCurrent,false,'A removed source must trigger a fresh manifest commit')
console.log('PASS: smart encrypted bank reuse is content-versioned, per competence/part, fail-closed and minimal')
