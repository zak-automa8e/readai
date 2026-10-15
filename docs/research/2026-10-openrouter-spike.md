# OpenRouter spike — story 1 of the audio pipeline rebuild

Date: 2026-10-15 · Branch `feat/reading-room-revamp` · Spec: `specs/2026-10-12-audio-pipeline-rebuild.md` §6 story 1
Script: `backend/scripts/spikes/openrouter-probe.js` (run from `backend/`; every probe caches to `bakeoff-output/spike/data/<probe>.json`,
a re-run spends nothing). Raw results: `bakeoff-output/spike/results.json`. Audio: `bakeoff-output/spike/` (git-ignored).

Vocabulary: **TTS** = text-to-speech; **STT** = speech-to-text; **PCM** = raw 16-bit little-endian samples; **CER** = character error rate
(edit distance ÷ reference length) against the Google-direct bake-off output, which is a reference, not ground truth;
**TTFB** = time to first byte.

## What changed against the spec (read this first)

```diff
  extraction realtime   POST /api/v1/chat/completions  model google/gemini-3.8-flash          ✔ as specified
- extraction batch      POST /api/v1/chat/completions  model google/gemini-3.8-flash:batch    ✘ 404 "cannot be used with chat/completions"
+ extraction batch      POST /api/v1/batches {endpoint:'/v1/chat/completions', model, requests:[{custom_id, body}]}
+                       → 202 {id,status:'validating'} → poll GET /api/v1/batches/:id → results[] inline
+                       images: PUBLIC http(s) URL only — data-URL/base64 rejected; one batch = one configuration
- TTS                   POST /api/v1/chat/completions  stream, modalities:['text','audio'], audio:{voice,format}
+ TTS                   POST /api/v1/audio/speech {model, input, voice, response_format:'pcm', instructions?}
+                       → raw bytes, Content-Type audio/pcm;rate=24000;channels=1, cost only via X-Generation-Id
- TTS style             system message
+ TTS style             top-level `instructions` (OpenRouter forwards it as Gemini speech_metadata.style)
- audio.format mp3/opus Gemini TTS: response_format 'pcm' ONLY (mp3 → 400; wav/opus/aac/flac → 400 schema error)
+ compression          ffmpeg in the backend (opus 32 kb/s = 4 KB/s, 12× smaller than WAV)
```

## Probe table

Request JSON below has the `Authorization` header omitted (it is the only secret; headers were never logged). Base64 bodies are shortened.

| Probe | Request (keys) | Response shape | Numbers | Decision for story 2 |
|---|---|---|---|---|
| **P1** extraction realtime | `POST /chat/completions` `{model:'google/gemini-3.8-flash', messages:[{role:'system',content:EXTRACTION_PROMPT},{role:'user',content:[{type:'image_url',image_url:{url:'data:image/png;base64,…'}},{type:'text',text:'Transcribe this page into blocks.'}]}], response_format:{type:'json_schema',json_schema:{name:'page_blocks',strict:true,schema}}, reasoning:{effort:'low'}, temperature:0, usage:{include:true}}` (schema = `RESPONSE_SCHEMA` lower-cased, `propertyOrdering` dropped, `additionalProperties:false`) | `{id, object, created, model, provider:'Google', system_fingerprint, service_tier, choices:[{finish_reason:'stop', message:{role, content:<JSON string>, refusal, reasoning, reasoning_details}}], usage:{prompt_tokens, completion_tokens, total_tokens, cost, is_byok, prompt_tokens_details:{cached_tokens, cache_write_tokens, audio_tokens, video_tokens}, cost_details:{upstream_inference_cost, upstream_inference_prompt_cost, upstream_inference_completions_cost}, completion_tokens_details:{reasoning_tokens, image_tokens, audio_tokens}}}`. Header `x-generation-id`. No image-token split in `usage`. | **prompt 2 329** on every page (bake-off 2 077 = 985 text + 1 092 image; +252 tokens through OpenRouter, image tokens not broken out). Completion 588–1 044 (bake-off 594–1 211). Reasoning **0**. Cost **$0.0040–0.0063/page** = list price, no markup (`cost` == `upstream_inference_cost`). Role counts **equal** on both pages; body CER **0.4 %** (b1-p5), **2.5 %** (b3-p9: diacritics only, plus it *fixed* the bake-off's `أserver` Latin-glue defect). Sentence flags identical. `reasoning.effort:'minimal'` **accepted** (200, CER 0.3 %, 5.1 s). | Realtime extraction = this exact body. Use `effort:'minimal'` (accepted, no quality loss seen, fastest). Bill from `usage.cost` + `usage.prompt_tokens/completion_tokens`. Keep `json_schema strict`. |
| **P2** extraction batch | (a) `:batch` on chat → **404** `"google/gemini-3.8-flash:batch cannot be used with the chat/completions endpoint (adapter VertexGeminiBatchAdapter)."` (b) `POST /batches {endpoint:'/v1/chat/completions', model:'google/gemini-3.8-flash', requests:[{custom_id, body:<P1 body without temperature>}]}` with a data-URL image → 202, then **failed**: `"Only public http(s) image URLs are supported in batch; base64/data-URI images, audio, video, and file content parts are rejected."` (c) same with a public Supabase PNG URL, two identical requests | 202 `{id:'batch-…', object:'batch', endpoint, model:'google/gemini-3.8-flash-20260902', completion_window:'24h', status:'validating', created_at, finalized_at, request_counts:{total,completed,failed}, usage, results, error}`; poll `GET /batches/:id`; `results[]` = `{custom_id, id, response:{status_code, request_id, body}, error}` | Submit 202 in ~2 s; `validating` → `in_progress` (≤32 s) → **`completed` at 460 s (7.7 min)** for 2 pages; results inline in the poll response. **Asynchronous**, not a slow synchronous call. Cost **$0.00453 for 2 pages = $0.00227/page** (4 658 in × $0.375/M + 1 485 out × $1.875/M) vs $0.0052 realtime on the same image = **half price confirmed**; per-request `usage` in each result, batch total `usage.cost` on the batch. Determinism without `temperature`: the two identical requests **differ** (CER 3.4 %, one heading merged into body). Realtime at `temperature:0` is **not deterministic either** (three b1-p5 runs: CER 0.14 % / 0.22 % / 0.43 % vs bake-off, all different strings). Mixing a request with another `response_format` in one batch fails the whole batch: "Split the requests into one batch per configuration". | Batch mode = **async job**: `extract_pages` (batch) submits, stores `provider_batch_id`, re-enqueues itself with `run_after +5 min` to poll (spec §5.2 branch 1). Page PNGs must be at a **public (or signed, ≥24 h) http(s) URL** — story 4 uploads the rendered PNG to storage before submitting (realtime keeps data URLs). One batch = one prompt/schema version. Do not rely on determinism in either mode: dedup by `image_sha256 + prompt_version + model` as specced, never by re-running and comparing. |
| **P3** TTS shape | chat/completions (stream and non-stream) → **400** `"…is a text-to-speech model and cannot be used with the chat/completions endpoint. Use the /api/v1/audio/speech endpoint instead."` → `POST /audio/speech {model:'google/gemini-3.8-flash-tts', input:<b1-s05, 286 chars>, voice:'Zephyr', response_format:'pcm'}` | Raw bytes; headers `content-type: audio/pcm;rate=24000;channels=1`, `x-generation-id: gen-tts-…`. No usage in the body: `GET /generation?id=` gives `native_tokens_prompt`, `native_tokens_completion` (audio tokens), `total_cost`, `provider_name:'Google'`, `model:'google/gemini-3.8-flash-tts-20260922'`, `api_type:'tts'`. Unknown voice `NotAVoice` → **400** `"Provider returned 400"` (free). | **27.68 s** audio vs bake-off **27.87 s** (−0.7 %, inside ±10 %) → `Zephyr` maps to the Gemini prebuilt voice. 24 kHz mono s16le = **48 000 B/s**. 104 text tok + **692 audio tok = exactly 25.0 tok/s** (Google-direct measured 22.9). **$0.00628** = 104×$0.50/M + 692×$9/M, list price, no markup → **$0.817/audio-hour** (bake-off $0.754). Latency 9.3 s, TTFB 8.8 s (bytes arrive only at the end; no useful streaming). | `synthesize()` → `/audio/speech`, `response_format:'pcm'`, wrap in a 44-byte WAV header using the `rate=` from Content-Type. Voice = Gemini prebuilt name as-is. Cost/usage via `GET /generation?id=<x-generation-id>` (needs a short retry: stats appear ~2–5 s later). Bill audio as `seconds × $0.000225` (25 tok/s × $9/M) — equals OpenRouter's charge to the cent. Treat voice 400 as a non-retriable config error. |
| **P4** TTS style | P3 + `instructions: voicePersonaService.buildPrompt({pace:'slow',tone:'dramatic',emotion:'enthusiastic',speaking_style:'storytelling'})`; P3 + short `instructions:'Read slowly and dramatically, like an enthusiastic storyteller, with long pauses.'`; P3 with the directive prefixed into `input` | same as P3; always audio (no text-only reply — the endpoint has no text modality) | Durations: plain 27.7 s → buildPrompt instructions **31.7 s** → short instructions **36.2 s** → prefix-in-input **45.1 s**. STT of the prefix file begins with **"Read slowly"** — the directive is **spoken aloud** (OpenRouter's TTS doc warns of this for 3.8 TTS). STT of the instructions file begins with the book text — instruction not spoken. | Style mechanism = top-level **`instructions`** (string from `buildPrompt`). Never fold style into `input`. The bake-off's "No audio data / text-only reply" failure mode is gone on this endpoint, so no retry-with-style-folded fallback is needed. Owner to judge by ear whether `buildPrompt`'s long prompt or a short directive sounds better. |
| **P5** TTS long | P3 with `b1-s03` (825 chars), a 1 496-char and a 2 995-char cut of book b1 | same | 825 → 76.6 s audio, **24.5 s** latency (Google-direct 32.2 s). 1 496 → 129.6 s, **25.5 s**. 2 995 → **276.8 s**, **34.5 s**. STT tail of the 2 995-char file matches the input's last sentence → **no truncation** at 3 000 chars (no `finish_reason` exists on this endpoint). 25.0 audio tok/s on all. | Keep the 1 500-char segment cap (headroom, and window granularity). Long segments are cheaper in latency per second of audio (≈8 s of audio per second of wall time at 3 000 chars). No max-length guard needed below 3 000 chars. |
| **P6** rate | 4 × P1 (both pages twice) + 2 × P3 (`b1-s01`, `b1-s02`) fired at once | all 200 | **0 × 429**. Wall 25.5 s for all six. Extraction 6.7–9.1 s (same as serial), TTS 14.4/15.3 s. **No `X-RateLimit-*` headers** on any response. `GET /key`: `{limit:10, limit_remaining, usage, usage_daily/weekly/monthly, is_free_tier:false, rate_limit:{requests:-1, interval:'10s', note:'deprecated'}}` | Caps are ours to choose: start at **4 extraction + 2 TTS** concurrent (spec R8 values) — no provider pressure at that level. Backoff must not depend on rate-limit headers (none sent); honour `Retry-After` if present, else exponential. The key has a **$10 limit** (`limit_remaining`) — story 2 should surface 402 "key limit" as an ops alert, not a user error. |
| **P7** document chat | `POST /chat/completions {model:'google/gemini-3.8-flash', messages:[{role:'user',content:[{type:'text',text:'ما عنوان الفصل الأول؟'},{type:'file',file:{filename:'b1.pdf',file_data:<public pdf_url>}}]}], plugins:[{id:'file-parser',pdf:{engine:'native'}}], reasoning:{effort:'low'}}`; turn 2 resends the file + the assistant reply (+ `annotations` if any) + a follow-up | same as P1. `message` keys `role, content, refusal, reasoning, reasoning_details` — **no `annotations` returned** with the `native` engine. | b1 = **27 pages, 430 KB** → **14 100 prompt tokens** (≈520 tok/page) → **$0.0107/turn**, 17.7 s. Answer correct ("مَنهجِيّة قُرآنيّة عَامة", p. 16). Turn 2 (resent file): 14 142 tok; first try **$0.0109, cached 0**; second try **$0.0027, `cached_tokens` 12 235** (Gemini implicit cache, 0.25×). Extrapolated: 100 pages ≈ 52 k tok ≈ **$0.039/turn** uncached, ≈ $0.011 cached; 300 pages ≈ $0.12 / $0.03. | Chat = native PDF via URL, resend the file every turn, rely on caching. Annotation reuse is **not available** with `native` (nothing to reuse). Implicit caching is hit-or-miss (1 of 2 here) → story 9 should try explicit `cache_control` on the file part to make the discount deterministic; bill per token from `usage` incl. `cached_tokens`. |
| **P8** compressed audio | P3 with `response_format` = `mp3`, `wav`, `opus`, `aac`, `flac`, `pcm16` | `mp3` → **400** `"Gemini TTS only supports response_format=\"pcm\". Got \"mp3\"."`; the other four → **400** ZodError `expected one of "mp3"|"pcm"` (the endpoint knows only mp3/pcm; Gemini only pcm). All free. | Only `pcm` works: **48 000 B/s, 1.75 GB per voice per 300-page book**. Local ffmpeg transcode of the P3 file: opus 24k **3 052 B/s (0.11 GB/book)**, opus 32k **4 030 B/s (0.15 GB)**, opus 48k 5 971 B/s (0.22 GB), mp3 48k 6 022 B/s, mp3 64k 8 027 B/s (0.29 GB), aac 48k 6 387 B/s. Encode time 0.3–0.8 s per 28 s clip. | Store **Ogg Opus 32 kb/s** (`audio_format='opus'`), 12× smaller than WAV — **unverified** on older iOS Safari, which has historically lagged on Ogg Opus; if story 7 finds a gap, MP3 64 kb/s (0.29 GB/book, 6× smaller) plays everywhere. Requires `ffmpeg` in both Dockerfiles (spec R3 fallback becomes the plan) and a transcode step in `ttsSegment`. Billing uses the PCM duration before transcoding. |

## Latency (OpenRouter, measured today)

| Path | n | p50 | max | Google-direct bake-off |
|---|---|---|---|---|
| Extraction realtime (200 DPI PNG, `effort` low/minimal) | 8 | **7.7 s** | **9.1 s** | p50 10.9 s, max 13.2 s |
| Extraction batch API (2 requests) | — | 460 s (7.7 min) submit → completed | — | — |
| TTS `/audio/speech` (286–2 995 chars) | 9 | **14.4 s** | **34.5 s** (2 995 chars) | p50 17.2 s, max 32.2 s |
| TTS, same 286-char segment | 1 | 9.3 s | — | 10.6 s |
| TTS, same 825-char segment | 1 | 24.5 s | — | 32.2 s |
| Document chat turn (27-page PDF) | 3 | 16.4 s | 17.7 s | — |

First audio for a new book ≈ extraction 5–9 s + TTS of the first segment 9–25 s → **≈ 15–35 s**, inside the owner's "listening within ~1 min".

## Billing fields (owner decision O3: text per token, audio per second)

| Call | Where the numbers are | Fields to store in the ledger |
|---|---|---|
| Extraction / chat | response body `usage` | `prompt_tokens`, `completion_tokens`, `completion_tokens_details.reasoning_tokens`, `prompt_tokens_details.cached_tokens`, `cost` (USD, == upstream cost; no OpenRouter markup on per-token charges) |
| Batch extraction | `GET /batches/:id` → `usage` (batch total) and `results[].response.body.usage` (per page) | same fields per page |
| TTS | **not** in the response; `GET /generation?id=<x-generation-id>` | `native_tokens_prompt` (text), `native_tokens_completion` (audio tokens = 25 × seconds), `total_cost`; seconds from the PCM byte count ÷ 48 000 |

Audio per second at list price = **$0.000225/s** (+ text input ≈ $0.000002/s) = **$0.817/h**; the spec's §8 $0.754/h used Google-direct's
22.9 tok/s, so the TTS line of the cost model is **8 % higher** through OpenRouter.

## Spend

| Source | USD |
|---|---|
| Sum of `usage.cost` / `generation.total_cost` over all cached probes (P1 $0.0139, P2 $0.0097, P3 $0.0063, P4 $0.0256, P5 $0.1096, P6 $0.0427, P7 $0.0243, P8 $0, PT $0.0109) | **$0.2431** |
| `GET /api/v1/key` `usage`: before $0.000000 → after $0.2483 (includes $0.0052 of a discarded first P2 run whose realtime call was redone) | **$0.2483** |

Budget guard $1.00 never tripped. Every refused call (404/400) cost $0. The key has a $10 limit; $9.75 remains. PT = an extra speech-to-text check (gemini-3.8-flash with `input_audio`) used to confirm what P4/P5 audio actually says.

## Files for the owner to listen to (`readai/bakeoff-output/`)

| Listen for | File |
|---|---|
| Voice mapping: OpenRouter `Zephyr` vs Google-direct `Zephyr` | `spike/P3-b1-s05-zephyr.wav` vs `audio/new/b1-s05.wav` |
| Style via `instructions` = `buildPrompt(dramatic persona)` | `spike/P4-b1-s05-dramatic-instructions.wav` |
| Style via a short `instructions` directive | `spike/P4-b1-s05-dramatic-short-instructions.wav` |
| Style prefixed into `input` (directive is read aloud — the wrong way) | `spike/P4-b1-s05-dramatic-prefix-in-input.wav` |
| Long segments | `spike/P5-b1-s03-825.wav` (vs `audio/new/b1-s03.wav`), `spike/P5-1500.wav`, `spike/P5-3000.wav` |
| Compression quality (same clip as P3) | `spike/P8-transcode-opus-24k.ogg`, `-opus-32k.ogg`, `-opus-48k.ogg`, `-mp3-48k.mp3`, `-mp3-64k.mp3`, `-aac-48k.m4a` |

## Blocks or changes for story 2 (and later stories)

Nothing blocks story 2. Its interfaces change from the spec as follows:

1. **Two transports, not one.** `openrouterProvider` needs `chat()` (`/chat/completions`, JSON) for extraction + document chat, `synthesize()` (`/audio/speech`, binary) for TTS, and `submitBatch()/getBatch()` (`/batches`) for batch extraction. The spec's streaming-SSE TTS shape (`modalities`, `audio:{voice,format}`, `delta.audio.data`) does not apply to Gemini TTS on OpenRouter.
2. **TTS cost is a second call.** `synthesize()` returns `{pcm, sampleRate, generationId}`; a follow-up `GET /generation?id=` (retry ~2–5 s) yields `total_cost` and audio tokens. The credit settle in story 5 can use `seconds × 0.000225` immediately and reconcile later.
3. **Batch needs public image URLs** (story 4): upload rendered page PNGs to storage (public bucket path or a signed URL valid ≥ 24 h) before submitting; realtime keeps data URLs. Batch is async (7.7 min for 2 pages today, 24 h window) → poll pattern.
4. **Compression needs ffmpeg** (story 5 + both Dockerfiles): Gemini TTS returns PCM only. Recommended store format Ogg Opus 32 kb/s; owner to confirm by ear (P8 files) and story 7 to confirm iOS playback.
5. **Style = `instructions`**: `voicePersonaService.buildPrompt(persona)` passes straight through; strip its "You must ONLY output audio" line later if the owner prefers (it is harmless here — the endpoint can only return audio).
6. **Cost model update** (§8): TTS via OpenRouter = 25.0 audio tok/s → $0.817/h (not $0.754); extraction 2 329 prompt tokens/page (not 2 077) → ≈$0.0045–0.0063/page realtime, ≈$0.0023/page batch.
7. **Ops**: the key has a $10 spend limit; a 402 from OpenRouter must alert the operator, not show as a user credit error.

Open, not resolved by this spike: whether `provider.options` can lift Gemini TTS sample rate or add pcm→mp3 server-side (doc mentions only `google-ai-studio` options forwarded as generation config — untested); explicit `cache_control` on PDF file parts for story 9 (implicit caching hit 1 of 2 tries).
