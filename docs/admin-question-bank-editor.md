# Admin question search and editing

Choose a track and a single competence to browse its bank, or choose **All competences** in the dropdown to search every bank in that track. **All tracks** searches across all five tracks. Competences and GMDSS parts appear in numeric order (C1, C2, C10; Part 1, Part 2, Part 10).

Enter a question number or text and press **Search questions** or Enter. Searches are explicit rather than running on each keystroke. At most 100 matches are shown; refine the query if there are more. Each result identifies its track, competence, part and original question number. Selecting it opens that exact source bank. Question results scroll below the search control, and the list is capped to the form height without forcing an empty oversized panel.

Choice fields start one line high, including long choices. Scroll or resize them to read/edit longer text; prompts and explanations continue to fit their content. Add edited files to the queue in one action, then validate/review and publish separately. Opening another question cannot discard unqueued changes. Returning to a staged bank restores its queued CSV rather than replacing earlier edits with the published original.

Search results and queued drafts retain their bank revision. A clean editor reloads if newer results refer to the same bank; an older queued draft is preserved rather than silently replaced. To abandon such a draft, clear its queue, choose **Discard bank draft**, and reopen the result. No photo or question changes are published by searching or opening a result.

## Implementation limits

The admin-only Worker endpoint uses immutable GitHub bank files, not a Supabase database text scan. Each page freshly verifies admin authorization, processes at most twelve banks with four concurrent reads, and returns only bounded result previews (500 characters) plus source references. The client follows revision-pinned pages and renders results only after the search succeeds. Completed per-bank indexes are cached in the Worker for reuse; answers and raw CSV are not returned in search responses. Normal edit/publish authorization, origin checks, size limits, row identity checks and concurrency guards remain in place.
