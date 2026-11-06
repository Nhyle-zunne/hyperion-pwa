# Narrow diagnostic log searches

Supabase Log Query measures log data scanned by Studio, APIs, CLI tools, and coding assistants. It is separate from normal application database queries and from log ingestion. The application and CI contain no automatic Supabase log-search loop as of this review. This policy guides future investigations; it does not configure Studio defaults, restrict third-party tools, or remove usage already recorded.

## Investigation procedure

1. State the incident and use existing evidence first. Inspect source, local regression results, deployment status, or a supplied export before querying production logs. Routine deployment acceptance uses the existing live-release verification, not a Supabase log scan.
2. Start with a window of at most 15 minutes containing the incident. If its time is unknown, use the latest 15 minutes and disclose that scope. Preserve the user's explicit historical time range when one is requested; do not silently substitute a different period.
3. Pass explicit `iso_timestamp_start` and `iso_timestamp_end` values to `supabase_query_logs`; omitting them can default to 24 hours. Convert reported Philippine time to UTC or include its `+08:00` offset.
4. Filter by the relevant source and, where known, endpoint, request ID, response status, or error inside the query. Do not fetch all sources just to filter locally. Use aggregate counts or a compact error summary first; retrieve individual entries only when necessary. `LIMIT` bounds returned rows, not necessarily the data scanned.
5. If the first result is inconclusive, adjust the filter or widen the time range only as needed and record the reason. An empty 15-minute result cannot establish that an issue never happened. Avoid repeated overlapping scans and do not poll the logs API.
6. Report the time window, filters, finding, and limits of the evidence. Do not claim measured savings from this policy alone; compare usage trends after representative diagnostic activity.

## Supabase Studio

Before running a search, choose the smallest useful custom time range, select the relevant service, and include endpoint/error filters in the query. Avoid repeatedly refreshing the same broad historical search. Repository rules cannot automatically enforce these choices in a person's browser or in an external monitoring integration.

## Preserve observability

Do not disable authentication, payment, entitlement, security, or recovery logging to reduce log-query usage. Do not delete production records or shorten recovery retention as part of this policy. Continuous monitoring needs a separately evaluated design; this change does not install log drains or introduce another paid service.

Reference: [Supabase Log Query usage](https://supabase.com/docs/guides/platform/manage-your-usage/logs-query). Plan allowances and enforcement can change; verify the current dashboard and official documentation before a plan downgrade.
