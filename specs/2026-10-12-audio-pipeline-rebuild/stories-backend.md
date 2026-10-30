# Audio Pipeline Rebuild — Stories 1–6 (backend pipeline)

Part of [the audio pipeline spec](../2026-10-12-audio-pipeline-rebuild.md) (§6, stories 1–6). Owner decisions (§9) live there and supersede this file where they conflict.

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

### Story 5 — Segment audio, window, daily limit (L) · **Opus**

Files: `backend/src/services/audio/{segmentAudioService.js, windowService.js}`, `backend/src/services/plans/planService.js`, `backend/src/services/jobs/handlers/ttsSegment.js`, `backend/src/controllers/{segmentsController.js (+listen, +audio), planController.js}`, routes (`GET /api/plan` → `{plan, limit, usedToday, remainingToday}`), `supabaseService` (+segment_audio CRUD, `record_page_listen` RPC wrapper), tests (voice snapshot hash canonicalisation, window stops at the remaining allowance, page counted once per day, 402 path, conflict path).

Acceptance (running app, processed book from story 4, owner's persona + base voice):
- `POST /listen {fromSeq:1}` → items for ≈600 s of text, but never past the pages left in today's allowance; within ~30 s the first item is `ready`; `segment_audio.duration_seconds` equals the WAV header (within 0.1 s); `segment_audio.cost_micros` is filled.
- Listening reaches a page → `daily_page_usage` gets one row; replaying the page adds none; `GET /api/plan` shows `usedToday` moving.
- Same request again → every item `ready, cached:true`, no new jobs.
- Switch voice (persona) → new snapshot hash, new generation; edit the persona (updated_at changes) → new hash again. A second test user listening to the same book and voice hits the existing clips.
- Free plan (2 pages) → the third new page returns `402 { code:'DAILY_LIMIT_REACHED', used, limit, plan }`; cached items for counted pages still play; no job enqueued. Assign `basic` by hand in `subscriptions` → the limit becomes 10 immediately.

### Story 6 — Prepare one page ahead (S) · **Opus** · rewritten 2026-10-20 (O13)

Files: `backend/src/services/audio/windowService.js` (`lastWindowPage`, page-based `planWindow`), config `audio.pagesAhead = 1` (replaces `windowSeconds`/`min`/`max`), `segmentsController.listen` (drops `windowSeconds`), tests.

Acceptance: `/listen` prepares the rest of the current page plus the next read page (skipped pages passed over); a segment starting on the last window page is taken whole, so a paragraph cut by the next page break is one clip; an open segment inside the window stops it with `processing`; the allowance cap and count-on-delivery rule are unchanged; no chapter-ahead jobs. Live check 2026-10-20: `fromSeq` 66 (page 18) planned 66–69 (69 = pages 19→20) and stopped at 70 with `window`.
