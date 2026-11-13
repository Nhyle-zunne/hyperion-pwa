# Bond Store and purchase popup visual consistency

User request: make the inconsistent store and Unlock FULL reviewer popup feel coherent and less generic. Apply the existing Hyperion artwork, navy and green palette with modest corners and restrained decoration.

1. Use shared 10px card and 6px control corner tokens. Remove the popup’s redundant nested card outline, simplify banner decoration, and align purchase actions to a high-contrast green/white treatment.
2. Refine shared type weight, selected-duration feedback, focus and hover styling. Preserve supplied sprite artwork, all nine features, card expansion behavior, responsive grid, prices, term selection, sign-in and verified checkout behavior.
3. Check real computed styles and responsive behavior with synthetic account/media browser fixtures, both themes, small phones and desktop. Run security and production build checks, obtain independent review, and deploy under the user’s standing release instruction.

Scope: frontend styles and CSS class hooks only. No Supabase, licensing, payment or question-bank logic changes. Preserve the existing uncommitted AGENTS.md preferences.
