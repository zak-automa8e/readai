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
  // The windows below are written for one page ahead
  require('../../src/config').audio.pagesAhead = 1;
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
    expect(res.body).toMatchObject({ plan: 'free', limit: 2, usedToday: 0, remainingToday: 2, stopReason: 'window', skippedSeqs: [] });
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

describe('POST /api/books/:bookId/listen prepares the text ahead (O15)', () => {
  // Pages 1-6 have text (and segments) out of 20
  beforeEach(() => {
    db.addPages(BOOK, 20);
    Object.assign(extraction, { status: 'partial', pages_total: 20, source_book_id: BOOK });
    for (let n = 1; n <= 6; n++) db.landPage(extraction, BOOK, n, { blocks: [], pageType: 'body' });
  });
  const textJobs = () => db.state.jobs.filter((j) => j.kind === 'extract_pages').map((j) => j.payload.pages);

  it('queues text for the pages just past the listener and wakes the runner', async () => {
    const res = await request(app).post(`/api/books/${BOOK}/listen`).send({ fromSeq: 5 });

    expect(res.status).toBe(200);
    expect(textJobs()).toEqual([[7]]); // pages 4..7 around page 5, one page ahead; 4-6 are done
    expect(db.state.extractions.get(extraction.id).status).toBe('running');
    expect(jobRunner.wake).toHaveBeenCalled();
  });

  it('answers processing with no items for a page with no text yet, and queues its window', async () => {
    const res = await request(app).post(`/api/books/${BOOK}/listen`).send({ fromPage: 9 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ stopReason: 'processing', items: [] });
    expect(textJobs()).toEqual([[7, 8, 9, 10, 11]]); // reaches back to page 7: segments grow from page 1
    expect(db.state.segmentAudio).toHaveLength(0);
  });

  it('queues nothing more on a second request for the same window', async () => {
    await request(app).post(`/api/books/${BOOK}/listen`).send({ fromPage: 9 });
    await request(app).post(`/api/books/${BOOK}/listen`).send({ fromPage: 9 });
    expect(textJobs()).toHaveLength(1);
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
    expect(plan.body).toMatchObject({ plan: 'free', name: 'Free', limit: 2, usedToday: 2, remainingToday: 0 });
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

describe('POST /api/books/:bookId/listen/wait', () => {
  const config = require('../../src/config');
  const plainHash = async () => (await segmentAudio.resolveListenerVoice('user-1', {})).hash;
  const wait = (body, user = 'user-1') => request(app).post(`/api/books/${BOOK}/listen/wait`).set('x-test-user', user).send(body);
  const row = (seq, voiceHash, status) => {
    const s = db.state.segments.find((x) => x.seq === seq);
    const r = { text_sha256: s.text_sha256, voice_snapshot_sha256: voiceHash, status, duration_seconds: status === 'ready' ? '29.97' : null };
    db.state.segmentAudio.push(r);
    return r;
  };

  beforeAll(() => { config.audio.clipWaitPollMs = 10; });

  it('answers at once when a listed clip is already ready, with statuses only', async () => {
    const voiceKey = await plainHash();
    row(1, voiceKey, 'ready');
    row(2, voiceKey, 'pending');

    const res = await wait({ segmentIds: [segId(1), segId(2)], voiceKey });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ voiceKey, timedOut: false, items: [
      { segmentId: segId(1), seq: 1, status: 'ready', durationSeconds: 29.97 },
      { segmentId: segId(2), seq: 2, status: 'pending' },
    ] });
    expect(db.recordPageListen).not.toHaveBeenCalled();
  });

  it('holds the request while every clip is pending and answers as soon as one turns ready', async () => {
    const voiceKey = await plainHash();
    const r = row(1, voiceKey, 'pending');
    setTimeout(() => Object.assign(r, { status: 'ready', duration_seconds: '12.5' }), 80);

    const started = Date.now();
    const res = await wait({ segmentIds: [segId(1)], voiceKey });

    expect(Date.now() - started).toBeGreaterThanOrEqual(70);
    expect(res.body).toMatchObject({ timedOut: false, items: [{ seq: 1, status: 'ready', durationSeconds: 12.5 }] });
  });

  it('times out with the pending statuses; failed and never-queued clips answer at once', async () => {
    const voiceKey = await plainHash();
    row(1, voiceKey, 'pending');
    expect((await wait({ segmentIds: [segId(1)], voiceKey, timeoutSeconds: 0.05 })).body).toMatchObject({ timedOut: true, items: [{ status: 'pending' }] });

    row(2, voiceKey, 'failed');
    expect((await wait({ segmentIds: [segId(1), segId(2)], voiceKey })).body.items.map((i) => i.status)).toEqual(['pending', 'failed']);
    expect((await wait({ segmentIds: [segId(3)], voiceKey })).body.items[0].status).toBe('missing');
  });

  it('rejects bad input, a stranger and segments of another book', async () => {
    const voiceKey = await plainHash();
    expect((await wait({ segmentIds: [], voiceKey })).status).toBe(400);
    expect((await wait({ segmentIds: ['not-a-uuid'], voiceKey })).status).toBe(400);
    expect((await wait({ segmentIds: Array.from({ length: 51 }, (_, i) => segId(i + 1)), voiceKey })).status).toBe(400);
    expect((await wait({ segmentIds: [segId(1)], voiceKey: 'abc' })).status).toBe(400);
    expect((await wait({ segmentIds: [segId(1)], voiceKey }, 'stranger')).status).toBe(403);
    expect((await wait({ segmentIds: [segId(99)], voiceKey })).status).toBe(404);
  });
});

describe('GET /api/plan', () => {
  it('reads the plan without counting anything', async () => {
    db.subscribe('user-1', 'basic');
    const res = await request(app).get('/api/plan');
    expect(res.body).toMatchObject({ plan: 'basic', name: 'Basic', limit: 10, usedToday: 0, remainingToday: 10 });
    expect(db.recordPageListen).not.toHaveBeenCalled();
  });

  it('lists the plans on offer and when the count resets (next UTC midnight)', async () => {
    const res = await request(app).get('/api/plan');
    expect(res.body.plans.map((p) => [p.id, p.dailyPageLimit, p.priceCents])).toEqual([
      ['free', 2, 0], ['basic', 10, 500], ['pro', 50, 1500],
    ]);
    const reset = new Date(res.body.resetsAt);
    expect(reset.toISOString().slice(11)).toBe('00:00:00.000Z');
    expect(reset.getTime() - Date.now()).toBeGreaterThan(0);
    expect(reset.getTime() - Date.now()).toBeLessThanOrEqual(24 * 3600 * 1000);
  });
});
