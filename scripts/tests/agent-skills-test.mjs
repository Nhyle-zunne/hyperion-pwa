import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, readdir, lstat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../../', import.meta.url))
const skillsRoot = path.join(root, '.agents/skills')
const manifest = JSON.parse(await readFile(path.join(root, '.agents/upstream-lock.json'), 'utf8'))
const files = new Set()
const names = new Set()

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name)
    assert(!(await lstat(target)).isSymbolicLink(), `Skills must survive a fresh checkout: ${target}`)
    if (entry.isDirectory()) await walk(target)
    else files.add(path.relative(root, target).split(path.sep).join('/'))
  }
}
await walk(skillsRoot)

for (const source of manifest.sources) {
  assert.match(source.commit, /^[a-f0-9]{40}$/)
  assert(source.files.length > 0)
  for (const file of source.files) {
    assert(!path.isAbsolute(file.destination) && !file.destination.split('/').includes('..'))
    const content = await readFile(path.join(root, file.destination))
    assert.equal(createHash('sha256').update(content).digest('hex'), file.sha256, file.destination)
    files.delete(file.destination)
  }
  for (const name of source.skills) {
    assert(!names.has(name), `Duplicate skill: ${name}`)
    names.add(name)
    const text = await readFile(path.join(skillsRoot, name, 'SKILL.md'), 'utf8')
    assert.match(text, /^---\r?\n/)
    const frontmatter = text.split(/^---\s*$/m)[1]
    assert.match(frontmatter, new RegExp(`^name: ${name}$`, 'm'))
    assert.match(frontmatter, /^description:\s*\S/m)
  }
}
assert.deepEqual([...files], [], 'Unpinned skill files')
assert.equal(names.size, 18, 'Expected 15 Superpowers skills, Ponytail, Caveman, and UI/UX Pro Max')
const instructions = await readFile(path.join(root, 'AGENTS.md'), 'utf8')
for (const name of ['using-superpowers', 'ponytail', 'caveman', 'ui-ux-pro-max']) {
  assert(instructions.includes(`.agents/skills/${name}/SKILL.md`), `Missing entry point: ${name}`)
}
console.log(`PASS: ${names.size} repository skills, unique names, pinned bytes, portable files, and AGENTS entry points`)
