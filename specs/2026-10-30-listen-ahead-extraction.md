# Listen-ahead extraction — implementation spec

Epic approved 2026-10-30 (decision O15: text is prepared only for listening, a few pages ahead, like the audio). This
spec supersedes §5.2 of the audio pipeline spec ([job-orchestration.md](2026-10-12-audio-pipeline-rebuild/job-orchestration.md)): the chunk plan (the realtime head and the whole-book
tail) and the prefix-only finalisation.

**Goal:** text and audio are prepared together, N pages past the listener (default 2), never the whole book. Read mode
prepares nothing: the reader reads the scanned PDF page.

## 1. Target shape

```diff
  POST /process {fromPage}                       (Listen mode, first open, or switching to Listen)
    plan job: count pages (pdfinfo, free) ─▶ pages rows 1..N ─▶ books.total_pages
-   ─▶ chunk jobs over the WHOLE book (p..p+9 realtime, 1..p-1 realtime, the rest batch/realtime)
+   ─▶ ensureText(p-1 .. p+N+1)                  one extract_pages job for the pages not done and not queued

  POST /listen {fromSeq | fromPage}
+   ─▶ ensureText(p-1 .. p+N+1)                  p = fromPage, or the start page of fromSeq's segment
    ─▶ planWindow(p .. p+N)                      unchanged: audio for the current page + N read pages
-   ─▶ stops at the end of the prefix (pages 1..D)
+   ─▶ stops at a page with no text yet: 'processing' + listen_followup (as today)

  finalize after each page
-   one prefix from page 1, carry the open tail, seq = 1..n, compare-and-set finalized_through_page
+   runs of done pages anywhere in the book; rebuild the touched region and replace it atomically;
+   seq = start_page × 1000 + index on that page (gaps allowed, stable when runs join)
```

Text runs one page past the audio window (`p+N+1`) so the last paragraph of page `p+N` can close before it is voiced,
and one page before it (`p-1`) so the listener's first paragraph knows whether it began on the previous page.

## 2. Data model

| Change | Migration | Why |
|---|---|---|
| `segments.status` gains `'head'` | `20261031_01_segment_runs.sql`: drop and re-add the check constraint | The first paragraph of a run whose previous page has no text yet. It may continue that page; the window planner waits on it like an `'open'` segment. |
| `replace_segments(p_extraction uuid, p_from_page int, p_to_page int, p_rows jsonb)` RPC | same file, `security definer`, `service_role` only | Deletes the extraction's segments with `start_page` in `[from, to]` and inserts the rebuilt rows in one transaction. A crash leaves the old region or the new one, never half. |
| Seq rewrite of every existing extraction | data step, run by `scripts/resegment.js --apply --all` after the migration | Old seqs are 1..n; the new scheme is page-anchored. Audio is keyed by text hash, so every clip is kept. |
| `user_profiles.listen_pages_ahead int not null default 2 check (between 1 and 5)` | `20261031_02_listen_pages_ahead.sql` (story 3) | The Settings choice. |

`finalized_through_page` stays, now meaning "the last page of the run that starts at page 1" (written, not read for
control flow). `book_extractions.status`: `complete` when every page has text; `running` while jobs are outstanding;
`partial` when idle with pages left. `partial` is the normal resting state of a book being listened to.

## 3. Stories

Gates for every story: `cd backend && npm test && npm run lint` (no new lint errors), `cd frontend && npx tsc --noEmit
-p tsconfig.app.json && npm run build`. Live checks on the 27-page test book `3aaf8d3d` only.

### Story 1 — Text follows the listener (M) · Opus

Backend:
- `extractionService.ensureText({extraction, pages, userId})`: drop pages that already have this extraction's text or
  sit in a queued/running job's `payload.pages`; enqueue one realtime `extract_pages` job for the rest. Key
  `extract:<id>:w<first>-<last>:<n>` (`n` = next free round for that range, so a later window over the same pages after a
  failure is not swallowed by the old key). Priority 10. Pages past `pages_total` are clipped.
- `runPlan` counts pages, writes `pages` rows and `total_pages`, then calls `ensureText` for `fromPage-1 .. fromPage+N+1`.
  `planChunks`, the batch tail and `requeueMissingPages`' whole-book sweep go; a retry re-queues only failed pages
  inside the requested window.
- `POST /listen` accepts `fromPage` as an alternative to `fromSeq`; it calls `ensureText` before planning and wakes the
  runner. Before the plan job has run (`pages_total` null) it answers `stopReason: 'processing'`.
- `N` = `config.audio.pagesAhead`, default changes 1 → 2 (story 3 replaces it with the reader's setting).
- Status: `complete` / `running` / `partial` as §2.

Frontend:
- `useBookProcessing`: `partial` is no longer "start again"; it calls `POST /process` once per opening with the
  current page (it already sends no page; send `pageNumber`).
- `ExtractedTextView`: "Preparing this book… x of y pages" becomes "Preparing the next pages…" while the current
  page has no text; pages without text show nothing (the Text view only covers prepared pages).

Acceptance criteria:
- [ ] Opening a Listen book at page p queues extraction for p-1..p+3 only (N = 2); no other page is extracted.
- [ ] Listening from page p+2 queues p+1..p+5 (pages already done are not queued again).
- [ ] Read mode and uploads queue no extraction job.
- [ ] Two listen calls in a row for the same window queue one job.
- [ ] A failed page is retried only when a window that contains it is requested again.
- [ ] Tests: `ensureText` dedup against done and queued pages; `/listen {fromPage}` before and after the plan job.

### Story 2 — Paragraphs from any page (L) · Opus

Backend, `finalizeOnce` rewritten around runs:
1. `done` = page numbers with this extraction's text. Runs = maximal contiguous ranges of `done`.
2. For the pages that became done since the last pass, take each run they belong to. The **region** to rebuild is
   from the start page of the segment that ends on the page before the new pages (only when that segment is `'open'`)
   to the end page of the run; when the run now reaches the next run, the region also covers the next run's `'head'`
   segment(s). A run's first page is its region start when nothing before it is done.
3. `buildSegments(pagesOfRegion, { moreToCome: regionEnd < total && !done.has(regionEnd + 1) })`, plus a new option
   `headUnknown: regionStart > 1 && !done.has(regionStart - 1)` that marks the first segment `'head'` when it is a body
   block (a heading cannot continue a sentence).
4. Seq = `start_page × 1000 + i`, `i` counting the segments that start on that page within the region (start pages
   never move across a region boundary, so `i` is the same as a full rebuild would give).
5. `replace_segments(extraction, regionStart, regionEnd, rows)`; then pages_done / status / `finalized_through_page`
   as §2, and `wakeFollowups` as today.

The pass is idempotent: replaying it rebuilds the same region to the same rows. `resegment.js` rebuilds every run of
an extraction the same way (`--all` loops over extractions).

`windowService.planWindow`: a `'head'` segment stops the walk with `'processing'` (like `'open'`), and so does a gap:
the next segment starts after a page inside the window that has no text. `getSegments` keeps `fromPage`; `atChar` is
replaced by `atPage`.

Frontend:
- `useSegmentPlayback`: drop the `seq + 1` / `seq - 1` guesses. Next = the next loaded segment, else
  `listen({fromPage: endPage + 1})`. Previous = the previous loaded segment, else load from `startPage - 1`.
  `seqForPage` past the known text returns a `fromPage` request instead of `lastSeq + 1`.
- Book progress bar becomes page-based: position = (current segment's page − 1 + fraction of its parts heard) /
  `pagesTotal`; a seek goes to a page and plays from it (`atPage`). The known-chars estimate goes.
- `readingPosition`: a stored seq that is not on the stored page is ignored; the page wins (old seqs change in the
  rewrite).

Acceptance criteria:
- [ ] Jumping to page 20 of a book with pages 1–5 done extracts 19–23 only; pages 6–18 stay without text.
- [ ] The paragraph that starts on page 19 and ends on page 20 is one segment, voiced once.
- [ ] Filling the gap later joins the two runs: the open tail of page 18 and the head of page 19 become one segment;
      every other segment keeps its seq and its audio.
- [ ] Replaying any finalize pass leaves the rows unchanged (test).
- [ ] The seq rewrite on the test book keeps every `segment_audio` row usable (same text hashes; checked by script).
- [ ] Next / previous paragraph and the progress bar work across a gap and at the end of a run.

### Story 3 — "Pages ahead" setting (S) · Sonnet

- Migration §2; `GET/PUT /api/profile` (existing profile route) carries `listenPagesAhead`.
- `windowService.listen` and `ensureText` read the listener's value, falling back to `config.audio.pagesAhead`.
- Settings page, Listening section: "Prepare ahead" select, 1–5 pages, default 2, helper text "More pages ahead means
  fewer pauses, and uses more of your daily pages if you skip ahead." (pages only count when heard, so the helper text
  must not claim preparing counts; final copy at build time).

Acceptance criteria:
- [ ] Changing the setting to 4 makes the next listen queue p-1..p+5 and audio for p..p+4.
- [ ] The value survives a reload; values outside 1–5 return 400.

### Story 4 — Copy fixes (S) · Sonnet

- `BookModeChoice` Listen card: drop "Preparing the text takes a few minutes" → "Read aloud paragraph by paragraph."
- `ModeSwitch` dialog: drop "the rest follows while you listen" → "The next pages are prepared as you listen; the
  first ones take a few seconds. Each page you listen to counts toward your daily pages."

## 4. Order and gates

Mode switch (uncommitted) is owner-tested and committed first. Then 1 → 2 → 3 → 4 on `feat/audio-pipeline-rebuild`,
each committed after its gates. Story 2's migration and the seq rewrite go to the owner as approval cards before they
run. Story 1 alone already stops whole-book extraction (a jump still extracts every page between the run and the
target until story 2 lands); story 1 is not shipped to anyone without story 2.

## 5. Risks

| # | Risk | Mitigation |
|---|---|---|
| L1 | A `'head'` segment voiced, then changed by a join → its clip is orphaned | The planner never voices `'head'`; text is always prepared one page before the listener |
| L2 | One `extract_pages` job at a time: two listeners on different books wait for each other (~15 s per window) | Windows are 4–5 pages; raise the cap only if seen |
| L3 | Seq rewrite breaks stored reading positions | Page wins over seq (story 2); clips are kept |
| L4 | `'partial'` read elsewhere as "failed" | Consumers listed: `useBookProcessing`, `ExtractedTextView`, `extractPages` handler; each changed in story 1 |
| L5 | A window queued past the daily allowance spends text money on pages never heard | Text only: ~$0.005/page, ≤ 6 pages per window |
