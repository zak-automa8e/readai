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

## Contents

| Sections | File |
|---|---|
| §1, §2: target pipeline and load-bearing facts | [target-and-facts.md](2026-10-12-audio-pipeline-rebuild/target-and-facts.md) |
| §3, §4: data model and api contract | [data-model-and-api.md](2026-10-12-audio-pipeline-rebuild/data-model-and-api.md) |
| §5: job orchestration | [job-orchestration.md](2026-10-12-audio-pipeline-rebuild/job-orchestration.md) |
| §6, stories 1–6: stories 1–6 (backend pipeline) | [stories-backend.md](2026-10-12-audio-pipeline-rebuild/stories-backend.md) |
| §6, stories 7a–12; §7: stories 7a–12, delegation, interleaving | [stories-player-and-later.md](2026-10-12-audio-pipeline-rebuild/stories-player-and-later.md) |
| §8, §10, §11: cost model, risks, unverified items | [costs-risks-unverified.md](2026-10-12-audio-pipeline-rebuild/costs-risks-unverified.md) |
| §9: owner decisions | this file, below |

---

## 9. Owner decisions (2026-10-13 / 2026-10-14) — these SUPERSEDE anything above that conflicts

The original defaults D1–D3 are replaced. Sections 3 (data model), 5.3 (credits), and stories 3, 5 and 8 must be reconciled with this table when those stories are planned in detail.

| # | Decision (final) | Consequence for the design |
|---|---|---|
| O1 | **Two book modes, chosen at upload or before opening: Read and Listen.** Read = the real PDF page + chat + notes, **no extraction, no audio**. Listen = extraction + audio. A Read book can switch to Listen later. | `books.mode` (`read` \| `listen`); extraction jobs are only created for Listen books. Chat keeps using the PDF directly, so it works in both modes. |
| O2 | ~~**The user pays for extraction**, and only in Listen mode.~~ **Superseded by O12.** | Extraction still runs only for Listen books (O1). |
| O3 | ~~**Billing is metered like our providers bill us, plus our other costs:** text extraction **per token**, audio **per second**. The page is a **storage unit only**, never a billing unit.~~ **Superseded by O12.** | Ledger rows carry `unit` (`tokens` \| `audio_seconds`), quantity, provider cost, and price charged. Price = provider cost × markup (config), not a per-page or per-minute flat rate. |
| O4 | **Superseded by O12** (kept: same paragraph + same voice is never regenerated). ~~**A recording belongs to whoever paid to generate it.** Recording = book (PDF content hash) × voice persona snapshot. A new or edited persona is a new recording and a new generation.~~ | New `recordings` table: `book_content_sha256`, `persona_snapshot_sha256`, `owner_user_id`, `visibility` (`private` \| `donated`). `segment_audio` gains `recording_id` + `funded_by_user_id` (a recording may have several funders, e.g. different chapters). |
| O5 | **Superseded by O12.** **Donation:** the owner may donate a recording to everyone; listeners then play its existing audio **free**. Segments not yet generated are paid by whoever generates them, who may donate them too (community recording). Donation requires the uploader to confirm they hold the rights; donations can be taken down. | `recordings.visibility='donated'`, `donated_at`, `rights_attested_at`; a takedown flag. |
| O6 | **Superseded by O12.** **Pay it forward** for private recordings: same book + same voice is **never regenerated**. Another listener pays the normal per-second price; a share goes back to the funder(s) **as credits**, until each funder has recovered **100%** of what they paid; after that the platform keeps it all. Credits only, never cash. A "founding narrator" badge stays on the recording. | Ledger kind `rebate`; per-funder `recovered_amount` vs `paid_amount`, capped at 100%; listener payments split across funders by the seconds of their segments played. Rebate share % is config. |
| O7 | **Audio clip unit = paragraph; storage unit = page.** A paragraph crossing a page break is ONE clip, stored and generated once, owned by the page it starts on; the next page references it as "continues from". Never cut audio at a page edge. | Per-page index of segments (`parts` already records the page spans); page view flips partway through the shared clip at the page-2 character offset. |
| O8 | **Non-content pages:** every page is classified in the same extraction call (cover, title, copyright, dedication, author's note, table of contents, blank, body, index, bibliography, back cover). Defaults: skip cover, title, copyright, blank, table of contents, index, back cover, dedication, author's note; read preface/introduction/body. The user reviews the suggestions (rail Pages tab: thumbnail + toggle, plus "read all front matter") and may read any skipped page. Skipped pages are never voiced. | `page_text.page_type`; per-user-per-book skip overrides; the segment builder excludes skipped pages per listener. |
| O9 | **Existing books re-process automatically on first open** (Listen mode); legacy per-page audio keeps playing until new segments are ready. | Unchanged from old D3. |
| O10 | **Order:** finish the reading-room epic before starting story 1 of this epic. | — |
| O11 | **Selection on scanned books waits for the extracted-text view** (2026-10-15). Most books are scanned or have an unusable PDF text layer, so the reading-room Explain / Save-as-note popover only works on text PDFs today. No "Explain this page" stopgap. | Story 7's `ExtractedTextView` must support text selection wired to the existing `AssistantContext` explain API and `SelectionPopover` (Explain / Save as note with `textSelection` + the page the selected text came from). |
| O12 | **Subscription plans with a daily page limit** (2026-10-16), replacing O2–O6. Defaults: Free 2 pages/day, Basic $5/month 10 pages/day, Pro $15/month 50 pages/day (rows in `plans`, editable). A page counts once per day when listening first reaches it in Listen mode, cached or not; Read mode never counts. At the limit, audio stops; reading, text, chat and notes keep working. **Payment is delayed** until the functional stories are done and tested (story 12); plans are assigned by hand until then. | §3 rewritten: `plans`, `subscriptions`, `daily_page_usage`, `record_page_listen`; no credits, ledger, recordings or funders. Stories 5, 6 and 8 reworded; story 12 added. Worst-case cost of an uncached page ≈ $0.03, so $5 breaks even at ≈ 5 new pages/day with no cache hits. |
| O13 | **Prepare one page ahead, not a chapter** (2026-10-20). The listening window is the current page plus the next read page; a paragraph cut by a page break is voiced whole with the page it starts on. Chapter-ahead (`tts_chapter`, engaged-after trigger) is dropped: harder and costlier to test. Later, a Settings choice lets the listener pick how many pages ahead (backlog). | Story 6 rewritten; `config.audio.pagesAhead` is the single value the setting will change; §5.3's 600-s window and chapter-ahead steps are superseded. |
| O14 | **Mode is per reader once a book is shared** (2026-10-30), refines O1. The owner's mode at the moment of sharing is what every reader starts with. Each reader can switch Read ↔ Listen for themselves only; after sharing, the owner's switch also affects only the owner. Switching back to Read keeps the reader's generated audio, ready when they return to Listen. Sharing is public (Discover) first, with no review step; sharing with chosen people and an owner review step come later. | `user_books.mode` (nullable) overrides `books.mode`; effective mode = `coalesce(user_books.mode, books.mode)`. While private the owner's switch writes `books.mode`; once public it writes the owner's `user_books.mode`. Audio is content-addressed, so nothing is deleted on a switch. |
