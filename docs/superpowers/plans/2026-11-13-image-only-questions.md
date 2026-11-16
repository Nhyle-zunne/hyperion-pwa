# Image-only question prompts

Allow a blank question stem only when valid HYPERION_MEDIA includes a question-placement image. Do not require the admin to type a description; preserve the existing generated nonempty accessibility label. Explanation-only, malformed or missing attachments cannot authorize empty questions. Preserve choices, answer keys, row order, IDs, retirement and entitlement checks.

Update direct editor parsing/validation, server parser and generated Worker codec, client offline parser and native loaders/persistence. Test blank prompts through apply, queue, validation, delivery/counts, saved reload and review, with strict rejection cases and neighboring identity preservation. Audit counts/cache version changes. Do not modify production banks or attach photos as tests. Deploy the PWA and necessary server parsing fix after verification; Android code needs its own app release.

Production question-bank currently has intentional count/retirement divergence from repository. Deploy only the parser changes onto its retrieved current source; preserve all other live behavior. Keep a local before snapshot for comparison/rollback and validate the patched source before deployment.

## Verification and deployment

- 76 Bun unit tests across 16 files pass, including strict image-only prompt/letter-choice validity and short normalized GMDSS files; unchanged text-question identity and choice shuffle behavior remain compatible.
- Admin browser verifies a genuinely blank question stem survives apply, queue and validation with the uploaded reference. Fourteen media browser scenarios pass, including real image decoding, saved rehydration and blank-stem mock rendering.
- Fingerprint regression confirms client, question-bank and learning-progress parity; different scans differ, alt-only changes do not; old derived caches invalidate. Publisher tests reject swapping image-only scans but permit an in-place image correction. Security and production build pass; both repository and patched live function Deno checks pass.
- Production functions deployed: learning-progress v134 (verify_jwt=true), question-bank v328 (existing manual-auth gateway setting preserved). Targeted changes applied to retrieved live source; unrelated count/retirement differences preserved, with no question-bank data writes or real image uploads as tests.
- Native changes receive separate CI/review through Android PR22. Shipping the native binary and updating packaged banks remain release actions; smart-bank refresh/signing/version flags are unchanged.
- Existing image entitlement rules remain in force. The free-sample caveat in the attachment guide continues to apply; this change does not grant anonymous image access.
