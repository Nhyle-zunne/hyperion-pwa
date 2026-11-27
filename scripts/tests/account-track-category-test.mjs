import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const load = (path, context = {}) => {
  const code = ts.transpileModule(readFileSync(new URL('../../' + path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports, require, ...context })
  return exports
}

test('single categories and DECK+GMDSS are valid account display categories', () => {
  const { parseTrackCategory, TRACK_CATEGORIES } = load('src/lib/accountTrackCategory.ts')
  assert.deepEqual(Array.from(TRACK_CATEGORIES), ['DECK', 'ENGINE', 'GMDSS'])
  for (const category of TRACK_CATEGORIES) assert.equal(parseTrackCategory(category), category)
  assert.equal(parseTrackCategory('DECK+GMDSS'), 'DECK+GMDSS')
  for (const category of [undefined, null, '', 'deck', 'GMDSS_GOC', 'ENGINE_OIC_EW', 'ENGINE+DECK', 'GMDSS+DECK', [], {}]) {
    assert.equal(parseTrackCategory(category), null)
  }
})

test('DECK and GMDSS toggle together while ENGINE remains exclusive', () => {
  const { toggleTrackCategory, hasTrackCategory } = load('src/lib/accountTrackCategory.ts')
  assert.equal(toggleTrackCategory(null, 'DECK'), 'DECK')
  assert.equal(toggleTrackCategory('DECK', 'GMDSS'), 'DECK+GMDSS')
  assert.equal(toggleTrackCategory('GMDSS', 'DECK'), 'DECK+GMDSS')
  assert.equal(hasTrackCategory('DECK+GMDSS', 'DECK'), true)
  assert.equal(hasTrackCategory('DECK+GMDSS', 'GMDSS'), true)
  assert.equal(hasTrackCategory('DECK+GMDSS', 'ENGINE'), false)
  assert.equal(toggleTrackCategory('DECK+GMDSS', 'DECK'), 'GMDSS')
  assert.equal(toggleTrackCategory('DECK+GMDSS', 'GMDSS'), 'DECK')
  assert.equal(toggleTrackCategory('DECK+GMDSS', 'ENGINE'), 'ENGINE')
  assert.equal(toggleTrackCategory('ENGINE', 'GMDSS'), 'GMDSS')
  assert.equal(toggleTrackCategory('ENGINE', 'DECK'), 'DECK')
  assert.equal(toggleTrackCategory('ENGINE', 'ENGINE'), null)
})

test('account profile keeps direct tag editing available inside its disclosure', () => {
  const screen = readFileSync(new URL('../../src/screens/AccountScreen.tsx', import.meta.url), 'utf8')
  assert.match(screen, /aria-expanded=\{profileExpanded\}/)
  assert.doesNotMatch(screen, /profileEditing|EDIT PROFILE|readOnly=/)
  assert.match(screen, /Your track categories/)
  assert.match(screen, /SAVE CHANGES/)
})

test('account category badge shows only validated display data', () => {
  const { default: Badge } = load('src/components/TrackCategoryBadge.tsx', {
    require: name => name === '../lib/accountTrackCategory'
      ? load('src/lib/accountTrackCategory.ts')
      : require(name),
  })
  const render = require('react-dom/server').renderToStaticMarkup
  assert.match(render(Badge({ category: 'DECK' })), /DECK/)
  assert.match(render(Badge({ category: 'GMDSS' })), /GMDSS/)
  const combined = render(Badge({ category: 'DECK+GMDSS' }))
  assert.equal((combined.match(/title="Self-selected account category \(not a license\)"/g) || []).length, 2)
  assert.match(combined, />DECK<\/span>/)
  assert.match(combined, />GMDSS<\/span>/)
  assert.equal(render(Badge({ category: 'ADMIN' })), '')
  assert.equal(render(Badge({ category: null })), '')
})

test('the global sign-in prompt appears only for online accounts missing a category', () => {
  const renderPrompt = (user, online = true, error = '', deferred = false, saveSlow = false) => {
    const states = [user, true, online, null, false, error, saveSlow, deferred]
    let index = 0
    const { default: Prompt } = load('src/components/AccountTrackCategoryPrompt.tsx', {
      document: { body: {} },
      require: name => {
        if (name === 'react') return {
          useState: initial => [states[index++] ?? initial, () => {}],
          useEffect: () => {}, useRef: () => ({ current: null }),
        }
        if (name === 'react-dom') return { createPortal: node => node }
        if (name === '../lib/supabase') return { supabase: {} }
        if (name === '../lib/accountTrackCategory') return load('src/lib/accountTrackCategory.ts')
        return require(name)
      },
    })
    return require('react-dom/server').renderToStaticMarkup(Prompt())
  }
  const missing = { id: 'member', user_metadata: { full_name: 'Test Member' } }
  const marked = { id: 'member', user_metadata: { track_category: 'ENGINE' } }
  const both = { id: 'member', user_metadata: { track_category: 'DECK+GMDSS' } }
  assert.match(renderPrompt(missing), /Choose your track category/)
  assert.match(renderPrompt(missing), /aria-modal="true"/)
  assert.match(renderPrompt(missing), /SAVE TRACK CATEGORY/)
  assert.equal(renderPrompt(null), '', 'Guests can continue without a profile')
  assert.equal(renderPrompt(marked), '', 'Valid stored categories do not cause repeated prompts')
  assert.equal(renderPrompt(both), '', 'A saved DECK and GMDSS selection does not re-prompt')
  assert.equal(renderPrompt(missing, false), '', 'Offline reviewer access is never blocked by the prompt')
  assert.match(renderPrompt(missing, true, 'Save failed'), /CONTINUE TO REVIEWER FOR NOW/,
    'A failed network save offers a safe way to keep using the reviewer')
  assert.match(renderPrompt(missing, true, '', false, true), /CONTINUE TO REVIEWER FOR NOW/,
    'A stalled Auth update also offers continuation without blocking reviewer access')
  assert.equal(renderPrompt(missing, true, '', true), '', 'A deferred prompt never blocks the current page')
})

test('existing-user browser fixtures carry a category so unrelated reviewer flows remain usable', async () => {
  const values = new Map()
  const localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  }
  const { supabase, fixtureUsers, fixtureSetUser } = load('scripts/tests/recovery-supabase-fixture.ts', {
    localStorage, navigator: { onLine: true },
    require: name => name === '../../src/lib/supabase' ? {} : require(name),
  })
  assert.equal((await supabase.auth.getSession()).data.session.user.user_metadata.track_category, 'DECK')
  fixtureSetUser(fixtureUsers.b)
  assert.equal((await supabase.auth.getSession()).data.session.user.user_metadata.track_category, 'ENGINE')
})
