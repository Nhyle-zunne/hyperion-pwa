# Quick Scan presentation and shared question-state regression

Run from the repository root with Playwright, Chromium and the repository dependencies installed:

```sh
HYPERION_BROWSER_FIXTURE=quickscan HYPERION_BROWSER_TEST_OUTPUT=/tmp/hyperion-quickscan-browser npx vite build --config scripts/tests/keyword-browser.config.ts
HYPERION_BROWSER_FIXTURE=quickscan HYPERION_BROWSER_TEST_OUTPUT=/tmp/hyperion-quickscan-browser npx vite preview --config scripts/tests/keyword-browser.config.ts --host 127.0.0.1 --port 4179
```

In another terminal:

```sh
node scripts/tests/quickscan-browser-test.mjs
```

`HYPERION_TEST_TOOLS` can select an external Playwright installation via its package.json path. `CHROMIUM_PATH` defaults to `/usr/bin/chromium`; `HYPERION_QUICKSCAN_TEST_URL` overrides the fixture URL.

This fixture mounts the real App, Practice and Quick Scan screens. A test-only Vite plugin supplies 120 synthetic bank questions and the entry fixes entitlement state for presentation testing. These stubs are not part of the production entry and do not modify application license checks. Bookmarks and highlights use the real shared stores and encrypted IndexedDB storage in an isolated browser profile.

Coverage: shared sticky topbar, theme inside Settings, no separate bottom theme toggle, text sizing, matching desktop width and mobile overflow, green Save Keywords, bookmarks following the actual Quick Scan question, bookmarks and highlights retained across Practice/Quick Scan navigation, correct-answer display, Previous/Next/Jump and Back.
