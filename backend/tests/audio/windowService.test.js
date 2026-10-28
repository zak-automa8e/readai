jest.mock('../../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../../src/services/supabaseService', () => require('../helpers/fakeSupabase')());
jest.mock('../../src/services/llm', () => ({ ttsModel: () => 'test/tts', synthesize: jest.fn() }));

const crypto = require('crypto');
const db = require('../../src/services/supabaseService');
const window = require('../../src/services/audio/windowService');
const segmentAudio = require('../../src/services/audio/segmentAudioService');
const planService = require('../../src/services/plans/planService');

const sha = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const SNAPSHOT = segmentAudio.voiceSnapshot({ model: 'test/tts', baseVoice: 'Sadaltager', instructions: null });
const VOICE = { snapshot: SNAPSHOT, hash: segmentAudio.snapshotHash(SNAPSHOT) };
const USER = 'user-1';
const BOOK = 'book-1';

// A segment row: `pages` are the pages it covers, chars split evenly
function seg(seq, pages, chars = 100, extra = {}) {
  const text = `paragraph ${seq} `.padEnd(chars, 'x');
  const per = Math.floor(chars / pages.length);
  const parts = pages.map((page, i) => ({ page, chars: i === pages.length - 1 ? chars - per * (pages.length - 1) : per }));
  return { id: `seg-${seq}`, seq, start_page: pages[0], end_page: pages[pages.length - 1], parts, text, text_sha256: sha(text), char_count: chars, status: 'final', ...extra };
}

const noSkip = () => false;
const SECONDS_PER_CHAR = 0.0999;

describe('isPageSkipped (O8)', () => {
  const pageTypes = new Map([
    [1, 'cover'], [2, 'title'], [3, 'copyright'], [4, 'dedication'], [5, 'author_note'], [6, 'toc'],
    [7, 'preface'], [8, 'introduction'], [9, 'body'], [10, 'blank'], [11, 'bibliography'], [12, 'index'], [13, 'back_cover'], [14, null],
  ]);
  const skipped = (rules) => [...pageTypes.keys()].filter((page) => window.isPageSkipped(page, { pageTypes, ...rules }));

  it('skips the default types and reads preface, introduction, body, bibliography and untyped pages', () => {
    expect(skipped({})).toEqual([1, 2, 3, 4, 5, 6, 10, 12, 13]);
  });

  it('read_front_matter brings back title, copyright, dedication, author note and toc only', () => {
    expect(skipped({ readFrontMatter: true })).toEqual([1, 10, 12, 13]);
  });

  it('a per-page override wins in both directions over the defaults and read_front_matter', () => {
    const overrides = new Map([[1, false], [2, true], [9, true]]);
    expect(skipped({ readFrontMatter: true, overrides })).toEqual([2, 9, 10, 12, 13]);
  });
});

describe('planWindow', () => {
  it('prepares the rest of the current page and the next page; a paragraph cut by the next break is taken whole', () => {
    // p4: 1, 2, 3 (cut into p5) · p5: 4, 5 (cut into p6) · p6: 6 · p7: 7
    const segments = [seg(1, [4], 1000), seg(2, [4]), seg(3, [4, 5]), seg(4, [5]), seg(5, [5, 6]), seg(6, [6]), seg(7, [7])];
    const plan = window.planWindow(segments, { isSkipped: noSkip, countedPages: new Set(), remaining: 50, pagesAhead: 1 });

    expect(plan.items.map((i) => i.segment.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(plan.newPages).toEqual([4, 5, 6]);
    expect(plan.stopReason).toBe('window');
    expect(plan.items[1].offsetSeconds).toBeCloseTo(1000 * SECONDS_PER_CHAR, 6);
  });

  it('starting inside a paragraph that began on the previous page counts that page as the current one', () => {
    const segments = [seg(3, [4, 5]), seg(4, [5]), seg(5, [5, 6]), seg(6, [6])];
    const plan = window.planWindow(segments, { isSkipped: noSkip, countedPages: new Set(), remaining: 50, pagesAhead: 1 });

    expect(plan.items.map((i) => i.segment.seq)).toEqual([3, 4, 5]);
    expect(plan.stopReason).toBe('window');
  });

  it('lastWindowPage counts read pages only', () => {
    expect(window.lastWindowPage(4, 0, noSkip)).toBe(4);
    expect(window.lastWindowPage(4, 1, noSkip)).toBe(5);
    expect(window.lastWindowPage(4, 2, noSkip)).toBe(6);
    expect(window.lastWindowPage(4, 1, (p) => p === 5 || p === 6)).toBe(7);
  });

  it('an open segment past the window ends it as a full window, not as processing', () => {
    const segments = [seg(1, [1]), seg(2, [2]), seg(3, [3], 100, { status: 'open' })];
    const plan = window.planWindow(segments, { isSkipped: noSkip, countedPages: new Set(), remaining: 50, pagesAhead: 1 });

    expect(plan.items.map((i) => i.segment.seq)).toEqual([1, 2]);
    expect(plan.stopReason).toBe('window');
  });

  it('never goes past the pages left today; pages already counted today are free', () => {
    const segments = [seg(1, [3]), seg(2, [3]), seg(3, [4]), seg(4, [5]), seg(5, [6]), seg(6, [7])];
    const plan = window.planWindow(segments, { isSkipped: noSkip, countedPages: new Set([3, 4]), remaining: 2, pagesAhead: 10 });

    expect(plan.items.map((i) => i.segment.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(plan.newPages).toEqual([5, 6]);
    expect(plan.stopReason).toBe('allowance');
  });

  it('a segment crossing a page break needs every page it touches', () => {
    const segments = [seg(1, [1]), seg(2, [1, 2])];
    const plan = window.planWindow(segments, { isSkipped: noSkip, countedPages: new Set(), remaining: 1, pagesAhead: 1 });
    expect(plan.items.map((i) => i.segment.seq)).toEqual([1]);
    expect(plan.stopReason).toBe('allowance');
  });

  it('passes over segments that start on a skipped page and stops at an open segment inside the window', () => {
    // p2 is skipped, so two pages ahead of p1 reaches p4
    const segments = [seg(1, [1]), seg(2, [2]), seg(3, [2, 3]), seg(4, [3]), seg(5, [4], 100, { status: 'open' }), seg(6, [5])];
    const plan = window.planWindow(segments, { isSkipped: (p) => p === 2, countedPages: new Set(), remaining: 10, pagesAhead: 2 });

    expect(plan.items.map((i) => i.segment.seq)).toEqual([1, 4]);
    expect(plan.skippedSeqs).toEqual([2, 3]);
    expect(plan.stopReason).toBe('processing');
  });
});

describe('listen and deliver against the store', () => {
  let extraction;

  beforeEach(() => {
    jest.clearAllMocks();
    db.reset();
    db.addBook({ id: BOOK, user_id: USER, content_sha256: 'sha-1' });
    db.addPages(BOOK, 8);
    extraction = { id: 'ext-1', content_sha256: 'sha-1', status: 'complete', pages_total: 8, finalized_through_page: 8, prompt_version: 2, model: 'm' };
    db.state.extractions.set(extraction.id, extraction);
    db.landPage(extraction, BOOK, 1, { blocks: [], pageType: 'cover' });
    for (let n = 2; n <= 8; n++) db.landPage(extraction, BOOK, n, { blocks: [], pageType: 'body' });
    // p1 cover, then two segments per page on 2..7, one crossing 7→8
    let seq = 1;
    db.state.segments.push({ extraction_id: extraction.id, ...seg(seq++, [1]) });
    for (let page = 2; page <= 7; page++) {
      db.state.segments.push({ extraction_id: extraction.id, ...seg(seq++, [page]) });
      db.state.segments.push({ extraction_id: extraction.id, ...seg(seq++, page === 7 ? [7, 8] : [page]) });
    }
  });

  const listen = (fromSeq = 1, extra = {}) => window.listen({ userId: USER, book: db.state.books.get(BOOK), extraction, fromSeq, voice: VOICE, ...extra });
  const deliver = (seq) => window.deliver({ userId: USER, book: db.state.books.get(BOOK), segment: db.state.segments.find((s) => s.seq === seq), voice: VOICE });
  const ttsJobs = () => db.state.jobs.filter((j) => j.kind === 'tts_segment');
  const makeReady = () => db.state.segmentAudio.forEach((row) => Object.assign(row, { status: 'ready', audio_url: `https://cdn.test/${row.text_sha256}.wav`, duration_seconds: '9.99', audio_format: 'wav' }));

  it('free plan: plans the current page and the next (skipping the cover), returns statuses only and enqueues one job per clip', async () => {
    const result = await listen(1);

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ voiceKey: VOICE.hash, stopReason: 'window', plan: 'free', limit: 2, usedToday: 0, remainingToday: 2, skippedSeqs: [1] });
    expect(result.body.items.map((i) => i.seq)).toEqual([2, 3, 4, 5]); // pages 2 and 3
    expect(result.body.items.every((i) => i.status === 'pending' && !('audioUrl' in i))).toBe(true);
    expect(ttsJobs().map((j) => j.priority)).toEqual([0, 10, 20, 30]);
    expect(db.state.dailyUsage).toHaveLength(0); // planning never counts
    expect(result.enqueued).toBe(true);
  });

  it('the same request again adds no jobs and no rows; ready clips report ready with their duration', async () => {
    await listen(1);
    makeReady();
    const jobs = db.state.jobs.length;

    const again = await listen(1);

    expect(db.state.jobs).toHaveLength(jobs);
    expect(db.state.segmentAudio).toHaveLength(4);
    expect(again.body.items).toEqual([2, 3, 4, 5].map((seq) => ({ segmentId: `seg-${seq}`, seq, status: 'ready', durationSeconds: 9.99 })));
    expect(again.enqueued).toBe(false);
  });

  it('delivery counts each page once per day; replaying adds no row; the third new page is refused with 402', async () => {
    await listen(1);
    makeReady();

    const first = await deliver(2);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ status: 'ready', audioUrl: expect.stringContaining('https://cdn.test/'), durationSeconds: 9.99, cached: true, usedToday: 1, limit: 2, remainingToday: 1, countedPages: [2] });

    expect((await deliver(3)).body).toMatchObject({ usedToday: 1, countedPages: [] }); // same page
    expect((await deliver(2)).status).toBe(200); // replay
    expect(db.state.dailyUsage).toHaveLength(1);

    expect((await deliver(4)).body).toMatchObject({ usedToday: 2, countedPages: [3] });

    // Page 4's clip exists (another listener made it), but page 4 would be the third new page today
    const s6 = db.state.segments.find((s) => s.seq === 6);
    db.state.segmentAudio.push({ text_sha256: s6.text_sha256, voice_snapshot_sha256: VOICE.hash, status: 'ready', audio_url: 'https://cdn.test/s6.wav', duration_seconds: 5 });
    const refused = await deliver(6);
    expect(refused.status).toBe(402);
    expect(refused.body).toEqual(expect.objectContaining({ error: 'DAILY_LIMIT_REACHED', used: 2, limit: 2, plan: 'free' }));
    expect(refused.body.audioUrl).toBeUndefined();
    expect(db.state.dailyUsage.map((u) => u.page_number)).toEqual([2, 3]);
  });

  it('at the limit, /listen returns 402 with the cached statuses and prepares nothing', async () => {
    await listen(1);
    makeReady();
    await deliver(2);
    await deliver(4);
    const jobs = db.state.jobs.length;

    const replay = await listen(2); // pages 2 and 3 are counted: free to hear again
    expect(replay.status).toBe(200);
    expect(replay.body.items.map((i) => i.seq)).toEqual([2, 3, 4, 5]);

    const blocked = await listen(6);
    expect(blocked.status).toBe(402);
    expect(blocked.body).toMatchObject({ error: 'DAILY_LIMIT_REACHED', used: 2, limit: 2, plan: 'free', items: [] });
    expect(db.state.jobs).toHaveLength(jobs);
    expect(blocked.enqueued).toBe(false);
  });

  it('a hand-assigned basic plan lifts the limit to 10 at once', async () => {
    await listen(1);
    makeReady();
    await deliver(2);
    await deliver(4);
    expect((await listen(6)).status).toBe(402);

    db.subscribe(USER, 'basic');

    const result = await listen(6);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ plan: 'basic', limit: 10, usedToday: 2, remainingToday: 8, stopReason: 'window' });
    expect(result.body.items.map((i) => i.seq)).toEqual([6, 7, 8, 9]); // pages 4 and 5
  });

  it('the last page of the book ends the window; its paragraph cut into page 8 is taken whole', async () => {
    db.subscribe(USER, 'basic');

    const result = await listen(10); // page 6

    expect(result.body.items.map((i) => i.seq)).toEqual([10, 11, 12, 13]); // 13 = pages 7 → 8
    expect(result.body.stopReason).toBe('end');
  });

  it('a 402 lists the window clips that are already cached', async () => {
    db.subscribe(USER, 'free');
    db.state.dailyUsage.push({ user_id: USER, usage_date: db.state.today, book_id: 'another-book', page_number: 1 }, { user_id: USER, usage_date: db.state.today, book_id: 'another-book', page_number: 2 });
    const s2 = db.state.segments.find((s) => s.seq === 2);
    db.state.segmentAudio.push({ text_sha256: s2.text_sha256, voice_snapshot_sha256: VOICE.hash, status: 'ready', audio_url: 'u', duration_seconds: 4 });

    const blocked = await listen(1);

    expect(blocked.status).toBe(402);
    expect(blocked.body.items).toEqual([{ segmentId: 'seg-2', seq: 2, status: 'ready', durationSeconds: 4 }]);
  });

  it('skips by override and read_front_matter per listener', async () => {
    db.subscribe(USER, 'pro');
    db.state.skipOverrides.push({ user_id: USER, book_id: BOOK, page_number: 1, skip: false }, { user_id: USER, book_id: BOOK, page_number: 3, skip: true });

    // The cover is read by override: page 1 is current, page 2 is next
    expect((await listen(1)).body.items.map((i) => i.seq)).toEqual([1, 2, 3]);

    // Page 3 is skipped by override: the next read page after page 2 is page 4
    const result = await listen(2);
    expect(result.body.items.map((i) => i.seq)).toEqual([2, 3, 6, 7]);
    expect(result.body.skippedSeqs).toEqual([4, 5]);
  });

  it('a clip that is not ready is reported without counting anything', async () => {
    await listen(1);

    const pending = await deliver(2);
    const missing = await deliver(12);

    expect(pending).toEqual({ status: 200, body: { status: 'pending', cached: false, voiceKey: VOICE.hash } });
    expect(missing.body.status).toBe('missing');
    expect(db.state.dailyUsage).toHaveLength(0);
  });

  it('a segment that crosses into a page that does not fit counts none of its pages', async () => {
    db.state.dailyUsage.push({ user_id: USER, usage_date: db.state.today, book_id: 'another-book', page_number: 1 });
    const s13 = db.state.segments.find((s) => s.seq === 13); // pages 7 and 8
    db.state.segmentAudio.push({ text_sha256: s13.text_sha256, voice_snapshot_sha256: VOICE.hash, status: 'ready', audio_url: 'u', duration_seconds: 4 });

    const refused = await deliver(13);

    expect(refused.status).toBe(402);
    expect(db.recordPageListen).not.toHaveBeenCalled();
    expect(db.state.dailyUsage).toHaveLength(1);
  });

  describe('listening follow-up (story 6b)', () => {
    // Page 8 is still being extracted: seq 13 (pages 7 → 8) is open
    const seg13 = () => db.state.segments.find((s) => s.seq === 13);
    const followups = () => db.state.jobs.filter((j) => j.kind === 'listen_followup');
    const ttsSeqs = () => ttsJobs().map((j) => db.state.segments.find((s) => s.id === j.payload.segmentId).seq);

    beforeEach(() => {
      db.subscribe(USER, 'basic');
      Object.assign(extraction, { status: 'running', finalized_through_page: 6 });
      seg13().status = 'open';
    });

    it('a window stopped by an open paragraph queues one follow-up for it, delayed, and repeat requests add none', async () => {
      const result = await listen(10); // page 6 → window pages 6 and 7

      expect(result.body.stopReason).toBe('processing');
      expect(result.body.items.map((i) => i.seq)).toEqual([10, 11, 12]);
      expect(followups()).toHaveLength(1);
      const job = followups()[0];
      expect(job).toMatchObject({ idempotency_key: `followup:${USER}:${VOICE.hash}:ext-1:13`, user_id: USER, book_id: BOOK, extraction_id: 'ext-1', priority: 0 });
      expect(job.payload).toMatchObject({ fromSeq: 10, waitSeq: 13, voiceHash: VOICE.hash, voiceSnapshot: VOICE.snapshot });
      expect(Date.parse(job.run_after)).toBeGreaterThan(Date.now());

      await listen(10);
      expect(followups()).toHaveLength(1);
    });

    it('waits while the paragraph is open, then plans the window and queues its clip once it closes', async () => {
      await listen(10);
      const job = followups()[0];

      expect(await window.runFollowup(job)).toEqual({ requeue: { delayMs: 30000 } });
      expect(ttsSeqs()).toEqual([10, 11, 12]);

      seg13().status = 'final';
      expect(await window.runFollowup(job)).toBeNull();
      expect(ttsSeqs()).toEqual([10, 11, 12, 13]);
      expect(db.state.dailyUsage).toHaveLength(0); // never counts
    });

    it('stops when extraction is no longer running or the wait runs out, queuing nothing', async () => {
      await listen(10);
      const job = followups()[0];

      extraction.status = 'partial';
      expect(await window.runFollowup(job)).toBeNull();

      extraction.status = 'running';
      const expired = { ...job, payload: { ...job.payload, waitUntil: new Date(Date.now() - 1000).toISOString() } };
      expect(await window.runFollowup(expired)).toBeNull();
      expect(ttsSeqs()).toEqual([10, 11, 12]);
    });

    it('after a follow-up gave up, the next request queues a new round', async () => {
      await listen(10);
      followups()[0].status = 'done';

      await listen(10);

      expect(followups().map((j) => j.idempotency_key)).toEqual([
        `followup:${USER}:${VOICE.hash}:ext-1:13`,
        `followup:${USER}:${VOICE.hash}:ext-1:13:round1`,
      ]);
    });

    it('waits for the next segment to be built when the stored segments run out', async () => {
      db.state.segments.splice(db.state.segments.indexOf(seg13()), 1);

      const result = await listen(10);

      expect(result.body.stopReason).toBe('processing');
      expect(followups()[0].payload.waitSeq).toBe(13);
    });

    it('a finished extraction queues no follow-up', async () => {
      Object.assign(extraction, { status: 'complete', finalized_through_page: 8 });
      seg13().status = 'final';

      await listen(10);

      expect(followups()).toHaveLength(0);
    });
  });
});

describe('planService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.reset();
  });

  it('no subscription, a canceled one or an ended one means the free plan', async () => {
    expect((await planService.getPlanUsage(USER)).plan).toBe('free');
    db.subscribe(USER, 'pro', { status: 'canceled' });
    expect((await planService.getPlanUsage(USER)).plan).toBe('free');
    db.subscribe(USER, 'pro', { ends_at: '2020-01-01T00:00:00Z' });
    expect((await planService.getPlanUsage(USER)).plan).toBe('free');
    db.subscribe(USER, 'pro', { ends_at: '2999-01-01T00:00:00Z' });
    expect(await planService.getPlanUsage(USER)).toMatchObject({ plan: 'pro', name: 'Pro', limit: 50, usedToday: 0, remainingToday: 50 });
  });

  it('counts today across every book and lists the pages already counted in one book', async () => {
    db.state.dailyUsage.push(
      { user_id: USER, usage_date: db.state.today, book_id: BOOK, page_number: 4 },
      { user_id: USER, usage_date: db.state.today, book_id: 'other', page_number: 4 },
      { user_id: USER, usage_date: '2000-01-01', book_id: BOOK, page_number: 5 },
    );
    const usage = await planService.getPlanUsage(USER, { bookId: BOOK });
    expect(usage).toMatchObject({ usedToday: 2, remainingToday: 0 });
    expect([...usage.countedPages]).toEqual([4]);
  });
});
