# Arabic TTS for ReadAI: options, costs, highlighting (Oct 2026)

Researched 2026-10-12. Every price below carries the date it was read and is a list price in USD unless noted.
"Unverified" means the source was secondary, vendor-written, or only partly readable.

## 0. What "the new, very good Arabic TTS model" most likely is

```text
2026-01-20  Habibi-TTS (open, F5-TTS based, 12 dialects + MSA)        arXiv 2601.13802
2026-08-18  Cartesia Sonic 3.6       -> #1 Arabic on Artificial Analysis Controlled-Voice arena
2026-09-22  Gemini 3.8 Flash TTS (GA) -> #1 Arabic MSA on Voice Arena (1204 vs ElevenLabs v3 1020)
2026-09-28  ElevenLabs Eleven v4 / v4 Turbo (no Arabic-specific results published)
2026        SILMA TTS v2 (Saudi startup; MSA + Najdi; conversational-speech trained)
```

The most likely match is **Gemini 3.8 Flash TTS** (`gemini-3.8-flash-tts`), generally available since 2026-09-22. It fits what the owner already believes (Gemini is best for Arabic). It is also the only model with a published *Arabic MSA* blind-preference win over ElevenLabs and OpenAI.
**Cartesia Sonic 3.6** is the second candidate. It leads a *different* Arabic arena, one that tests cloned voices and did not include Gemini 3.8. The two arenas disagree, which is why section 3 sets out a blind test on our own text.

## 1. Ranked comparison

Cost per audio hour assumptions:
- Token-billed models: Gemini bills 25 audio tokens per second, so 1 h = 90,000 output tokens. Text input adds about $0.02/h.
- Character-billed models: we assume 1 h of MSA narration ≈ 50,000 undiacritised characters (about 130 words/min × about 6.4 chars incl. space; this is our estimate, check it on our own audio). **Diacritised input roughly doubles the character count** on character-billed APIs, because each haraka is its own code point.

| # | Model | Arabic MSA quality (evidence) | Needs diacritisation? | Timestamps | Style / persona control | Cost per audio hour (date) | Latency | License / hosting |
|---|---|---|---|---|---|---|---|---|
| 1 | **Gemini 3.8 Flash TTS** (GA 2026-09-22) | Voice Arena Arabic MSA **#1, 1204 Elo**; Flash-Lite 1181; Gemini 3.1 Flash 1135; Eleven v3 1020; gpt-4o-mini-tts 911 (Sept 2026, figures via search snippets of Voice Arena's X post: partly unverified). Artificial Analysis: #1 Pronunciation Robustness, #2 Provider-Voice arena (1260). Google claims long-form consistency "across hours". | No. It is LLM-based and infers vowels from context. I'rab accuracy on classical text is untested: test it. | **None** documented | Strongest fit for our personas: natural-language `style` instructions, inline tags (`<sigh>`, `<short pause>`), voice design from a prompt, voice replication from a 30 s sample (consent check), 2,000+ voices | **$0.81** ($9/M audio tok) until 2026-12-31, then **$1.62** from 2027-01-01. Batch/Flex $0.41, then $0.81 (read 2026-10-12) | Streaming supported. TTFT not published | Proprietary API. SynthID watermark. Node: `@google/genai`. Input limit 8,192 tokens/request |
| 2 | **Gemini 3.8 Flash-Lite TTS** | Voice Arena Arabic MSA #2 (1181). AA arena #6 overall (1235) | No | None | Same controls, positioned for high volume | **$0.54**, then **$1.08** from 2027. Batch $0.27 (2026-10-12) | Lower than Flash (vendor claim) | As above |
| 3 | **Gemini 2.5 Flash Preview TTS** (current) | Our baseline. Voice Arena Arabic score not found. Google markets Flash-Lite 3.8 as its replacement | No | None | Base voice + style prompt (what we use today) | **$0.90** ($10/M). Batch $0.45 (2026-10-12) | Same as today | Preview. Expect deprecation (unverified) |
| 4 | **Cartesia Sonic 3.6** (2026-08-18) | Artificial Analysis Controlled-Voice **Arabic #1, 1369 Elo, +132 over Eleven v3**. Gemini was not in that board (alphasignal, 2026-09-22) | Unknown (no Arabic diacritics doc). Test it | **Word + phoneme timestamps** (`add_timestamps`, `add_phoneme_timestamps`). Arabic is not explicitly confirmed | Emotion enum (5 values), speed 0.6–1.5×, volume, voice cloning. Less expressive than prompt-styling | **~$1.85–2.45** ($37–49/M chars, plan-dependent, secondary sources Sept 2026) | **<90 ms** TTFB (vendor) | Proprietary API. On-prem via partners/SageMaker. JS SDK |
| 5 | **ElevenLabs Eleven v4 / v3** | v3: Voice Arena Arabic MSA 1020 (4th); AA Arabic runner-up to Sonic 3.6. v4 (2026-09-28): no Arabic-specific results | No (model-internal) | **Character-level** start/end times (`/with-timestamps`, plus normalized alignment). Docs don't restrict by model; v4 support unverified | Audio tags (`[whispers]`). v4 dropped style/speed sliders. Instant + professional cloning | v4/v3 list **$4.00** ($0.08/1k chars). v4 72%-off launch promo ends **2026-10-12** ($1.12/h while it lasts). Flash/Turbo/v4 Turbo **$2.00** ($0.04/1k) (read 2026-10-12) | v3 ~730 ms TTFT (SILMA benchmark). v4 Turbo ~100–150 ms | Proprietary. Official Node SDK |
| 6 | **Azure AI Speech: Dragon HD Omni** (e.g. `ar-SA-Hamed:DragonHDOmniLatestNeural`) and standard ar-* neural | No 2026 Arabic listening-test data found. Microsoft says better diacritic prediction cut Arabic word-pronunciation errors by 78% (via Munsit/Telnyx, unverified primary). Styles on Omni are **English-only**; paralinguistics work in all languages | No (internal diacritiser). SSML `<phoneme>`/lexicon alias for overrides on non-Omni voices | **Word boundary events** (audio offset + text offset) on neural **and** HD Omni. Note: HD has no `<bookmark>` | Persona = voice + temperature/top_p/cfg_scale. Arabic style control is weak. Custom neural voice is available (gated) | Neural **$0.80** ($16/M); HD **$1.10** ($22/M from Mar 2026) (secondary, 2026) | <300 ms | Proprietary. Containers/embedded only for non-HD voices. Node Speech SDK |
| 7 | **SILMA TTS v2** (Saudi startup, 2026) | No published MOS/WER. Own benchmark is latency-only and vendor-written. Trained on *conversational* speech, which may not suit long non-fiction (our inference). Ranked in Navid Arabic TTS Arena (scores not extracted) | Not documented | **SSE "text segments and timestamps"** (granularity unverified) | Speed/variability, 10 s cloning, pronunciation dictionary | **$1.20–1.50** ($0.020–0.025/min) (2026-10) | ~170 ms server, ~280 ms EU e2e (vendor) | API, plus on-prem for enterprise. v1 open (MIT code, Apache-2.0 weights, 150M params) |
| 8 | **Google Cloud Chirp 3 HD** (`ar-XA`) | No Arabic arena data. Gemini TTS has displaced it on quality | No | **None in practice.** Timepoints need SSML `<mark>`, which Chirp 3 HD docs don't list (unverified) | 28 fixed voices, pace 0.25–2×, `[pause]` tags, IPA phonemes, instant custom voice | **$1.50** ($30/M) (2026) | Streaming | Proprietary. Node client |
| 9 | **OpenAI gpt-4o-mini-tts** | Voice Arena Arabic MSA **911** (last of five) | No | **None** | Free-text `instructions` (similar to our personas) | **~$0.90** (~$0.015/min; secondary, Jul 2026) | Streaming | Proprietary. Node SDK |
| 10 | **Fish Audio S2 / S2.1 Pro** | Vendor-claimed BT win overall. No Arabic-specific results | Unknown | Not documented (unverified) | Tags, cloning | **~$1.50** ($15/M UTF-8 bytes; Arabic is 2 bytes/char) (2026) | Fast (vendor) | S2 open weights (check license). S2.1 Pro API-only |
| 11 | **MiniMax Speech 2.8 HD / Turbo** (2026-01-23) | Arabic supported (`language_boost: Arabic`). No Arabic benchmark | Unknown | **Sentence or word subtitles** (`subtitle_type: word`) | 9 emotions, cloning ($1.50/voice), voice design ($3) | HD **$5.00** ($100/M); Turbo **$3.00** ($60/M) (2026) | Streaming | Proprietary API |
| 12 | **Amazon Polly** (Zeina std MSA; Hala/Zayd neural Gulf ar-AE) | Dated. No Arabic generative voice. MSA neural is missing (Zeina is standard-only) | No (internal) | **Speech marks**: word + sentence + SSML marks | Little (SSML prosody only) | Neural **$0.80** ($16/M). Std $0.20 (2026) | Low | Proprietary. AWS SDK JS |
| 13 | **Habibi-TTS** (open, 2026-01, F5-TTS based) | Paper: "highly competitive with ElevenLabs v3 (alpha)" on intelligibility/similarity/naturalness, human eval (no MSA numbers extracted) | **No** ("without text diacritization") | None. Add forced alignment | Zero-shot cloning from a reference clip, speed control. No text style prompts | Self-host GPU only. Estimated **<$0.10** of GPU time per audio hour plus ops (unverified estimate) | Not a streaming product | **MSA model Apache-2.0** (commercial OK). Unified/SAU/UAE CC-BY-NC-SA (no commercial). Python only |
| 14 | Other open models: Arabic-F5-TTS-v2, Arabic-TTS-Spark, Lahgtna/OmniVoice, NAMAA Saudi TTS, XTTS v2 fine-tunes, ArTST, KaniTTS-Arabic | Community-ranked on Navid AI Arabic TTS Arena (HF, Mar 2026; 13–15 systems, Bradley-Terry). No commercial model is on that board | Arabic-F5-TTS-v2 **requires full diacritisation**. Others vary | None | Cloning only | Self-host | — | Mixed. XTTS v2 = CPML (non-commercial) |
| — | Fanar TTS (QCRI, Qatar) | Voices "Hamza" (news/reading) and "Amina" (expressive). No public benchmark | Has a diacritic-recovery module (NatiQ lineage) | Unknown | Unknown | No public pricing (access via Fanar platform) | Real-time (claim) | Unverified availability |
| — | Munsit Faseeh, Hakim AI, Hams.ai, Lahajati | Gulf startups. Only vendor marketing found. Munsit exposes a standalone Tashkīl API | Munsit: separate tashkeel endpoint | Unknown | Unknown | Not public | Hakim claims 113 ms | Unverified |

### Diacritisation: when we need a separate step

- **Gemini, ElevenLabs, Azure, Polly, Chirp, Habibi**: no separate step needed. Each guesses vowels internally.
  - The risk is i'rab and case endings on classical text and rare words. That is exactly what our blind test scores.
- **Arabic-F5-TTS-v2, older FastPitch-style models**: these need fully diacritised input.
- If we add a pre-diacritisation step, use a frontier LLM, not a small diacritiser.
  - On SadeedDiac-25, Claude 3.7 Sonnet scored **4.7% WER with case endings**, Sadeed (1.5B) 13.7%, Aya-8B 47.5% (Sadeed paper, Apr 2025).
  - CATT scores 3.4% DER on Tashkeela but **28.3% DER / 48.2% WER** on the KSAA-2026 blind test (Fine-Tashkeel, LREC 2026). Small diacritisers generalise poorly off their training domain.
  - Mishkal is rule-based and weaker still (no recent benchmark found).
- Pre-diacritising does two useful things:
  1. It gives the displayed text the same vowels the audio speaks (optional "show tashkeel" toggle).
  2. It helps forced alignment.
- Cost of pre-diacritising: it **doubles billed characters** on character-priced APIs, but has no effect on Gemini's audio-token billing.

## 2. Recommendations

**(a) Best quality: Gemini 3.8 Flash TTS.**
- It has the only Arabic-MSA-specific win in the evidence.
- It keeps our persona model intact (style prompt + voice, now with voice design/replication).
- It costs *less* than our current 2.5 Flash Preview until 2027-01-01 ($0.81/h vs $0.90/h). After that it costs $1.62/h.
- Challenger: **Cartesia Sonic 3.6**. It leads the other Arabic arena, has native word timestamps and the lowest latency, at roughly 2–3× the cost.
- Run both through the section 3 test before switching.

**(b) Best value: Gemini 3.8 Flash-Lite TTS.**
- $0.54/h now, $1.08/h in 2027. Batch/Flex halves that ($0.27/h now) for pre-generating whole books ahead of listening.
- It is #2 on Arabic MSA, with the same API and personas.
- A sensible split: Flash-Lite for bulk/background pre-generation, Flash for the paragraph the user is about to hear.
- Azure neural ($0.80/h, with free word boundaries) is the value pick only if the blind test shows Arabic quality near Gemini's. The evidence does not suggest it will.

**(c) Highlighting strategy for a Gemini pick.** Gemini returns no timings, so per paragraph:

```text
paragraph text ──► Gemini TTS (1 call, full paragraph prosody) ──► WAV
      │                                                         │
      └──► sentence/word tokens ──► forced aligner (MMS-300m CTC, ctc-forced-aligner) ◄─┘
                                          │
                                          ▼
                     word timings ──► sentence spans ──► highlight in text view
```

| Strategy | Highlight granularity | Quality trade-off | Cost / complexity |
|---|---|---|---|
| **Paragraph synth + forced alignment (recommended)** | Word (aggregate to sentence) | Best prosody: one take per paragraph | Python sidecar (torchaudio MMS_FA or `ctc-forced-aligner`, uroman romanisation for Arabic). CPU is fine at about 0.1–0.3× real time (estimate). Expect ~300–500 ms word precision. Sentence highlighting is very reliable |
| Per-sentence synthesis | Sentence (exact, from clip boundaries) | Pitch/energy resets at every sentence, plus per-call overhead and rate limits. Our long MSA sentences make calls uneven | No new service. Same audio-token cost. Simplest fallback |
| Native timestamps (switch to Cartesia / ElevenLabs / Azure / MiniMax) | Word or char | Depends on the blind test | No aligner, but a different vendor and character billing |

Implementation notes for forced alignment:
- Align against the **exact text sent to TTS**. If we pre-diacritise, align against the diacritised form and map back by word index.
- Normalise numerals: the TTS speaks "ثلاثة وعشرون" for "23", so the aligner needs the spoken form or must treat the number as one wildcard token.
- If alignment fails or has low confidence for a paragraph, **fall back to character-proportional timing** within each sentence. The highlight will still land on the right sentence.
- Gemini's 8,192-token input cap is ample for one paragraph.

## 3. Blind listening test on 10 of our paragraphs

1. **Pick 10 paragraphs** from real ReadAI books. Each should be 60–150 words:
   - 4 modern MSA non-fiction
   - 3 classical/turath prose (heavy i'rab, rare words)
   - 1 with numerals, dates and Hijri years
   - 1 with embedded English terms/names
   - 1 English-only

   Use undiacritised source text, exactly as extracted.
2. **Systems (5–6)**:
   - Gemini 2.5 Flash Preview TTS (baseline)
   - Gemini 3.8 Flash
   - Gemini 3.8 Flash-Lite
   - Cartesia Sonic 3.6 (best Arabic voice)
   - ElevenLabs v4
   - Azure `ar-SA-*:DragonHDOmniLatestNeural`
   - optional: Habibi MSA

   For Gemini, use one fixed "calm narrator" persona. Elsewhere use the closest male + female voice. One take per system; no cherry-picking.
3. **Normalise the audio**: same format (24 kHz mono), loudness-normalise to −16 LUFS, trim leading/trailing silence, rename files to random IDs. Keep the key in a separate file the raters never see.
4. **Raters**: at least 5 native Arabic speakers. Include at least 2 with strong fusha/nahw (grammar) skills to judge i'rab.
5. **Per clip, rate 1–5 on:**
   - naturalness (MOS)
   - pronunciation/i'rab correctness
   - listenability for 30 minutes ("would you keep this on while working?")

   Also mark every mispronounced word on a printed copy of the text. This gives a word-error count.
6. **Pairwise round**: Gemini 3.8 Flash vs the top non-Gemini system, same paragraph, A/B order randomised, forced choice.
7. **Long-form check**: generate 10 consecutive paragraphs (one chapter) with the top 2 systems. Listen for voice drift, pace drift and inconsistent pronunciation of a recurring name.
8. **Analysis**:
   - mean MOS ± 95% CI per system
   - mispronunciations per 100 words, split modern vs classical
   - pairwise win rate
   - cost per audio hour (from the table)

   Decision rule: switch from baseline only if MOS is ≥ 0.2 higher, or mispronunciations are ≥ 25% lower, with no regression on the classical set.
9. **Timing check** (for the highlighting design): run forced alignment on the winner's 10 clips. Hand-check sentence boundaries against the audio and report mean absolute boundary error. Target < 250 ms at sentence level.

## 4. Sources

Prices read 2026-10-12 unless dated otherwise.

**Gemini**
- Gemini API pricing (3.8 Flash/Flash-Lite TTS, 3.1 Flash TTS preview, 2.5 Flash/Pro TTS; 25 tokens/s; 2027 doubling): https://ai.google.dev/gemini-api/docs/pricing
- Gemini 3.8 Flash TTS model page (8,192 input tokens, style, voice design/replication, streaming, Arabic variants; no timestamps documented): https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash-tts
- Google blog, Gemini 3.8 TTS (2026-09-23): https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-8-text-to-speech/
- DeepMind Gemini Audio page (Arabic named among top languages): https://deepmind.google/models/gemini-audio/speech-generation/
- Cellcog, Gemini 3.8 Flash TTS (GA 2026-09-22; AA Elo 1260, #2): https://cellcog.ai/blog/gemini-3-8-flash-tts/
- Voice Arena X post (Gemini 3.8 #1 on all seven language boards). Arabic MSA scores 1204/1181/1135/1020/911 came via search snippets; the post itself was not readable (402), so **partly unverified**: https://x.com/voicearena_ai/status/2102793388668174468 and https://voicearena.com/
- Artificial Analysis X post (Gemini 3.8 #1 Pronunciation Robustness), not readable (402), unverified: https://x.com/ArtificialAnlys/status/2102784197853380647
- Gemini forced-alignment threads (LLM timestamp generation unreliable, 2025): https://discuss.ai.google.dev/t/timestamp-generation-forced-alignment-on-2-0-production-models-is-still-broken/79553

**Cartesia**
- Sonic 3.6 blog (Aug 2026): https://www.cartesia.ai/blog/sonic-3.6
- MarkTechPost (2026-08-18): https://www.marktechpost.com/2026/08/18/cartesia-ships-sonic-3-6-a-streaming-tts-model-that-now-leads-both-artificial-analysis-speech-arenas/
- AlphaSignal (2026-09-22; Arabic 1369 Elo, +132 over Eleven v3; Gemini absent): https://alphasignal.ai/news/cartesia-s-sonic-3-6-dominates-eight-of-nine-global-voice-ai-leaderboards
- Cartesia WebSocket docs (word/phoneme timestamps, emotion, speed): https://docs.cartesia.ai/api-reference/tts/websocket
- Cartesia pricing, secondary (Sept 2026): https://www.cloudtalk.io/cartesia-pricing/ and https://www.layer3labs.io/guides/sonic-3-5-pricing

**Artificial Analysis arenas**
- Controlled Voice leaderboard (English view; Arabic board not rendered): https://artificialanalysis.ai/text-to-speech/leaderboard/controlled-voice
- Multilingual boards announcement (incl. Arabic), not readable, unverified: https://x.com/ArtificialAnlys/status/2102490340678856997

**ElevenLabs**
- API pricing (v4 $0.022 promo, v3 $0.08, Flash/Turbo $0.04 per 1k chars): https://elevenlabs.io/pricing/api
- With-timestamps (character alignment): https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps
- Eleven v4 explainer (2026-09-28 launch, $0.08/$0.04 list, promo to 2026-10-12, sliders removed, 10k-char limit): https://www.eesel.ai/blog/eleven-v4

**Azure**
- HD voices doc (updated 2026-09-24; Omni word boundary, English-only styles, SSML table): https://learn.microsoft.com/en-us/azure/ai-services/speech-service/high-definition-voices
- Azure HD updates blog ($22/M HD from Mar 2026; Arabic HD updates): https://techcommunity.microsoft.com/blog/azure-ai-foundry-blog/azure-speech-%E2%80%93-neural-hd-text-to-speech-recent-voice-updates/4505380
- Azure neural $16/M, secondary (2026): https://texttolab.com/blog/azure-text-to-speech-pricing

**Google Cloud**
- Chirp 3 HD docs: https://docs.cloud.google.com/text-to-speech/docs/chirp3-hd
- Cloud TTS pricing (Chirp 3 HD $30/M; page did not render, figure via search snippet): https://cloud.google.com/text-to-speech/pricing
- Timepoints via SSML `<mark>`: https://docs.cloud.google.com/text-to-speech/docs/reference/rest/v1beta1/text/synthesize

**OpenAI**
- Pricing page (tts-1 $15/M, tts-1-hd $30/M): https://developers.openai.com/api/docs/pricing
- gpt-4o-mini-tts ~$0.015/min (secondary, Jul 2026): https://techsy.io/en/blog/best-tts-apis-developers

**Amazon Polly**
- Pricing: https://aws.amazon.com/polly/pricing
- Voices: https://docs.aws.amazon.com/polly/latest/dg/available-voices.html

**MiniMax**
- T2A API (Arabic, word subtitles, emotions): https://platform.minimax.io/docs/api-reference/speech-t2a-http
- Pricing $100/$60 per M (secondary, 2026): https://www.gradually.ai/en/ai-models/minimax-speech-2-8/

**Fish Audio**
- Pricing $15/M bytes (secondary, 2026): https://smallest.ai/blog/fish-audio-pricing-plans-api-billing-commercial-use-in-2026

**SILMA**
- TTS models page: https://silma.ai/arabic-tts-models
- Vendor latency benchmark (2026-10-09, no quality metrics): https://silma.ai/blog/best-low-latency-arabic-text-to-speech-apis-for-developers-2026-benchmark
- SILMA v1 open repo: https://github.com/SILMA-AI/silma-tts

**Open Arabic models**
- Habibi paper (2026-01-20, rev. 2026-03-31): https://arxiv.org/abs/2601.13802
- Habibi repo (licenses per model): https://github.com/SWivid/Habibi-TTS
- "More Data, Fewer Diacritics" (2026-03-02; 4,000 h; diacritics less needed at scale): https://arxiv.org/abs/2603.01622
- Navid AI Arabic TTS Arena (2026-03-12): https://huggingface.co/blog/Navid-AI/introducing-arabic-tts-arena
- Middle East AI News on the arena (2026-03-25): https://www.middleeastainews.com/p/saudi-ai-firm-launches-community
- Arabic-F5-TTS-v2: https://huggingface.co/IbrahimSalah/Arabic-F5-TTS-v2
- Arabic-TTS-Spark: https://huggingface.co/IbrahimSalah/Arabic-TTS-Spark

**Fanar / QCRI**
- HBKU announcement (Hamza/Amina voices; date and API access unverified): https://hbku.edu.qa/en/node/22753

**Gulf startups (vendor listicle, unverified)**
- Munsit, 2026: https://munsit.com/blog/best-arabic-tts

**Diacritisation**
- Sadeed (Apr 2025; LLM vs small-model case-ending WER): https://arxiv.org/html/2504.21635v1
- Fine-Tashkeel at KSAA-2026 (CATT blind-test DER/WER): https://aclanthology.org/2026.osact-1.31/ and https://github.com/HasanBGit/KSAA2026-Fine-Tashkeel
- CATT-Whisper (NADI 2025): https://arxiv.org/pdf/2510.24247

**Forced alignment**
- MMS-FA / romanisation approach for Arabic: https://huggingface.co/spaces/karchoud/srt-caption-generator/blob/main/docs/ALIGNER.md
- Arabic CTC aligner: https://huggingface.co/parseh/aligner-ar
- ASR vs forced-alignment comparison: https://arxiv.org/pdf/2406.19363
