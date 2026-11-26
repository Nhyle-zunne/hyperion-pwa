# Admin Poster Generator Responsive Follow-up Implementation Plan

> **For agentic workers:** Use this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Fix the poster editor's desktop width, make its layout responsive, and restrict track/degree choices.

**Architecture:** Keep the existing React form and Canvas renderer. Exclude only `.admin-poster` from the shared 560px desktop cap, use a 40%/remaining-width grid above 950px, and stack the form and preview below that breakpoint. Keep photo movement in percentage units until the Canvas renderer converts it to artwork coordinates.

**Tech Stack:** React, TypeScript, CSS Grid, Canvas 2D, Node test runner.

**Spec:** `docs/superpowers/specs/2026-11-26-admin-poster-responsive-design.md`

## Global Constraints
- Supported tracks: OIC-NW, OIC-EW, CAPT., and C/E only.
- Supported degrees: Marine Transportation and Marine Engineering only.
- Desktop form/preview split: 40% / 58%, with a 2% gap.
- Stack the layout at widths of 950px and below.
- Portrait scale and position controls use percentages.
- Preserve existing admin authorization, local-only photo processing, and poster export behavior.

## Review Focus
- Very narrow mobile widths and text zoom must not cause horizontal scrolling.
- Changing tracks must reset the degree to the correct deck/engine default.
- Percentage offsets must preserve the previous approximate adjustment range.
- The generated image must still export at 2048 × 2048 with the existing artwork and portrait behavior.

---

### Task 1: Responsive editor, constrained choices, and percentage controls

**Files:**
- Modify: `src/index.css`
- Modify: `src/screens/AdminPosterGeneratorScreen.css`
- Modify: `src/screens/AdminPosterGeneratorScreen.tsx`
- Modify: `src/lib/posterTracks.mjs` and `src/lib/posterTracks.d.mts`
- Modify: `src/lib/posterLayout.mjs` and `src/lib/posterLayout.d.mts`
- Modify: `src/lib/renderPoster.ts`
- Test: `scripts/tests/admin-poster-route-test.mjs`
- Test: `scripts/tests/poster-tracks-test.mjs`
- Test: `scripts/tests/poster-layout-test.mjs`

**Interfaces:**
- `POSTER_DEGREES`: two `{ label, value }` options; values retain the full Bachelor of Science degree strings.
- `PosterContent.scalePercent`, `xOffsetPercent`, and `yOffsetPercent`: percentage values supplied by the form.
- `posterOffsetFromPercent(percent, dimension)`: converts a percentage to artwork-space units.

- [ ] Write the failing tests for the four tracks, two degrees, percentage offsets, and responsive CSS.
- [ ] Run `node --test scripts/tests/poster-tracks-test.mjs scripts/tests/poster-layout-test.mjs scripts/tests/admin-poster-route-test.mjs`; verify failures match the missing behavior.
- [ ] Implement the dropdown options, track metadata, and percentage-based portrait controls.
- [ ] Exempt only `.admin-poster` from the generic 560px desktop cap; use the percentage grid and mobile stack.
- [ ] Run the focused poster tests, then `npm run test:security` and `npm run build`.
- [ ] Review the diff and open a focused pull request. Do not merge or deploy without authorization.

### Task 2: Match sample typography and track-specific examination headings

**Files:**
- Modify: `src/lib/posterLayout.mjs` and `src/lib/posterLayout.d.mts`
- Modify: `src/lib/posterTracks.mjs`
- Modify: `src/lib/renderPoster.ts`
- Test: `scripts/tests/poster-layout-test.mjs`
- Test: `scripts/tests/poster-tracks-test.mjs`
- Test: `scripts/tests/admin-poster-route-test.mjs`

- [ ] Add failing tests for largest-font-first wrapping, sample-aligned text positions, and all four track headings.
- [ ] Verify the current renderer fails those assertions.
- [ ] Implement explicit-newline-aware fitting, a shared poster text layout, and the four requested exam descriptions.
- [ ] Verify focused tests, the full PWA CI suite, and a rendered production preview before merging.
