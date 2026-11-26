import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const app = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8')
const navigation = readFileSync(new URL('../../src/components/AdminNavigation.tsx', import.meta.url), 'utf8')
const editor = readFileSync(new URL('../../src/screens/AdminPosterGeneratorScreen.tsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8')
const posterStyles = readFileSync(new URL('../../src/screens/AdminPosterGeneratorScreen.css', import.meta.url), 'utf8')

test('poster generator has its own lazy admin route and navigation entry', () => {
  assert.match(app, /AdminPosterGeneratorScreen\s*=\s*lazy/)
  assert.match(app, /<Route path="\/admin\/posters" element=\{<AdminPosterGeneratorScreen \/>\}/)
  assert.match(navigation, /to:\s*'\/admin\/posters',\s*label:\s*'POSTER GENERATOR'/)
})

test('poster editor uses server-verified admin permission and local photo processing', () => {
  assert.match(editor, /useAdminCheckoutAccess\(userId\)/)
  assert.match(editor, /if \(!access\.allowed\)/)
  assert.match(editor, /removePortraitBackground\(file\)/)
  assert.doesNotMatch(editor, /\.storage\.|upload\(|\.from\('candidate/)
})

test('poster editor provides dropdowns for the four tracks and two degrees', () => {
  assert.match(editor, /POSTER_TRACKS\.map/)
  assert.match(editor, /POSTER_DEGREES\.map/)
  assert.match(editor, /<select id="poster-degree"/)
  assert.doesNotMatch(editor, /<input id="poster-degree"/)
})

test('admin poster uses the wide desktop page layout instead of the generic 560px screen width', () => {
  const desktopSizing = styles.slice(styles.indexOf('/* Desktop sizing: keep the dashboard wide'), styles.indexOf('/* Mock exam overview/results'))
  assert.match(desktopSizing, /:not\(\.admin-poster\)/)
  assert.match(posterStyles, /\.admin-poster\s*\{[^}]*max-width:\s*1320px/)
  assert.match(posterStyles, /grid-template-columns:\s*minmax\(340px,\s*430px\)\s+minmax\(0,\s*1fr\)/)
  assert.match(posterStyles, /\.admin-poster__canvas\s*\{[^}]*max-width:\s*760px/)
})

test('four admin links form equal columns and a mobile two-by-two grid', () => {
  const navigationStyles = styles.slice(styles.indexOf('/* Shared administration navigation'), styles.indexOf('.question-diagram-zoom'))
  assert.ok(/\.admin-page-navigation__sections\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/.test(navigationStyles), 'Desktop navigation has four columns')
  assert.ok(/@media\s*\(max-width:\s*760px\)[\s\S]*?\.admin-page-navigation__sections\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/.test(navigationStyles), 'Mobile navigation has two columns')
})
