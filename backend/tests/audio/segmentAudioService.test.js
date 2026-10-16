jest.mock('../../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../../src/services/supabaseService', () => require('../helpers/fakeSupabase')());
jest.mock('../../src/services/llm', () => ({ ttsModel: jest.fn(() => 'test/tts'), synthesize: jest.fn() }));
jest.mock('../../src/services/audio/transcode', () => ({ pcmToOggOpus: jest.fn() }));

const crypto = require('crypto');
const db = require('../../src/services/supabaseService');
const llm = require('../../src/services/llm');
const transcode = require('../../src/services/audio/transcode');
const voicePersonaService = require('../../src/services/voicePersonaService');
const service = require('../../src/services/audio/segmentAudioService');
const { wavInfo } = require('../../src/services/llm/audio');

const sha = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const PERSONA = { id: '11111111-1111-4111-8111-111111111111', user_id: 'user-1', base_voice_name: 'Zephyr', pace: 'slow', tone: 'dramatic', emotion: 'calm', speaking_style: 'storytelling', updated_at: '2026-10-16T10:00:00Z', is_active: true };

function pcmAudio(seconds) {
  return { pcm: Buffer.alloc(Math.round(seconds * 48000)), sampleRate: 24000, channels: 1, bitsPerSample: 16, generationId: 'gen-1', usage: { provider: 'openrouter', model: 'test/tts', costUsd: seconds * 0.000225 } };
}

function segment(text, overrides = {}) {
  return db.addSegment({ extraction_id: 'ext-1', seq: 1, role: 'body', start_page: 1, end_page: 1, parts: [{ page: 1, chars: text.length }], text, text_sha256: sha(text), char_count: text.length, ...overrides });
}

const PLAIN = service.voiceSnapshot({ model: 'test/tts', baseVoice: 'Sadaltager', instructions: null });
const VOICE = { snapshot: PLAIN, hash: service.snapshotHash(PLAIN) };
const OWNER = { bookId: 'book-1', userId: 'user-1', extractionId: 'ext-1' };

beforeEach(() => {
  jest.clearAllMocks();
  db.reset();
  llm.ttsModel.mockReturnValue('test/tts');
  jest.spyOn(voicePersonaService, 'getAccessiblePersona').mockResolvedValue(null);
});

describe('voice snapshot identity', () => {
  it('hashes canonical JSON: key order and a missing instructions key do not change it', () => {
    const a = service.snapshotHash({ model: 'm', base_voice: 'Zephyr', instructions: null });
    const b = service.snapshotHash({ instructions: null, base_voice: 'Zephyr', model: 'm' });
    const c = service.snapshotHash({ base_voice: 'Zephyr', model: 'm' });
    expect(a).toBe(b);
    expect(a).toBe(c);
    expect(a).toBe(sha('{"base_voice":"Zephyr","instructions":null,"model":"m"}'));
  });

  it('changes with the model, the base voice and the instructions', () => {
    const base = { model: 'm', base_voice: 'Zephyr', instructions: null };
    const hashes = new Set([
      service.snapshotHash(base),
      service.snapshotHash({ ...base, model: 'm2' }),
      service.snapshotHash({ ...base, base_voice: 'Puck' }),
      service.snapshotHash({ ...base, instructions: 'Read slowly.' }),
    ]);
    expect(hashes.size).toBe(4);
  });

  it('canonicalJson sorts nested keys', () => {
    expect(service.canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: 'x' } })).toBe('{"a":{"c":"x","d":[2,{"y":2,"z":1}]},"b":1}');
  });

  it('resolves a persona to its base voice and buildPrompt instructions', async () => {
    voicePersonaService.getAccessiblePersona.mockResolvedValue(PERSONA);

    const voice = await service.resolveListenerVoice('user-1', { voicePersonaId: PERSONA.id });

    expect(voice.snapshot).toEqual({ model: 'test/tts', base_voice: 'Zephyr', instructions: voicePersonaService.buildPrompt(PERSONA) });
    expect(voice.hash).toBe(service.snapshotHash(voice.snapshot));
  });

  it('a persona edit that changes the style is a new hash; one that does not keeps the clips', async () => {
    voicePersonaService.getAccessiblePersona.mockResolvedValue(PERSONA);
    const before = await service.resolveListenerVoice('user-1', { voicePersonaId: PERSONA.id });

    voicePersonaService.getAccessiblePersona.mockResolvedValue({ ...PERSONA, tone: 'warm', updated_at: '2026-10-16T11:00:00Z' });
    const restyled = await service.resolveListenerVoice('user-1', { voicePersonaId: PERSONA.id });

    voicePersonaService.getAccessiblePersona.mockResolvedValue({ ...PERSONA, name: 'Renamed', updated_at: '2026-10-16T12:00:00Z' });
    const renamed = await service.resolveListenerVoice('user-1', { voicePersonaId: PERSONA.id });

    expect(restyled.hash).not.toBe(before.hash);
    expect(renamed.hash).toBe(before.hash);
  });

  it('falls back to the base voice (no instructions) when the persona is not accessible', async () => {
    const voice = await service.resolveListenerVoice('user-1', { voicePersonaId: PERSONA.id, voicePersona: 'Puck' });
    expect(voice.snapshot).toEqual({ model: 'test/tts', base_voice: 'Puck', instructions: null });
    expect((await service.resolveListenerVoice('user-1', {})).snapshot.base_voice).toBe('Sadaltager');
  });
});

describe('ensureClips', () => {
  it('inserts one pending row and one base-key job per missing clip, with the listener distance as priority', async () => {
    const s1 = segment('first paragraph');
    const s2 = segment('second paragraph', { seq: 2 });

    await service.ensureClips([{ segment: s1, priority: 0 }, { segment: s2, priority: 12.4 }], VOICE, OWNER);

    expect(db.state.segmentAudio).toHaveLength(2);
    expect(db.audioRow(s1.text_sha256, VOICE.hash)).toMatchObject({ status: 'pending', voice_snapshot: PLAIN });
    expect(db.state.jobs.map((j) => [j.idempotency_key, j.priority, j.kind])).toEqual([
      [`tts:${VOICE.hash}:${s1.text_sha256}`, 0, 'tts_segment'],
      [`tts:${VOICE.hash}:${s2.text_sha256}`, 12, 'tts_segment'],
    ]);
    expect(db.state.jobs[0].payload).toEqual({ segmentId: s1.id, textSha256: s1.text_sha256, voiceHash: VOICE.hash, voiceSnapshot: PLAIN });
    expect(db.state.jobs[0]).toMatchObject({ book_id: 'book-1', user_id: 'user-1', extraction_id: 'ext-1' });
  });

  it('two listeners at once produce one row and one job for the same identity', async () => {
    const s1 = segment('shared paragraph');
    // The same paragraph in another book's extraction: same text hash
    const other = segment('shared paragraph', { extraction_id: 'ext-2' });

    await Promise.all([
      service.ensureClips([{ segment: s1, priority: 0 }], VOICE, OWNER),
      service.ensureClips([{ segment: other, priority: 0 }], VOICE, { bookId: 'book-2', userId: 'user-2' }),
    ]);

    expect(db.state.segmentAudio).toHaveLength(1);
    expect(db.state.jobs).toHaveLength(1);
  });

  it('enqueues nothing for a ready clip and nothing again while a job is active', async () => {
    const ready = segment('ready one');
    const queued = segment('queued one', { seq: 2 });
    db.state.segmentAudio.push({ text_sha256: ready.text_sha256, voice_snapshot_sha256: VOICE.hash, status: 'ready', audio_url: 'u', duration_seconds: 3 });
    await service.ensureClips([{ segment: queued, priority: 0 }], VOICE, OWNER);
    db.enqueueJobs.mockClear();

    await service.ensureClips([{ segment: ready, priority: 0 }, { segment: queued, priority: 0 }], VOICE, OWNER);

    expect(db.state.jobs).toHaveLength(1);
    const enqueued = db.enqueueJobs.mock.calls.flatMap((call) => call[0]);
    expect(enqueued).toHaveLength(0);
  });

  it('retries a failed clip under the next round key and sets the row back to pending', async () => {
    const s1 = segment('failed once');
    const base = `tts:${VOICE.hash}:${s1.text_sha256}`;
    db.state.segmentAudio.push({ text_sha256: s1.text_sha256, voice_snapshot_sha256: VOICE.hash, status: 'failed', error: 'boom' });
    db.state.jobs.push({ id: 'j1', idempotency_key: base, status: 'failed' }, { id: 'j2', idempotency_key: `${base}:retry1`, status: 'failed' });

    await service.ensureClips([{ segment: s1, priority: 5 }], VOICE, OWNER);
    await service.ensureClips([{ segment: s1, priority: 5 }], VOICE, OWNER); // the retry is active now: no round 3

    expect(db.state.jobs.map((j) => j.idempotency_key)).toEqual([base, `${base}:retry1`, `${base}:retry2`]);
    expect(db.audioRow(s1.text_sha256, VOICE.hash)).toMatchObject({ status: 'pending', error: null });
  });

  it('re-queues a row stuck in pending whose job has ended', async () => {
    const s1 = segment('stuck');
    const base = `tts:${VOICE.hash}:${s1.text_sha256}`;
    db.state.segmentAudio.push({ text_sha256: s1.text_sha256, voice_snapshot_sha256: VOICE.hash, status: 'pending' });
    db.state.jobs.push({ id: 'j1', idempotency_key: base, status: 'done' });

    await service.ensureClips([{ segment: s1, priority: 0 }], VOICE, OWNER);

    expect(db.state.jobs.map((j) => j.idempotency_key)).toEqual([base, `${base}:retry1`]);
  });

  it('refuses an open segment', async () => {
    const open = segment('still growing', { status: 'open' });
    await expect(service.ensureClips([{ segment: open, priority: 0 }], VOICE, OWNER)).rejects.toThrow(/open/);
    expect(db.state.jobs).toHaveLength(0);
  });
});

describe('generate', () => {
  it('synthesises with the snapshot, stores WAV under the content path and marks the row ready', async () => {
    const s1 = segment('a paragraph to read');
    voicePersonaService.getAccessiblePersona.mockResolvedValue(PERSONA);
    const voice = await service.resolveListenerVoice('user-1', { voicePersonaId: PERSONA.id });
    llm.synthesize.mockResolvedValue(pcmAudio(12.345));

    const { generated, row } = await service.generate({ segmentId: s1.id, textSha256: s1.text_sha256, voiceHash: voice.hash, voiceSnapshot: voice.snapshot });

    expect(generated).toBe(true);
    expect(llm.synthesize).toHaveBeenCalledWith({ text: 'a paragraph to read', baseVoice: 'Zephyr', styleInstruction: voicePersonaService.buildPrompt(PERSONA) });
    const path = `segment-audio/${voice.hash}/${s1.text_sha256}.wav`;
    expect(db.uploadFile).toHaveBeenCalledWith('readai-media', path, expect.any(Buffer), { contentType: 'audio/wav', upsert: true });
    const wav = db.state.files.get(path);
    expect(wavInfo(wav).seconds).toBeCloseTo(12.345, 3);
    expect(row).toMatchObject({
      status: 'ready',
      audio_url: `https://public.test/readai-media/${path}`,
      audio_format: 'wav',
      sample_rate: 24000,
      channels: 1,
      duration_seconds: 12.35,
      size_bytes: wav.length,
      cost_micros: Math.round(12.345 * 0.000225 * 1e6),
    });
    expect(row.usage).toMatchObject({ generationId: 'gen-1', audioSeconds: 12.345, model: 'test/tts' });
    expect(row.ready_at).toEqual(expect.any(String));
  });

  it('makes no provider call when the clip is ready (replayed job, second identical job)', async () => {
    const s1 = segment('only once');
    const payload = { segmentId: s1.id, textSha256: s1.text_sha256, voiceHash: VOICE.hash, voiceSnapshot: PLAIN };
    llm.synthesize.mockResolvedValue(pcmAudio(2));

    await service.generate(payload);
    const again = await service.generate(payload);

    expect(again.generated).toBe(false);
    expect(llm.synthesize).toHaveBeenCalledTimes(1);
    expect(db.state.segmentAudio).toHaveLength(1);
  });

  it('refuses work that does not match its identity, without retries', async () => {
    const s1 = segment('the text');
    const ok = { segmentId: s1.id, textSha256: s1.text_sha256, voiceHash: VOICE.hash, voiceSnapshot: PLAIN };

    await expect(service.generate({ ...ok, voiceHash: 'f'.repeat(64) })).rejects.toMatchObject({ nonRetriable: true });
    await expect(service.generate({ ...ok, textSha256: sha('other text') })).rejects.toMatchObject({ nonRetriable: true });
    llm.ttsModel.mockReturnValue('test/tts-v2');
    await expect(service.generate(ok)).rejects.toMatchObject({ nonRetriable: true, message: expect.stringMatching(/model/) });
    expect(llm.synthesize).not.toHaveBeenCalled();
  });

  it('stores Ogg Opus when configured, keeping the PCM duration', async () => {
    const config = require('../../src/config');
    const s1 = segment('compressed');
    llm.synthesize.mockResolvedValue(pcmAudio(4));
    transcode.pcmToOggOpus.mockResolvedValue(Buffer.from('OggS-fake'));
    config.audio.format = 'opus';
    try {
      const { row } = await service.generate({ segmentId: s1.id, textSha256: s1.text_sha256, voiceHash: VOICE.hash, voiceSnapshot: PLAIN });
      expect(transcode.pcmToOggOpus).toHaveBeenCalledWith(expect.objectContaining({ sampleRate: 24000 }), { bitrateKbps: 32 });
      expect(db.uploadFile).toHaveBeenCalledWith('readai-media', `segment-audio/${VOICE.hash}/${s1.text_sha256}.ogg`, Buffer.from('OggS-fake'), { contentType: 'audio/ogg', upsert: true });
      expect(row).toMatchObject({ audio_format: 'opus', duration_seconds: 4, size_bytes: 9 });
    } finally {
      config.audio.format = 'wav';
    }
  });

  it('falls back to WAV when ffmpeg is missing', async () => {
    transcode.pcmToOggOpus.mockRejectedValue(Object.assign(new Error('spawn ffmpeg ENOENT'), { code: 'ENOENT' }));
    const out = await service.encode(pcmAudio(1), 'opus');
    expect(out.format).toBe('wav');
    expect(wavInfo(out.buffer).seconds).toBeCloseTo(1, 5);
  });

  it('markFailed records the error but never touches a ready clip', async () => {
    const a = segment('will fail');
    const b = segment('already ready', { seq: 2 });
    db.state.segmentAudio.push(
      { text_sha256: a.text_sha256, voice_snapshot_sha256: VOICE.hash, status: 'pending' },
      { text_sha256: b.text_sha256, voice_snapshot_sha256: VOICE.hash, status: 'ready', audio_url: 'u' },
    );

    await service.markFailed({ textSha256: a.text_sha256, voiceHash: VOICE.hash }, new Error('provider said no'));
    await service.markFailed({ textSha256: b.text_sha256, voiceHash: VOICE.hash }, new Error('late failure'));

    expect(db.audioRow(a.text_sha256, VOICE.hash)).toMatchObject({ status: 'failed', error: 'provider said no' });
    expect(db.audioRow(b.text_sha256, VOICE.hash)).toMatchObject({ status: 'ready' });
  });
});
