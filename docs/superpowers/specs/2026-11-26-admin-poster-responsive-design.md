# Hyperion Admin Poster Generator Responsive Follow-up Design

## Intent
Make the passer poster generator practical to use on desktop, tablet, and mobile, while limiting its choices to the four active Hyperion license tracks and two degree programs.

## Requirements
- Track dropdown contains only OIC-NW, OIC-EW, CAPT., and C/E, in that order.
- Degree dropdown contains only Marine Transportation and Marine Engineering. The selected value renders as the full Bachelor of Science degree title.
- Track selection sets the matching deck or engine degree default and examination heading.
- Desktop uses a percentage-based two-column layout: 40% candidate form, 2% gap, remaining width for the live square preview.
- At widths of 950px and below, form and preview stack at full width. No horizontal overflow.
- The shared desktop 560px screen cap must not apply to the poster generator.
- Portrait scale, horizontal movement, and vertical movement are expressed as percentages. Convert movement to artwork coordinates only inside the renderer.
- Preserve local-only photo processing, existing admin authorization, Hyperion artwork, sharp corners, 2048 × 2048 PNG output, and existing download behavior.

## Approaches
1. **Selected: scope the global width exception to the poster screen and use a fluid percentage grid.** Fixes the actual cause without changing other pages; keeps the existing React/CSS/Canvas architecture.
2. Add a more-specific width override only in the poster stylesheet. Smaller selector change, but leaves the global rule unexpectedly competing with the poster screen.
3. Widen every standard screen. Not selected because it changes unrelated account and study pages.

## Non-goals
- No changes to authentication, licensing, payment processing, Supabase data, or photo storage.
- No additional tracks, degree values, backend image processing, or new dependencies.
- No changes to the generated artwork's design or portrait segmentation algorithm.
