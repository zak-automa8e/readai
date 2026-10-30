# Audio Pipeline Rebuild — Stories 7a–12, delegation, interleaving

Part of [the audio pipeline spec](../2026-10-12-audio-pipeline-rebuild.md) (§6, stories 7a–12; §7). Owner decisions (§9) live there and supersede this file where they conflict.

### Story 7a — Request limits for listening (S) · **Opus** · 2026-10-28

The production limit (100 requests / 15 min per IP, all of `/api`) ran out in ~3 minutes with 2-s clip polling, and is shared by everyone on one IP. Owner chose: wait-for-ready + per-user limit. `POST /listen/wait` replaces polling; the playback routes (`processing`, `segments`, `listen`, `listen/wait`, `segments/:id/audio`, `plan`) leave the general limiter for their own budget per signed-in user (`PLAYBACK_RATE_LIMIT_MAX`, default 600 / 15 min) behind a per-IP flood guard (`PLAYBACK_IP_RATE_LIMIT_MAX`, 3000). Player contract for story 7: after `/listen`, send the pending ids to `/listen/wait` in a loop; fetch `/segments/:id/audio` only for clips reported ready.

### Story 7 — Frontend: segment playback, text view, highlight, page flip (L) · **Opus** for `useSegmentPlayback`; **Sonnet** for `ExtractedTextView` + bar changes

Files: `frontend/src/services/apiService.ts`, `frontend/src/types/segments.ts`, `hooks/useBookProcessing.ts`, `hooks/useSegmentPlayback.ts`, `components/reading-room/ExtractedTextView.tsx`, `CanvasPane.tsx` (view switch; hidden prefetch `<Page>` rendered only in legacy mode), `NowPlayingBar.tsx`, `ReadingRoomContext.tsx` (choose hook by `processing.mode`), `usePageAudio.ts` **unchanged**.

Behaviour:
- On room mount: `useBookProcessing` calls `GET /processing`; if no extraction and the book is the user's (or in their library) → `POST /process` (DEFAULT 1); polls while `running`. `mode:'legacy'` → today's hook; `mode:'segments'` → new hook. Toast once: "Preparing this book… listening starts in about a minute".
- `useSegmentPlayback`: `segments` from `GET /segments`; `play(seq)` → `/listen {fromSeq}` → plays the first `ready` item with one `<audio>`; while playing, polls `GET /segments/:id/audio` for the next 2 items and preloads them (`new Audio(url).load()`); on `ended` → next segment (no page-level blank skipping needed: pages with no body blocks produce no segments); every 20 s and on pause → `POST /progress`.
- **Highlight clock**: `t → charIndex = t / duration × charCount` → current sentence = last `sentenceOffsets[i] ≤ charIndex`; **page flip**: when `charIndex ≥ Σ parts[0..k].chars` → `setPageNumber(parts[k+1].page)`; also `setPageNumber(startPage)` when a segment starts. Seeking inside a segment stays proportional. (Forced alignment is story 11.)
- `ExtractedTextView`: paragraphs grouped by `startPage` with a hairline page marker ("ص ٩" / "p. 9"), headings in `font-serif`, current sentence `bg-muted` + `text-primary` (tokens from the reading-room spec §3; no coloured bars), click a sentence → `seekTo(seq, charOffset)` → `/listen {fromSeq:seq}` + `audio.currentTime = offset/charCount × duration`; `dir="rtl"` when `book.language === 'ar'` or the text is ≥ 60 % Arabic code points; Latin runs wrapped `dir="ltr"`. View switch in `CanvasPane`: PDF | Text (DEFAULT: Text while audio plays if the user has not chosen).
- `NowPlayingBar`: prev/next now step **segments** (page buttons stay for navigation); progress = position in book (Σ durations known / estimated); `pending` → spinner on the play button with "preparing…"; `402 DAILY_LIMIT_REACHED` → the usage chip turns `text-destructive` and a toast "Today's listening limit is reached — reading, text and chat still work".

Acceptance (running app):
- Open a never-processed Arabic book → within ~60 s play starts at page 1; the text view shows the first paragraph with the highlighted sentence moving; when the segment that spans pages 5→6 plays, the PDF pane flips to 6 at roughly the right moment (±1 sentence).
- No running header, footer, page number or footnote is ever spoken (listen through 3 page boundaries).
- A legacy book (no extraction yet, `processing` returns `legacy` when `POST /process` is disabled by env for the test) behaves exactly as before story 7 (R7 regression script from the reading-room spec).
- Change voice mid-segment → playback stops, `/listen` re-plans with the new voice, resumes at the same segment.
- `tsc` + `build` pass; `grep -rn "isBlankCanvas" frontend/src` still only in the legacy hook.

### Story 8 — Plan + daily usage UI (S) · **Sonnet**

Files: `hooks/usePlan.ts`, `NowPlayingBar.tsx` (chip "3 / 10 pages today"), `pages/Settings.tsx` (current plan, limit, pages used today, the plan list read-only), `apiService.ts`.
Acceptance: the chip updates when listening reaches a new page (after `/listen` and on page flip); the limit-reached state is visible; no emoji, no gradient. No upgrade button until story 12.

### Story 9 — Document chat on OpenRouter (M) · **Sonnet** (shape fixed by spike P7)

Files: `backend/src/services/geminiDocumentService.js` → thin wrapper over `llmProvider.chatWithDocument`; `chatController.js` (`upload-book` stores the parsed-file `annotations` hash in `ai_conversations.gemini_cache_name` — **column reuse, no DDL**; `cache_expires_at` semantics kept for the client), `calculateMessageCost` from real `usage`, tests.
Acceptance: Chat tab answers a question about a 100-page PDF; the second turn costs less than the first (log `usage`); `useBookConversation` (reading-room story 5) needs no change; `LLM_PROVIDER=google` path still works.

### Story 10 — Legacy retirement sweep (S) · **Haiku** sweep with grep verification; **Sonnet** reviews

Only after the owner has re-processed every live book: remove the client-side header+body join and `isBlankCanvas` call sites from the room (`usePageAudio.ts` deleted, `blankPage.ts` deleted), keep `/api/pages/*` routes until the owner says otherwise. Verify `grep -rn "getCachedPageText\|getCachedPageAudio\|isBlankCanvas" frontend/src` → 0 hits; `tsc` + `build`.

### Story 11 (optional, later) — Forced alignment sidecar (L) · **Opus**

Python sidecar (MMS forced aligner per `docs/research/2026-10-arabic-tts.md` §2c) producing word timings per `segment_audio` row (`segment_audio.alignment jsonb` — **new column, owner approval**); client prefers alignment, falls back to proportional. Not scheduled in this epic.

### Story 12 — Payments (M) · **Opus** · after every functional story is done and owner-tested (O12)

Checkout and plan changes through a payment provider (provider chosen at that time); `subscriptions` gains the
provider's ids and period dates; webhooks keep `status` and `ends_at` in sync; Settings gets upgrade / cancel. Until
this story, plans are assigned by hand in `subscriptions`.

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
| 12 | Opus | Money and webhooks; runs last |

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
