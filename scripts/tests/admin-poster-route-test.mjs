import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const app = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8')
const navigation = readFileSync(new URL('../../src/components/AdminNavigation.tsx', import.meta.url), 'utf8')
const editor = readFileSync(new URL('../../src/screens/AdminPosterGeneratorScreen.tsx', import.meta.url), 'utf8')
const posterStyles = readFileSync(new URL('../../src/screens/AdminPosterGeneratorScreen.css', import.meta.url), 'utf8')
const globalStyles = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8')
const renderer = readFileSync(new URL('../../src/lib/renderPoster.ts', import.meta.url), 'utf8')

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

test('poster degree and photo positioning use the supported dropdowns and percentages', () => {
  assert.match(editor, /<select id="poster-degree"/)
  assert.match(editor, /POSTER_DEGREES\.map/)
  assert.match(editor, /xOffsetPercent/)
  assert.match(editor, /yOffsetPercent/)
  assert.match(editor, /Move horizontally[\s\S]*?%/)
  assert.match(editor, /Move vertically[\s\S]*?%/)
  assert.match(renderer, /posterOffsetFromPercent\(data\.xOffsetPercent, ART_SIZE\)/)
  assert.match(renderer, /posterOffsetFromPercent\(data\.yOffsetPercent, ART_SIZE\)/)
})

test('poster page escapes the narrow desktop screen cap and uses a responsive percentage layout', () => {
  assert.match(globalStyles, /:not\(\.admin-poster\)/)
  assert.match(posterStyles, /grid-template-columns:\s*minmax\(0,\s*40%\)\s+minmax\(0,\s*1fr\)/)
  assert.match(posterStyles, /gap:\s*2%/)
  assert.match(posterStyles, /@media\s*\(max-width:\s*950px\)[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/)
  assert.match(posterStyles, /\.admin-poster__canvas\s*\{[^}]*width:\s*100%[^}]*aspect-ratio:\s*1/)
})

test('poster renderer preserves explicit track heading lines and shared sample-aligned text layout', () => {
  assert.match(renderer, /POSTER_TEXT_LAYOUT/)
  assert.match(renderer, /data\.track\.examTitle/)
  assert.doesNotMatch(renderer, /examTitle\.replace\(/)
})
