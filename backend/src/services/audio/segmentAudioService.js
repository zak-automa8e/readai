const crypto = require('crypto');
const config = require('../../config');
const logger = require('../../utils/logger');
const supabaseService = require('../supabaseService');
const llm = require('../llm');
const { pcmToWav } = require('../llm/audio');
const pageCacheService = require('../pageCacheService');
const voicePersonaService = require('../voicePersonaService');
const { pcmToOggOpus } = require('./transcode');

/**
 * Content-addressed clip cache (spec §3, O12). A clip is identified by
 *   text_sha256 (segments.text_sha256) × voice_snapshot_sha256
 * where the voice snapshot is canonical JSON {model, base_voice, instructions}: exactly what is sent
 * to the TTS model. Every listener and every book containing the same paragraph shares the clip; a
 * persona edit that changes its instructions is a new snapshot, so a new generation.
 *
 * One segment_audio row per identity; one active tts_segment job per identity at a time.
 * Job idempotency keys:
 *   tts:<voice hash>:<text hash>              the first generation
 *   tts:<voice hash>:<text hash>:retry<n>     round n, after the previous job ended without a ready clip
 */

const ACTIVE_JOB = new Set(['queued', 'running']);
const MAX_PRIORITY = 499; // chapter-ahead jobs (story 6) run at 500, behind every live window

const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

// ---------------------------------------------------------------- voice identity

/**
 * Canonical JSON: keys sorted at every level, no whitespace.
 * @param {*} value
 * @returns {string}
 */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

/**
 * @param {{model: string, baseVoice: string, instructions: string|null}} voice
 * @returns {{model: string, base_voice: string, instructions: string|null}}
 */
function voiceSnapshot({ model, baseVoice, instructions }) {
  return { model, base_voice: baseVoice, instructions: instructions || null };
}

function snapshotHash(snapshot) {
  return sha256(canonicalJson({
    model: snapshot.model,
    base_voice: snapshot.base_voice,
    instructions: snapshot.instructions ?? null,
  }));
}

/**
 * The listener's voice as a snapshot and its hash. A persona the user cannot use falls back to
 * the base voice (pageCacheService.resolveVoice rules, same as the legacy page audio).
 * @param {string} userId
 * @param {{voicePersonaId?: string|null, voicePersona?: string|null}} request
 */
async function resolveListenerVoice(userId, { voicePersonaId = null, voicePersona = null } = {}) {
  const { persona, baseVoiceName } = await pageCacheService.resolveVoice(voicePersonaId, voicePersona, userId);
  const snapshot = voiceSnapshot({
    model: llm.ttsModel(),
    baseVoice: baseVoiceName,
    instructions: persona ? voicePersonaService.buildPrompt(persona) : null,
  });
  return { snapshot, hash: snapshotHash(snapshot), persona };
}

// ---------------------------------------------------------------- cache rows and jobs

function baseJobKey(voiceHash, textHash) {
  return `tts:${voiceHash}:${textHash}`;
}

function retryRound(key) {
  const match = /:retry(\d+)$/.exec(key);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Cache rows for the given texts in one voice: Map text_sha256 → row.
 */
async function lookup(voiceHash, textHashes) {
  if (!textHashes.length) return new Map();
  const rows = await supabaseService.getSegmentAudioRows(voiceHash, textHashes);
  return new Map(rows.map((row) => [row.text_sha256, row]));
}

/**
 * Make sure each item has a ready clip or an active tts_segment job, without ever running two jobs
 * for one identity at once:
 *   - a missing row is inserted as pending (ON CONFLICT DO NOTHING: concurrent listeners make one row);
 *   - a failed row goes back to pending (a later listen retries it);
 *   - the first job uses the base key, so concurrent listeners collapse onto one job;
 *   - when every job of the identity has ended without a ready clip (failed, or the row is stuck
 *     pending), the next retry round is enqueued; concurrent callers compute the same round key.
 * The handler re-checks the row first, so a job that finds the clip ready is a no-op.
 *
 * @param {{segment: Object, priority: number}[]} items segments must be final
 * @param {{snapshot: Object, hash: string}} voice
 * @param {{bookId: string, userId: string|null, extractionId?: string|null}} owner the job's book and user
 * @returns {Promise<Map<string, Object>>} text_sha256 → row as read before any change (null when it was missing)
 */
async function ensureClips(items, voice, { bookId, userId = null, extractionId = null }) {
  const byText = new Map();
  for (const item of items) {
    if (item.segment.status !== 'final') throw new Error(`segment ${item.segment.id} is still open`);
    const known = byText.get(item.segment.text_sha256);
    if (!known || item.priority < known.priority) byText.set(item.segment.text_sha256, item);
  }
  const rows = await lookup(voice.hash, [...byText.keys()]);
  const todo = [...byText.values()].filter((item) => rows.get(item.segment.text_sha256)?.status !== 'ready');
  if (!todo.length) return rows;

  const missing = todo.filter((item) => !rows.has(item.segment.text_sha256));
  await supabaseService.insertSegmentAudioPending(missing.map((item) => ({
    text_sha256: item.segment.text_sha256,
    voice_snapshot_sha256: voice.hash,
    voice_snapshot: voice.snapshot,
  })));
  for (const item of todo.filter((i) => rows.get(i.segment.text_sha256)?.status === 'failed')) {
    // Before the job is enqueued: if the new job fails again it sets 'failed' after this
    await supabaseService.updateSegmentAudio(item.segment.text_sha256, voice.hash, { status: 'pending', error: null }, { onlyStatus: 'failed' });
  }

  const job = (item, key) => ({
    kind: 'tts_segment',
    book_id: bookId,
    user_id: userId,
    extraction_id: extractionId,
    payload: {
      segmentId: item.segment.id,
      textSha256: item.segment.text_sha256,
      voiceHash: voice.hash,
      voiceSnapshot: voice.snapshot,
    },
    idempotency_key: key,
    priority: Math.min(Math.max(Math.round(item.priority), 0), MAX_PRIORITY),
  });

  const baseKeys = todo.map((item) => baseJobKey(voice.hash, item.segment.text_sha256));
  const existing = new Map((await supabaseService.getJobsByKeys(baseKeys)).map((j) => [j.idempotency_key, j]));
  const fresh = todo.filter((item) => !existing.has(baseJobKey(voice.hash, item.segment.text_sha256)));
  // Base key taken by a concurrent caller between our read and insert: that job is queued, which is what we want
  await supabaseService.enqueueJobs(fresh.map((item) => job(item, baseJobKey(voice.hash, item.segment.text_sha256))));

  const retries = [];
  for (const item of todo) {
    const base = existing.get(baseJobKey(voice.hash, item.segment.text_sha256));
    if (!base || ACTIVE_JOB.has(base.status)) continue;
    const rounds = await supabaseService.getJobsByKeyPrefix(`${base.idempotency_key}:retry`);
    if (rounds.some((j) => ACTIVE_JOB.has(j.status))) continue;
    const round = Math.max(0, ...rounds.map((j) => retryRound(j.idempotency_key))) + 1;
    retries.push(job(item, `${base.idempotency_key}:retry${round}`));
  }
  if (retries.length) {
    await supabaseService.enqueueJobs(retries);
    logger.info('Segment audio re-queued', { voiceHash: voice.hash, clips: retries.length });
  }
  return rows;
}

// ---------------------------------------------------------------- generation (tts_segment handler)

function storagePath(voiceHash, textHash, format) {
  return `${config.audio.storagePrefix}/${voiceHash}/${textHash}.${format === 'opus' ? 'ogg' : 'wav'}`;
}

let warnedNoFfmpeg = false;

/**
 * Encode PCM in the configured format. Opus needs ffmpeg; without it the clip is stored as WAV.
 * @returns {Promise<{buffer: Buffer, format: 'wav'|'opus', contentType: string}>}
 */
async function encode(audio, format = config.audio.format) {
  if (format === 'opus') {
    try {
      const buffer = await pcmToOggOpus(audio, { bitrateKbps: config.audio.opusBitrateKbps });
      return { buffer, format: 'opus', contentType: 'audio/ogg' };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (!warnedNoFfmpeg) {
        warnedNoFfmpeg = true;
        logger.error('AUDIO_FORMAT=opus but ffmpeg is not installed; storing WAV');
      }
    }
  }
  return { buffer: pcmToWav(audio), format: 'wav', contentType: 'audio/wav' };
}

function pcmSeconds({ pcm, sampleRate, channels, bitsPerSample }) {
  return pcm.length / (sampleRate * channels * bitsPerSample / 8);
}

function nonRetriable(message) {
  const error = new Error(message);
  error.nonRetriable = true;
  return error;
}

/**
 * Generate one clip: the body of a tts_segment job. Inserts the pending row if missing, returns at
 * once when the clip is ready already, else synthesises, encodes, uploads and marks the row ready.
 * @param {{segmentId: string, textSha256: string, voiceHash: string, voiceSnapshot: Object}} payload
 * @returns {Promise<{generated: boolean, row: Object}>}
 */
async function generate({ segmentId, textSha256, voiceHash, voiceSnapshot }) {
  if (!voiceSnapshot || snapshotHash(voiceSnapshot) !== voiceHash) {
    throw nonRetriable('voice snapshot does not match its hash');
  }
  await supabaseService.insertSegmentAudioPending([{ text_sha256: textSha256, voice_snapshot_sha256: voiceHash, voice_snapshot: voiceSnapshot }]);
  const existing = await supabaseService.getSegmentAudio(textSha256, voiceHash);
  if (existing?.status === 'ready') return { generated: false, row: existing };

  const segment = await supabaseService.getSegmentById(segmentId);
  if (!segment) throw nonRetriable(`segment ${segmentId} not found`);
  if (segment.status !== 'final') throw nonRetriable(`segment ${segmentId} is still open`);
  if (segment.text_sha256 !== textSha256 || sha256(segment.text) !== textSha256) {
    throw nonRetriable(`segment ${segmentId} text does not match ${textSha256}`);
  }
  // The clip must be made by the model its identity names
  const model = llm.ttsModel();
  if (voiceSnapshot.model !== model) {
    throw nonRetriable(`TTS model is now ${model}, the job asked for ${voiceSnapshot.model}; listen again to re-plan`);
  }

  const startedAt = Date.now();
  const audio = await llm.synthesize({
    text: segment.text,
    baseVoice: voiceSnapshot.base_voice,
    styleInstruction: voiceSnapshot.instructions,
  });
  // Duration (and the cost) from the PCM, before any transcoding
  const seconds = pcmSeconds(audio);
  const { buffer, format, contentType } = await encode(audio);

  const path = storagePath(voiceHash, textSha256, format);
  await supabaseService.uploadFile(config.audio.storageBucket, path, buffer, { contentType, upsert: true });
  const audioUrl = supabaseService.getFileUrl(config.audio.storageBucket, path);

  const usage = { ...audio.usage, generationId: audio.generationId || null, audioSeconds: Number(seconds.toFixed(3)) };
  const costMicros = typeof usage.costUsd === 'number' ? Math.round(usage.costUsd * 1e6) : null;
  const row = await supabaseService.updateSegmentAudio(textSha256, voiceHash, {
    status: 'ready',
    error: null,
    audio_url: audioUrl,
    audio_format: format,
    sample_rate: audio.sampleRate,
    channels: audio.channels,
    duration_seconds: Number(seconds.toFixed(2)),
    size_bytes: buffer.length,
    usage,
    cost_micros: costMicros,
    ready_at: new Date().toISOString(),
  });

  logger.info('Segment audio generated', {
    segmentId,
    textSha256,
    voiceHash,
    chars: segment.text.length,
    seconds: Number(seconds.toFixed(2)),
    format,
    bytes: buffer.length,
    costUsd: usage.costUsd,
    ms: Date.now() - startedAt,
  });
  return { generated: true, row };
}

/**
 * Mark a clip failed after its job gave up. A ready clip is never touched.
 */
async function markFailed({ textSha256, voiceHash }, error) {
  if (!textSha256 || !voiceHash) return;
  await supabaseService.updateSegmentAudio(textSha256, voiceHash, {
    status: 'failed',
    error: String(error?.message || error).slice(0, 500),
  }, { unlessStatus: 'ready' });
}

module.exports = {
  canonicalJson,
  voiceSnapshot,
  snapshotHash,
  resolveListenerVoice,
  baseJobKey,
  lookup,
  ensureClips,
  storagePath,
  encode,
  generate,
  markFailed,
};
