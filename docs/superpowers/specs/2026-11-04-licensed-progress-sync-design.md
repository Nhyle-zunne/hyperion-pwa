# Zero automatic progress traffic without an active license

User authorized implementation, verification and deployment directly. Execute inline.

Use the existing cryptographically verified entitlement lease, bound to its account,
to decide whether PWA background progress/archive traffic may start. Unknown, guest,
free, expired and revoked states fail closed. Signed administrator grants qualify.
This is scheduling, never authorization: server-side question and license checks
remain authoritative. No editable user metadata grants access.

Separate account-local initialization from cloud hydration. Every authenticated
account gets owner-isolated encrypted recovery and local session/history behavior,
even offline or unlicensed. Account switching preserves the old encrypted cache,
clears live state before restoring only the new owner's cache, and invalidates old
responses. Keep guest migration into the first account compatible; never migrate
one signed-in account's state to another. Serialize owner transitions.

Gate every progress and archive network boundary, including retry/conflict reads,
recovery and missing-archive fallback, and recheck after awaits. Cancel timers and
invalidate in-flight application of results when eligibility ends. Existing issued
requests cannot be unsent; they must not acknowledge/delete newer local work or
apply old-account/expired responses. Keep local dirty work and historical cloud
records untouched. Do not delete any production data or change revision retention.

On verified activation/renewal, automatically hydrate the existing account cloud
row, merge eligible same-account local dirty work with current conflict/tombstone
rules, then resume meaningful writes and archive batches. Do not upload before the
cloud baseline is known. Auth/license/payment calls remain functional.

Audit the Edge function and Android backup rights. Prefer PWA request gating over
blanket server denial: old Android clients and expired owners retain historical
backup rights, and server checks still sanitize protected content. Add backend
work only if the audit shows a safe compatible need. No schema/data migration.

Free Reviewer delivery and its online-only checks stay on Cloudflare/GitHub. No
new premium, offline bank, bookmark or mistakes unlock. Cached paid question access
must continue checking verified track access when opened.

Alternatives considered: server-only refusal still incurs Edge requests and could
break old clients/backup rights; filtering individual call sites independently
risks missed retries and account races. Shared account-bound eligibility plus a
local-first lifecycle is the chosen implementation approach.

Implementation safety details from review: cloud scheduling requires a successful
current-session signed server verification; cached signed grants alone continue
local/offline study rights. Reconnect verifies before scheduling. Account identity
changes synchronously and closes archive reads/study views until owner restore is
complete. Complete target snapshots are encrypted before publishing partial state;
interrupted targets retain their complete cache rather than backing up partial
fields. Essential account/checkout/auth routes remain available during switching.
