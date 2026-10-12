// ReadAI extraction + TTS bake-off. Run from readai/backend:  node scripts/bakeoff/run.js [--force-extract] [--force-tts]
// READ-ONLY against Supabase (selects + public downloads only). All output goes to readai/bakeoff-output/.
// Each stage caches its result on disk, so a re-run spends nothing unless forced.
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const BACKEND = process.cwd();
const config = require(path.join(BACKEND, 'src/config'));
const { convertToWav } = require(path.join(BACKEND, 'src/utils/audioUtils'));
const { GoogleGenAI } = require(require.resolve('@google/genai', { paths: [BACKEND] }));
const { createClient } = require(require.resolve('@supabase/supabase-js', { paths: [BACKEND] }));
const { EXTRACTION_PROMPT, RESPONSE_SCHEMA } = require('./prompt');
const { buildSegments, looksOpen, words } = require('./segments');

const OUT = path.resolve(BACKEND, '..', 'bakeoff-output');
const DIRS = ['images', 'audio/old', 'audio/new', 'data/extract', 'data/tts', 'pdf'].map(d => path.join(OUT, d));
const PDFTOPPM = 'C:/Program Files/poppler/Library/bin/pdftoppm.exe';
const FORCE_EXTRACT = process.argv.includes('--force-extract');
const FORCE_TTS = process.argv.includes('--force-tts');
const BUDGET_USD = 5;
const TTS_GAP_MS = 20000;
let lastTtsAt = 0;

const EXTRACT_MODEL = 'gemini-3.8-flash';
const TTS_MODEL = 'gemini-3.8-flash-tts';

// Prices, USD per 1M tokens, from docs/research/2026-10-arabic-ocr.md and 2026-10-arabic-tts.md (read 2026-10-09/12, valid to 2026-12-31).
const PRICES = {
  'gemini-3.8-flash': { input: 0.75, output: 3.75, source: 'OCR doc §1: 3.6/3.8 Flash $0.75 in / $3.75 out; thinking billed as output' },
  'gemini-2.5-flash': { input: 0.30, output: 2.50, source: 'OCR doc §1 baseline: $0.30 / $2.50' },
  'gemini-3.8-flash-tts': { input: 1.00, output: 9.00, source: 'TTS doc §1: $9/M audio tokens. Text input price not in the doc; $1/M assumed (doc: text input ~ $0.02 per audio hour)' },
  'gemini-2.5-flash-preview-tts': { input: 0.50, output: 10.00, source: 'TTS doc §1: $10/M audio tokens. Text input $0.50/M assumed' },
};
const AUDIO_TOKENS_PER_SEC = 25; // TTS doc §1
// Old-pipeline extraction assumptions (model is no longer listed, so it cannot be measured): OCR doc §1.
const OLD_ASSUMED = { imageTokens: 1550, thinkingTokens: 1000 };

const SAMPLE = [
  { key: 'b1', id: '3aaf8d3d-b0cf-40bc-8525-09e37c84ded6', pages: [5, 6, 7, 8], oldVoiceKey: 'Zephyr', newVoice: 'Zephyr' },
  { key: 'b2', id: '1380f803-0b75-4191-aa24-3fc6ff31e2b4', pages: [9, 10, 11, 12], oldVoiceKey: 'Zephyr', newVoice: 'Zephyr' },
  // Pages 9-11 only have the "Islamic Book Reader" persona audio (base voice Algieba, styled). Zephyr exists only for 6-8.
  { key: 'b3', id: 'cb6c142b-d493-40bf-a180-485b951d07f0', pages: [8, 9, 10, 11], oldVoiceKey: 'Islamic Book Reader', newVoice: 'Algieba' },
];

const calls = []; // every model call: tokens + cost + latency
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const chk = (r) => { if (r.error) throw new Error(JSON.stringify(r.error)); return r.data; };
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const writeJson = (f, o) => fs.writeFileSync(f, JSON.stringify(o, null, 2));
const spent = () => calls.reduce((s, c) => s + (c.costUsd || 0), 0);

function costOf(model, usage) {
  const p = PRICES[model];
  const inTok = usage.promptTokenCount || 0;
  const outTok = (usage.candidatesTokenCount || 0) + (usage.thoughtsTokenCount || 0);
  return (inTok * p.input + outTok * p.output) / 1e6;
}

function usageRow(u = {}) {
  return {
    promptTokenCount: u.promptTokenCount || 0,
    candidatesTokenCount: u.candidatesTokenCount || 0,
    thoughtsTokenCount: u.thoughtsTokenCount || 0,
    totalTokenCount: u.totalTokenCount || 0,
    promptTokensDetails: u.promptTokensDetails || null,
    candidatesTokensDetails: u.candidatesTokensDetails || null,
  };
}

function guardBudget(nextEstimate) {
  if (spent() + nextEstimate > BUDGET_USD) {
    throw new Error(`Budget guard: spent $${spent().toFixed(4)} + next ~$${nextEstimate} would pass $${BUDGET_USD}. Stopping.`);
  }
}

async function withRetry(fn, label, tries = 6) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(i); } catch (e) {
      last = e;
      const msg = String(e.message || e);
      const retriable = /429|RESOURCE_EXHAUSTED|500|502|503|504|UNAVAILABLE|INTERNAL|fetch failed|No audio|empty/i.test(msg);
      const rate = /429|RESOURCE_EXHAUSTED/.test(msg);
      // On 429, show which quota was hit and honour the server's retryDelay.
      let detail = '', retryMs = 0;
      if (rate) {
        try {
          const j = JSON.parse(msg.slice(msg.indexOf('{')));
          for (const d of j.error.details || []) {
            if (/QuotaFailure/.test(d['@type'])) detail += (d.violations || []).map(v => `${v.quotaId} (${v.quotaValue || '?'})`).join(', ');
            if (/RetryInfo/.test(d['@type']) && d.retryDelay) retryMs = parseFloat(d.retryDelay) * 1000;
          }
        } catch { /* message not JSON */ }
      }
      log(`  ! ${label} attempt ${i + 1} failed: ${detail ? '429 quota ' + detail + (retryMs ? `, retry in ${retryMs / 1000}s` : '') : msg.slice(0, 200)}`);
      if (/PerDay/.test(detail)) { e.dailyCap = detail; break; } // daily cap: retrying today is pointless
      if (!retriable || i === tries - 1) break;
      const backoff = (rate ? 15000 : 4000) * Math.pow(2, Math.min(i, 3));
      await new Promise(r => setTimeout(r, Math.max(backoff, retryMs + 1000)));
    }
  }
  throw last;
}

function wavInfo(buf) {
  // Walk RIFF chunks; return { sampleRate, channels, bits, dataBytes, seconds }.
  if (buf.toString('ascii', 0, 4) !== 'RIFF') return null;
  let off = 12, fmt = null, dataBytes = 0;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') fmt = { channels: buf.readUInt16LE(off + 10), sampleRate: buf.readUInt32LE(off + 12), bits: buf.readUInt16LE(off + 22) };
    if (id === 'data') { dataBytes = Math.min(size, buf.length - off - 8); break; }
    off += 8 + size + (size % 2);
  }
  if (!fmt) return null;
  return { ...fmt, dataBytes, seconds: dataBytes / (fmt.sampleRate * fmt.channels * fmt.bits / 8) };
}

async function download(url, dest) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return dest;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status} ${url.split('?')[0].slice(-60)}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

function oldSpokenText(t) {
  // Mirrors frontend usePageAudio.ts (header + "\n\n" + body) and geminiService.generateAudio truncation.
  let s = '';
  if (t.header && t.header.trim()) s += t.header.trim() + '\n\n';
  if (t.body && t.body.trim()) s += t.body.trim();
  const max = config.maxTextLength;
  return { full: s, spoken: s.length > max ? s.substring(0, max) + '...' : s, truncated: s.length > max, max };
}

function parseOldText(raw) {
  let p = raw;
  if (typeof raw === 'string') { try { p = JSON.parse(raw); } catch { return { header: '', body: raw, footer: '' }; } }
  return { header: p.header || '', body: p.body || '', footer: p.footer || '' };
}

async function main() {
  DIRS.forEach(d => fs.mkdirSync(d, { recursive: true }));
  const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
  const sb = createClient(config.supabase.url, config.supabase.serviceKey);
  const t0 = Date.now();
  const timings = {};

  // ---------- Stage 1: source data (read-only selects) ----------
  let ts = Date.now();
  const books = [];
  for (const s of SAMPLE) {
    const book = chk(await sb.from('books').select('id,title,author,total_pages,pdf_url').eq('id', s.id).single());
    const pages = chk(await sb.from('pages').select('id,page_number,image_url,image_width,image_height').eq('book_id', s.id).in('page_number', s.pages).order('page_number'));
    const ids = pages.map(p => p.id);
    const texts = chk(await sb.from('page_text').select('page_id,extracted_text,processed_at,processing_duration_ms').in('page_id', ids));
    const auds = chk(await sb.from('page_audio').select('page_id,voice_persona,audio_url,audio_duration_seconds,audio_size_bytes,voice_settings,processed_at').in('page_id', ids));
    const notes = [];
    const outPages = [];
    for (const n of s.pages) {
      const pg = pages.find(p => p.page_number === n);
      if (!pg) throw new Error(`${s.key} page ${n} has no pages row`);
      const t = texts.find(x => x.page_id === pg.id);
      const rows = auds.filter(x => x.page_id === pg.id);
      // Prefer the book's comparison voice key; else a base voice row; else newest.
      const pick = rows.find(r => r.voice_persona === s.oldVoiceKey)
        || rows.find(r => /^[A-Za-z][A-Za-z0-9_-]*$/.test(r.voice_persona))
        || rows.sort((a, b) => String(b.processed_at).localeCompare(String(a.processed_at)))[0];
      if (!t) notes.push(`page ${n}: no old text`);
      if (!pick) notes.push(`page ${n}: no old audio`);
      outPages.push({
        page: n,
        pageId: pg.id,
        imageUrlInDb: pg.image_url,
        oldText: t ? parseOldText(t.extracted_text) : null,
        oldTextProcessingMs: t ? t.processing_duration_ms : null,
        oldAudioRow: pick ? { voice_persona: pick.voice_persona, voice_settings: pick.voice_settings, audio_url: pick.audio_url, db_duration_seconds: pick.audio_duration_seconds, audio_size_bytes: pick.audio_size_bytes, processed_at: pick.processed_at } : null,
        oldAudioVoicesAvailable: rows.map(r => r.voice_persona),
      });
    }
    books.push({ ...s, title: book.title, author: book.author, pdfUrl: book.pdf_url, notes, pages: outPages });
  }
  timings.sourceMs = Date.now() - ts;
  log('Source data loaded');

  // ---------- Stage 2: render page images + download old audio ----------
  ts = Date.now();
  for (const b of books) {
    const pdf = path.join(OUT, 'pdf', `${b.key}.pdf`);
    await download(b.pdfUrl, pdf);
    for (const p of b.pages) {
      const base = path.join(OUT, 'images', `${b.key}-p${p.page}`);
      if (!fs.existsSync(`${base}.png`)) {
        execFileSync(PDFTOPPM, ['-f', String(p.page), '-l', String(p.page), '-r', '200', '-png', '-singlefile', pdf, base]);
      }
      p.image = `images/${b.key}-p${p.page}.png`;
      if (p.oldAudioRow) {
        const f = path.join(OUT, 'audio', 'old', `${b.key}-p${p.page}.wav`);
        await download(p.oldAudioRow.audio_url, f);
        p.oldAudio = `audio/old/${b.key}-p${p.page}.wav`;
        p.oldAudioInfo = wavInfo(fs.readFileSync(f));
      }
      if (p.oldText) {
        const sp = oldSpokenText(p.oldText);
        p.oldSpoken = sp;
      }
    }
  }
  timings.renderAndDownloadMs = Date.now() - ts;
  log('Images rendered, old audio downloaded');
  if (process.argv.includes('--prep-only')) { writeJson(path.join(OUT, 'data', 'prep.json'), books); return; }

  // ---------- Stage 3: NEW extraction ----------
  ts = Date.now();
  let thinkingLevel = 'MINIMAL';
  const extractOne = async (b, p) => {
    const cacheFile = path.join(OUT, 'data', 'extract', `${b.key}-p${p.page}.json`);
    if (fs.existsSync(cacheFile) && !FORCE_EXTRACT) {
      const c = readJson(cacheFile);
      calls.push(c.call);
      return c;
    }
    guardBudget(0.05);
    const img = fs.readFileSync(path.join(OUT, p.image)).toString('base64');
    return withRetry(async () => {
      const started = Date.now();
      const req = {
        model: EXTRACT_MODEL,
        contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/png', data: img } }, { text: 'Transcribe this page into blocks.' }] }],
        config: {
          temperature: 0,
          thinkingConfig: { thinkingLevel },
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
          systemInstruction: EXTRACTION_PROMPT,
        },
      };
      let res;
      try {
        res = await ai.models.generateContent(req);
      } catch (e) {
        if (thinkingLevel === 'MINIMAL' && /thinking|INVALID_ARGUMENT|400/i.test(String(e.message))) {
          log('  MINIMAL thinking rejected, falling back to LOW:', String(e.message).slice(0, 160));
          thinkingLevel = 'LOW';
          req.config.thinkingConfig = { thinkingLevel };
          res = await ai.models.generateContent(req);
        } else throw e;
      }
      const latencyMs = Date.now() - started;
      const text = res.text;
      if (!text) throw new Error('empty extraction response');
      const parsed = JSON.parse(text);
      const usage = usageRow(res.usageMetadata);
      const call = {
        kind: 'extract', model: EXTRACT_MODEL, modelVersion: res.modelVersion || null, target: `${b.key}-p${p.page}`,
        thinkingLevel, ...usage, costUsd: costOf(EXTRACT_MODEL, usage), latencyMs,
        finishReason: res.candidates?.[0]?.finishReason || null,
      };
      calls.push(call);
      const out = { blocks: parsed.blocks || [], raw: text, call };
      writeJson(cacheFile, out);
      log(`  extracted ${call.target}: ${out.blocks.length} blocks, in ${usage.promptTokenCount} / out ${usage.candidatesTokenCount} / think ${usage.thoughtsTokenCount}, $${call.costUsd.toFixed(5)}, ${latencyMs} ms`);
      return out;
    }, `extract ${b.key}-p${p.page}`);
  };
  const failures = [];
  for (const b of books) {
    // First page alone (settles the thinking level), then the rest in parallel.
    const [first, ...rest] = b.pages;
    const run = async (p) => {
      try { const r = await extractOne(b, p); p.newBlocks = r.blocks; p.extractCall = r.call; } catch (e) {
        failures.push({ target: `${b.key}-p${p.page}`, error: String(e.message).slice(0, 300) });
        p.newBlocks = null;
      }
    };
    await run(first);
    for (const p of rest) await run(p); // sequential: the key returns 429s under parallel load
  }
  timings.extractMs = Date.now() - ts;
  log('Extraction done, spent so far $' + spent().toFixed(4));
  if (failures.length) throw new Error(`Extraction failed for ${failures.map(f => f.target).join(', ')}; not building segments over a page gap. Re-run to retry (finished pages are cached).`);

  // ---------- Stage 4: segments + old-pipeline break analysis ----------
  for (const b of books) {
    const ok = b.pages.filter(p => p.newBlocks);
    const { segments, boundaries } = buildSegments(ok.map(p => ({ page: p.page, blocks: p.newBlocks })), b.key);
    b.segments = segments;
    b.boundaries = boundaries;
    b.oldBreaks = [];
    for (let i = 0; i + 1 < b.pages.length; i++) {
      const a = b.pages[i], c = b.pages[i + 1];
      if (!a.oldText || !c.oldText) continue;
      const aBody = a.oldText.body.trim();
      const open = looksOpen(aBody);
      const nextSpoken = c.oldSpoken.spoken;
      b.oldBreaks.push({
        from: a.page, to: c.page,
        sentenceCrossesBreak: open,
        prevTruncated: a.oldSpoken.truncated,
        nextStartsWithHeader: !!c.oldText.header.trim(),
        nextHeader: c.oldText.header.trim(),
        tail: words(a.oldSpoken.spoken).slice(-8).join(' '),
        head: words(nextSpoken).slice(0, 8).join(' '),
      });
    }
  }

  // ---------- Stage 5: NEW TTS per segment ----------
  ts = Date.now();
  let dailyCap = null;
  const ttsPending = [];
  for (const b of books) {
    for (const s of b.segments) {
      const cacheFile = path.join(OUT, 'data', 'tts', `${s.id}.json`);
      const wavFile = path.join(OUT, 'audio', 'new', `${s.id}.wav`);
      s.audio = `audio/new/${s.id}.wav`;
      if (fs.existsSync(cacheFile) && fs.existsSync(wavFile) && !FORCE_TTS) {
        const c = readJson(cacheFile);
        if (c.text === s.text) { calls.push(c.call); s.ttsCall = c.call; s.duration = c.duration; continue; }
      }
      if (dailyCap) { s.audio = null; s.ttsPending = dailyCap; ttsPending.push(s.id); continue; }
      guardBudget(0.05);
      // Pace TTS: the key hit 429s after 10 back-to-back calls.
      const wait = lastTtsAt + TTS_GAP_MS - Date.now();
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      lastTtsAt = Date.now();
      try {
        const r = await withRetry(async (attempt) => {
          const started = Date.now();
          const req = {
            model: TTS_MODEL,
            contents: [{ parts: [{ text: s.text }] }],
            config: {
              responseModalities: ['AUDIO'],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: b.newVoice } } },
            },
          };
          // A retry after a text-only reply adds the same audio-only instruction the backend uses (no style).
          if (attempt > 0) req.config.systemInstruction = 'You are a TTS engine. Only generate audio of the given text, exactly as written.';
          const res = await ai.models.generateContent(req);
          const part = res.candidates?.[0]?.content?.parts?.find(x => x.inlineData?.data);
          if (!part) throw new Error(`No audio data (finish ${res.candidates?.[0]?.finishReason})`);
          const usage = usageRow(res.usageMetadata);
          const wav = convertToWav(part.inlineData.data, part.inlineData.mimeType || 'audio/L16;rate=24000');
          fs.writeFileSync(wavFile, wav);
          const info = wavInfo(wav);
          const call = {
            kind: 'tts', model: TTS_MODEL, modelVersion: res.modelVersion || null, target: s.id, voice: b.newVoice,
            mimeType: part.inlineData.mimeType, ...usage, costUsd: costOf(TTS_MODEL, usage), latencyMs: Date.now() - started,
            audioSeconds: info.seconds, chars: s.text.length, attempts: attempt + 1,
          };
          return { call, duration: info.seconds };
        }, `tts ${s.id}`, 6);
        calls.push(r.call);
        s.ttsCall = r.call;
        s.duration = r.duration;
        writeJson(cacheFile, { text: s.text, call: r.call, duration: r.duration });
        log(`  tts ${s.id} (${s.text.length} chars): ${r.duration.toFixed(1)} s audio, out ${r.call.candidatesTokenCount} tok, $${r.call.costUsd.toFixed(5)}, ${r.call.latencyMs} ms`);
      } catch (e) {
        s.audio = null;
        if (e.dailyCap) {
          dailyCap = e.dailyCap; s.ttsPending = dailyCap; ttsPending.push(s.id);
          log(`  daily TTS cap hit (${dailyCap}); remaining segments marked pending. Re-run after the quota resets.`);
        } else {
          failures.push({ target: s.id, error: String(e.message).slice(0, 300) });
        }
      }
    }
  }
  timings.ttsMs = Date.now() - ts;
  log('TTS done, spent so far $' + spent().toFixed(4));

  // ---------- Stage 6: old-pipeline cost estimate (token counting is free) ----------
  const oldPromptTok = (await ai.models.countTokens({ model: EXTRACT_MODEL, contents: [{ parts: [{ text: require(path.join(BACKEND, 'src/services/geminiService')).getDigitalMuhaqqiqPrompt() }] }] })).totalTokens;
  for (const b of books) {
    for (const p of b.pages) {
      if (!p.oldText) continue;
      const outTok = (await ai.models.countTokens({ model: EXTRACT_MODEL, contents: [{ parts: [{ text: JSON.stringify(p.oldText) }] }] })).totalTokens;
      const spokenTok = (await ai.models.countTokens({ model: EXTRACT_MODEL, contents: [{ parts: [{ text: p.oldSpoken.spoken }] }] })).totalTokens;
      const inTok = oldPromptTok + OLD_ASSUMED.imageTokens;
      const extractCost = (inTok * PRICES['gemini-2.5-flash'].input + (outTok + OLD_ASSUMED.thinkingTokens) * PRICES['gemini-2.5-flash'].output) / 1e6;
      const secs = p.oldAudioInfo ? p.oldAudioInfo.seconds : 0;
      const ttsCost = (spokenTok * PRICES['gemini-2.5-flash-preview-tts'].input + secs * AUDIO_TOKENS_PER_SEC * PRICES['gemini-2.5-flash-preview-tts'].output) / 1e6;
      p.oldEstimate = { promptTokens: oldPromptTok, imageTokensAssumed: OLD_ASSUMED.imageTokens, outputTokens: outTok, thinkingTokensAssumed: OLD_ASSUMED.thinkingTokens, extractCost, audioSeconds: secs, spokenTokens: spokenTok, ttsCost };
    }
  }

  // ---------- Stage 7: summary ----------
  const extractCalls = calls.filter(c => c.kind === 'extract');
  const ttsCalls = calls.filter(c => c.kind === 'tts');
  const allPages = books.flatMap(b => b.pages);
  const oldPages = allPages.filter(p => p.oldEstimate);
  const sum = (a, f) => a.reduce((s, x) => s + (f(x) || 0), 0);
  const newAudioSec = sum(ttsCalls, c => c.audioSeconds);
  const newAudioTok = sum(ttsCalls, c => c.candidatesTokenCount);
  const oldAudioSec = sum(oldPages, p => p.oldEstimate.audioSeconds);
  const pageCount = allPages.length;
  const summary = {
    generatedAt: new Date().toISOString(),
    models: { extract: EXTRACT_MODEL, tts: TTS_MODEL, thinkingLevel, modelVersions: [...new Set(calls.map(c => c.modelVersion).filter(Boolean))] },
    pages: pageCount,
    segments: sum(books, b => b.segments.length),
    merges: sum(books, b => b.segments.filter(s => s.merged).length),
    oldBreaks: sum(books, b => b.oldBreaks.filter(x => x.sentenceCrossesBreak).length),
    boundaries: sum(books, b => b.boundaries.length),
    failures,
    ttsDone: ttsCalls.length,
    ttsPending,
    ttsDailyCap: dailyCap,
    spendUsd: spent(),
    spendExtractUsd: sum(extractCalls, c => c.costUsd),
    spendTtsUsd: sum(ttsCalls, c => c.costUsd),
    tokens: {
      extractIn: sum(extractCalls, c => c.promptTokenCount), extractOut: sum(extractCalls, c => c.candidatesTokenCount), extractThink: sum(extractCalls, c => c.thoughtsTokenCount),
      ttsIn: sum(ttsCalls, c => c.promptTokenCount), ttsOut: newAudioTok,
    },
    audio: {
      newSeconds: newAudioSec, oldSeconds: oldAudioSec,
      newAudioTokensPerSec: newAudioSec ? newAudioTok / newAudioSec : null,
    },
    per1kPages: {
      newExtract: sum(extractCalls, c => c.costUsd) / extractCalls.length * 1000,
      oldExtractEstimate: sum(oldPages, p => p.oldEstimate.extractCost) / oldPages.length * 1000,
      // Measured TTS cost per spoken character x average spoken characters per page (works while some segments are pending).
      newTts: sum(ttsCalls, c => c.chars) ? sum(ttsCalls, c => c.costUsd) / sum(ttsCalls, c => c.chars) * sum(books, b => sum(b.segments, s => s.text.length)) / pageCount * 1000 : null,
      newTtsBasis: `measured $ per spoken char over ${ttsCalls.length} segments x ${Math.round(sum(books, b => sum(b.segments, s => s.text.length)) / pageCount)} spoken chars per page`,
      oldTtsEstimate: sum(oldPages, p => p.oldEstimate.ttsCost) / oldPages.length * 1000,
    },
    perAudioHour: {
      newTts: newAudioSec ? sum(ttsCalls, c => c.costUsd) / newAudioSec * 3600 : null,
      oldTtsEstimate: oldAudioSec ? sum(oldPages, p => p.oldEstimate.ttsCost) / oldAudioSec * 3600 : null,
    },
    latency: {
      extractP50: pct(extractCalls.map(c => c.latencyMs), 0.5), extractMax: Math.max(...extractCalls.map(c => c.latencyMs)),
      ttsP50: pct(ttsCalls.map(c => c.latencyMs), 0.5), ttsMax: Math.max(...ttsCalls.map(c => c.latencyMs)),
      oldExtractStoredP50: pct(oldPages.map(p => p.oldTextProcessingMs).filter(Boolean), 0.5),
    },
    timings: { ...timings, totalMs: Date.now() - t0 },
    prices: PRICES,
    oldAssumptions: { ...OLD_ASSUMED, note: 'gemini-2.5-flash-preview-09-2025 is no longer in models.list, so its tokens cannot be measured. Image + thinking tokens are the OCR doc §1 assumptions; output tokens are counted from the cached old text; old audio seconds come from the cached WAV headers.' },
    maxTextLength: config.maxTextLength,
  };
  writeJson(path.join(OUT, 'data', 'calls.json'), calls);
  writeJson(path.join(OUT, 'data', 'bakeoff.json'), { summary, prompt: EXTRACTION_PROMPT, schema: RESPONSE_SCHEMA, books });
  log(`Done. ${summary.pages} pages, ${summary.segments} segments, ${summary.merges} merges, spend $${summary.spendUsd.toFixed(4)}, failures ${failures.length}`);
}

function pct(arr, q) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

main().catch(e => { console.error('FATAL', e.message); console.error('Spent before stop: $' + spent().toFixed(4)); process.exit(1); });
