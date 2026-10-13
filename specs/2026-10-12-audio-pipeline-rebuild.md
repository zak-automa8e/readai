# Audio Pipeline Rebuild — implementation spec

Date: 2026-10-12 · Branch: `feat/reading-room-revamp` (stay on it) · Scope: `backend/` + `frontend/` audio path + Supabase schema
Follows: `specs/2026-10-12-reading-room-revamp.md` (UI epic, stories 1–2 landed; 3–7 open). Inputs: `docs/research/2026-10-arabic-ocr.md`,
`docs/research/2026-10-arabic-tts.md`, bake-off `backend/scripts/bakeoff/*` + `bakeoff-output/data/*.json` (12 pages, 47 segments, 10 TTS calls, $0.17 list price).

Vocabulary: **block** = one labelled piece of text on one page (`role`, `text`, flags) — the storage unit; **segment** = one paragraph
or heading stitched across page breaks — the playback and TTS unit; **window** = the segments the listener will reach in the next
~10 minutes; **extraction** = one versioned run of block extraction over a whole book; **TTS** = text-to-speech; **OCR** = optical
character recognition; **RLS** = row-level security; **RPC** = a Postgres function called through Supabase; **SSE** = server-sent events;
**JIT** = just-in-time; **DPI** = dots per inch; **PCM** = raw 16-bit audio samples; **OpenRouter** = the LLM gateway all model calls move to.

Everything marked **SCHEMA CHANGE — REQUIRES OWNER APPROVAL** is applied by the owner in the Supabase console, never by an agent.
Everything marked **DEFAULT** is a choice the owner may overturn before the story that implements it starts.

---

## 1. Target pipeline (diff against today)

```diff
 TODAY (per page, driven by the browser)
-  browser renders <Page> → html2canvas PNG (pane-width dependent) → POST /api/pages/text {imageData}
-    → gemini-2.5-flash-preview-09-2025 (thinking -1, {header,body,footer} JSON) → page_text.extracted_text (string)
-  browser joins header + "\n\n" + body → POST /api/pages/audio {text, voicePersonaId}
-    → gemini-2.5-flash-preview-tts → WAV (24 kHz mono) → storage audio/<user>/<book>/page_N_<voice>_<ts>.wav
-    → page_audio (audio_duration_seconds = bytes/176400 ⇒ 3.7× too short)
-  browser prefetches next page through a hidden <Page>; blank pages detected in the browser; header + page number spoken first

 TARGET (per book for text, per segment for audio, driven by the server)
+  FIRST OPEN of a book → POST /api/books/:id/process → book_processing_jobs(kind=extract_pages …)
+    worker: pdfinfo → total_pages; pdftoppm -r 200 (page PNGs, never stored)
+      → llmProvider.extractBlocks()  = openrouter google/gemini-3.8-flash, structured output, reasoning low
+        pages [p0 .. p0+9]  realtime, 4 in parallel  (listening starts in ~1 min)
+        pages [p0+10 .. N]  google/gemini-3.8-flash:batch in 50-page chunks (half price)
+      → validate (Latin-glued-in-Arabic guard, loop/length guard) → page_text.blocks (jsonb, per page, as today)
+      → segmentBuilder (bakeoff segments.js, owner-approved) over the contiguous done-prefix → segments (stitched, owned by start page)
+  LISTEN → POST /api/books/:id/listen {fromSeq, voicePersonaId}
+    → windowService: next ~600 s of segments → creditService.reserve(estimated seconds) → book_processing_jobs(kind=tts_segment, priority=distance)
+      → segmentAudioService: content_hash(text + voice config + model) → segment_audio HIT? else
+        llmProvider.synthesize() = openrouter google/gemini-3.8-flash-tts (stream) → WAV 24 kHz mono (duration from WAV header)
+        → storage segment-audio/<hash> (shared) | segment-audio/users/<uid>/<hash> (private books) → segment_audio
+    → engaged listener (≥20 min) + credits ⇒ next chapter generated ahead at low priority
+  PLAYBACK → GET /api/books/:id/segments (text, pages, sentence offsets) + GET /api/segments/:id/audio?voice=…
+    client plays segment by segment; page view flips when playback crosses a part boundary; sentence highlight proportional by character
+    out of credits ⇒ generation stops; cached audio and the text view keep working
+  LEGACY → books with no completed extraction keep today's /api/pages/text + /api/pages/audio path untouched until re-processed
```

### 1.1 Backend file tree (diff)

```diff
 backend/src/
   config/
     index.js                      + llm: { provider, openrouter: { baseUrl, models }, google: { models } }, jobs: { mode, concurrency }, credits: {...}
+    prompts/extraction.js         moved from scripts/bakeoff/prompt.js (prompt text + JSON schema; add PROMPT_VERSION = 1)
   services/
     geminiService.js              becomes the Google-direct adapter body (dev-only fallback) — no behaviour change for legacy routes
     pageCacheService.js           duration fix (WAV header) + double-decode of JSON-in-body; otherwise untouched (legacy path)
+    llm/index.js                  llmProvider: provider switch, usage/cost accounting, retry/backoff shared by both adapters
+    llm/openrouterProvider.js     extractBlocks · synthesize · chatWithDocument over /api/v1/chat/completions
+    llm/googleProvider.js         same interface over @google/genai (wraps geminiService + geminiDocumentService)
+    llm/audio.js                  wavInfo (from bakeoff run.js) · pcmToWav · durationFromWav
+    jobs/jobRunner.js             claim loop (RPC claim_jobs), lease renewal, retry/backoff, handlers registry
+    jobs/handlers/extractPages.js  render → extract → validate → save blocks → rebuild segments prefix
+    jobs/handlers/ttsSegment.js    content hash → cache lookup → synthesize → upload → segment_audio → settle credits
+    extraction/pageRenderer.js    pdfinfo + pdftoppm (spawn, as thumbnailService does)
+    extraction/validate.js        latinGlue(), loopGuard(), lengthRatio()
+    extraction/segmentBuilder.js  moved from scripts/bakeoff/segments.js + splitLong(1500 chars) + sentence offsets
+    extraction/extractionService.js  start/resume an extraction, prefix finalisation, status
+    audio/segmentAudioService.js  contentHash, scoped lookup, generate, storage path, dedup on conflict
+    audio/windowService.js        next-N-seconds planner, priority, chapter-ahead trigger
+    credits/creditService.js      balance, grant, reserve, settle, release (ledger rows)
   controllers/
+    processingController.js       POST /books/:id/process · GET /books/:id/processing
+    segmentsController.js         GET /books/:id/segments · POST /books/:id/listen · GET /segments/:id/audio · POST /books/:id/progress
+    creditsController.js          GET /credits
   routes/                         + processingRoutes, segmentsRoutes, creditsRoutes mounted in routes/index.js
 backend/scripts/
+  spikes/openrouter-probe.js      story 1 (≤ $1)
+  backfill-page-audio-duration.js story 3 (dry-run by default)
 backend/supabase/migrations/
+  20261013_01_page_text_blocks.sql  20261013_02_segments.sql  20261013_03_jobs.sql  20261013_04_credits.sql  20261013_05_claim_jobs_rpc.sql
```

### 1.2 Frontend file tree (diff)

```diff
 frontend/src/
   services/apiService.ts          + startProcessing · getProcessing · getSegments · listen · getSegmentAudio · getCredits · reportProgress
+  types/segments.ts               Segment, SegmentAudioStatus, ProcessingStatus, CreditBalance
   components/reading-room/
     CanvasPane.tsx                children slot already exists; gains a view switch PDF | Text (story 7)
+    ExtractedTextView.tsx         segments as paragraphs, current sentence highlighted, click sentence → seek, RTL-aware
     NowPlayingBar.tsx             segment-aware: prev/next segment, book progress, credits chip; page buttons stay
     hooks/
       usePageAudio.ts             kept verbatim for LEGACY books only (no completed extraction)
+      useBookProcessing.ts        trigger on first open, poll GET /processing, expose status + progress
+      useSegmentPlayback.ts       queue, ensure-window, prefetch next ready audio, auto-advance, page flip, highlight clock
+      useCredits.ts               balance + 402 handling
     ReadingRoomContext.tsx        playback value = legacy or segment hook, chosen by processing status
```

---

## 2. Load-bearing facts — verified against the live system

| # | Question | Finding (how verified) | Consequence |
|---|---|---|---|
| F1 | What does the live schema actually hold? | Probe `scratchpad/schema-probe.js` (selects only). Tables present: `books`(5 rows) `pages`(61) `page_text`(60) `page_audio`(84) `voice_personas`(2) `voice_persona_templates` `persona_ratings`(0) `persona_usage`(0) `persona_preview_limits` `user_books`(5) `user_profiles`(4) `book_notes` `processing_costs`(0) `reading_sessions`(0) `ai_conversations` `ai_messages`. **Missing**: `book_pages`, `page_cache` (named in CLAUDE.md), any credits/jobs/segments table. `books.total_pages` is NULL on all 5 books; `pages.image_url` = 'placeholder' on all 61 rows; `books.visibility` = private on all. | §3 diff is against this. Page count must come from `pdfinfo` server-side. Shared cache has no live public book to test on — story 5 verification creates one in the owner's account. |
| F2 | Is the duration bug real and how big? | `page_audio` bytes/sec mean = **177 858** across 84 rows (expected 176 400 if computed for 44.1 kHz stereo; real WAVs are 24 kHz mono 16-bit = 48 000 B/s, confirmed from WAV headers in `bakeoff.json`: 24000Hz/1ch/16bit on all 12). `pageCacheService.js:183` divides by `44100*2*2`. | Fix formula and backfill 84 rows: `duration = (audio_size_bytes − 44) / 48000`. |
| F3 | How many cached texts are JSON-in-body? | 8 of 60 `page_text` rows have a `body` that is itself a JSON string (model reply double-wrapped); 5 rows have an empty body. `normalizeExtractedText` (`pageCacheService.js:100`) parses once only. | Legacy fix = parse twice when `body` starts with `{`. New pipeline never stores strings. |
| F4 | What did the bake-off measure? | `bakeoff.json` summary: extraction **$0.00468/page** (2 077–2 085 prompt tokens of which **1 092–1 100 image tokens** at 200 DPI PNG, 571–1 320 output tokens, 0 thinking at LOW; MINIMAL rejected with 400); p50 latency 10.9 s, max 13.2 s. TTS **22.9 audio tokens/s**, **$0.754/audio-hour**, 99.9 s of audio per 1 000 spoken chars; p50 17.2 s, max 32.2 s for an 825-char segment. **1 213 spoken chars/page, 3.92 segments/page**, segment chars min/median/max 5/296/825, 5 of 9 boundaries merged with model flag + heuristic + next-page flag all agreeing. | Cost model §8 and the window sizing in §5 use these. Segment cap 1 500 chars is above the observed max. |
| F5 | What is on OpenRouter today? | `GET https://openrouter.ai/api/v1/models` (public): `google/gemini-3.8-flash` $0.75/$3.75 per M, `image` $0.75/M, `internal_reasoning` billed at $3.75/M, `input_cache_read` $0.075/M; supports `response_format`, `structured_outputs`, `reasoning`, `reasoning_effort`, `temperature`. **`google/gemini-3.8-flash:batch`** $0.375/$1.875 — same params **minus `temperature`**. With `?output_modalities=speech`: `google/gemini-3.8-flash-tts` $0.50 in / $9.00 out, `gemini-3.8-flash-lite-tts` $0.50 / $6.00, ctx 32 768, `supported_parameters: []`. **No `*-tts:batch` id exists.** OpenRouter audio-output doc (generic): `modalities: ["text","audio"]`, `audio: { voice, format }`, **streaming only**, chunks in `choices[].delta.audio.data` (base64) + `transcript`. PDF doc: `{type:"file", file:{filename, file_data}}`, `file-parser` plugin engines `native` (billed as input tokens) / `mistral-ocr` ($2/1k pages) / `cloudflare-ai` (free); parsed-file `annotations` reusable across requests. Caching doc: Gemini implicit caching; explicit `cache_control` 5-min TTL, reads at 0.25×. Rate limits doc: no numeric limit for paid accounts; provider 429s pass through with `provider_code`. | Batch TTS via OpenRouter is **not available** → "chapter ahead" runs at list price unless the Google-direct Batch API is used (needs a paid Google key). `:batch` has no `temperature` → extraction must be deterministic without it (schema + low reasoning) or accept drift. Voice names, style/system-instruction support, sample rate and `format` options for the Gemini TTS models are **unverified** → story 1. |
| F6 | Can the server render pages? | `thumbnailService.js` already spawns `pdftoppm`; `backend/Dockerfile` installs `poppler-utils`; bake-off used `pdftoppm -r 200 -png -singlefile` locally. Backend `node_modules` has no pdf/canvas/sharp/queue library. | Server-side rendering is free; no new native dependency. Body-size limit (10 MB, `app.js`) stops mattering because the browser no longer uploads page images for processed books. |
| F7 | Is there any queue/worker infrastructure? | None: single Express process (`server.js`), Supabase via REST only (no Postgres connection string in `config/index.js`), no Redis. | Queue = a Postgres table claimed through an RPC with `FOR UPDATE SKIP LOCKED`; runner = a loop inside the Express process by default, splittable by env flag (§5). |
| F8 | What does the frontend audio contract look like right now? | `usePageAudio.ts` (643 lines) owns capture → `/pages/text` → `/pages/audio` → `<audio>`; blank-page skipping landed in a129a08 (`blankPage.ts`); `CanvasPane` already renders `children` as the view slot and owns the hidden prefetch `<Page>`; `NowPlayingBar` reads `usePlayback()`; `ReadingRoomContext` composes `usePageAudio` + `useVoiceChoice`. `frontend/vite.config.ts` port is 8080. | Story 7 adds a parallel hook and switches on processing status; legacy hook stays byte-identical. |
| F9 | Storage footprint of WAV | 24 kHz mono 16-bit = 48 KB/s ⇒ a 300-page book (≈10.1 audio-hours, §8) is **≈1.75 GB per voice** as WAV. | Risk R3: the spike must test `audio.format` = mp3/opus; else add `ffmpeg` to the Docker image. Not blocking the design — the cache key and tables are format-agnostic (`audio_format` column). |

Bugs confirmed in code, folded into story 3: `pageCacheService.js:183` (duration), `pageCacheService.js:100-125` (single JSON parse), `usePageAudio.ts:177-182,496-502` (header spoken first — becomes moot for processed books, left alone for legacy).

---

## 3. Data model — diff against the LIVE schema

Every `+` below is a **SCHEMA CHANGE — REQUIRES OWNER APPROVAL** (applied in the Supabase console from the migration files; the live DB is the truth, repo migrations are the record). RLS: enable on every new table with **no policies** (anon/authenticated see nothing); the backend reaches them with the service key and performs ownership checks in code via `supabaseService.ensureUserHasBookAccess(userId, bookId)` — same pattern CLAUDE.md mandates for personas. The frontend never queries these tables directly.

```diff
 books            (id, user_id, parent_book_id, title, author, description, isbn, language, voice_persona, voice_settings,
                   pdf_url, pdf_source, thumbnail_url, total_pages, visibility, shared_with, processing_status, processing_error, …)
+                 total_pages is finally written (by pdfinfo in extractPages). No column change.

 pages            (id, book_id, page_number, image_url, image_width, image_height, created_at)
+                 rows bulk-created for every page of a book at extraction start (today: lazily). No column change.

 page_text        (id, page_id UNIQUE, extracted_text text, extraction_confidence, extraction_metadata jsonb, processed_at, processing_duration_ms)
+  blocks               jsonb      -- [{i, role, text, footnote_markers[], starts_mid_sentence, ends_mid_sentence}] (bakeoff schema, roles enum)
+  extraction_id        uuid NULL REFERENCES book_extractions(id)
+  prompt_version       int        -- extraction.js PROMPT_VERSION
+  model                text       -- e.g. 'openrouter:google/gemini-3.8-flash'
+  image_sha256         text       -- hash of the rendered PNG → re-extraction skips unchanged pages
+  validation           jsonb      -- {latin_glue: n, loop: bool, length_ratio: x, retries: n, suspect: bool}
+  extracted_text keeps the LEGACY {header:'', body:<spoken text joined>, footer:''} string so /api/pages/* keep working unchanged
+  INDEX page_text_extraction_idx (extraction_id)

+book_extractions (one versioned run per book; the thing segments belong to)
+  id uuid PK · book_id uuid FK books ON DELETE CASCADE · status text CHECK IN ('queued','running','partial','complete','failed')
+  model text · prompt_version int · dpi int DEFAULT 200 · pages_total int · pages_done int DEFAULT 0 · pages_failed int DEFAULT 0
+  finalized_through_page int DEFAULT 0   -- segments are final for pages ≤ this
+  requested_by uuid · started_at · finished_at · error text · created_at
+  UNIQUE (book_id, prompt_version, model) WHERE status <> 'failed'   -- one live extraction per recipe
+  INDEX (book_id, created_at DESC)

+segments         (playback unit)
+  id uuid PK · extraction_id uuid FK book_extractions ON DELETE CASCADE · book_id uuid FK books
+  seq int                      -- 1-based order within the extraction; append-only (never renumbered)
+  role text CHECK IN ('body','heading')
+  start_page int · end_page int · parts jsonb   -- [{page, chars}] from segmentBuilder → page-flip timing
+  text text · text_sha256 text · char_count int
+  sentence_offsets int[]       -- char offset where each sentence starts → highlight timing
+  footnote_markers text[]
+  status text CHECK IN ('open','final') DEFAULT 'final'   -- 'open' = last segment of the prefix, may still grow
+  UNIQUE (extraction_id, seq) · INDEX (book_id, start_page) · INDEX (text_sha256)

+segment_audio    (content-addressed cache; NOT linked to a segment row — found by hash at request time)
+  id uuid PK
+  content_sha256 text          -- sha256(canonical JSON {text_sha256, model, base_voice, style_prompt, audio_format})
+  text_sha256 text · model text · voice_key text   -- voice_key as pageCacheService.resolveVoice: 'Zephyr' | 'persona:<id>:<updated_at ms>'
+  owner_user_id uuid NULL      -- NULL = shared row (generated for a public/shared book); set = private to that user
+  scope_key text GENERATED ALWAYS AS (coalesce(owner_user_id::text, 'shared')) STORED
+  status text CHECK IN ('pending','ready','failed') · error text
+  audio_url text · audio_format text · sample_rate int · channels int · duration_seconds numeric(8,2) · size_bytes int
+  usage jsonb                  -- {prompt_tokens, completion_tokens, cost_usd, provider, latency_ms}
+  created_at · ready_at · last_used_at · use_count int DEFAULT 0
+  UNIQUE (content_sha256, scope_key) · INDEX (status, created_at)

+book_processing_jobs (the queue)
+  id uuid PK · kind text CHECK IN ('extract_pages','tts_segment','tts_chapter')
+  book_id uuid FK books ON DELETE CASCADE · user_id uuid NULL · extraction_id uuid NULL
+  payload jsonb                -- extract_pages: {pages:[…], mode:'realtime'|'batch', provider_batch_id?}  tts_segment: {segment_id, voice_key, persona_id?, reservation_id}
+  idempotency_key text UNIQUE  -- 'extract:<extraction_id>:<first>-<last>' | 'tts:<content_sha256>:<scope_key>'
+  priority int DEFAULT 100     -- lower runs first; tts distance in seconds from the listener
+  status text CHECK IN ('queued','running','done','failed','cancelled') · attempts int DEFAULT 0 · max_attempts int DEFAULT 5
+  run_after timestamptz DEFAULT now() · locked_by text · locked_at timestamptz · last_error text · created_at · finished_at
+  INDEX (status, run_after, priority) · INDEX (book_id, kind)

+credit_accounts  (user_id uuid PK · balance_seconds bigint NOT NULL DEFAULT 0 · updated_at)   -- cached sum; ledger is the truth
+credit_ledger    (id uuid PK · user_id uuid · kind text CHECK IN ('grant','reserve','settle','release','refund','adjust')
+                  · seconds int NOT NULL   -- signed: grant +, reserve −, settle 0 or ±delta, release +
+                  · reservation_id uuid NULL · ref_type text · ref_id uuid · note text · created_at)
+                  INDEX (user_id, created_at DESC) · INDEX (reservation_id)

+RPC claim_jobs(worker text, kinds text[], n int) RETURNS SETOF book_processing_jobs
+  UPDATE … SET status='running', locked_by=worker, locked_at=now(), attempts=attempts+1
+  WHERE id IN (SELECT id FROM book_processing_jobs WHERE status='queued' AND run_after<=now() AND kind = ANY(kinds)
+               ORDER BY priority, created_at LIMIT n FOR UPDATE SKIP LOCKED) RETURNING *;
+RPC credit_apply(user uuid, kind text, seconds int, reservation uuid, ref_type text, ref_id uuid, note text) RETURNS bigint
+  inserts the ledger row and updates credit_accounts.balance_seconds in one transaction; raises when a reserve would go negative

 page_audio       (legacy, unchanged shape) — 84 rows get audio_duration_seconds corrected by the story-3 backfill (data fix, not DDL)
```

Rejected alternative — a `page_blocks` table with one row per block: more rows (≈1 200 per 300-page book) for no query we need; blocks are only ever read per page, and the owner-approved unit is the page. Kept as jsonb on `page_text` so the legacy row and the new data live together and `page_id UNIQUE` keeps idempotency for free.

### 3.1 Migration and backfill plan

| Step | What | Data loss? | Who |
|---|---|---|---|
| M1 | Apply `01_page_text_blocks.sql` (add columns, index) | none; additive | owner |
| M2 | Apply `02_segments.sql`, `03_jobs.sql`, `04_credits.sql`, `05_claim_jobs_rpc.sql` | none; new tables | owner |
| M3 | Run `scripts/backfill-page-audio-duration.js --dry-run` → prints 84 old/new values; owner re-runs with `--apply` | none; fixes wrong numbers | owner |
| M4 | Grant starter credits: `credit_apply(user, 'grant', 3600, …)` per existing user (DEFAULT 60 min; owner sets the number) | none | owner |
| M5 | Deploy backend with `LLM_PROVIDER=openrouter`, `JOBS_MODE=inline` | none; legacy routes unchanged | agent (after owner confirms env vars are set — never read `.env`) |
| M6 | Existing books: nothing happens until the owner opens one (DEFAULT 1 → first open triggers extraction). Legacy `page_audio` keeps playing through `/api/pages/*` until `book_extractions.status='complete'` for that book; then the client switches to segments. Legacy files are **not** deleted in this epic. | none | — |
| M7 | Later (not in this epic): delete legacy `page_audio` rows/files for re-processed books; drop `/api/pages/audio` | owner decision | — |

---

## 4. API contract (new routes; all behind `authenticateUser`)

| Route | Request | Response | Notes |
|---|---|---|---|
| `POST /api/books/:id/process` | `{ fromPage?: number }` | `202 { extractionId, status, pagesTotal, pagesDone, finalizedThroughPage }` | Idempotent: returns the live extraction if one exists for (book, PROMPT_VERSION, model). Ownership via `ensureUserHasBookAccess`. Realtime window = `[fromPage ?? user_books.last_read_page ?? 1, +9]`. |
| `GET /api/books/:id/processing` | — | `{ status, pagesTotal, pagesDone, pagesFailed, finalizedThroughPage, mode: 'legacy'|'segments' }` | `mode='segments'` once `finalizedThroughPage ≥ 1`. Client polls every 3 s while `running`. |
| `GET /api/books/:id/segments?fromPage=&limit=` | — | `{ extractionId, segments: [{ id, seq, role, startPage, endPage, parts, text, sentenceOffsets, charCount, status }] }` | Text for the text view + highlight; no audio URLs here. |
| `POST /api/books/:id/listen` | `{ fromSeq, voicePersonaId?, windowSeconds? }` | `{ voiceKey, estimatedSeconds, reserved: bool, balanceSeconds, items: [{ segmentId, seq, status: 'ready'|'pending'|'failed', audioUrl?, durationSeconds? }] }` | Plans the window (§5.3), reserves credits, enqueues `tts_segment` jobs. Returns `402 { code:'INSUFFICIENT_CREDITS', balanceSeconds, items }` with whatever is already cached when balance < one segment. |
| `GET /api/segments/:id/audio?voicePersonaId=` | — | `{ status, audioUrl?, durationSeconds?, cached: bool }` | Cache-only lookup + bump `use_count/last_used_at`; never generates. Client polls this for `pending` items (2 s). |
| `POST /api/books/:id/progress` | `{ seq, positionSeconds, listenedSecondsDelta }` | `{ ok, sessionListenedSeconds }` | Extends today's `updateProgress`; feeds the chapter-ahead trigger and `user_books.last_read_page`. |
| `GET /api/credits` | — | `{ balanceSeconds, reservedSeconds, ledger: last 20 }` | |

Error envelope stays `{ error, message }` (CLAUDE.md). Legacy `POST /api/pages/text` and `/api/pages/audio` are untouched.

---

## 5. Job orchestration

### 5.1 Where it runs and why

| Option | Verdict |
|---|---|
| **Loop inside the Express process** (`JOBS_MODE=inline`, default) | **Chosen.** One Docker container, no Redis, no connection string; volume today is 5 books. Concurrency caps keep the HTTP path responsive: `extract_pages` 1 job at a time × 4 parallel pages, `tts_*` 2 jobs. `SIGTERM` handler (already in `server.js`) waits for in-flight jobs ≤ 10 s; leases expire anyway (5 min) so a killed job is re-claimed. |
| Same code as a separate process (`JOBS_MODE=worker` runs only the loop; `JOBS_MODE=off` runs only HTTP) | Supported by the same module from day one; switch when CPU from `pdftoppm` or base64 encoding shows in request latency. No code change, only the flag. |
| BullMQ / Redis | Rejected: new infrastructure for a queue of tens of rows. |
| pg-boss | Rejected: needs a direct Postgres connection string the backend does not have; the RPC gives the same `SKIP LOCKED` semantics through supabase-js. |

### 5.2 Extraction: realtime head, batch tail, prefix finalisation

```text
POST /process ─▶ book_extractions(running) ─▶ pages rows for 1..N (pdfinfo) ─▶ jobs:
   extract_pages {pages:[p0..p0+9],  mode:'realtime', priority:10}      ← 4 pages in parallel, google/gemini-3.8-flash
   extract_pages {pages:[1..p0-1] + [p0+10..N] in chunks of 50, mode:'batch', priority:50}  ← google/gemini-3.8-flash:batch
handler per page: render PNG (sha256) ─▶ skip if page_text.image_sha256 matches & prompt_version same
                  ─▶ extractBlocks ─▶ validate ─▶ retry policy ─▶ upsert page_text (page_id UNIQUE)
after each job:   finalizePrefix(extraction): walk pages from finalized_through_page+1 while page_text.extraction_id = this
                  ─▶ segmentBuilder over [finalized_through_page .. lastDone] (needs the previous page's tail → re-read 1 page back)
                  ─▶ append segments with seq > max(seq); the last segment is status='open' if its block ends_mid_sentence
                     and the next page is not done yet; it is re-written in place (same seq) when the next page lands
                  ─▶ finalized_through_page = lastDone − (open ? 1 : 0); status = pages_done=N ? 'complete' : 'partial'
```

- **Batch semantics are a spike question** (F5): if `:batch` is an asynchronous queue the handler stores `provider_batch_id` and re-enqueues itself with `run_after = +5 min` to poll; if it is a synchronous-but-slower endpoint, the handler simply awaits. Either way the job is one chunk, so a failure retries one chunk.
- **Validation + retry** (`extraction/validate.js`): `latinGlue(text)` = `/[؀-ۿ][A-Za-z]|[A-Za-z][؀-ۿ]/u` on each body/heading block (catches `أserver`); `loopGuard` = any 4-gram repeated ≥ 3× or output > 1.5× the median page length of the book so far; on failure retry the page once with `reasoning_effort: 'medium'`, then once on the Google-direct adapter if configured, then store with `validation.suspect=true` (spoken anyway, visible in the text view with a marker, never blocks the book).
- **Retries**: `attempts < max_attempts` → `status='queued'`, `run_after = now() + 15 s × 2^attempts`; 429 honours `X-RateLimit-Reset`/`retryDelay` when present. Final failure → `pages_failed++`, extraction stays `partial`; `GET /processing` exposes failed pages; a later `POST /process` re-queues only failed pages (idempotency key is per chunk, so the re-queue uses a new chunk key `…:retry<n>`).
- **Dedup**: `page_text.image_sha256 + prompt_version + model` equal ⇒ no model call (re-processing an unchanged book costs rendering only).
- **Resume**: everything is in the table; on boot the runner re-claims jobs whose `locked_at < now() − 5 min`.

### 5.3 TTS window, credits, chapter-ahead

```text
POST /listen {fromSeq, voice} ─▶ voiceKey = resolveVoice (reuse pageCacheService.resolveVoice)
  ─▶ pick segments seq ≥ fromSeq until Σ estimate ≥ windowSeconds (DEFAULT 600; estimate = char_count × 0.0999 s, bake-off F4)
  ─▶ for each: content_sha256 ─▶ segment_audio lookup (hash, scope ∈ {user, shared}) → ready | pending | missing
  ─▶ missing: reserve = credit_apply(user,'reserve', −estimate, reservation_id) ─▶ 402 if the RPC raises
             job tts_segment {segment_id, voice_key, reservation_id} priority = seconds-from-listener, idempotency 'tts:<hash>:<scope>'
  ─▶ respond with items[]
tts_segment handler: insert segment_audio(status='pending') ON CONFLICT DO NOTHING ─▶ if a row already exists and is ready → settle & done
  ─▶ llmProvider.synthesize ─▶ pcmToWav ─▶ duration from header ─▶ upload (upsert) ─▶ update row ready
  ─▶ credit_apply('settle', actual − estimate, reservation_id)   ← bills real delivered seconds
  on failure after retries: credit_apply('release', +estimate) ; row status='failed' (a later /listen retries it)
engaged listener: /progress accumulates listenedSeconds per session; when ≥ 1200 s (DEFAULT) and balance ≥ estimate(next chapter)
  ─▶ job tts_chapter {from: next 'heading' segment after the window, to: following heading or 1800 s of text} priority 500
  ─▶ expands into tts_segment jobs at priority 500 (behind every live window) using the cheapest provider that has a batch path
     (OpenRouter has none for TTS today → list price; if the spike finds the Google Batch API usable with a paid key, it goes there)
```

- **Scope rule** (DEFAULT 2): `books.visibility IN ('public','shared')` ⇒ generate with `owner_user_id = NULL` (shared row; any user with access to any book containing that exact text + voice gets a hit). Private ⇒ `owner_user_id = user`. Lookup always tries the user's row then the shared row — a private listener may *consume* a shared row, never *create* one.
- **Billing unit** (DEFAULT 3) = seconds of audio delivered: reserved on the estimate, settled to the WAV-header duration. Cache hits are billed the same way (see Decision D1).
- **Out of credits**: `/listen` returns 402 + cached items; client keeps playing anything `ready`, shows the text view, and the credits chip; no job is enqueued; nothing is deleted.
- **Idempotency**: two listeners hitting the same uncached public segment produce one `segment_audio` row (unique `(content_sha256, scope_key)`); the second job sees the existing row and only settles its own reservation.

---

## 6. Stories

Gates for every story: `cd backend && npm test && npm run lint`; frontend stories also `cd frontend && npx tsc --noEmit -p tsconfig.app.json && npm run build`. Running app: `cd backend && npm run dev` (3001), `cd frontend && npm run dev` (8080). Never read or print `.env`; env var names are referenced by name only. Supabase writes from code only through the backend's normal services; agents never run DDL.

### Story 1 — OpenRouter spike (S) · **Opus** (the answers decide the shapes of stories 2, 5, 9)

Files: `backend/scripts/spikes/openrouter-probe.js` (new), `docs/research/2026-10-openrouter-spike.md` (new). Budget guard $1.00 (reuse the `guardBudget` pattern from `scripts/bakeoff/run.js`). Uses `OPENROUTER_API_KEY` from `config` (name only); reads the two PNGs `bakeoff-output/images/b1-p5.png`, `b3-p9.png` and the cached blocks for comparison.

| Probe | What it sends | Must record |
|---|---|---|
| P1 extraction realtime | `google/gemini-3.8-flash`, system = `EXTRACTION_PROMPT`, user = image (data URL) + "Transcribe…", `response_format: { type:'json_schema', json_schema: RESPONSE_SCHEMA }`, `reasoning: { effort:'low' }`, `temperature: 0` | tokens (prompt / image / completion / reasoning) vs bake-off 2 077 / 1 092 / ~600 / 0; cost from `usage`; latency; block diff vs `bakeoff-output/data/extract/*.json` (role counts equal? text CER on body ≤ 2 %?); whether `reasoning.effort:'minimal'` is accepted |
| P2 extraction batch | same on `google/gemini-3.8-flash:batch` (no `temperature`) | is the reply synchronous? wall time; any batch id / polling endpoint in the response or headers; determinism without `temperature` (run twice, diff) |
| P3 TTS shape | `google/gemini-3.8-flash-tts`, `stream:true`, `modalities:['text','audio']`, `audio:{ voice:'Zephyr', format:'pcm16' }`, user = segment `b1-s05` text (286 chars) | does `voice:'Zephyr'` map to the Gemini prebuilt voice (compare against `bakeoff-output/audio/new/b1-s05.wav` by ear + duration ±10 %)? which `format` values work (`pcm16`, `wav`, `mp3`, `opus`)? sample rate (from header or doc), bytes/s; usage → cost/hour vs $0.754 |
| P4 TTS style | P3 + a system message = `voicePersonaService.buildPrompt(persona)` for a dramatic persona; and the same instruction prefixed in the user text | does style change the audio? does a system message produce a text-only reply (the bake-off saw "No audio data" retries)? pick the mechanism for `openrouterProvider.synthesize` |
| P5 TTS long | an 825-char segment (`b1-s03`) and a 1 500-char concatenation | hard limits / truncation / finish_reason; latency |
| P6 rate | 4 parallel P1 + 2 parallel P3 | 429s? `X-RateLimit-*` headers; `GET /api/v1/key` fields (`limit`, `usage`, `rate_limit`) |
| P7 document chat | `google/gemini-3.8-flash` + `{type:'file', file:{filename, file_data: <pdf_url of b1>}}` with `plugins:[{id:'file-parser', pdf:{engine:'native'}}]`, question "ما عنوان الفصل الأول؟"; second turn reusing the returned `annotations` | tokens/cost per turn for a ~100-page PDF; does the annotation reuse avoid re-billing the PDF? `cached_tokens` in usage on the second turn? |

Acceptance: `docs/research/2026-10-openrouter-spike.md` has one row per probe with the exact request JSON (keys only, no key material), the exact response shape, numbers, and a **Decision** column feeding story 2 (`format`, `voice` mapping, style mechanism, batch mode, parallelism caps); total spend printed by the script < $1.00. Verification: owner listens to the P3 and P4 WAVs saved under `bakeoff-output/spike/`.

### Story 2 — `llmProvider` layer (M) · **Sonnet** (interfaces fixed by story 1's decisions)

Files: `backend/src/services/llm/{index.js, openrouterProvider.js, googleProvider.js, audio.js}`, `backend/src/config/index.js` (+`llm`, keep `geminiModels` for the Google adapter), `backend/src/config/prompts/extraction.js` (moved from `scripts/bakeoff/prompt.js`, `PROMPT_VERSION = 1`), `backend/tests/llm/*.test.js`, and the three legacy call sites switched to the provider: `pageCacheService.getOrExtractPageText/getOrGeneratePageAudio`, `voicePersonaController.generatePreview`, `audioController.textToAudio`.

Interface (all return `{ …, usage: { promptTokens, completionTokens, reasoningTokens, costUsd, provider, model, latencyMs } }`):

```text
extractBlocks({ pngBase64, mimeType, mode: 'realtime'|'batch', reasoning: 'low'|'medium' }) → { blocks[], raw }
synthesize({ text, baseVoice, styleInstruction|null, format }) → { pcm: Buffer, sampleRate, channels, bitsPerSample }
chatWithDocument({ pdfUrl|annotations, history[], message, systemInstruction }) → { text, annotations }
```

- `config.llm.provider` ∈ `openrouter | google`; `openrouter.models = { extract:'google/gemini-3.8-flash', extractBatch:'google/gemini-3.8-flash:batch', tts:'google/gemini-3.8-flash-tts', ttsLite:'google/gemini-3.8-flash-lite-tts', chat:'google/gemini-3.8-flash' }`. Google adapter = today's code, labelled dev-only in config comments (free tier, 10 TTS/day).
- Shared retry: honours `retryDelay`/`X-RateLimit-Reset`, 6 attempts, stops on daily-cap errors (port `withRetry` from `scripts/bakeoff/run.js`).
- `audio.js`: `wavInfo`, `pcmToWav` (reuse `utils/audioUtils.convertToWav`), `durationSeconds(buf)`.
- Legacy routes keep returning exactly the same JSON; `generateAudio`'s truncation at `config.maxTextLength` stays for legacy only.

Acceptance (running app, `LLM_PROVIDER=openrouter`): voice-persona preview plays (no longer limited by the Google free tier); a legacy book page reads aloud through `/api/pages/audio` and the new `page_audio.audio_duration_seconds` equals the WAV header duration (check in the Supabase table view); with `LLM_PROVIDER=google` the same two flows still work. Tests mock `fetch` and assert request bodies for each method.

### Story 3 — Schema migrations + legacy data fixes (M) · **Opus** for the SQL and backfill; owner applies

Files: `backend/supabase/migrations/20261013_0{1..5}_*.sql` (exactly §3), `backend/scripts/backfill-page-audio-duration.js`, `backend/src/services/pageCacheService.js` (duration via `llm/audio.durationSeconds`; `normalizeExtractedText` parses a second time when `body` starts with `{` and the inner object has `body`), `backend/tests/pageCacheService.test.js` (+2 cases: JSON-in-body, duration).

Acceptance: owner has applied M1–M4 (confirmed by `schema-probe.js`-style select showing the new tables); `--dry-run` lists 84 rows with old vs new duration (expected ≈ ×3.7); after `--apply`, `SELECT avg(audio_size_bytes/audio_duration_seconds)` ≈ 48 000; the 8 JSON-in-body pages now return clean text from `/api/pages/text` (play b2 p12 or b3 p10 in the legacy reader — no JSON keys spoken). **SCHEMA CHANGE — REQUIRES OWNER APPROVAL** before anything in this story runs against the live DB.

### Story 4 — Extraction pipeline + job runner (L) · **Opus** (prefix finalisation and idempotency are where the first idea is wrong)

Files: `backend/src/services/jobs/{jobRunner.js, handlers/extractPages.js}`, `backend/src/services/extraction/{pageRenderer.js, validate.js, segmentBuilder.js (moved from scripts/bakeoff/segments.js + splitLong + sentenceOffsets), extractionService.js}`, `backend/src/controllers/processingController.js`, `backend/src/controllers/segmentsController.js` (GET segments only), `backend/src/routes/{processingRoutes.js, segmentsRoutes.js, index.js}`, `backend/src/app.js` or `server.js` (start/stop runner per `JOBS_MODE`), `backend/src/services/supabaseService.js` (+ `insertPagesBulk`, `upsertPageTextBlocks`, `getExtraction*`, `appendSegments`, `rewriteOpenSegment`, job CRUD via RPC), tests for `segmentBuilder` (port bake-off fixtures from `bakeoff-output/data/extract/*.json` into `backend/tests/fixtures/`), `validate`, `finalizePrefix` (open-segment rewrite, no renumbering).

Acceptance (running app, a 20–40 page Arabic PDF in the owner's library):
- `POST /api/books/:id/process` → `202`; within ~60 s `GET /processing` shows `pagesDone ≥ 10`, `finalizedThroughPage ≥ 9`, `mode:'segments'`; the rest completes via `:batch` chunks; `books.total_pages` is set.
- `GET /segments` returns stitched segments: at least one with `startPage < endPage` whose `parts` sum to `charCount`; no segment text contains a page number or running header (compare with the PDF); headings present as `role:'heading'`.
- Kill the backend mid-run, restart: the extraction resumes (no duplicate `page_text` rows, `seq` continues without gaps); a second `POST /process` returns the same `extractionId`.
- Force a validation failure in a unit test (`أserver`) → one retry at `medium`, then `validation.suspect=true` and the page is still saved.
- Log lines per page include tokens and cost (`usage`); `processing_costs` gets one row per page (reuse `recordProcessingCost`).

### Story 5 — Segment audio, window, credits (L) · **Opus**

Files: `backend/src/services/audio/{segmentAudioService.js, windowService.js}`, `backend/src/services/credits/creditService.js`, `backend/src/services/jobs/handlers/ttsSegment.js`, `backend/src/controllers/{segmentsController.js (+listen, +audio), creditsController.js}`, routes, `supabaseService` (+segment_audio CRUD, `credit_apply` RPC wrapper), tests (hash canonicalisation, scope rule, reserve/settle/release arithmetic, 402 path, conflict path).

Acceptance (running app, processed book from story 4, owner's persona + base voice):
- `POST /listen {fromSeq:1}` → items for ≈600 s of text; within ~30 s the first item is `ready`; `segment_audio.duration_seconds` equals the WAV header (within 0.1 s); `credit_ledger` shows one `reserve` per generated segment and one `settle` with the true delta; `GET /credits` balance moved by the delivered seconds only.
- Same request again → every item `ready, cached:true`, no new jobs, no new reservation (D1 default: a `settle`-style `charge` row for delivered seconds; see §9).
- Switch voice (persona) → new hashes, new generation; edit the persona (updated_at changes) → new hashes again (mirrors today's `persona:<id>:<version>` key).
- Make the book `visibility='public'` (owner, in the console), add it to a second test user's library: that user's `/listen` hits the shared rows (`owner_user_id IS NULL`); set the book back to private and generate a new voice → rows carry `owner_user_id`.
- Drain the account (`credit_apply(…,'adjust', −balance)` by the owner): `/listen` → `402`, cached items still returned, no job enqueued.

### Story 6 — Chapter-ahead generation + progress (M) · **Sonnet**

Files: `backend/src/services/audio/windowService.js` (+`planChapter`), `backend/src/services/jobs/handlers/ttsChapter.js`, `segmentsController.progress`, `supabaseService.updateBookProgress` (+`listened_seconds` on `reading_sessions` — **uses the existing empty table, no DDL**), config `credits.engagedAfterSeconds = 1200`, tests for the trigger (not engaged / engaged no credits / engaged with credits).

Acceptance: with a test override `ENGAGED_AFTER_SECONDS=30`, listening past 30 s enqueues `tts_chapter` for the next heading-to-heading span at priority 500; live `/listen` jobs (priority < 500) are still claimed first (observe in `book_processing_jobs`); without credits nothing is enqueued and `/credits` is unchanged.

### Story 7 — Frontend: segment playback, text view, highlight, page flip (L) · **Opus** for `useSegmentPlayback`; **Sonnet** for `ExtractedTextView` + bar changes

Files: `frontend/src/services/apiService.ts`, `frontend/src/types/segments.ts`, `hooks/useBookProcessing.ts`, `hooks/useSegmentPlayback.ts`, `components/reading-room/ExtractedTextView.tsx`, `CanvasPane.tsx` (view switch; hidden prefetch `<Page>` rendered only in legacy mode), `NowPlayingBar.tsx`, `ReadingRoomContext.tsx` (choose hook by `processing.mode`), `usePageAudio.ts` **unchanged**.

Behaviour:
- On room mount: `useBookProcessing` calls `GET /processing`; if no extraction and the book is the user's (or in their library) → `POST /process` (DEFAULT 1); polls while `running`. `mode:'legacy'` → today's hook; `mode:'segments'` → new hook. Toast once: "Preparing this book… listening starts in about a minute".
- `useSegmentPlayback`: `segments` from `GET /segments`; `play(seq)` → `/listen {fromSeq}` → plays the first `ready` item with one `<audio>`; while playing, polls `GET /segments/:id/audio` for the next 2 items and preloads them (`new Audio(url).load()`); on `ended` → next segment (no page-level blank skipping needed: pages with no body blocks produce no segments); every 20 s and on pause → `POST /progress`.
- **Highlight clock**: `t → charIndex = t / duration × charCount` → current sentence = last `sentenceOffsets[i] ≤ charIndex`; **page flip**: when `charIndex ≥ Σ parts[0..k].chars` → `setPageNumber(parts[k+1].page)`; also `setPageNumber(startPage)` when a segment starts. Seeking inside a segment stays proportional. (Forced alignment is story 11.)
- `ExtractedTextView`: paragraphs grouped by `startPage` with a hairline page marker ("ص ٩" / "p. 9"), headings in `font-serif`, current sentence `bg-muted` + `text-primary` (tokens from the reading-room spec §3; no coloured bars), click a sentence → `seekTo(seq, charOffset)` → `/listen {fromSeq:seq}` + `audio.currentTime = offset/charCount × duration`; `dir="rtl"` when `book.language === 'ar'` or the text is ≥ 60 % Arabic code points; Latin runs wrapped `dir="ltr"`. View switch in `CanvasPane`: PDF | Text (DEFAULT: Text while audio plays if the user has not chosen).
- `NowPlayingBar`: prev/next now step **segments** (page buttons stay for navigation); progress = position in book (Σ durations known / estimated); `pending` → spinner on the play button with "preparing…"; `402` → credits chip turns `text-destructive` and a toast "Out of listening credits — cached audio and text still work".

Acceptance (running app):
- Open a never-processed Arabic book → within ~60 s play starts at page 1; the text view shows the first paragraph with the highlighted sentence moving; when the segment that spans pages 5→6 plays, the PDF pane flips to 6 at roughly the right moment (±1 sentence).
- No running header, footer, page number or footnote is ever spoken (listen through 3 page boundaries).
- A legacy book (no extraction yet, `processing` returns `legacy` when `POST /process` is disabled by env for the test) behaves exactly as before story 7 (R7 regression script from the reading-room spec).
- Change voice mid-segment → playback stops, `/listen` re-plans with the new voice, resumes at the same segment.
- `tsc` + `build` pass; `grep -rn "isBlankCanvas" frontend/src` still only in the legacy hook.

### Story 8 — Credits UI + states (S) · **Sonnet**

Files: `hooks/useCredits.ts`, `NowPlayingBar.tsx` (chip), `pages/Settings.tsx` (balance + last 20 ledger rows, mono font), `apiService.ts`.
Acceptance: balance in `mm:ss` of listening left; updates after each settled segment (poll 15 s or after `/listen`); 402 state visible; no emoji, no gradient.

### Story 9 — Document chat on OpenRouter (M) · **Sonnet** (shape fixed by spike P7)

Files: `backend/src/services/geminiDocumentService.js` → thin wrapper over `llmProvider.chatWithDocument`; `chatController.js` (`upload-book` stores the parsed-file `annotations` hash in `ai_conversations.gemini_cache_name` — **column reuse, no DDL**; `cache_expires_at` semantics kept for the client), `calculateMessageCost` from real `usage`, tests.
Acceptance: Chat tab answers a question about a 100-page PDF; the second turn costs less than the first (log `usage`); `useBookConversation` (reading-room story 5) needs no change; `LLM_PROVIDER=google` path still works.

### Story 10 — Legacy retirement sweep (S) · **Haiku** sweep with grep verification; **Sonnet** reviews

Only after the owner has re-processed every live book: remove the client-side header+body join and `isBlankCanvas` call sites from the room (`usePageAudio.ts` deleted, `blankPage.ts` deleted), keep `/api/pages/*` routes until the owner says otherwise. Verify `grep -rn "getCachedPageText\|getCachedPageAudio\|isBlankCanvas" frontend/src` → 0 hits; `tsc` + `build`.

### Story 11 (optional, later) — Forced alignment sidecar (L) · **Opus**

Python sidecar (MMS forced aligner per `docs/research/2026-10-arabic-tts.md` §2c) producing word timings per `segment_audio` row (`segment_audio.alignment jsonb` — **new column, owner approval**); client prefers alignment, falls back to proportional. Not scheduled in this epic.

### Delegation summary

| Story | Who | Why |
|---|---|---|
| 1 | Opus | Judgement calls on unverified API shapes; decisions feed three stories |
| 2 | Sonnet | Interface and constants fixed by story 1 |
| 3 | Opus (SQL) → owner applies | DDL + a data backfill on live rows |
| 4, 5 | Opus | Prefix finalisation, idempotency, reservations — first idea likely wrong |
| 6, 8, 9 | Sonnet | Spec'd, checkable |
| 7 | Opus hook / Sonnet view | Highlight + flip clock is careful work; the view is spec'd |
| 10 | Haiku + Sonnet review | Mechanical sweep with a grep gate |

---

## 7. Interleaving with reading-room stories 3–7

```text
backend stories 1 → 2 → 3 → 4 → 5 → 6 → 9          (no frontend files)   ║  reading-room 3 → 4 → 5 → 6 → 7  run in parallel
frontend story 7 ─ needs: backend 5 landed, reading-room story 3 landed   ║  story 8 after 7; story 10 last
```

| Reading-room story | Files it edits | Relation to this epic |
|---|---|---|
| 3 Page canvas (`usePageFit`, `PageCanvas`, `CanvasPane` prefetch width, `capturePage` → `usePageAudio` 3.4, control bar 3.5) | `PageCanvas.tsx`, `CanvasPane.tsx`, `usePageAudio.ts`, `NowPlayingBar.tsx` | **Must land before story 7** — both touch `CanvasPane`/`NowPlayingBar`. Recommendation: keep 3.4 minimal (capture path only matters for legacy books). |
| 4 Left rail | `LeftRail`, `ThumbnailList`, `OutlineList`, `RailNotes`, `RailStrip` | Parallel with everything here. Nice-to-have later: rail "Text" tab mirrors `ExtractedTextView` — not in scope. |
| 5 AI pane | `useBookConversation`, `ChatWindow`, `ExplainTab`, `AIPane`, `useTextSelection`, `SelectionPopover` | Parallel. Story 9 changes only the backend behind `/api/chat/*`; the client contract is unchanged. |
| 6 App-shell restyle sweep | all pages + `index.css` | Parallel with backend stories; **do not run 6.1 while story 7 is in flight** (whole-tree churn). `ExtractedTextView` is written with tokens from day one so the sweep has nothing to fix there. |
| 7 RTL + mobile | all components (7.1 sweep), `UIContext`, `MobileReadingRoom` | `ExtractedTextView` uses logical utilities and `dir` from the book, so 7.1 finds nothing; `MobileReadingRoom` reuses `NowPlayingBar` as is. Same no-overlap rule as 6.1. |

---

## 8. Cost model per 300-page Arabic book (measured bake-off numbers, list prices valid to 2026-12-31)

Inputs: 1 213 spoken chars/page → 364 k chars/book; 99.9 s audio per 1 000 chars → **36 400 s ≈ 10.1 audio-hours**; 3.92 segments/page → ≈1 176 segments; extraction $0.00468/page realtime; TTS 22.9 tok/s.

| Line | Realtime | Batch / cheaper tier | Shared-cache hit |
|---|---|---|---|
| Text extraction (gemini-3.8-flash; 2 080 prompt tok of which 1 092 image, ~830 output, 0 reasoning) | **$1.40** (300 × $0.00468) | **$0.70** (`:batch` at half) — first 10 pages always realtime: +$0.05 | $0 (image hash unchanged) |
| TTS audio, Flash ($9/M out, 22.9 tok/s = $0.742/h + text in 205 k tok × $0.5 = $0.10) | **$7.60** whole book · **$0.75 per listened hour** | Flash-Lite $6/M: **$5.1** / **$0.50 per hour**; Google-direct Batch (needs paid Google key): $0.41/h → $4.1 | **$0** |
| Storage (WAV 48 KB/s) | 1.75 GB per voice per book — see R3; as 64 kbps mp3/opus ≈ 0.29 GB | same | shared row, counted once |
| Document chat (story 9) | per turn: PDF tokens once + answer; P7 measures | annotations reuse | — |
| **Platform cost: a user listens to the whole book, realtime JIT** | **≈ $9.0** (+ storage) | **≈ $5.8** (Lite TTS + batch text) | **≈ $0.70** (text only, audio all hits) |
| **Per listened hour (what credits price against)** | **$0.75** Flash / $0.50 Lite | — | $0 |

Window economics: a 600-s window ≈ 6 000 chars ≈ 15 segments ≈ $0.13 of TTS reserved at a time; the first page's audio is ready ~20 s after extraction of page 1 (TTS p50 17 s), so the owner's "listening within ~1 min" target holds only if the first realtime page extracts in ≤ 15 s (bake-off p50 10.9 s, max 13.2 s).

---

## 9. Owner decisions (2026-10-13 / 2026-10-14) — these SUPERSEDE anything above that conflicts

The original defaults D1–D3 are replaced. Sections 3 (data model), 5.3 (credits), and stories 3, 5 and 8 must be reconciled with this table when those stories are planned in detail.

| # | Decision (final) | Consequence for the design |
|---|---|---|
| O1 | **Two book modes, chosen at upload or before opening: Read and Listen.** Read = the real PDF page + chat + notes, **no extraction, no audio**. Listen = extraction + audio. A Read book can switch to Listen later. | `books.mode` (`read` \| `listen`); extraction jobs are only created for Listen books. Chat keeps using the PDF directly, so it works in both modes. |
| O2 | **The user pays for extraction**, and only in Listen mode. | No platform-paid extraction (old D2 dropped). |
| O3 | **Billing is metered like our providers bill us, plus our other costs:** text extraction **per token**, audio **per second**. The page is a **storage unit only**, never a billing unit. | Ledger rows carry `unit` (`tokens` \| `audio_seconds`), quantity, provider cost, and price charged. Price = provider cost × markup (config), not a per-page or per-minute flat rate. |
| O4 | **A recording belongs to whoever paid to generate it.** Recording = book (PDF content hash) × voice persona snapshot. A new or edited persona is a new recording and a new generation. | New `recordings` table: `book_content_sha256`, `persona_snapshot_sha256`, `owner_user_id`, `visibility` (`private` \| `donated`). `segment_audio` gains `recording_id` + `funded_by_user_id` (a recording may have several funders, e.g. different chapters). |
| O5 | **Donation:** the owner may donate a recording to everyone; listeners then play its existing audio **free**. Segments not yet generated are paid by whoever generates them, who may donate them too (community recording). Donation requires the uploader to confirm they hold the rights; donations can be taken down. | `recordings.visibility='donated'`, `donated_at`, `rights_attested_at`; a takedown flag. |
| O6 | **Pay it forward** for private recordings: same book + same voice is **never regenerated**. Another listener pays the normal per-second price; a share goes back to the funder(s) **as credits**, until each funder has recovered **100%** of what they paid; after that the platform keeps it all. Credits only, never cash. A "founding narrator" badge stays on the recording. | Ledger kind `rebate`; per-funder `recovered_amount` vs `paid_amount`, capped at 100%; listener payments split across funders by the seconds of their segments played. Rebate share % is config. |
| O7 | **Audio clip unit = paragraph; storage unit = page.** A paragraph crossing a page break is ONE clip, stored and generated once, owned by the page it starts on; the next page references it as "continues from". Never cut audio at a page edge. | Per-page index of segments (`parts` already records the page spans); page view flips partway through the shared clip at the page-2 character offset. |
| O8 | **Non-content pages:** every page is classified in the same extraction call (cover, title, copyright, dedication, author's note, table of contents, blank, body, index, bibliography, back cover). Defaults: skip cover, title, copyright, blank, table of contents, index, back cover, dedication, author's note; read preface/introduction/body. The user reviews the suggestions (rail Pages tab: thumbnail + toggle, plus "read all front matter") and may read any skipped page. Skipped pages are never voiced. | `page_text.page_type`; per-user-per-book skip overrides; the segment builder excludes skipped pages per listener. |
| O9 | **Existing books re-process automatically on first open** (Listen mode); legacy per-page audio keeps playing until new segments are ready. | Unchanged from old D3. |
| O10 | **Order:** finish the reading-room epic before starting story 1 of this epic. | — |

---

## 10. Risks and the cheapest de-risk

| # | Risk | Cheapest de-risk | Story |
|---|---|---|---|
| R1 | OpenRouter TTS request shape / voice mapping / style instruction differ from Google-direct; a system message yields a text-only reply (seen in the bake-off) | Spike P3–P5 before any provider code; `synthesize` retries once with the style folded into the user text | 1, 2 |
| R2 | `:batch` is either asynchronous (needs polling) or not cheaper in practice; it also lacks `temperature` | Spike P2 measures wall time + determinism on 2 pages; `extractPages` handles both modes behind one flag | 1, 4 |
| R3 | WAV storage ≈1.75 GB per voice per book | Spike P3 tries `format: 'mp3'|'opus'`; else `apk add ffmpeg` in both Dockerfiles and transcode in `ttsSegment`; `audio_format` column already there | 1, 5 |
| R4 | Image tokens via OpenRouter higher than the 1 092 measured direct (no `media_resolution` parameter exposed) | Spike P1 compares `usage` with bake-off; fallback: render at 150 DPI and re-check role accuracy on the 12 bake-off pages | 1 |
| R5 | Provider 429s under 4-parallel realtime extraction (seen on the Google free tier) | Spike P6; concurrency caps in config; backoff honours reset headers | 1, 4 |
| R6 | Prefix finalisation renumbers or duplicates segments on restart | `UNIQUE (extraction_id, seq)`, `status='open'` rewrite in place, unit test that replays the same job twice | 4 |
| R7 | Latin-glued defects or loops reach audio | `validate.js` + retry at `medium` + `suspect` flag; bake-off page `b3-p9` becomes the regression fixture | 4 |
| R8 | Job loop starves HTTP in the single Express process (`pdftoppm`, base64 of 1 MB PNGs) | Caps (1 extract job × 4 pages, 2 TTS); `JOBS_MODE=worker` is a flag flip, not a refactor | 4 |
| R9 | Credit reservation drift (estimate ≠ actual) or leaks on crash | Settle to WAV-header duration; a sweeper releases reservations whose job is `failed`/`cancelled` or older than 1 h with no row | 5 |
| R10 | Shared-cache leak: a private book's audio served to another user | Scope rule tested with two users; `scope_key` in the unique key; lookup never matches another user's `owner_user_id` | 5 |
| R11 | Proportional highlight drifts on long segments with numerals/pauses | Sentence-level only (not word); seek re-syncs; story 11 (forced alignment) if the owner finds it distracting | 7 |
| R12 | Reading-room story 3 and this story 7 edit `CanvasPane`/`NowPlayingBar` at once | Ordering rule in §7; story 7 starts after RR-3 merges | 7 |
| R13 | Prices double on 2027-01-01 (Google announcement in the research docs) | Cost table is per-hour; credits are minutes, so the owner re-prices minutes, not code | — |

---

## 11. Unverified at spec time (resolved by story 1 unless noted)

- OpenRouter TTS: voice-name mapping, `format` options and sample rate, style/system-instruction behaviour, max input, streaming-only delivery details for the Gemini TTS models (`supported_parameters` is empty in the catalogue).
- `:batch` delivery semantics and real turnaround; determinism without `temperature`.
- Image token count and `reasoning.effort: 'minimal'` acceptance through OpenRouter.
- OpenRouter per-account rate limits for paid credits (docs give none); provider pass-through limits.
- PDF chat cost per turn and whether `annotations` reuse avoids re-billing (P7).
- Index/constraint details of the live tables (REST exposes columns and counts only; migrations in the repo cover just the storage policy). The §3 diff therefore adds indexes defensively and never assumes an existing one.
- Whether the Google-direct Batch API is worth a paid Google key for chapter-ahead TTS (only relevant if the owner wants the $0.41/h tier; not needed for the epic).
