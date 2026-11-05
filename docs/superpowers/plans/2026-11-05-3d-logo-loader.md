# 3D logo loader implementation plan

**Goal:** Replace the pulsing logo/rings with a compact 3D Hyperion logo cube, turning above a shadow like the supplied GIF.

**Architecture:** Reuse TopLoadingIndicator, its existing loading lifecycle, and the precached /logo.png. Render six CSS-transformed faces with navy/gold branding, isometric rotation and a coordinated shadow. Retain the slim progress bar and accessible loading labels. No dependencies or generated image assets.

**Spec:** User request and attached 1000030694.gif; the proposed cube carries the existing logo on its faces. Keep the transparent overlay at the top of the page and preserve pointer access to the page underneath.

**Tech stack:** React, TypeScript, CSS 3D transforms; existing isolated Playwright account fixture.

## Review focus

- Mobile sizing and clipping: inspect 390px and desktop previews.
- Face orientation: inspect multiple quarter turns; avoid a mirrored logo or gaps.
- Loading completion and overlapping tasks: verify the indicator remains until all tasks finish.
- Reduced motion: show a stationary isometric logo and shadow.
- Offline branding: reuse the exact precached local logo path.

## Task: Replace the loader visual

- [x] Extend the isolated browser fixture with the real loader and synthetic loading controls. Add rendering, rotation, loading lifecycle, and reduced-motion assertions; verify the new visual check fails first.
- [x] Replace ring markup/CSS with six cube faces and a shadow; keep the existing lifecycle and progress track. Remove smoke assertions that enforce the superseded ring design.
- [x] Run account browser regression, security smoke checks, and production build. Inspect mobile/light and desktop/dark previews at multiple animation phases.
- [x] Review the focused diff and open a review PR. Production deployment remains a separate user action.

## Verification record

The new browser check first failed because the previous loader had no 3D cube. The completed implementation passed the account browser regression, `npm run test:security`, and `npm run build`. Browser coverage samples distinct 3D transforms, confirms pointer access and local logo loading, exercises overlapping loading tasks and completion, and disables cube/shadow motion for reduced-motion users.

Inspected 16 rotation phases in mobile light and dark themes, plus a desktop dark preview. Review found no blocking issues; the image check now waits for decoding to avoid a slow-asset race. No physical-device or production acceptance testing was performed. The GIF informs the isometric cube/shadow motion; a 2.4-second turn keeps the logo readable.
