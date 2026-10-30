# Audio Pipeline Rebuild — Data model and API contract

Part of [the audio pipeline spec](../2026-10-12-audio-pipeline-rebuild.md) (§3, §4). Owner decisions (§9) live there and supersede this file where they conflict.

## 3. Data model — diff against the LIVE schema (revised 2026-10-16: subscription plans, O12)

Billing is a **subscription with a daily page limit** (O12). The per-token/per-second money model, credits, recording
ownership, donation and pay-it-forward rebates (O3–O6) are dropped; git history holds that version. Audio is still
generated once per paragraph and voice and reused by everyone — now purely a cost saving.

Every `+` below is a **SCHEMA CHANGE — REQUIRES OWNER APPROVAL** (migration files in the repo are the record; the owner
approves before they are applied). RLS: enable on every new table with **no policies**; the backend reaches them with
the service key and checks ownership in code via `supabaseService.ensureUserHasBookAccess(userId, bookId)`. The frontend
never queries these tables directly.

**Identity of "the same book".** `books.content_sha256` = SHA-256 of the PDF bytes. Two uploads of the same PDF share one
extraction. **Identity of a clip** = paragraph text hash × voice snapshot hash, so any book containing the same paragraph
read in the same voice reuses it.

```diff
 books            (id, user_id, parent_book_id, title, author, …, pdf_url, total_pages, visibility, processing_status, …)
+  mode               text NOT NULL DEFAULT 'read' CHECK (mode IN ('read','listen'))      -- O1
+  content_sha256     text NULL · INDEX                                                    -- backfilled by script
+                     total_pages finally written (pdfinfo, story 4). No column change.

 user_books       (user_id, book_id, last_read_page, …)
+  read_front_matter  boolean NOT NULL DEFAULT false                                       -- O8

 pages            (id, book_id, page_number, image_url, …)  -- rows bulk-created at extraction start. No column change.

 page_text        (id, page_id UNIQUE, extracted_text, extraction_confidence, extraction_metadata, processed_at, processing_duration_ms)
+  blocks jsonb · page_type text CHECK (13 types, O8) · extraction_id uuid FK book_extractions
+  prompt_version int · model text · image_sha256 text · validation jsonb
+  usage jsonb · cost_micros bigint   -- our provider cost for this page (micro-USD), to tune plan limits
+  extracted_text keeps the LEGACY {header:'', body, footer} string so /api/pages/* keep working

+page_skip_overrides   (user_id, book_id, page_number, skip, updated_at) PK (user_id, book_id, page_number)   -- O8

+book_extractions      (one versioned run per PDF content)
+  id · content_sha256 · source_book_id FK books · status (queued|running|partial|complete|failed)
+  model · prompt_version · dpi · pages_total · pages_done · pages_failed · finalized_through_page
+  started_by · started_at · finished_at · error · created_at
+  UNIQUE (content_sha256, prompt_version, model) WHERE status <> 'failed'

+segments              (playback unit: one paragraph or heading, stitched across pages, owned by its start page — O7)
+  id · extraction_id FK · seq · role (body|heading) · start_page · end_page · parts jsonb [{page, chars}]
+  text · text_sha256 · char_count · sentence_offsets int[] · footnote_markers text[] · status (open|final)
+  UNIQUE (extraction_id, seq) · INDEX (extraction_id, start_page) · INDEX (text_sha256)
+  Built for EVERY page with text; skipped pages are filtered per listener when the window is planned (O8).

+segment_audio         (content-addressed clip cache)
+  id · text_sha256 · voice_snapshot_sha256 · voice_snapshot jsonb {model, base_voice, instructions}
+  status (pending|ready|failed) · error · audio_url · audio_format · sample_rate · channels
+  duration_seconds numeric(8,2) · size_bytes · usage jsonb · cost_micros bigint · created_at · ready_at
+  UNIQUE (text_sha256, voice_snapshot_sha256)   -- a persona edit is a new snapshot hash ⇒ a new generation

+book_processing_jobs  (the queue; unchanged) · RPC claim_jobs (FOR UPDATE SKIP LOCKED, 5-minute lease)

+plans                 (id text PK 'free'|'basic'|'pro' · name · price_cents · currency · daily_page_limit · active · sort_order)
+                      seeded: free 0¢ 2/day · basic 500¢ 10/day · pro 1500¢ 50/day (owner defaults 2026-10-16; edit the rows)
+subscriptions         (user_id PK · plan_id FK plans · status (active|canceled) · started_at · ends_at · updated_at)
+                      no row, or not active ⇒ the free plan. Plans are assigned by hand until the payment story.
+daily_page_usage      (user_id · usage_date · book_id · page_number · first_listened_at)
+                      PRIMARY KEY (user_id, usage_date, book_id, page_number) — a page counts once per day
+RPC record_page_listen(p_user, p_book, p_page) RETURNS jsonb {allowed, counted, used, limit, plan}
+  one transaction per user (advisory lock): already counted today ⇒ allowed; under the limit ⇒ insert + allowed;
+  at the limit ⇒ not allowed. Day = UTC date.

 page_audio       (legacy) — 102 rows get audio_duration_seconds corrected by the backfill (data fix, not DDL)
```

**Daily limit rules (O12).**

| Situation | Counts? | Result |
|---|---|---|
| Listening reaches a page in Listen mode for the first time today | yes | allowed while `used < limit` |
| The same page again today (replay, seek back) | no | allowed |
| Limit reached | — | audio stops at the page boundary; Read mode, text view, chat and notes keep working |
| Read mode | never | — |
| Audio already cached | still counts | the limit is about pages heard, not our cost |

The window planner (story 5) never prepares audio for pages beyond the remaining allowance, so prefetching cannot
spend money the plan does not cover.

Rejected alternatives: **credits / per-second billing** (O3–O6) — dropped by the owner as too complex for the product
stage; **counting only newly generated pages** — tracks our cost but users cannot predict it; **a `recordings` table** —
without ownership, a clip only needs text hash × voice hash.

### 3.1 Migration and backfill plan

| Step | What | Data loss? | Who |
|---|---|---|---|
| M1 | `01_books_modes_and_skips.sql`, `02_extractions_and_segments.sql`, `03_segment_audio.sql`, `04_processing_jobs.sql` | none; additive | agent, after owner approval |
| M2 | `05_plans_and_usage.sql` (tables + 3 seeded plans), `06_rpcs.sql` | none; new tables | same |
| M3 | `07_backfill_legacy_data.sql`: 102 `page_audio` rows on the old formula get `round((audio_size_bytes − 44) / 48000)`; the 5 existing books → `mode='listen'` (O9) | none; fixes wrong numbers | same |
| M4 | `scripts/backfill-book-hashes.js`: download each PDF, write `content_sha256` | none | agent |
| M5 | Legacy `page_audio` keeps playing until the book's extraction is complete; legacy files are **not** deleted in this epic | none | — |

---

## 4. API contract (new routes; all behind `authenticateUser`)

| Route | Request | Response | Notes |
|---|---|---|---|
| `POST /api/books/:id/process` | `{ fromPage?: number }` | `202 { extractionId, status, pagesTotal, pagesDone, finalizedThroughPage }` | Idempotent: returns the live extraction if one exists for (book, PROMPT_VERSION, model). Ownership via `ensureUserHasBookAccess`. Realtime window = `[fromPage ?? user_books.last_read_page ?? 1, +9]`. |
| `GET /api/books/:id/processing` | — | `{ status, pagesTotal, pagesDone, pagesFailed, finalizedThroughPage, mode: 'legacy'|'segments' }` | `mode='segments'` once `finalizedThroughPage ≥ 1`. Client polls every 3 s while `running`. |
| `GET /api/books/:id/segments?fromPage=&limit=` | — | `{ extractionId, segments: [{ id, seq, role, startPage, endPage, parts, text, sentenceOffsets, charCount, status }] }` | Text for the text view + highlight; no audio URLs here. |
| `POST /api/books/:id/listen` | `{ fromSeq, voicePersonaId?, windowSeconds? }` | `{ voiceKey, estimatedSeconds, reserved: bool, balanceSeconds, items: [{ segmentId, seq, status: 'ready'|'pending'|'failed', audioUrl?, durationSeconds? }] }` | Plans the window (§5.3), reserves credits, enqueues `tts_segment` jobs. Returns `402 { code:'INSUFFICIENT_CREDITS', balanceSeconds, items }` with whatever is already cached when balance < one segment. |
| `GET /api/segments/:id/audio?voicePersonaId=` | — | `{ status, audioUrl?, durationSeconds?, cached: bool }` | Cache-only lookup + bump `use_count/last_used_at`; never generates. Fetched once per clip when it is ready — no polling (story 7a). |
| `POST /api/books/:id/listen/wait` | `{ segmentIds (≤ 50), voiceKey, timeoutSeconds? }` | `{ voiceKey, items: [{ segmentId, seq, status: 'ready'\|'pending'\|'failed'\|'missing', durationSeconds? }], timedOut }` | Story 7a. Held until any listed clip is no longer `pending`, or 25 s. Statuses only, never counts. `failed`/`missing` → the player calls `/listen` again. |
| `POST /api/books/:id/progress` | `{ seq, positionSeconds, listenedSecondsDelta }` | `{ ok, sessionListenedSeconds }` | Extends today's `updateProgress`; feeds the chapter-ahead trigger and `user_books.last_read_page`. |
| `GET /api/credits` | — | `{ balanceSeconds, reservedSeconds, ledger: last 20 }` | |

Error envelope stays `{ error, message }` (CLAUDE.md). Legacy `POST /api/pages/text` and `/api/pages/audio` are untouched.
