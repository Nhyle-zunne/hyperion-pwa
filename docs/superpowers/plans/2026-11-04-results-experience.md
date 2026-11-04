# Results experience implementation plan

**Goal:** Match Android's processing sequence and results layout for scored practice, drills, and mock exams. Quick Scan is excluded by the user's clarification.

**Architecture:** Keep scoring, completion persistence, mock-plan weighting, saved-session recovery, and licensing unchanged. A presentation-only overlay follows the existing finishing state, stays visible for Android's three-second sequence, and remains until saving completes. Saving failures dismiss it so the existing retry action remains available. Overall mock submission triggers the same presentation. Shared results content uses the current session's questions and answers, with a score banner, competence breakdown, question review, missed-only filters, and existing navigation actions.

**Layout:** Use the competence-selection desktop width (560px); wrap question text and actions on mobile. Mirror Android's four processing stages and support reduced motion. No answer content is copied to new persistent storage.

## Implementation

1. Add an isolated browser regression for real scored-session completion, processing timing, save failure/retry, filters, unanswered items, score/history preservation, and desktop/mobile width.
2. Confirm it fails before implementation.
3. Add shared results and processing components; integrate with PracticeQuizScreen, MockExamRunner, overall mock submission, and App.
4. Run browser and TypeScript/security checks, inspect screenshots, request one independent review, then run full CI on a focused PR.

## Safety checks

Results appear only after durable session completion. An animation must not delay or change persistence, compute a different score, expose paid content through a new cache, or erase saved progress. Repeat clicks, reset/new-session changes, slow writes, and failed writes must not leave a blocking overlay or duplicate history.

## Local verification

The new browser regression first failed because Processing Results was absent, then passed after implementation. It covers practice, drill, standalone and managed mock completion, the three-second sequence, slow writes, save failure/retry, repeated submission, reset, weighted mock preservation, durable audits, competence/missed filters, unanswered items, keyboard tabs, reduced motion, and desktop/mobile width. Frontend TypeScript and release-safety smoke checks passed. Desktop/mobile results and processing screenshots were inspected. The underlying practice store and archive/scoring code were not modified.
