# Audio Pipeline Rebuild — Cost model, risks, unverified items

Part of [the audio pipeline spec](../2026-10-12-audio-pipeline-rebuild.md) (§8, §10, §11). Owner decisions (§9) live there and supersede this file where they conflict.

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
