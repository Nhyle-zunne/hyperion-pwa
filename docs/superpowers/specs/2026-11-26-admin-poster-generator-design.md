# Hyperion Admin Poster Generator Design

## Intent

Let Hyperion admins create square congratulatory posters for successful MARINA examinees directly in the PWA. The output should closely follow the supplied Hyperion OIC-NW sample, including its navy-and-gold nautical artwork, transparent anchor watermark, integrated right-side portrait, and the website in the footer. One admin should be able to prepare many different candidates and tracks without Photoshop.

## Scope

- Add a `POSTER GENERATOR` tab to the existing admin navigation, available only after the existing server-verified admin check. No new database tables, photo uploads to Supabase, or external image-storage services.
- Fields: full name, track, degree (editable; sensible deck/engine default), school, optional company, and examination date (editable for each poster). A candidate photo is uploaded locally.
- Automatically prepend the track's rank/title to the full name, never require the admin to type it. Defaults: `OIC-NW`, `OIC-EW`, `C/M` (Chief Mate), `CAPT.` (Master Mariner), `2/E` (Second Engineer), `C/E` (Chief Engineer). GMDSS GOC uses no invented shipboard rank, and its license designation appears in the examination title.
- Update the examination heading to match deck, engine, or GMDSS. The name, date, school, degree, and optional company use live text layers that cannot retain ghost text from prior candidates.
- Use the supplied `01_Background_Hyperion_Artwork.png` as the principal artwork, without the example candidate or placeholder labels. The footer replaces its existing centered social handle with Facebook `@HyperionMaritime` on the left and a globe plus `HyperionMaritime.org` on the right.
- Automatic, browser-side portrait segmentation removes photo backgrounds. Preserve the original visible RGB pixels, face shape, hair and uniform; alter only alpha transparency. Show the result before export and allow use of the unprocessed PNG if segmentation fails or the edge quality is unacceptable. Photo positioning/scale adjustments remain available.
- Provide a live, mobile-friendly square preview and export to a 2048 × 2048 PNG. The underlying artwork is 1254 × 1254 raster and will be scaled for export; the type overlay stays sharp.
- Preserve Hyperion's app-wide sharp 90-degree control corners. Use accessible labels, visible processing/error feedback, and responsive layout.

## Approaches

1. **Selected: local browser generator using Canvas and MediaPipe portrait segmentation.** Photos stay on the device, no payment-per-photo API, preview and download work from the same browser. The segmentation model may require an initial network download; device performance and hair-edge quality vary.
2. Server-side photo background removal and PNG rendering. Potentially more consistent, but requires image uploads, compute/storage infrastructure, and privacy controls.
3. Photoshop-only template. Gives manual control but fails the requested admin dashboard workflow.

## Non-goals and safeguards

- Do not manipulate facial features or generate a replacement likeness.
- Do not automatically post to Facebook or store generated posters.
- Do not alter existing licensing, checkout, authentication, or question-bank behavior.
- A portrait cutout is a best-effort matte. If it fails, show an error and leave the original photo available; never silently export a misleading replacement face.
- No automatic date inference from a prior example. The selected date is visibly editable, and the export uses that exact date.
