jest.mock('../../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../../src/services/supabaseService', () => require('../helpers/fakeSupabase')());
jest.mock('../../src/middleware/authMiddleware', () => ({
  authenticateUser: (req, res, next) => {
    req.user = { id: req.headers['x-test-user'] || 'user-1' };
    next();
  },
}));
jest.mock('../../src/services/llm', () => ({ extractionModel: () => 'test/model', ttsModel: () => 'test/tts', synthesize: jest.fn() }));
jest.mock('../../src/services/jobs/jobRunner', () => ({ wake: jest.fn() }));

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const db = require('../../src/services/supabaseService');
const jobRunner = require('../../src/services/jobs/jobRunner');
const voicePersonaService = require('../../src/services/voicePersonaService');
const segmentAudio = require('../../src/services/audio/segmentAudioService');

const app = express();
app.use(express.json());
app.use('/api/books', require('../../src/routes/segmentsRoutes'));
app.use('/api/segments', require('../../src/routes/segmentAudioRoutes'));
app.use('/api/plan', require('../../src/routes/planRoutes'));

const sha = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const BOOK = 'b0000000-0000-4000-8000-000000000001';
const PERSONA = { id: '11111111-1111-4111-8111-111111111111', user_id: 'user-1', base_voice_name: 'Zephyr', tone: 'dramatic', updated_at: '2026-10-16T10:00:00Z' };
const segId = (n) => `5e000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let extraction;

function addSegments() {
  for (let seq = 1; seq <= 6; seq++) {
    const text = `paragraph ${seq}`;
    db.addSegment({ id: segId(seq), extraction_id: extraction.id, seq, role: 'body', start_page: seq, end_page: seq, parts: [{ page: seq, chars: text.length }], text, text_sha256: sha(text), char_count: 300 });
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  db.reset();
  jest.spyOn(voicePersonaService, 'getAccessiblePersona').mockImplementation(async (id, userId) => (id === PERSONA.id && userId === 'user-1' ? PERSONA : null));
  db.addBook({ id: BOOK, user_id: 'user-1', content_sha256: 'sha-1' });
  extraction = { id: 'ext-1', content_sha256: 'sha-1', status: 'complete', pages_total: 6, finalized_through_page: 6, prompt_version: 2, model: 'test/model' };
  db.state.extractions.set(extraction.id, extraction);
  addSegments();
});

describe('POST /api/books/:bookId/listen', () => {
  it('plans the window, returns statuses without URLs and wakes the runner', async () => {
    const res = await request(app).post(`/api/books/${BOOK}/listen`).send({ fromSeq: 1, voicePersonaId: PERSONA.id });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ plan: 'free', limit: 2, usedToday: 0, remainingToday: 2, stopReason: 'allowance', skippedSeqs: [] });
    expect(res.body.items).toEqual([
      { segmentId: segId(1), seq: 1, status: 'pending' },
      { segmentId: segId(2), seq: 2, status: 'pending' },
    ]);
    const voice = await segmentAudio.resolveListenerVoice('user-1', { voicePersonaId: PERSONA.id });
    expect(res.body.voiceKey).toBe(voice.hash);
    expect(db.state.jobs[0].payload.voiceSnapshot).toEqual({ model: 'test/tts', base_voice: 'Zephyr', instructions: voicePersonaService.buildPrompt(PERSONA) });
    expect(jobRunner.wake).toHaveBeenCalled();
  });

  it('a different voice is a different identity: new rows and jobs', async () => {
    await request(app).post(`/api/books/${BOOK}/listen`).send({ fromSeq: 1 });
    await request(app).post(`/api/books/${BOOK}/listen`).send({ fromSeq: 1, voicePersonaId: PERSONA.id });

    expect(db.state.segmentAudio).toHaveLength(4);
    expect(new Set(db.state.segmentAudio.map((r) => r.voice_snapshot_sha256)).size).toBe(2);
    expect(db.state.jobs).toHaveLength(4);
  });

  it('refuses a user without access, a Read-mode book and a book with no extraction', async () => {
    expect((await request(app).post(`/api/books/${BOOK}/listen`).set('x-test-user', 'stranger').send({})).status).toBe(403);

    db.state.books.get(BOOK).mode = 'read';
    const read = await request(app).post(`/api/books/${BOOK}/listen`).send({});
    expect(read.status).toBe(409);
    expect(read.body.error).toBe('BOOK_NOT_IN_LISTEN_MODE');

    db.state.books.get(BOOK).mode = 'listen';
    db.state.books.get(BOOK).content_sha256 = 'sha-unprocessed';
    const none = await request(app).post(`/api/books/${BOOK}/listen`).send({});
    expect(none.status).toBe(409);
    expect(none.body.error).toBe('BOOK_NOT_PROCESSED');
    expect(db.state.jobs).toHaveLength(0);
  });
});

describe('GET /api/segments/:segmentId/audio', () => {
  function makeReady(voiceHash) {
    for (const s of db.state.segments) {
      db.state.segmentAudio.push({ text_sha256: s.text_sha256, voice_snapshot_sha256: voiceHash, status: 'ready', audio_url: `https://cdn.test/${s.seq}.wav`, audio_format: 'wav', duration_seconds: '29.97' });
    }
  }
  const plainHash = async () => (await segmentAudio.resolveListenerVoice('user-1', {})).hash;

  it('hands out the URL and counts the page; a third new page is 402 with no URL', async () => {
    makeReady(await plainHash());

    const one = await request(app).get(`/api/segments/${segId(1)}/audio`);
    expect(one.status).toBe(200);
    expect(one.body).toMatchObject({ status: 'ready', audioUrl: 'https://cdn.test/1.wav', durationSeconds: 29.97, cached: true, usedToday: 1, limit: 2 });

    expect((await request(app).get(`/api/segments/${segId(1)}/audio`)).body.usedToday).toBe(1);
    expect((await request(app).get(`/api/segments/${segId(2)}/audio`)).body.usedToday).toBe(2);

    const third = await request(app).get(`/api/segments/${segId(3)}/audio`);
    expect(third.status).toBe(402);
    expect(third.body).toEqual({ error: 'DAILY_LIMIT_REACHED', message: expect.any(String), used: 2, limit: 2, plan: 'free' });
    expect(db.state.dailyUsage.map((u) => [u.book_id, u.page_number])).toEqual([[BOOK, 1], [BOOK, 2]]);

    const plan = await request(app).get('/api/plan');
    expect(plan.body).toEqual({ plan: 'free', name: 'Free', limit: 2, usedToday: 2, remainingToday: 0 });
  });

  it('looks the clip up in the requested voice', async () => {
    makeReady(await plainHash());
    const res = await request(app).get(`/api/segments/${segId(1)}/audio`).query({ voicePersonaId: PERSONA.id });
    expect(res.body).toMatchObject({ status: 'missing', cached: false });
    expect(db.state.dailyUsage).toHaveLength(0);
  });

  it('counts against the listener\'s library copy of the same PDF', async () => {
    makeReady(await plainHash());
    const COPY = 'b0000000-0000-4000-8000-000000000002';
    db.addBook({ id: COPY, user_id: 'someone-else', content_sha256: 'sha-1' });
    db.state.userBooks.push({ user_id: 'user-2', book_id: COPY });

    const res = await request(app).get(`/api/segments/${segId(1)}/audio`).set('x-test-user', 'user-2');

    expect(res.status).toBe(200);
    expect(db.state.dailyUsage).toEqual([expect.objectContaining({ user_id: 'user-2', book_id: COPY, page_number: 1 })]);
  });

  it('404 for an unknown or malformed id, 403 without a book of that content, 409 in Read mode', async () => {
    expect((await request(app).get('/api/segments/not-a-uuid/audio')).status).toBe(404);
    expect((await request(app).get(`/api/segments/${segId(99)}/audio`)).status).toBe(404);
    expect((await request(app).get(`/api/segments/${segId(1)}/audio`).set('x-test-user', 'stranger')).status).toBe(403);
    const otherBook = 'b0000000-0000-4000-8000-000000000003';
    db.addBook({ id: otherBook, user_id: 'user-1', content_sha256: 'sha-other' });
    expect((await request(app).get(`/api/segments/${segId(1)}/audio`).query({ bookId: otherBook })).status).toBe(403);

    db.state.books.get(BOOK).mode = 'read';
    const read = await request(app).get(`/api/segments/${segId(1)}/audio`);
    expect(read.status).toBe(409);
    expect(db.state.dailyUsage).toHaveLength(0);
  });
});

describe('GET /api/plan', () => {
  it('reads the plan without counting anything', async () => {
    db.subscribe('user-1', 'basic');
    const res = await request(app).get('/api/plan');
    expect(res.body).toEqual({ plan: 'basic', name: 'Basic', limit: 10, usedToday: 0, remainingToday: 10 });
    expect(db.recordPageListen).not.toHaveBeenCalled();
  });
});
