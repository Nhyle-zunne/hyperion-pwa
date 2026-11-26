# Hyperion Admin Poster Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a private Admin Poster Generator for all seven maritime licensure tracks, with automatic rank prefixes, editable candidate data and examination date, local background removal, preview, and high-resolution download.

**Architecture:** Add an admin-gated React route and a small Canvas renderer drawing editable layers onto the clean Hyperion artwork. Process portraits on the client via MediaPipe's selfie segmenter, retaining the original image data and applying only an alpha mask. Keep heavy model loading on the poster route; do not add backend endpoints or Supabase storage.

**Tech Stack:** React 18, Vite 6, TypeScript, Canvas 2D, Google MediaPipe Tasks Vision, Node test runner.

**Spec:** `docs/superpowers/specs/2026-11-26-admin-poster-generator-design.md`

## Global Constraints

- Art source: exact user-supplied 1254 × 1254 `01_Background_Hyperion_Artwork.png`.
- Export: 2048 × 2048 PNG with Facebook `@HyperionMaritime` and `HyperionMaritime.org`.
- Candidate photo processing must not change visible RGB pixels or leave the browser.
- Do not permit generation before the `admin-payment-review` `check-admin` response confirms `isAdmin === true`.
- Track choices: OIC-NW, OIC-EW, Chief Mate, Master Mariner, Second Engineer, Chief Engineer, GMDSS GOC.
- UI controls use sharp corners and existing AdminNavigation styling.

## Review Focus

- Very long names or schools: scale or wrap safely without crossing the portrait.
- No image or failed background model: show an actionable error and prevent a false completed export.
- Date input on devices in different timezones: format the chosen calendar date without UTC-day shifting.
- Upload of a replacement portrait while removal is still running: discard stale processing results.
- Signed-out or non-admin deep link to `/admin/posters`: deny the editor, not just hide its tab.

---

### Task 1: Track labels and poster text

**Files:**
- Create: `src/lib/posterTracks.mjs`
- Create: `src/lib/posterTracks.d.mts`
- Create: `scripts/tests/poster-tracks-test.mjs`

**Interfaces:**
- `POSTER_TRACKS`: array of `{ id, label, prefix, defaultDegree, examTitle }`.
- `fullPosterName(trackId, name)`: prepend the correct prefix once.
- `formatPosterDate(yyyyMmDd)`: exact Month Day, Year string, no timezone drift.

- [ ] Write tests for all seven track mappings, empty names, lengthy names, and November 26, 2026 date formatting.
- [ ] Run `node --test scripts/tests/poster-tracks-test.mjs`; verify tests fail because the module is absent.
- [ ] Implement the metadata/functions and TypeScript declarations.
- [ ] Run the focused tests and verify pass.
- [ ] Commit track metadata and tests.

### Task 2: Portrait cutout

**Files:**
- Create: `src/lib/posterPortrait.ts`
- Create: `src/lib/posterAlpha.mjs`
- Create: `src/lib/posterAlpha.d.mts`
- Create: `scripts/tests/poster-alpha-test.mjs`
- Modify: `package.json`, `bun.lock`

**Interfaces:**
- `applyPortraitAlpha(imageData, mask, maskWidth, maskHeight)`: preserve RGB, assign confidence-based alpha.
- `removePortraitBackground(file: File)`: Promise of a browser-usable transparent photo URL/Blob; fail with actionable status.

- [ ] Write tests that prove RGB bytes are unchanged, background alpha is zero, and transparent source alpha is preserved.
- [ ] Run the focused tests; verify missing implementation failure.
- [ ] Implement the pure alpha helper.
- [ ] Install the pinned `@mediapipe/tasks-vision` package and implement lazy model loading, mask scaling, cleanup, and error handling.
- [ ] Run focused tests, TypeScript checks, and security tests.
- [ ] Commit portrait processing and tests.

### Task 3: Canvas renderer and artwork

**Files:**
- Create: `public/posters/hyperion-background.webp`
- Create: `src/lib/renderPoster.ts`
- Create: `src/lib/posterLayout.mjs`
- Create: `src/lib/posterLayout.d.mts`
- Create: `scripts/tests/poster-layout-test.mjs`

**Interfaces:**
- `renderPoster(canvas, { track, name, degree, date, school, company, portrait, scale, xOffset, yOffset })`: renders the entire square.
- `downloadPoster(canvas, name)`: downloads actual PNG only when required data is valid.

- [ ] Write tests for fit-to-width behavior and output-safe text bounds; verify red.
- [ ] Implement reusable typography/layout bounds, then verify green.
- [ ] Add exact Hyperion background asset; compose editable text, optional company, portrait, and two-part footer on Canvas.
- [ ] Visually compare a sample against the supplied example; ensure the underlying image contains no old candidate or text.
- [ ] Commit renderer, artwork, and tests.

### Task 4: Protected admin editor and navigation

**Files:**
- Create: `src/screens/AdminPosterGeneratorScreen.tsx`
- Create: `src/styles/adminPosterGenerator.css`
- Modify: `src/App.tsx`
- Modify: `src/components/AdminNavigation.tsx`
- Create: `scripts/tests/admin-poster-route-test.mjs`

**Interfaces:**
- Route `/admin/posters`, using the existing `useAdminCheckoutAccess` and Supabase auth session handling.
- Editable form with live Canvas preview and portrait processing status.

- [ ] Write a route test asserting the navigation link, lazy route, admin check, and no upload calls; verify red.
- [ ] Implement admin gate and form, including safe errors, local photo replacement, positioning controls, degree defaults on track changes, and preview/download actions.
- [ ] Verify route test and security suite.
- [ ] Run `npm run build` and inspect 375px and desktop layouts, plus one complete sample PNG export.
- [ ] Commit the admin editor and tests on a focused branch; open a PR without pushing to main.
