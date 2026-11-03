# Quieter background progress and archive sync

User approved executing the next optimization stage. Preserve encrypted local
saving, account isolation, actual license checks, version conflicts, retries and
immutable completed audits. No saved-data migration or deletion.

Versioned account-local recovery markers suppress routine cloud recovery after
an explicitly successful response. An absent cloud row can request recovery again
after 15 minutes. Failed recovery remains eligible after 15 minutes; it is never
acknowledged as complete. Hydration failures retry exponentially30 seconds to
15 minutes, with one timer and one in-flight initialization per account. A real
reconnect can retry promptly, limited to one wake override per30 seconds.

Archive saves debounce background scans; overlapping scans union their IDs rather
than replacing queued work. Changes continue saving locally immediately. Upload
up to 10 pending archives per request, using a 1 MiB target payload bound and allowing
an individual larger snapshot through the existing 8 MiB server safety limit. The
server verifies ownership from JWT, loads historical backup entitlements once,
sanitizes every item before one atomic bulk upsert, and returns explicit saved IDs.
No marker advances without acknowledgement of every requested ID. Old single-read
and write actions remain supported. Manual audit reads stay independent of
background backoff; identical simultaneous reads coalesce. Downloaded snapshots
are marked synced so they do not immediately upload again.

Alternatives: skip whole sync on timers would delay real edits; changing snapshot
merge semantics or deleting archives would risk saved work. Batch only uploads;
keep manual and background read access checks unchanged. Deploy compatible backend
before the frontend. No silent fallback to unsupported legacy response shapes.

Review routine logs and production tests. Retain security/payment failure logs;
add a fixture network boundary where needed instead of removing useful diagnostics.
Measure actual post-release traffic separately from cumulative billing totals.
