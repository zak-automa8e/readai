# Arabic-first OCR and layout extraction for ReadAI: options as of October 2026

Research date: 2026-10-12. Scope: how to swap out or rework the current per-page extraction (`gemini-2.5-flash-preview-09-2025`, thinking budget -1, JSON output). Web research only. Nothing here has been run on our own pages yet. Section 3 describes how to do that.

## 0. Read this first

```text
Today:   page image ──> Gemini 2.5 Flash (dynamic thinking) ──> flat text ──> TTS
                                                            (headers, page numbers and footnote markers get read aloud)

Target:  page image ──> extractor ──> blocks[{role, text, order, bbox}] ──> filter role=body ──> stitch across pages ──> TTS
```

- **The baseline model may already be retired.** Google's deprecations page (fetched 2026-10-12) lists the `gemini-2.5-flash-preview-09-*` preview with a shutdown date of 2026-02-17 and names `gemini-3.6-flash` as the replacement. The summariser was unclear about the exact ID string, so this is **unverified**. Check which model the backend actually reaches (`modelVersion` in the response) before reading anything else here.
- **Access to Gemini 2.5 is restricted.** Google says 2.5 models are "limited to users who have actively used them". For new projects it recommends `gemini-3.5-flash-lite` or `gemini-3.8-flash`. One third-party page says 2.5 Flash-Lite retires on 2026-10-16, while Google's page says "no shutdown date announced". These conflict, so do not plan on 2.5 Flash-Lite.
- **Thinking costs us money for nothing.** Thinking tokens are billed as output (Google pricing page, 2026-10-09). Transcription gains almost nothing from reasoning, and under a -1 budget thinking is probably the biggest single line in our current bill.

## 1. Ranked comparison

Cost columns are **USD per 1,000 pages**, quoted on the date shown. For token-priced models the cost is **my estimate**, built from these per-page assumptions (measure the real values in the Section 3 protocol):

| Assumption | Gemini 2.5 | Gemini 3.x |
|---|---|---|
| Image input | ~1,550 tokens (A4 at about 150 DPI = 6 tiles × 258) | 560 tokens (`media_resolution: medium`. Google: "quality typically saturates at medium" for documents) |
| Prompt + JSON schema | ~400 | ~400 |
| Visible output (Arabic page plus block JSON) | ~1,500 | ~1,500–1,800 |
| Thinking | ~1,000 at budget -1 (**unverified**, read `thoughtsTokenCount`) | minimal/low: ~0–300 |

| # | Option | Arabic scanned quality (evidence) | Roles / structure | $ / 1k pages (date) | Latency / page | License | Node integration |
|---|---|---|---|---|---|---|---|
| 1 | **Gemini 3.x Flash family** (3.6 / 3.8 Flash, 3.5 / 3.1 Flash-Lite) with a block schema and minimal or low thinking | **Best measured.** Gemini 3.5 Flash is #1 of 17 models on TII's 11,974-sample Arabic benchmark: 84.3% text accuracy overall, **91.0% on 4,296 book pages** (blog dated 2026-10-06, vendor-run). Gemini 3.5 Flash scored 1.6% CER on a small real-scan set in Antonhansel/arabic-ocr-bench (sample size small). Earlier generations: Gemini 2.0 Flash had CER 0.13 / WER 0.32 on KITAB-Bench (best closed model, 2025). Gemini 2.5 Pro had CER 0.31 / WER 0.37 on Misraj-DocOCR (2025-09). Flash-Lite tiers have **no Arabic numbers published**. | None built in, but the JSON schema can require `role ∈ {body, heading, running_header, page_number, footnote, footnote_marker, ...}` plus reading order. Role accuracy is **unverified**: measure it. | 3.1 Flash-Lite ≈ **$2.6** (batch ≈ $1.3). 3.5 Flash-Lite ≈ **$4.3**. 3.6/3.8 Flash at low thinking ≈ **$7.5** (prices valid to 2026-12-31; Google says rates double on 2027-01-01). Rates: $0.25/$1.50, $0.30/$2.50 and $0.75/$3.75 per 1M input/output tokens (Google pricing page, 2026-10-09). | 3.1 Flash-Lite ~1.3 s. 2.5 Flash ~2.4 s. 3 Flash ~12 s. 3.6 Flash ~10 s (Roboflow playground, 2026; includes thinking). | Proprietary API | We already use `@google/genai`. Change the model ID, `thinkingConfig.thinkingLevel`, `mediaResolution` and `responseSchema`. |
| — | **Baseline: Gemini 2.5 Flash** (thinking -1) | Between the 2.0 Flash and 2.5 Pro numbers above. | Flat text today | ≈ **$6.8** (range ~$4.5–$11 depending on thinking). Rates $0.30 / $2.50 (2026-10-09). | ~2.4 s without thinking. More with dynamic thinking. | Proprietary | Current code |
| 2 | **Azure AI Document Intelligence: Layout** (`prebuilt-layout`, v4.0) | **Lowest CER on Misraj-DocOCR: 0.27** (Gemini 2.5 Pro 0.31, Baseer 0.53). WER 0.44 (2025-09). KITAB-Bench reports Azure as **best at diacritics** (2025). But Azure OCR scored CER 0.52 on KITAB-Bench's mixed-domain OCR set. Arabic printed and handwritten text is supported (docs updated 2026-07-10). | **Native paragraph roles that map almost 1:1 to our needs:** `title`, `sectionHeading`, `pageHeader`, `pageFooter`, `pageNumber`, `footnote`. Also reading order, Markdown output and bounding boxes. No "footnote marker" role: the inline superscript stays in the body text. | Layout **$10**. Read (text only, no roles) **$1.50**. Both from a secondary source dated 2026. Microsoft's page did not render the numbers. Commitment tiers exist. | Asynchronous (submit, then poll). Typically a few seconds per page (**unverified**). | Proprietary | `@azure-rest/ai-document-intelligence` (REST client). Simple. |
| 3 | **Mistral OCR 4.1** (`mistral-ocr-latest`, GA 2026-08-31) | **Thin evidence for Arabic.** The original Mistral OCR (2025) scored CER 0.21 / WER 0.44 on QARI's 200-page diacritic-rich set. No Arabic numbers published for v4 or 4.1. | `include_blocks` returns blocks in reading order with bounding boxes and types: `title`, `text`, `list`, `table`, `header`, `footer`, `references`, `aside_text`, `caption` and more. `extract_header` / `extract_footer` split those out. **No footnote or page-number type.** Block, word and page confidence scores. | **$4**, batch **$2**, Document AI annotations $5 (therundown.ai, 2026-08-29) | Synchronous. Not benchmarked (**unverified**). | Proprietary (self-hosting needs an enterprise agreement) | Official TS SDK `@mistralai/mistralai`, `client.ocr.process()`. Accepts PDF URLs directly. |
| 4 | **Google Document AI: Gemini Layout Parser** (v1.6 = Gemini 3 Flash, v3.1-lite = 3.1 Flash-Lite) | Inherits Gemini quality. No published Arabic benchmark for the parser itself. Arabic language support for Layout Parser is not stated in the docs (**unverified**). | Block types: paragraph, title, heading, **page header, page footer**, list, table, figure. No footnote type. | Layout Parser **$10**. Enterprise OCR **$1.50** (falls to $0.60 above 5M pages a month). From the pricing page summary and secondary sources, 2026. | Online processing is capped at 15 pages per request and 20 MB | Proprietary | `@google-cloud/documentai`. Needs a GCP processor to be set up. Costs more than calling the same Gemini directly. |
| 5 | **Falcon-OCR Arabic** (TII, 270M parameters), self-hosted | **#2 of 17 on TII's benchmark: 81.9% overall, 90.1% on books** (Gemini 3.5 Flash 91.0%). Beats Claude Opus 5.5 (79.2%), GPT Astra (75.0%), Chandra OCR 2 (61.7%) and PaddleOCR-VL 1.6 (59.4% or lower). Vendor-run, released 2026-10-06, no independent replication yet. | The layout + OCR pipeline returns text, bounding box and **category label** per region. Its category set is **unverified** against our list (header, footer, footnote). | GPU-hour cost only. Base model runs ~2.9 images/s on an A100, so **≈ $0.1–0.2 at full utilisation** (my estimate). Idle GPU time dominates at our volume (see 3b). | Sub-second per page on an A100 (implied by its throughput) | Base Falcon-OCR is **Apache-2.0**. The Arabic checkpoint's license is **unverified**. | Docker image `ghcr.io/tiiuae/falcon-ocr`. Serves an OpenAI-compatible vLLM API, so Node calls it over HTTP. |
| 6 | **dots.ocr** (rednote, 1.7B), self-hosted | Best open-source model on KITAB-Bench PDF-to-Markdown in the Baseer paper: **WER 0.39 / CER 0.28**. On Misraj-DocOCR: WER 0.50 / CER 0.40. Datalab's Arabic benchmark ranks it above DeepSeek-OCR and olmOCR 2. | **Best role set among open models:** `Page-header`, `Page-footer`, `Footnote`, `Section-header`, `Title`, `Text`, `List-item`, `Caption`, plus reading order and bounding boxes | ~$0.5–0.7 at full utilisation: ~35 pages/min on an L40S at $0.96/h (Spheron, 2026-06-23) | ~2 s per page on an L40S | **MIT** | vLLM server, OpenAI-compatible |
| 7 | **PaddleOCR-VL 1.6** (0.9B) | Supports 109 languages including Arabic. Weak on Arabic in TII's benchmark (at or below 59.4%). PaddleOCR classic scored CER 0.79 on KITAB-Bench. | PP-DocLayout regions include header, footer and footnote-type labels (exact label names **unverified**) | ~$0.73 (45 pages/min on an L40S, 2026-06-23) | ~1.3 s per page | Apache-2.0 | vLLM / SGLang server, or a Python sidecar |
| 8 | **amad-vlm6** (Qwen2.5-VL-7B merge) | **#1 on the Clouda benchmark** (462 real Arabic pages, run 2026-09-19 to 09-24): normalised CER 40.6% / WER 53.4%. On KITAB-Bench: CER 0.235 / WER 0.463 (model card). | Plain text only. Can emit `<think>` blocks. | 8B model, ~$1–2 (my estimate) | Slow: up to 4,096 output tokens | Apache-2.0 | vLLM |
| 9 | **HunyuanOCR 1.5** (1B) | #3 on Clouda: CER 43.5% / WER 51.7% | Markdown, plus JSON text-spotting with boxes | Cheap (~3 GB VRAM) | Fast | **Tencent Hunyuan Community License.** The territory and usage clauses are **unverified**: legal review needed. | vLLM |
| 10 | Baseer (Misraj, Qwen2.5-VL-3B) | Best WER and TEDS on Misraj-DocOCR (0.25 / 66) and best TEDS on KITAB-Bench PDF-to-Markdown. Its CER (0.53) is worse than Azure's. | Markdown structure | Hosted platform (baseerocr.com) with no public pricing | — | **CC BY-NC-SA 4.0 (non-commercial)**, so the weights are out for us. The commercial API is an option to ask about. | API (pricing unknown) |
| 11 | QARI-OCR v0.2–0.4 (Qwen2-VL-2B) | Excellent on its own synthetic diacritic set (v0.2: CER 0.061), but **collapses on real scans**: v0.4 scored 216% normalised CER on Clouda and 194.7% on Muharaf. | Plain text | Cheap | Fast | Apache-2.0 | vLLM |
| 12 | AIN-7B (MBZUAI) | KITAB-Bench OCR: CER 0.20 / WER 0.28 (strong, 2025). Clouda: 218% CER (hallucination or repetition on real pages). | Plain text / Markdown | ~$1–2 | Slow | License **unverified** | vLLM |
| 13 | Chandra OCR 2 (Datalab) | 68.4% on Datalab's own Arabic set. 61.7% on TII's. | Full layout: HTML / JSON with block types | Datalab API, or self-host | — | Open weights. License **unverified** (earlier versions had revenue-gated terms). | API or vLLM |
| 14 | Qwen2.5-VL-7B / Qwen 3.x | Qwen2.5-VL-7B: KITAB-Bench CER 1.20. Qwen 3.8 Max: 74.8%. Qwen 3.5 397B: 67.4% (TII). | Prompted JSON | — | — | Apache-2.0 (open sizes) | — |
| 15 | DeepSeek-OCR / OCR-2, olmOCR 2, Surya, GOT-OCR | No competitive Arabic evidence. olmOCR is trained on English. Surya: KITAB-Bench CER 4.95. The Arabic DeepSeek-OCR-2 fine-tune failed to load in Clouda. | Varies | ~$0.4–0.7 | — | MIT / Apache / GPL (Surya weights have their own terms) | — |
| 16 | Arabic-Nougat | Not benchmarked anywhere I could find | Markdown | — | — | GPL-3.0 | — |
| 17 | AWS Textract | **No Arabic.** It supports English, Spanish, German, Italian, French and Portuguese only (2026). | — | — | — | — | Excluded |
| 18 | Sakhr OCR | Long-standing Arabic vendor. No public benchmark or pricing found (**unverified**). | — | Ask sales | — | Proprietary | — |
| floor | Tesseract 5 (`ara`) | KITAB-Bench CER 0.54 / WER 0.84. QARI set: CER 0.436. It omits diacritics, so its CER barely changes when they are stripped. | None (hOCR lines only) | ~$0 (CPU) | ~1–3 s | Apache-2.0 | `tesseract.js` |

Benchmarks disagree a lot. AIN and QARI are strong on curated sets and fall apart on Clouda's real pages. Every number above comes from someone else's data, which is why the 20-page test in Section 3 decides.

**Diacritics warning.** An August 2026 cross-dataset study (arXiv 2608.22366) found that VLMs lose **about 16.6% CER when tashkeel is kept** versus stripped. Tesseract loses only 0.4%, because it simply drops the marks. Score every candidate both ways.

## 2. Recommendation

### Top: stay on Gemini, but change *how* we call it

Use **Gemini 3.1 Flash-Lite** or **3.5 Flash-Lite** with `thinkingLevel: minimal`, `mediaResolution: medium` and a strict block schema. Run **Gemini 3.6 Flash (low thinking)** as the quality fallback, applied per book or per failed page.

```jsonc
// responseSchema (sketch)
{ "blocks": [ { "order": 1, "role": "body|heading|running_header|running_footer|page_number|footnote|marginalia|caption",
                "text": "...", "continues_from_prev_page": true, "ends_mid_sentence": true,
                "footnote_refs": ["١"] } ] }
```

- **Why:** Gemini has the best Arabic book-page evidence available (91.0% on books, #1 of 17). It needs no new vendor, no new SDK and no GPU. The schema fixes both product problems at once: filter on `role === "body"`, and use `continues_from_prev_page` / `ends_mid_sentence` to stitch sentences. Strip `footnote_refs` from the spoken text.
- **Cost:** about **$2.6–4.3 per 1k pages**, versus about **$6.8** for today's baseline, so roughly 40–60% cheaper. Using the Batch API for whole-book pre-extraction halves that again (about $1.3). Prefetch-while-listening stays on the online API.
- **Risk:** Flash-Lite Arabic quality is unpublished, and role tagging is a prompt, not a trained detector. Both are measured in Section 3. 3.6/3.8 Flash prices double on 2027-01-01, which makes the Flash-Lite tiers more attractive still.

### Runner-up: Azure Document Intelligence Layout, or Azure Read plus a cheap LLM tagger

- **Why:** it has the best published Arabic CER (0.27 on Misraj) and is the strongest on diacritics in KITAB-Bench. Its *trained* paragraph roles (`pageHeader` / `pageFooter` / `pageNumber` / `footnote` / `sectionHeading`) match our filter list almost exactly, and it is deterministic: no hallucinations or repetition loops.
- **Cost:** Layout at **$10 per 1k** is *more* than the baseline. The cheaper variant is **Read at $1.50** plus a text-only Gemini 3.1 Flash-Lite pass. That pass receives the lines with their y-positions and returns roles and stitch flags (~$0.8 per 1k, my estimate), for **≈ $2.3 per 1k in total**. Use Layout only if the tagger misses roles.
- Choose this if Gemini Flash-Lite shows hallucination or drift on our pages. That is the main failure mode of every VLM-based option.
- **Mistral OCR 4.1** ($4, or $2 in batch) is the cheapest managed option with block types and header/footer extraction. Include it in the bake-off, but its Arabic quality is unproven and it has no footnote role.

### Self-hosted option: Falcon-OCR Arabic, with dots.ocr as the safer second

- **Falcon-OCR Arabic:** a 270M-parameter model under Apache-2.0 (base model) that comes within about 1 point of Gemini 3.5 Flash on book pages in TII's benchmark. It returns categorised layout regions and ships as a ready vLLM Docker image. It runs on a small GPU in well under a second per page. **Caveats:** six days old, vendor benchmark only, and both the Arabic checkpoint's license and its category set are unverified.
- **dots.ocr (MIT):** the open model with the best independent Arabic evidence (KITAB-Bench PDF-to-Markdown WER 0.39). Its role taxonomy (`Page-header` / `Page-footer` / `Footnote`) is exactly what we need.
- **Economics:** worth it only at volume. An always-on L40S costs about $0.96/h, roughly **$700 a month** (2026-06 pricing). That buys about 270k Gemini Flash-Lite pages a month, so self-hosting breaks even at roughly **250–300k pages a month** for near-real-time use. Scale-to-zero serverless GPU lowers the idle cost but adds cold starts, which we can tolerate since we prefetch 1–2 pages ahead.

## 3. Evaluation protocol: 20 of our own pages

### 3a. Build the test set (half a day)

1. **Pick 20 pages from about 8 books**, stratified:
   - 6 classical Arabic, with tashkeel
   - 4 MSA, no tashkeel
   - 3 two-column or with marginalia
   - 3 footnote-heavy (markers plus a footnote block)
   - 2 poor scans (skewed, low DPI, bleed-through)
   - 2 English
   - Include **at least 3 consecutive-page pairs** where a sentence crosses the page break.
2. **Render the pages once** at a fixed DPI (200) and freeze the PNGs. Every candidate gets the same bytes.
3. **Ground truth.** Run the strongest candidate (Gemini 3.6 Flash) and have an Arabic reader correct it in a plain editor. Correcting is about 5× faster than typing from scratch. Bias towards that model is minor once the corrections are done. Store `gt/<page>.json` as `{blocks:[{order, role, text}]}` using our role list, plus `gt/<page>.body.txt`: the exact string TTS should speak, with markers removed and stitched across page pairs.
4. **Two text tracks per page:** `with_tashkeel` as written, and `stripped`. For the stripped track, remove U+064B–U+0652, U+0670 and tatweel U+0640. Normalise NFKC and Arabic-Indic digits to a single form. Unify alef forms (أ إ آ → ا) only in a separately reported "lenient" score.

### 3b. Metrics per candidate

| Metric | How | Pass bar (initial suggestion) |
|---|---|---|
| CER / WER, body text, stripped | Levenshtein over the `role=body` concatenation against `body.txt` (Node: `fastest-levenshtein`. Python: `jiwer`) | CER ≤ 3%, WER ≤ 10% |
| CER, with tashkeel | Same, on the diacritised track | Report only. Matters if TTS uses tashkeel for pronunciation. |
| Diacritic error rate | Over characters whose base letter matches, the share with wrong or missing marks | Report |
| **TTS leak rate** | Characters from GT non-body blocks (headers, page numbers, footnotes, markers) that appear in the candidate's spoken stream ÷ total non-body characters | ≤ 2% |
| Body drop rate | GT body characters that the candidate tagged non-body (it skipped real content) | ≤ 1% |
| Role F1 | Per role, matching blocks by text overlap of at least 0.5 | Header, footer and page-number F1 ≥ 0.95. Footnote F1 ≥ 0.9. |
| Reading order | Kendall tau over the order of matched body blocks (matters for two-column pages) | ≥ 0.95 |
| Stitch accuracy | Across the cross-page pairs: is the joined sentence exactly right? | 3/3 |
| Hallucination / loop | Count of runs of 4 or more words absent from GT, plus repeated n-grams; any page with output 1.5× longer than GT | 0 pages |
| Latency | p50 / p95 wall-clock per page, 3 runs | p95 ≤ 6 s (we prefetch 1–2 pages) |
| Cost per page | From billing or `usageMetadata` (`promptTokenCount`, `candidatesTokenCount`, `thoughtsTokenCount`) × the dated price | Report |

### 3c. Run order

1. Current baseline, to confirm the model ID actually in use and its real thinking tokens.
2. Gemini 3.1 Flash-Lite, minimal thinking.
3. Gemini 3.5 Flash-Lite, minimal thinking.
4. Gemini 3.6 Flash, low thinking.
5. Azure Read plus Flash-Lite tagger, and Azure Layout.
6. Mistral OCR 4.1 with `include_blocks`.
7. Falcon-OCR Arabic and dots.ocr on one rented GPU for an hour (about $2).

Keep all raw outputs in `eval/runs/<candidate>/` so the result can be re-scored later. **Decision rule:** take the cheapest candidate that passes every bar, and use the next one up as a per-page fallback when a page fails a cheap check (output-length ratio, loop detection, or a low Mistral or Azure confidence score).

## 4. Sources

Dates are publication or last-update dates where shown. "Fetched" means read on 2026-10-12.

- Google Gemini API pricing, updated 2026-10-09. https://ai.google.dev/gemini-api/docs/pricing
- Google Gemini deprecations (fetched 2026-10-12). The 09-2025 preview shutdown date is **unverified**: summariser output was ambiguous. https://ai.google.dev/gemini-api/docs/deprecations
- Gemini media resolution: 280/560/1120/2240 tokens; "saturates at medium" (fetched). https://ai.google.dev/gemini-api/docs/media-resolution
- Gemini thinking levels (fetched). Whether 3.6/3.8 Flash support `minimal` is **unverified**; the summary said low/medium/high only. https://ai.google.dev/gemini-api/docs/thinking
- Gemini image tokens: 258 per 768-px tile (fetched). https://ai.google.dev/gemini-api/docs/tokens
- Third-party claim that 2.5 Flash-Lite retires 2026-10-16. **Conflicts** with Google's page. https://www.morphllm.com/gemini-api-pricing
- KITAB-Bench, ACL Findings 2025 (arXiv 2502.14949 v2): OCR CER/WER table. https://arxiv.org/html/2502.14949v2 and https://github.com/mbzuai-oryx/KITAB-Bench
- Baseer / Misraj-DocOCR, 2025-09-17 (arXiv 2509.18174). https://arxiv.org/html/2509.18174
- Misraj Baseer platform launch, 2025-12-04. https://www.globenewswire.com/fr/news-release/2025/12/04/3199752/0/en/Misraj-AI-Launches-Baseer-a-State-of-the-Art-Arabic-Document-Intelligence-Platform.html
- QARI-OCR, 2025-06 (arXiv 2506.02295): includes the Mistral OCR v1 Arabic numbers. https://arxiv.org/html/2506.02295v1
- Falcon OCR Arabic blog, TII, 2026-10-06: 17-model Arabic leaderboard. https://huggingface.co/blog/tiiuae/falcon-ocr-arabic
- Falcon-OCR model card (Apache-2.0, throughput, Docker). https://huggingface.co/tiiuae/Falcon-OCR
- Clouda OCR Arabic model-selection benchmark, run 2026-09-19 to 09-24. https://github.com/sahrasayed3-crypto/clouda-ocr-model-selection-benchmark
- "When Do VLMs Help Arabic Manuscript OCR?", 2026-08-23 (arXiv 2608.22366): diacritics penalty. https://arxiv.org/html/2608.22366v1
- Antonhansel arabic-ocr-bench, 2026 (small sample). https://github.com/Antonhansel/arabic-ocr-bench
- Datalab Arabic benchmark (undated; vendor). https://www.datalab.to/benchmark/arabic
- amad-vlm6 model card. https://huggingface.co/amad-iq/amad-vlm6
- HunyuanOCR model card, 2026-07-06. https://huggingface.co/tencent/HunyuanOCR
- dots.ocr model card (MIT, layout categories). https://huggingface.co/dots-studio/dots.ocr
- PaddleOCR-VL docs. https://www.paddleocr.ai/latest/en/version3.x/algorithm/PaddleOCR-VL/PaddleOCR-VL.html
- Spheron self-host OCR cost comparison, 2026-06-23 (vendor blog). https://www.spheron.network/blog/best-open-source-ocr-vlm-self-host-gpu-cloud-2026/
- Mistral OCR processor docs (block types, header/footer params; fetched). https://docs.mistral.ai/studio/document-processing/basic_ocr
- Mistral OCR 4.1 pricing, 2026-08-29. https://www.therundown.ai/tools/mistral-ocr-4 and https://invoiceextractor.ai/mistral-ocr-pricing
- Mistral OCR 4 announcement. https://mistral.ai/news/ocr-4/
- Azure Document Intelligence Layout (paragraph roles), updated 2026-07-10. https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/prebuilt/layout
- Azure language support (Arabic printed and handwritten), updated 2026-07-10. https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/language-support/ocr
- Azure pricing: official page did not render numbers. $1.50 Read / $10 Layout from a secondary 2026 source (**partly unverified**). https://azure.microsoft.com/en-us/pricing/details/ai-document-intelligence/ and https://erpresearch.com/erp-add-ons/ocr/azure-document-intelligence/pricing
- Google Document AI Layout Parser (versions, block types, limits; fetched). https://docs.cloud.google.com/document-ai/docs/layout-parse-chunk
- Google Document AI pricing ($1.50 OCR, $10 Layout Parser via search snippets; **partly unverified**). https://cloud.google.com/document-ai/pricing
- AWS Textract language list (no Arabic), 2026 secondary sources. https://www.extend.ai/resources/aws-textract-when-to-use-alternative and https://repost.aws/questions/QU1qOYxOc5SOSvaJakOUnA7A/roadmap-for-languages-supported-by-amazon-textract
- Roboflow playground OCR latency (Gemini 2.5 Flash 2.39 s, 3.1 Flash-Lite 1.32 s, 3 Flash 12.4 s, 3.6 Flash 10.4 s), 2026. https://playground.roboflow.com/models/compare/gemini-3-6-flash-vs-mimo-v2-6-flash
- Arabic-Nougat (GPL-3.0). https://huggingface.co/MohamedRashad/arabic-base-nougat
- Sakhr: no public OCR pricing found. https://sakhr.com/llms.txt

**Unverified, collected in one place:**
- The baseline model's shutdown date.
- Whether 3.6/3.8 Flash accept `minimal` thinking.
- Per-page thinking tokens at budget -1.
- Azure and Document AI prices (secondary sources).
- Azure latency.
- Document AI Layout Parser Arabic support.
- The Falcon-OCR Arabic checkpoint license and categories.
- PaddleOCR-VL label names.
- AIN, Chandra and HunyuanOCR license terms.
- Mistral OCR 4.x Arabic accuracy.
- Sakhr and Baseer API pricing.
