// ReadAI audio-pipeline story 1: OpenRouter spike (probes P1-P8).
// Run from readai/backend:  node scripts/spikes/openrouter-probe.js [--force] [--only=P1,P3]
// Each probe caches its result under readai/bakeoff-output/spike/data/, so a re-run spends nothing unless --force.
// The API key is read from the environment that src/config loads; it is never printed, and request headers are never logged.
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const BACKEND = process.cwd();
require(path.join(BACKEND, 'src/config'));
const ENV = process.env;
const { EXTRACTION_PROMPT, RESPONSE_SCHEMA } = require(path.join(BACKEND, 'scripts/bakeoff/prompt'));

const API = 'https://openrouter.ai/api/v1';
const OUT = path.resolve(BACKEND, '..', 'bakeoff-output');
const SPIKE = path.join(OUT, 'spike');
const DATA = path.join(SPIKE, 'data');
const FORCE = process.argv.includes('--force');
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const BUDGET_USD = 1.0;

const EXTRACT_MODEL = 'google/gemini-3.8-flash';
const BATCH_MODEL = 'google/gemini-3.8-flash:batch';
const TTS_MODEL = 'google/gemini-3.8-flash-tts';
const IMAGES = ['b1-p5', 'b3-p9'];

const calls = []; // every billed call: { probe, model, usage, cost, latencyMs, ... }
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const writeJson = (f, o) => fs.writeFileSync(f, JSON.stringify(o, null, 2));
const spent = () => calls.reduce((s, c) => s + (c.cost || 0), 0);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function guardBudget(nextEstimate) {
  if (spent() + nextEstimate > BUDGET_USD) {
    throw new Error(`Budget guard: spent $${spent().toFixed(4)} + next ~$${nextEstimate} would pass $${BUDGET_USD}. Stopping.`);
  }
}

function authHeaders() {
  const k = ENV.OPENROUTER_API_KEY;
  if (!k) throw new Error('OPENROUTER_API_KEY is not set in the backend environment');
  return { Authorization: `Bearer ${k}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://readai.local/spike', 'X-Title': 'ReadAI spike' };
}

// Response headers worth keeping (rate limits, generation id). Never request headers.
function keepHeaders(h) {
  const o = {};
  for (const [k, v] of h.entries()) if (/ratelimit|retry-after|generation|x-openrouter|content-type/i.test(k)) o[k] = v;
  return o;
}

// Redacted copy of a request body for the report: long base64 / data URLs shortened.
function redact(body) {
  return JSON.parse(JSON.stringify(body, (k, v) => {
    if (typeof v === 'string' && v.length > 400 && /^data:|^[A-Za-z0-9+/=]{400,}$/.test(v)) return `${v.slice(0, 40)}…(${v.length} chars)`;
    if (k === 'content' && typeof v === 'string' && v.length > 600) return `${v.slice(0, 120)}…(${v.length} chars)`;
    return v;
  }));
}

// Google `Type` schema -> plain JSON schema for OpenRouter's json_schema response_format.
function toJsonSchema(s) {
  const o = {};
  if (s.type) o.type = String(s.type).toLowerCase();
  if (s.enum) o.enum = s.enum;
  if (s.properties) {
    o.properties = {};
    for (const [k, v] of Object.entries(s.properties)) o.properties[k] = toJsonSchema(v);
    o.additionalProperties = false;
  }
  if (s.items) o.items = toJsonSchema(s.items);
  if (s.required) o.required = s.required;
  return o;
}
const JSON_SCHEMA = { name: 'page_blocks', strict: true, schema: toJsonSchema(RESPONSE_SCHEMA) };

async function getJson(url) {
  const res = await fetch(url, { headers: authHeaders() });
  const text = await res.text();
  try { return { status: res.status, json: JSON.parse(text) }; } catch { return { status: res.status, text: text.slice(0, 500) }; }
}

async function keyInfo() {
  const r = await getJson(`${API}/key`);
  const d = r.json && r.json.data;
  if (!d) return { status: r.status, error: r.json || r.text };
  // `label` can contain part of the key, so it is dropped.
  const { label, ...rest } = d;
  return { status: r.status, ...rest };
}

// Generation stats (native token counts, provider, cost). Available a few seconds after the call.
async function generationStats(id) {
  if (!id) return null;
  for (let i = 0; i < 6; i++) {
    await sleep(1500 + i * 1500);
    const r = await getJson(`${API}/generation?id=${encodeURIComponent(id)}`);
    if (r.status === 200 && r.json && r.json.data) return r.json.data;
  }
  return { unavailable: true };
}

// Non-streaming chat completion.
async function chat(body, { timeoutMs = 300000 } = {}) {
  const started = Date.now();
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${API}/chat/completions`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body), signal: ac.signal });
  } finally { clearTimeout(t); }
  const text = await res.text();
  const latencyMs = Date.now() - started;
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, headers: keepHeaders(res.headers), latencyMs, json, rawText: json ? undefined : text.slice(0, 2000) };
}

function wavHeader(dataBytes, rate = 24000, ch = 1, bits = 16) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + dataBytes, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(ch, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * ch * bits / 8, 28); h.writeUInt16LE(ch * bits / 8, 32); h.writeUInt16LE(bits, 34);
  h.write('data', 36); h.writeUInt32LE(dataBytes, 40);
  return h;
}

function sniff(buf) {
  if (!buf || buf.length < 4) return 'empty';
  const a = buf.toString('ascii', 0, 4);
  if (a === 'RIFF') return 'wav';
  if (a === 'OggS') return 'ogg';
  if (a === 'fLaC') return 'flac';
  if (buf.toString('ascii', 0, 3) === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0 && (buf[1] & 0x06) !== 0)) return 'mp3';
  if (buf[0] === 0xff && (buf[1] & 0xf6) === 0xf0) return 'aac-adts';
  if (buf.toString('ascii', 4, 8) === 'ftyp') return 'mp4';
  return 'raw';
}

function ffprobe(file) {
  try {
    const o = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { encoding: 'utf8' }));
    const s = (o.streams || [])[0] || {};
    return { codec: s.codec_name, sampleRate: Number(s.sample_rate) || null, channels: s.channels || null, duration: Number(o.format && o.format.duration) || Number(s.duration) || null, bitRate: Number(o.format && o.format.bit_rate) || null, formatName: o.format && o.format.format_name };
  } catch (e) { return { error: String(e.message).slice(0, 200) }; }
}

// Save TTS bytes; returns file info incl. duration and bytes/s.
function saveAudio(name, buf, requestedFormat) {
  const kind = sniff(buf);
  let file, info;
  if (kind === 'raw' && /pcm/.test(requestedFormat)) {
    const raw = path.join(SPIKE, `${name}.pcm`);
    fs.writeFileSync(raw, buf);
    file = path.join(SPIKE, `${name}.wav`);
    fs.writeFileSync(file, Buffer.concat([wavHeader(buf.length), buf])); // assumes 24 kHz mono s16le, checked against duration below
    info = { ...ffprobe(file), assumed: '24000 Hz mono s16le' };
  } else {
    const ext = { wav: 'wav', ogg: 'ogg', flac: 'flac', mp3: 'mp3', 'aac-adts': 'aac', mp4: 'm4a' }[kind] || `${requestedFormat}.bin`;
    file = path.join(SPIKE, `${name}.${ext}`);
    fs.writeFileSync(file, buf);
    info = ffprobe(file);
    if (kind === 'wav') {
      const declared = buf.readUInt32LE(40);
      info.wavDeclaredDataBytes = declared;
      info.wavHeaderSane = declared === buf.length - 44;
    }
  }
  return { file: path.relative(OUT, file).replace(/\\/g, '/'), bytes: buf.length, sniffed: kind, ...info, bytesPerSec: info.duration ? Math.round(buf.length / info.duration) : null };
}

function record(probe, r, extra = {}) {
  const u = r.usage || (r.json && r.json.usage) || null;
  const c = { probe, model: r.model || (r.json && r.json.model) || extra.model, provider: r.provider || (r.json && r.json.provider) || null, status: r.status, latencyMs: r.latencyMs, usage: u, cost: u && typeof u.cost === 'number' ? u.cost : 0, ...extra };
  calls.push(c);
  return c;
}

// ---------- extraction helpers ----------
const imgDataUrl = name => `data:image/png;base64,${fs.readFileSync(path.join(OUT, 'images', `${name}.png`)).toString('base64')}`;

function extractBody(name, { model = EXTRACT_MODEL, effort = 'low', temperature = 0 } = {}) {
  const b = {
    model,
    messages: [
      { role: 'system', content: EXTRACTION_PROMPT },
      { role: 'user', content: [{ type: 'image_url', image_url: { url: imgDataUrl(name) } }, { type: 'text', text: 'Transcribe this page into blocks.' }] },
    ],
    response_format: { type: 'json_schema', json_schema: JSON_SCHEMA },
    reasoning: { effort },
    usage: { include: true },
  };
  if (temperature !== undefined && temperature !== null) b.temperature = temperature;
  return b;
}

function lev(a, b) {
  const A = [...a], B = [...b];
  let prev = Array.from({ length: B.length + 1 }, (_, i) => i);
  for (let i = 1; i <= A.length; i++) {
    const cur = [i];
    for (let j = 1; j <= B.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (A[i - 1] === B[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[B.length];
}
const roleCounts = blocks => blocks.reduce((m, b) => { m[b.role] = (m[b.role] || 0) + 1; return m; }, {});
const spokenText = blocks => blocks.filter(b => b.role === 'body' || b.role === 'heading').map(b => b.text.trim()).join('\n');

function compareBlocks(ref, got) {
  const rt = spokenText(ref), gt = spokenText(got);
  const d = lev(rt, gt);
  const rc = roleCounts(ref), gc = roleCounts(got);
  const roles = [...new Set([...Object.keys(rc), ...Object.keys(gc)])];
  return {
    roleCountsRef: rc, roleCountsGot: gc, roleCountsEqual: roles.every(r => (rc[r] || 0) === (gc[r] || 0)),
    spokenCharsRef: [...rt].length, spokenCharsGot: [...gt].length, editDistance: d, cer: +(d / Math.max(1, [...rt].length)).toFixed(4),
    flagsRef: ref.filter(b => b.starts_mid_sentence || b.ends_mid_sentence).map(b => `${b.role}:${b.starts_mid_sentence ? 'S' : ''}${b.ends_mid_sentence ? 'E' : ''}`),
    flagsGot: got.filter(b => b.starts_mid_sentence || b.ends_mid_sentence).map(b => `${b.role}:${b.starts_mid_sentence ? 'S' : ''}${b.ends_mid_sentence ? 'E' : ''}`),
  };
}

async function runExtraction(probe, name, opts, tag) {
  guardBudget(0.02);
  const body = extractBody(name, opts);
  const r = await chat(body, { timeoutMs: opts.timeoutMs || 300000 });
  const msg = r.json && r.json.choices && r.json.choices[0] && r.json.choices[0].message;
  let blocks = null, parseError = null;
  if (msg && msg.content) { try { blocks = JSON.parse(msg.content).blocks; } catch (e) { parseError = String(e.message); } }
  const gen = r.json && r.json.id ? await generationStats(r.json.id) : null;
  const ref = readJson(path.join(OUT, 'data', 'extract', `${name}.json`));
  const c = record(probe, r, { kind: 'extract', target: name, tag, model: opts.model || EXTRACT_MODEL, generation: gen });
  const out = {
    target: name, tag, request: redact(body), status: r.status, headers: r.headers, latencyMs: r.latencyMs,
    responseKeys: r.json ? Object.keys(r.json) : null, choiceKeys: r.json && r.json.choices ? Object.keys(r.json.choices[0] || {}) : null,
    messageKeys: msg ? Object.keys(msg) : null, finish: r.json && r.json.choices && r.json.choices[0] && r.json.choices[0].finish_reason,
    id: r.json && r.json.id, model: r.json && r.json.model, provider: r.json && r.json.provider,
    usage: r.json && r.json.usage, generation: gen, error: r.json && r.json.error, rawText: r.rawText,
    reasoningPresent: !!(msg && (msg.reasoning || msg.reasoning_details)), parseError,
    blocks, compare: blocks ? compareBlocks(ref.blocks, blocks) : null,
    bakeoffUsage: { prompt: ref.call.promptTokenCount, completion: ref.call.candidatesTokenCount, thoughts: ref.call.thoughtsTokenCount, details: ref.call.promptTokensDetails, latencyMs: ref.call.latencyMs, costUsd: ref.call.costUsd },
    cost: c.cost,
  };
  log(`  ${probe} ${tag} ${name}: HTTP ${r.status}, ${r.latencyMs} ms, cost $${(c.cost || 0).toFixed(5)}, ${blocks ? blocks.length + ' blocks, CER ' + out.compare.cer : 'no blocks'}${out.error ? ' ERR ' + JSON.stringify(out.error).slice(0, 200) : ''}`);
  return out;
}

// ---------- TTS helpers ----------
// OpenRouter rejects Gemini TTS on /chat/completions ("Use the /api/v1/audio/speech endpoint instead"), so TTS goes to
// /audio/speech: OpenAI-style body, raw audio bytes back, cost only via X-Generation-Id -> GET /generation.
const bakeSegments = () => readJson(path.join(OUT, 'data', 'bakeoff.json')).books.flatMap(b => b.segments);
const segText = id => bakeSegments().find(s => s.id === id).text;

function speechBody(text, { voice = 'Zephyr', format = 'pcm', instructions = null } = {}) {
  const b = { model: TTS_MODEL, input: text, voice, response_format: format };
  if (instructions) b.instructions = instructions;
  return b;
}

async function speech(body) {
  const started = Date.now();
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 600000);
  try {
    const res = await fetch(`${API}/audio/speech`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body), signal: ac.signal });
    const headers = keepHeaders(res.headers);
    if (!res.ok || !res.body) {
      const text = await res.text();
      let json = null; try { json = JSON.parse(text); } catch { /* */ }
      return { status: res.status, headers, latencyMs: Date.now() - started, error: json || text.slice(0, 1000) };
    }
    const reader = res.body.getReader();
    const parts = []; let firstByteMs = null, reads = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (firstByteMs === null) firstByteMs = Date.now() - started;
      parts.push(Buffer.from(value)); reads++;
    }
    return { status: res.status, headers, latencyMs: Date.now() - started, firstByteMs, reads, audio: Buffer.concat(parts) };
  } finally { clearTimeout(t); }
}

function pcmRate(contentType) {
  const m = /rate=(\d+)/.exec(contentType || '');
  return m ? Number(m[1]) : 24000;
}

async function runTts(probe, name, text, opts = {}) {
  guardBudget(0.08);
  const body = speechBody(text, opts);
  const r = await speech(body);
  const genId = r.headers['x-generation-id'];
  const gen = genId ? await generationStats(genId) : null;
  const cost = gen && typeof gen.total_cost === 'number' ? gen.total_cost : 0;
  const c = record(probe, { status: r.status, latencyMs: r.latencyMs, usage: null }, { kind: 'tts', target: name, model: TTS_MODEL, chars: [...text].length, generation: gen });
  c.cost = cost;
  let audio = null;
  if (r.audio && r.audio.length) {
    const ct = r.headers['content-type'] || '';
    if (/pcm/.test(ct) || sniff(r.audio) === 'raw') {
      const rate = pcmRate(ct);
      const raw = path.join(SPIKE, `${name}.pcm`);
      fs.writeFileSync(raw, r.audio);
      const wav = path.join(SPIKE, `${name}.wav`);
      fs.writeFileSync(wav, Buffer.concat([wavHeader(r.audio.length, rate), r.audio]));
      const info = ffprobe(wav);
      audio = { file: path.relative(OUT, wav).replace(/\\/g, '/'), contentType: ct, pcmBytes: r.audio.length, sampleRate: rate, ...info, bytesPerSec: info.duration ? Math.round(r.audio.length / info.duration) : null };
    } else {
      audio = { contentType: ct, ...saveAudio(name, r.audio, opts.format || 'pcm') };
    }
  }
  const out = {
    target: name, request: redact(body), status: r.status, headers: r.headers, latencyMs: r.latencyMs, firstByteMs: r.firstByteMs, reads: r.reads,
    error: r.error, generation: gen, chars: [...text].length, audio, cost,
  };
  if (audio && audio.duration && gen && gen.native_tokens_completion) out.audioTokensPerSec = +(gen.native_tokens_completion / audio.duration).toFixed(2);
  if (audio && audio.duration && cost) { out.costPerAudioHour = +(cost / audio.duration * 3600).toFixed(4); out.audioSecPerKChar = +(audio.duration / [...text].length * 1000).toFixed(1); }
  log(`  ${probe} ${name}: HTTP ${r.status}, ${r.latencyMs} ms (first byte ${r.firstByteMs} ms), ${audio ? (audio.pcmBytes || audio.bytes) + ' B ' + (audio.contentType || '') + ' ' + (audio.duration || 0).toFixed(2) + ' s' : 'NO AUDIO'}, cost $${cost.toFixed(5)}${r.error ? ' ERR ' + JSON.stringify(r.error).slice(0, 240) : ''}`);
  return out;
}

// ---------- batch helpers ----------
async function postJson(url, body) {
  const started = Date.now();
  const res = await fetch(url, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* */ }
  return { status: res.status, headers: keepHeaders(res.headers), latencyMs: Date.now() - started, json, rawText: json ? undefined : text.slice(0, 1000) };
}

function extractBodyUrl(url, model, temperature) {
  const b = {
    model,
    messages: [
      { role: 'system', content: EXTRACTION_PROMPT },
      { role: 'user', content: [{ type: 'image_url', image_url: { url } }, { type: 'text', text: 'Transcribe this page into blocks.' }] },
    ],
    response_format: { type: 'json_schema', json_schema: JSON_SCHEMA },
    reasoning: { effort: 'low' },
  };
  if (temperature !== null && temperature !== undefined) b.temperature = temperature;
  return b;
}

// ---------- probes ----------
const COVER_URL = 'https://nmmmnfoahmdvaikcpvcn.supabase.co/storage/v1/object/public/readai-media/thumbnails/7a59017e-b2d2-4ca6-b7b8-5f8e6c9b8e61/3aaf8d3d-b0cf-40bc-8525-09e37c84ded6/cover.png';
const PROBES = {
  async P1() {
    const runs = [];
    for (const n of IMAGES) runs.push(await runExtraction('P1', n, { effort: 'low', temperature: 0 }, 'low'));
    runs.push(await runExtraction('P1', IMAGES[0], { effort: 'minimal', temperature: 0 }, 'minimal'));
    return { runs };
  },
  async P2() {
    // (a) the chat endpoint refuses `:batch` (measured on the first run): recorded here for the report.
    const chatRefusal = 'HTTP 404 "google/gemini-3.8-flash:batch cannot be used with the chat/completions endpoint (adapter VertexGeminiBatchAdapter)."';
    const out = { chatRefusal };
    // (b) Batch API with an inline data-URL image: documented as rejected (URL-only multimodal). Free if refused.
    const inline = { endpoint: '/v1/chat/completions', model: EXTRACT_MODEL, requests: [{ custom_id: 'inline-b1-p5', body: extractBody('b1-p5', { temperature: null }) }] };
    delete inline.requests[0].body.usage; delete inline.requests[0].body.temperature;
    const ri = await postJson(`${API}/batches`, inline);
    out.inlineImage = { request: redact(inline), status: ri.status, body: ri.json || ri.rawText };
    log(`  P2 inline-image batch: HTTP ${ri.status} ${JSON.stringify(ri.json || ri.rawText).slice(0, 300)}`);
    if (ri.json && ri.json.id) out.inlineImage.note = 'accepted; polled below with the URL batch';
    // (c) Realtime reference on the public cover URL (same input the batch gets).
    guardBudget(0.02);
    const rtBody = extractBodyUrl(COVER_URL, EXTRACT_MODEL, 0);
    const rt = await chat(rtBody);
    const rtGen = rt.json && rt.json.id ? await generationStats(rt.json.id) : null;
    record('P2', rt, { kind: 'extract', target: 'cover-url-realtime', model: EXTRACT_MODEL, generation: rtGen });
    const rtMsg = rt.json && rt.json.choices && rt.json.choices[0] && rt.json.choices[0].message;
    out.realtimeCover = { status: rt.status, latencyMs: rt.latencyMs, usage: rt.json && rt.json.usage, error: rt.json && rt.json.error, content: rtMsg && rtMsg.content };
    log(`  P2 realtime cover URL: HTTP ${rt.status}, ${rt.latencyMs} ms`);
    // (d) Batch API, URL image, two identical requests (determinism without temperature). One batch = one configuration: a first run that added a text-only control request failed with "Split the requests into one batch per configuration".
    const bodyB = extractBodyUrl(COVER_URL, EXTRACT_MODEL, null);
    const batch = {
      endpoint: '/v1/chat/completions', model: EXTRACT_MODEL,
      requests: [
        { custom_id: 'cover-1', body: bodyB },
        { custom_id: 'cover-2', body: bodyB },
      ],
    };
    guardBudget(0.03);
    const submittedAt = Date.now();
    const rb = await postJson(`${API}/batches`, batch);
    out.urlBatch = { request: redact(batch), submit: { status: rb.status, latencyMs: rb.latencyMs, headers: rb.headers, body: rb.json || rb.rawText } };
    log(`  P2 URL batch submit: HTTP ${rb.status} ${JSON.stringify(rb.json || rb.rawText).slice(0, 300)}`);
    const id = rb.json && rb.json.id;
    if (!id) return out;
    const timeline = [];
    let last = null;
    const deadline = submittedAt + 60 * 60 * 1000; // 1 h cap; re-run resumes nothing, but the id is recorded
    while (Date.now() < deadline) {
      await sleep(30000);
      const g = await getJson(`${API}/batches/${id}`);
      last = g.json;
      const st = last && last.status;
      if (!timeline.length || timeline[timeline.length - 1].status !== st) { timeline.push({ status: st, atSec: Math.round((Date.now() - submittedAt) / 1000), counts: last && last.request_counts }); log(`  P2 batch ${id}: ${st} at ${timeline[timeline.length - 1].atSec}s`); }
      if (['completed', 'failed', 'expired', 'cancelled'].includes(st)) break;
    }
    if (ri.json && ri.json.id) { const gi = await getJson(`${API}/batches/${ri.json.id}`); out.inlineImage.final = gi.json ? { ...gi.json, results: gi.json.results ? gi.json.results.map(x => ({ custom_id: x.custom_id, error: x.error, status_code: x.response && x.response.status_code, usage: x.response && x.response.body && x.response.body.usage })) : null } : gi; log(`  P2 inline-image batch final: ${gi.json && gi.json.status} ${JSON.stringify(gi.json && gi.json.error)}`); }
    out.urlBatch.id = id;
    out.urlBatch.timeline = timeline;
    out.urlBatch.wallSec = Math.round((Date.now() - submittedAt) / 1000);
    out.urlBatch.final = last ? { ...last, results: undefined } : null;
    out.urlBatch.results = last && last.results ? last.results.map(x => ({ custom_id: x.custom_id, error: x.error, status_code: x.response && x.response.status_code, usage: x.response && x.response.body && x.response.body.usage, content: x.response && x.response.body && x.response.body.choices && x.response.body.choices[0] && x.response.body.choices[0].message && x.response.body.choices[0].message.content })) : null;
    if (last && last.usage && typeof last.usage.cost === 'number') calls.push({ probe: 'P2', kind: 'extract-batch', target: 'url-batch', model: EXTRACT_MODEL + ' (batch API)', status: 200, latencyMs: out.urlBatch.wallSec * 1000, cost: last.usage.cost, usage: last.usage });
    const r = out.urlBatch.results || [];
    const c1 = r.find(x => x.custom_id === 'cover-1'), c2 = r.find(x => x.custom_id === 'cover-2');
    if (c1 && c2 && c1.content && c2.content) {
      out.determinism = { identical: c1.content === c2.content };
      try {
        const b1 = JSON.parse(c1.content).blocks, b2 = JSON.parse(c2.content).blocks;
        out.determinism.between = compareBlocks(b1, b2);
        if (out.realtimeCover.content) out.determinism.vsRealtime = compareBlocks(JSON.parse(out.realtimeCover.content).blocks, b1);
      } catch (e) { out.determinism.parseError = String(e.message); }
    }
    return out;
  },
  async P3() {
    const text = segText('b1-s05');
    const chatRefusal = 'HTTP 400 "google/gemini-3.8-flash-tts is a text-to-speech model and cannot be used with the chat/completions endpoint. Use the /api/v1/audio/speech endpoint instead." (stream true and false alike)';
    const main = await runTts('P3', 'P3-b1-s05-zephyr', text, { voice: 'Zephyr', format: 'pcm' });
    const badVoice = await runTts('P3', 'P3-b1-s05-badvoice', text, { voice: 'NotAVoice', format: 'pcm' });
    const ref = readJson(path.join(OUT, 'data', 'tts', 'b1-s05.json'));
    return { chatRefusal, main, badVoice, bakeoff: { durationSec: ref.duration, audioTokens: ref.call.candidatesTokenCount, promptTokens: ref.call.promptTokenCount, latencyMs: ref.call.latencyMs, costUsd: ref.call.costUsd, file: 'audio/new/b1-s05.wav' } };
  },
  async P8() {
    const text = segText('b1-s05');
    const results = {};
    for (const f of ['mp3', 'wav', 'opus', 'aac', 'flac', 'pcm16']) results[f] = await runTts('P8', `P8-b1-s05-${f}`, text, { format: f });
    // Local transcodes of the P3 PCM (free): what a compressed store would cost in bytes/s.
    const src = path.join(SPIKE, 'P3-b1-s05-zephyr.wav');
    const transcodes = {};
    if (fs.existsSync(src)) {
      const variants = { 'opus-24k': ['-c:a', 'libopus', '-b:a', '24k', 'ogg'], 'opus-32k': ['-c:a', 'libopus', '-b:a', '32k', 'ogg'], 'opus-48k': ['-c:a', 'libopus', '-b:a', '48k', 'ogg'], 'mp3-48k': ['-c:a', 'libmp3lame', '-b:a', '48k', 'mp3'], 'mp3-64k': ['-c:a', 'libmp3lame', '-b:a', '64k', 'mp3'], 'aac-48k': ['-c:a', 'aac', '-b:a', '48k', 'm4a'] };
      for (const [k, v] of Object.entries(variants)) {
        const dst = path.join(SPIKE, `P8-transcode-${k}.${v[4]}`);
        const t0 = Date.now();
        try {
          execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', src, v[0], v[1], v[2], v[3], dst]);
          const info = ffprobe(dst);
          const bytes = fs.statSync(dst).size;
          transcodes[k] = { file: path.relative(OUT, dst).replace(/\\/g, '/'), bytes, duration: info.duration, bytesPerSec: Math.round(bytes / info.duration), encodeMs: Date.now() - t0, gbPer300PageBook: +(bytes / info.duration * 36400 / 1e9).toFixed(3) };
        } catch (e) { transcodes[k] = { error: String(e.message).slice(0, 200) }; }
      }
      const wavBytes = fs.statSync(src).size;
      const d = ffprobe(src).duration;
      transcodes.wav = { bytes: wavBytes, duration: d, bytesPerSec: Math.round(wavBytes / d), gbPer300PageBook: +(wavBytes / d * 36400 / 1e9).toFixed(3) };
    }
    return { results, transcodes };
  },
  async P4() {
    let buildPrompt;
    try { buildPrompt = require(path.join(BACKEND, 'src/services/voicePersonaService')).buildPrompt; } catch (e) { throw new Error('cannot load voicePersonaService: ' + e.message); }
    const persona = { pace: 'slow', tone: 'dramatic', emotion: 'enthusiastic', speaking_style: 'storytelling' };
    const style = buildPrompt.call({}, persona);
    const text = segText('b1-s05');
    const instr = await runTts('P4', 'P4-b1-s05-dramatic-instructions', text, { instructions: style });
    const short = await runTts('P4', 'P4-b1-s05-dramatic-short-instructions', text, { instructions: 'Read slowly and dramatically, like an enthusiastic storyteller, with long pauses.' });
    const prefixed = await runTts('P4', 'P4-b1-s05-dramatic-prefix-in-input', `Read slowly and dramatically, like an enthusiastic storyteller: ${text}`, {});
    return { persona, styleInstruction: style, instr, short, prefixed };
  },
  async P5() {
    const s03 = segText('b1-s03');
    const all = bakeSegments().filter(s => s.id.startsWith('b1-')).map(s => s.text).join('\n\n');
    const cutAt = (n) => { const t = [...all].slice(0, n).join(''); const i = Math.max(t.lastIndexOf('.'), t.lastIndexOf('،'), t.lastIndexOf(' ')); return t.slice(0, i + 1).trim(); };
    const a = await runTts('P5', 'P5-b1-s03-825', s03, {});
    const b = await runTts('P5', 'P5-1500', cutAt(1500), {});
    const c = await runTts('P5', 'P5-3000', cutAt(3000), {});
    const ref = readJson(path.join(OUT, 'data', 'tts', 'b1-s03.json'));
    return { s03: a, long1500: b, long3000: c, b1TotalChars: [...all].length, bakeoffS03: { durationSec: ref.duration, latencyMs: ref.call.latencyMs } };
  },
  async P6() {
    const before = await keyInfo();
    const started = Date.now();
    const ext = [0, 1, 2, 3].map(i => runExtraction('P6', IMAGES[i % 2], { effort: 'low', temperature: 0 }, `parallel${i}`));
    const tts = ['b1-s01', 'b1-s02'].map(id => runTts('P6', `P6-${id}`, segText(id), {}));
    const all = await Promise.allSettled([...ext, ...tts]);
    const wallMs = Date.now() - started;
    const after = await keyInfo();
    return {
      wallMs, keyBefore: before, keyAfter: after,
      results: all.map(x => x.status === 'fulfilled'
        ? { target: x.value.target, tag: x.value.tag, status: x.value.status, latencyMs: x.value.latencyMs, headers: x.value.headers, error: x.value.error, cer: x.value.compare && x.value.compare.cer, audio: x.value.audio && { duration: x.value.audio.duration, file: x.value.audio.file } }
        : { rejected: String(x.reason && x.reason.message) }),
    };
  },
  // PT: speech-to-text check of saved TTS files (was a style prefix spoken aloud? did the 3 000-char call read to the end?).
  async PT() {
    const files = ['P3-b1-s05-zephyr', 'P4-b1-s05-dramatic-instructions', 'P4-b1-s05-dramatic-prefix-in-input', 'P5-3000'];
    const out = {};
    for (const n of files) {
      const src = path.join(SPIKE, `${n}.wav`);
      if (!fs.existsSync(src)) { out[n] = { missing: true }; continue; }
      const mp3 = path.join(DATA, `${n}-stt.mp3`);
      execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', src, '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '32k', mp3]);
      guardBudget(0.03);
      const body = { model: EXTRACT_MODEL, messages: [{ role: 'user', content: [{ type: 'text', text: 'Transcribe this Arabic audio verbatim. Include any English words exactly as spoken. Output only the transcript.' }, { type: 'input_audio', input_audio: { data: fs.readFileSync(mp3).toString('base64'), format: 'mp3' } }] }], reasoning: { effort: 'low' }, temperature: 0 };
      const r = await chat(body);
      record('PT', r, { kind: 'stt', target: n, model: EXTRACT_MODEL });
      const t = r.json && r.json.choices && r.json.choices[0] && r.json.choices[0].message && r.json.choices[0].message.content;
      out[n] = { status: r.status, error: r.json && r.json.error, usage: r.json && r.json.usage, transcript: t, head: t && t.slice(0, 160), tail: t && t.slice(-160) };
      log(`  PT ${n}: HTTP ${r.status}, head: ${(t || '').slice(0, 80).replace(/\n/g, ' ')}`);
    }
    return out;
  },
  async P7() {
    const prep = readJson(path.join(OUT, 'data', 'prep.json'));
    const b1 = prep.find(b => b.id === '3aaf8d3d-b0cf-40bc-8525-09e37c84ded6');
    const pdfUrl = b1.pdfUrl;
    const q1 = 'ما عنوان الفصل الأول؟';
    const q2 = 'لخّص الفصل الأول في جملتين.';
    const plugins = [{ id: 'file-parser', pdf: { engine: 'native' } }];
    const userTurn1 = { role: 'user', content: [{ type: 'text', text: q1 }, { type: 'file', file: { filename: 'b1.pdf', file_data: pdfUrl } }] };
    guardBudget(0.1);
    const body1 = { model: EXTRACT_MODEL, messages: [userTurn1], plugins, reasoning: { effort: 'low' }, usage: { include: true } };
    const r1 = await chat(body1);
    const m1 = r1.json && r1.json.choices && r1.json.choices[0] && r1.json.choices[0].message;
    const g1 = r1.json && r1.json.id ? await generationStats(r1.json.id) : null;
    record('P7', r1, { kind: 'chat', target: 'turn1', model: EXTRACT_MODEL, generation: g1 });
    log(`  P7 turn1: HTTP ${r1.status}, ${r1.latencyMs} ms, cost $${((r1.json && r1.json.usage && r1.json.usage.cost) || 0).toFixed(5)}`);
    const turn1 = { request: redact(body1), status: r1.status, latencyMs: r1.latencyMs, error: r1.json && r1.json.error, messageKeys: m1 ? Object.keys(m1) : null, answer: m1 && m1.content, annotationsShape: m1 && m1.annotations ? m1.annotations.map(a => ({ type: a.type, keys: Object.keys(a), fileKeys: a.file ? Object.keys(a.file) : null, contentParts: a.file && a.file.content ? a.file.content.length : null })) : null, usage: r1.json && r1.json.usage, generation: g1 };
    if (!m1) return { pdfPages: 27, turn1 };
    // Turn 2a: resend the file + the returned annotations (documented reuse path).
    const assistant = { role: 'assistant', content: m1.content, ...(m1.annotations ? { annotations: m1.annotations } : {}) };
    const msgs2 = [userTurn1, assistant, { role: 'user', content: q2 }];
    guardBudget(0.1);
    const body2 = { model: EXTRACT_MODEL, messages: msgs2, plugins, reasoning: { effort: 'low' }, usage: { include: true } };
    const r2 = await chat(body2);
    const m2 = r2.json && r2.json.choices && r2.json.choices[0] && r2.json.choices[0].message;
    const g2 = r2.json && r2.json.id ? await generationStats(r2.json.id) : null;
    record('P7', r2, { kind: 'chat', target: 'turn2-annotations', model: EXTRACT_MODEL, generation: g2 });
    log(`  P7 turn2 (annotations): HTTP ${r2.status}, ${r2.latencyMs} ms, cost $${((r2.json && r2.json.usage && r2.json.usage.cost) || 0).toFixed(5)}`);
    // Turn 2b: same, without annotations (control).
    const msgs3 = [userTurn1, { role: 'assistant', content: m1.content }, { role: 'user', content: q2 }];
    guardBudget(0.1);
    const body3 = { model: EXTRACT_MODEL, messages: msgs3, plugins, reasoning: { effort: 'low' }, usage: { include: true } };
    const r3 = await chat(body3);
    const m3 = r3.json && r3.json.choices && r3.json.choices[0] && r3.json.choices[0].message;
    const g3 = r3.json && r3.json.id ? await generationStats(r3.json.id) : null;
    record('P7', r3, { kind: 'chat', target: 'turn2-no-annotations', model: EXTRACT_MODEL, generation: g3 });
    log(`  P7 turn2 (no annotations): HTTP ${r3.status}, ${r3.latencyMs} ms, cost $${((r3.json && r3.json.usage && r3.json.usage.cost) || 0).toFixed(5)}`);
    return {
      pdfPages: 27, pdfBytes: fs.statSync(path.join(OUT, 'pdf', 'b1.pdf')).size, turn1,
      turn2WithAnnotations: { request: redact(body2), status: r2.status, latencyMs: r2.latencyMs, error: r2.json && r2.json.error, answer: m2 && m2.content, usage: r2.json && r2.json.usage, generation: g2 },
      turn2WithoutAnnotations: { request: redact(body3), status: r3.status, latencyMs: r3.latencyMs, error: r3.json && r3.json.error, answer: m3 && m3.content, usage: r3.json && r3.json.usage, generation: g3 },
    };
  },
};

async function main() {
  fs.mkdirSync(DATA, { recursive: true });
  const keyBefore = await keyInfo();
  log('key before:', JSON.stringify(keyBefore));
  const results = {};
  const order = ['P1', 'P2', 'P3', 'P8', 'P4', 'P5', 'P6', 'P7', 'PT'];
  for (const p of order) {
    if (ONLY.length && !ONLY.includes(p)) continue;
    const cache = path.join(DATA, `${p}.json`);
    if (fs.existsSync(cache) && !FORCE) {
      const c = readJson(cache);
      results[p] = c.result; c.calls.forEach(x => calls.push(x));
      log(`${p}: cached ($${c.calls.reduce((s, x) => s + (x.cost || 0), 0).toFixed(5)})`);
      continue;
    }
    log(`${p}: running`);
    const n0 = calls.length;
    try {
      results[p] = await PROBES[p]();
    } catch (e) {
      results[p] = { fatal: String(e.message) };
      log(`${p} FAILED: ${e.message}`);
      if (/Budget guard/.test(e.message)) { writeJson(cache, { result: results[p], calls: calls.slice(n0) }); break; }
    }
    writeJson(cache, { result: results[p], calls: calls.slice(n0) });
    log(`${p}: done, spent so far $${spent().toFixed(5)}`);
  }
  const keyAfter = await keyInfo();
  log('key after:', JSON.stringify(keyAfter));
  const pct = (arr, q) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
  const lat = (f) => { const a = calls.filter(f).map(c => c.latencyMs).filter(Boolean); return { n: a.length, p50: pct(a, 0.5), max: a.length ? Math.max(...a) : null }; };
  const summary = {
    generatedAt: new Date().toISOString(),
    spendFromUsageUsd: +spent().toFixed(6),
    keyBefore, keyAfter,
    keyUsageDeltaUsd: (typeof keyBefore.usage === 'number' && typeof keyAfter.usage === 'number') ? +(keyAfter.usage - keyBefore.usage).toFixed(6) : null,
    latency: {
      extractRealtime: lat(c => c.kind === 'extract' && c.model === EXTRACT_MODEL && c.status === 200),
      extractBatch: lat(c => c.kind === 'extract' && c.model === BATCH_MODEL && c.status === 200),
      tts: lat(c => c.kind === 'tts' && c.status === 200 && c.cost > 0),
    },
    calls: calls.map(c => ({ probe: c.probe, target: c.target, tag: c.tag, model: c.model, status: c.status, latencyMs: c.latencyMs, cost: c.cost })),
  };
  writeJson(path.join(SPIKE, 'results.json'), { summary, results });
  log(`Total spend (usage.cost): $${summary.spendFromUsageUsd}; key usage delta: ${summary.keyUsageDeltaUsd}`);
  log('Latency', JSON.stringify(summary.latency));
}

main().catch(e => { console.error('FATAL', e.message); console.error('Spent before stop: $' + spent().toFixed(5)); process.exit(1); });
