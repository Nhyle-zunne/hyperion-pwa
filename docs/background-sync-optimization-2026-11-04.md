# Background sync request reduction

## Changes

- Cloud collection recovery runs for an unrecovered account/version. Only an
  explicitly successful response records completion. Failed attempts pause for
  15 minutes; an absent cloud profile can request recovery again after 15 minutes.
  Healthy restores no longer run recovery on every reconnect, retry or reload.
- Restore/upload failures use one retry timer with 30-second exponential backoff,
  capped at15 minutes. A reconnect can retry promptly without repeated wake events
  bypassing failure backoff. Fresh account authentication resets its retry state.
- Initializations coalesce within the current authentication epoch. Sign-out,
  account switches and cleanup invalidate old responses immediately. Requests bind
  to the captured user's JWT; delayed responses cannot change another account's
  cloud version or restoration state.
- Archive-only saves debounce scans and no longer dirty the whole progress
  snapshot. Pending ID sets are unioned, and snapshots stream into batches of up
  to 10 items with a 1 MiB target size. A single larger archive retains the existing
  server 8 MiB request limit. Records are still encrypted and saved locally first.
- The backend validates and authorizes every batch item before one atomic upsert.
  Completed-audit immutability remains enforced by the existing DB trigger. The
  client advances markers only for a complete, explicit acknowledgement. Failed
  work remains local for the existing retry/reconnect/save paths.
- Identical manual archive reads coalesce; downloaded snapshots receive synced
  hash hints so they are not immediately uploaded unchanged. Manual reads remain
  independent of background backoff. Legacy single-session actions still work.

No database migrations, question IDs, license rules, user records or purchases
were changed or deleted. Deploy backend support before releasing this frontend;
`scripts/deploy-learning-progress.mjs` checks the batch action and JWT enforcement.

## Logging and test traffic review

The learning-progress path has no routine success logging to remove. Most server
application logs inspected concern payment/security failures or reconciliation;
those operational records were retained. Browser console warnings do not consume
Supabase log ingestion. Fewer backend requests also mean fewer gateway/DB logs.

Recovery, publisher and sync browser fixtures now build with empty production
Supabase configuration. Network guards abort external requests and assert that no
production requests were attempted. Existing small post-deployment read-only
checks remain deliberate release verification. No broad production log scans or
synthetic user-data writes were used to test this stage.

## Verification

- Four request-policy and three archive-batch utility tests.
- Real Edge handler tests cover JWT account scoping, batch limits/duplicate IDs,
  complete acknowledgements, authorization before any write, historical owners,
  failure responses, and legacy recovery/archive contracts.
- Focused real-browser encrypted-IDB regression: 23 queued archives use 3 writes;
  overlapping requests retain every ID; unchanged/downloaded snapshots make no
  redundant writes; failed batches retain local data and later recover; recovery
  completion persists across reload; restore retries back off; late old-account
  acknowledgements never mark another user's data as saved.
- Review found a same-account reauthentication/remount race in coalescing. A
  regression reproduced it (2 reads instead of3); authentication epochs fix it.
  Tests cover both rapid A-to-B-to-A authentication and cleanup/restart while a
  previous read is pending.
- Existing full saved-data/browser, publisher, production build/auth, SQL
  preservation/recovery, security and offline build checks pass locally.

These are per-operation improvements. A full day of post-release usage is still
needed to assess the billing trend; historical billing totals do not reset.
