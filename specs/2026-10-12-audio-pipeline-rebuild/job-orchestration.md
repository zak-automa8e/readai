# Audio Pipeline Rebuild — Job orchestration

Part of [the audio pipeline spec](../2026-10-12-audio-pipeline-rebuild.md) (§5). Owner decisions (§9) live there and supersede this file where they conflict.

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

> **O12 (2026-10-16):** the credit steps below (`credit_apply` reserve / settle / release, scope rule, D1–D3) are
> superseded. The window is capped by the pages left in today's allowance (`record_page_listen`, §3), and cached clips
> are shared by text hash × voice hash. The orchestration (window, priorities, chapter-ahead, idempotency) stands.

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
