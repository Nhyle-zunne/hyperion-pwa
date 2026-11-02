# Session timer and per-question bookmark regression

From the repository root, with dependencies, Playwright and Chromium available:

```sh
HYPERION_BROWSER_FIXTURE=session HYPERION_BROWSER_TEST_OUTPUT=/tmp/hyperion-session-browser npx vite build --config scripts/tests/keyword-browser.config.ts
HYPERION_BROWSER_FIXTURE=session HYPERION_BROWSER_TEST_OUTPUT=/tmp/hyperion-session-browser npx vite preview --config scripts/tests/keyword-browser.config.ts --host 127.0.0.1 --port 4177
```

In another terminal:

```sh
node scripts/tests/session-browser-test.mjs
```

If Playwright is installed outside this checkout, set `HYPERION_TEST_TOOLS` to that installation's absolute package.json path. `CHROMIUM_PATH` defaults to `/usr/bin/chromium`. `HYPERION_SESSION_TEST_URL` overrides the fixture URL.

The isolated fixture imports the actual timer and bookmark components and uses encrypted IndexedDB storage. Synthetic questions and an isolated browser profile avoid touching actual study data or protected question banks. It checks elapsed-time formatting, question navigation, wake catch-up, resumed and new session starts, independent question bookmarks/removal, encrypted persistence and offline reload. The normal application build does not include the fixture.

The visible timer measures elapsed session time. Practice uses the existing persisted start timestamp; Quick Scan starts after its initial questions load and retains its timestamp during pagination. It does not add study segments or modify existing mock-exam countdown logic.
