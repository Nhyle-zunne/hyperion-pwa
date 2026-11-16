# Choice keyword highlighting implementation plan

**Goal:** Extend the existing keyword editor to answer-choice words and punctuation, and prevent answers being selected or checked while editing.

**Design:** Reuse the existing yellow highlights and single Edit Keyword / Save Keywords control. A question-scoped editor shares its draft with the stem and choices. Choice identity uses exact choice text so shuffling cannot move highlights to another answer. Preserve legacy stem word indices; append punctuation/symbol token identifiers after word identifiers. Existing encrypted local storage remains in use. An explicit save persists all fields together; failed saves retain the draft. Navigation and disabling highlights discard unsaved drafts.

**Scope:** PWA practice/drill, continuous mock, Quick Scan and session history; the native Android counterpart is implemented independently in hyperion-reviewer. No banks, answer keys, licenses, backend protocols or payment changes. No signed Android release. Work on focused branches and review before integration.

- [x] Add a failing browser regression for choice editing, punctuation, no answer selection/checking, persisted shuffled-choice identity, old stem selections, save failure and draft discard.
- [x] Add token parsing and a shared question editor; retain legacy saved arrays and encrypted persistence.
- [x] Wire choices into every existing keyword surface; use non-answer containers while editing so token controls are never nested inside answer buttons. Guard pending-answer checks and auto-advance.
- [x] Run keyword browser tests on mobile and desktop, security checks, TypeScript/build and affected practice/mock/history browser regressions. Review both repository diffs and record native CI evidence.

**Review focus:** repeated words; punctuation/emoji/blanks; shuffled or revised choices; existing legacy highlights; keyboard activation and automatic answering. Tests must exercise these states without modifying real accounts.

## Verification and review

The existing punctuation regression failed before implementation (no punctuation target). A fresh review identified independently removable compound punctuation and preservation of historical choice revisions; browser repros were added and pass after the fixes. Legacy word selections expand to explicit internal-symbol positions once, while new saves preserve independently cleared punctuation. Saving retains other exact-choice hashes, including historical sessions.

Passed locally: keyword token/migration checks; keyword editor browser checks (desktop and mobile, keyboard, punctuation/blanks, offline save/reload, legacy storage, failed writes, shuffle and revised/historical choices); actual App practice/direct-answer/continuous-mock checks at 390 and 1440px; saved-data recovery browser regression; Quick Scan browser regression; practice refresh across 79 sessions in all five tracks; repository skill checks; release-security smoke checks; production TypeScript/Worker checks and build. Tests use synthetic data and block external services. Native Android validation is recorded in the separate repository PR.

No bank files, answer keys, account data, licenses, backend protocols or payment logic changed. Duplicate exact choices intentionally share highlights because their text identity is identical. Native Android signing/store release is outside this change.
