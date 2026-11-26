import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const app = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8')
const navigation = readFileSync(new URL('../../src/components/AdminNavigation.tsx', import.meta.url), 'utf8')

test('poster generator has its own lazy admin route and navigation entry', () => {
  assert.match(app, /AdminPosterGeneratorScreen\s*=\s*lazy/)
  assert.match(app, /<Route path="\/admin\/posters" element=\{<AdminPosterGeneratorScreen \/>\}/)
  assert.match(navigation, /to:\s*'\/admin\/posters',\s*label:\s*'POSTER GENERATOR'/)
})

test('poster editor uses server-verified admin permission and local photo processing', () => {
  const editor = readFileSync(new URL('../../src/screens/AdminPosterGeneratorScreen.tsx', import.meta.url), 'utf8')
  assert.match(editor, /useAdminCheckoutAccess\(userId\)/)
  assert.match(editor, /if \(!access\.allowed\)/)
  assert.match(editor, /removePortraitBackground\(file\)/)
  assert.doesNotMatch(editor, /\.storage\.|upload\(|\.from\('candidate/)
})
