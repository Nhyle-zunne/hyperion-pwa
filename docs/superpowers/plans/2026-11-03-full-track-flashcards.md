# Full-track Flashcards Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement inline, preserving the user's existing main-branch workflow.

**Goal:** Remove the redundant track switcher, match the Practice All Questions competence directory, and make every question in the selected licensed track reachable through flashcards.

**Architecture:** Build a deck manifest from existing verified competence/part counts. Load 50-card windows using the existing authorized question pagination and offline-pack fallback. Advance grades only after the next window succeeds; retain the current card and counters on failure.

**Tech Stack:** React, TypeScript, existing protected question-bank client, Playwright browser fixture.

**Spec:** User request in this conversation on November 3, 2026 (Asia/Manila).

## Global Constraints
- Preserve license checks, offline grants, bookmarks and other saved study data.
- Keep the track from the route; remove in-screen track selection.
- Reuse existing question endpoints; do not increase server page limits or request raw bank assets.
- Keep the polished card layout and grading controls.

## Review Focus
- A track or competence containing more than 20/30 questions must not be silently truncated.
- GMDSS parts and multiple competences must retain correct ordering and counts.
- A failed page load must leave the current card and grade counts intact.
- Route changes/unmount must not apply a stale deck load.
- Complete downloaded packs must supply the same ranges offline through existing license checks.

### Task 1: Full-track paginated deck
**Files:** Create `src/lib/flashcardDeck.ts`; modify `src/screens/FlashcardsScreen.tsx`; test `scripts/tests/recovery-bank-fixture.ts` and `scripts/tests/recovery-browser-test.mjs`.
- [x] Add a synthetic deck larger than one page and verify traversal, group boundaries and page-failure retry.
- [x] Build verified manifests and bounded range loading; use them in the screen instead of sampled decks.
- [x] Verify counters and answers remain unchanged after a failed next-page request.

### Task 2: Selected-track competence directory
**Files:** Modify `src/screens/FlashcardsScreen.tsx` and `src/screens/FlashcardsScreen.css`.
- [x] Remove the track selector and 20-card sample copy.
- [x] Match Practice All Questions directory card structure and display verified question counts.
- [x] Run production build, security/offline-build checks and the full saved-data browser regression; inspect desktop/mobile screenshots.
- [x] Commit and push the verified changes to main per the user's standing preference.

## Verification record
- Before implementation, the updated browser regression failed because the redundant track navigation was still present.
- Final browser regression traversed all 65 unique synthetic questions in order across two competences and multiple parts, verified the selected competence contains 35 cards, and verified failed next-page requests preserve the current card and final grade totals.
- Production build, release security smoke checks and generated offline app-shell checks passed.
- Desktop/mobile screenshots inspected; the directory uses the Practice All Questions card structure and has no track switcher.
- Independent read-only review found no actionable issues in traversal, part offsets, retry state, async cancellation or existing license/offline delivery paths.
