# Audio Pipeline Rebuild — Target pipeline and load-bearing facts

Part of [the audio pipeline spec](../2026-10-12-audio-pipeline-rebuild.md) (§1, §2). Owner decisions (§9) live there and supersede this file where they conflict.

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
