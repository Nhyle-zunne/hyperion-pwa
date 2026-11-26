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

test('four admin links form equal columns and a mobile two-by-two grid', () => {
  const styles = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8')
  const navigationStyles = styles.slice(styles.indexOf('/* Shared administration navigation'), styles.indexOf('.question-diagram-zoom'))
  assert.ok(/\.admin-page-navigation__sections\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/.test(navigationStyles), 'Desktop navigation has four columns')
  assert.ok(/@media\s*\(max-width:\s*760px\)[\s\S]*?\.admin-page-navigation__sections\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/.test(navigationStyles), 'Mobile navigation has two columns')
})
