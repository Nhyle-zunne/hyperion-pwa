import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('admin navigation links to a separate lazy-loaded QR editor route', () => {
  const app = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8')
  const nav = readFileSync(new URL('../../src/components/AdminNavigation.tsx', import.meta.url), 'utf8')
  assert.match(app, /const AdminQrEditorScreen = lazy\(\(\) => import\('\.\/screens\/AdminQrEditorScreen'\)\)/)
  assert.match(app, /<Route path="\/admin\/qr-editor" element={<AdminQrEditorScreen \/>} \/>/)
  assert.match(nav, /to: '\/admin\/qr-editor', label: 'QR CODE EDITOR'/)
})

test('QR editor workspace is remounted for each authorized account and unmounted when access is lost', () => {
  const screen = readFileSync(new URL('../../src/screens/AdminQrEditorScreen.tsx', import.meta.url), 'utf8')
  assert.match(screen, /if \(!access\.allowed\) return/)
  assert.match(screen, /return <QrEditorWorkspace key={userId} \/>/)
  assert.match(screen, /function QrEditorWorkspace\(\)/)
})

test('QR preview and download stay tied to the current payload and optional logo', () => {
  const screen = readFileSync(new URL('../../src/screens/AdminQrEditorScreen.tsx', import.meta.url), 'utf8')
  assert.match(screen, /preview\?\.payload === editedPayload && preview\.logo === logoFile \? preview\.url : ''/)
  assert.match(screen, /renderQrPng\(editedPayload, logoFile\)/)
  assert.match(screen, /id="qr-editor-logo" type="file"/)
  assert.match(screen, /REMOVE LOGO/)
})

test('uploaded QR and logo keep their chosen filenames, and full decoded data is visible locally', () => {
  const screen = readFileSync(new URL('../../src/screens/AdminQrEditorScreen.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(screen, /event\.target\.value\s*=\s*''/)
  assert.match(screen, /QR image loaded:.*file\.name/)
  assert.match(screen, /ref={logoInputRef}/)
  assert.match(screen, /logoInputRef\.current\.value = ''/)
  assert.match(screen, /listQrPhDataFields\(dataPayload\)/)
  assert.match(screen, /DECODED QR DATA/)
  assert.match(screen, /value={dataPayload} readOnly/)
  assert.match(screen, /admin-poster__hint admin-qr__upload-status/)
  const styles = readFileSync(new URL('../../src/screens/AdminQrEditorScreen.css', import.meta.url), 'utf8')
  assert.match(styles, /\.admin-qr__upload-status\s*\{[^}]*overflow-wrap:\s*anywhere/)
})

test('admin navigation accommodates the fifth tool without overflowing desktop tabs', () => {
  const styles = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8')
  assert.match(styles, /\.admin-page-navigation__sections\s*\{[^}]*grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/)
})
