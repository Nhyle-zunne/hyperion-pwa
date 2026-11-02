# Keyword highlighting browser regression

Run from the repository root with dependencies installed. Playwright and system Chromium are test prerequisites; no authenticated account or backend is needed. The isolated fixture imports the real editor, settings store, and encrypted IndexedDB storage. It does not disable application licensing or load private question banks.

```sh
npx vite build --config scripts/tests/keyword-browser.config.ts
npx vite preview --config scripts/tests/keyword-browser.config.ts --host 127.0.0.1 --port 4176
```

In another terminal:

```sh
node scripts/tests/keyword-browser-test.mjs
```

If Playwright is installed outside the checkout, set `HYPERION_TEST_TOOLS` to that installation's absolute package.json path. `CHROMIUM_PATH` defaults to `/usr/bin/chromium`. `HYPERION_KEYWORD_TEST_URL` and `HYPERION_BROWSER_TEST_OUTPUT` override the fixture URL and build output directory.

Coverage: selecting multiple and repeated words, keyboard editing, explicit save, persisted toggle, offline cold reload and saves, draft discard, question/track/text-revision isolation, and failed-save recovery without overwriting the last saved selection. The normal app build uses index.html and does not bundle this fixture.
