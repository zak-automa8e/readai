jest.mock('../../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../../src/services/supabaseService', () => require('../helpers/fakeSupabase')());
jest.mock('../../src/services/llm', () => ({ ttsModel: () => 'test/tts', synthesize: jest.fn() }));

// A page counts once ever per user, book, page and voice (owner 2026-11-17)
const crypto = require('crypto');
const db = require('../../src/services/supabaseService');
const window = require('../../src/services/audio/windowService');
const segmentAudio = require('../../src/services/audio/segmentAudioService');

const sha = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const voiceOf = (baseVoice) => {
  const snapshot = segmentAudio.voiceSnapshot({ model: 'test/tts', baseVoice, instructions: null });
  return { snapshot, hash: segmentAudio.snapshotHash(snapshot) };
};
const A = voiceOf('Sadaltager');
const B = voiceOf('Kore');
const USER = 'user-1';
const BOOK = 'book-1';
const YESTERDAY = '2000-01-01';

describe('daily page count: once per page and voice, on any day', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.reset();
    db.addBook({ id: BOOK, user_id: USER, content_sha256: 'sha-1' });
    // One segment per page 1..5, a ready clip in both voices
    for (let page = 1; page <= 5; page++) {
      const text = `paragraph ${page}`;
      db.state.segments.push({ id: `seg-${page}`, seq: page, start_page: page, end_page: page, parts: [{ page, chars: text.length }], text, text_sha256: sha(text), char_count: text.length, status: 'final' });
      for (const voice of [A, B]) {
        db.state.segmentAudio.push({ text_sha256: sha(text), voice_snapshot_sha256: voice.hash, status: 'ready', audio_url: `https://cdn.test/${page}-${voice.hash}.wav`, duration_seconds: '3', audio_format: 'wav' });
      }
    }
  });

  const deliver = (page, voice = A) => window.deliver({ userId: USER, book: db.state.books.get(BOOK), segment: db.state.segments.find((s) => s.seq === page), voice });
  const heardYesterday = (page, voiceHash) => db.state.dailyUsage.push({ user_id: USER, usage_date: YESTERDAY, book_id: BOOK, page_number: page, voice_hash: voiceHash });
  const today = () => db.state.dailyUsage.filter((u) => u.usage_date === db.state.today).map((u) => u.page_number);

  it('pages heard yesterday in the same voice replay free, even after today is used up', async () => {
    heardYesterday(1, A.hash);
    heardYesterday(2, A.hash);

    expect((await deliver(1)).body).toMatchObject({ status: 'ready', usedToday: 0, countedPages: [] });
    expect((await deliver(3)).body).toMatchObject({ usedToday: 1, countedPages: [3] });
    expect((await deliver(4)).body).toMatchObject({ usedToday: 2, countedPages: [4] });
    expect((await deliver(5)).status).toBe(402); // a new page past the free limit

    const replay = await deliver(2); // limit reached, but page 2 was heard yesterday in this voice
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({ status: 'ready', usedToday: 2, countedPages: [] });
    expect(today()).toEqual([3, 4]);
  });

  it('the same page in a new voice counts once; switching back to the old voice is free', async () => {
    heardYesterday(1, A.hash);

    expect((await deliver(1, B)).body).toMatchObject({ usedToday: 1, countedPages: [1] });
    expect((await deliver(1, B)).body).toMatchObject({ usedToday: 1, countedPages: [] });
    const back = await deliver(1, A);
    expect(back.body).toMatchObject({ usedToday: 1, countedPages: [], audioUrl: `https://cdn.test/1-${A.hash}.wav` });
  });

  it('rows from before voices were recorded count as heard in every voice', async () => {
    heardYesterday(1, null);

    expect((await deliver(1, A)).body).toMatchObject({ usedToday: 0, countedPages: [] });
    expect((await deliver(1, B)).body).toMatchObject({ usedToday: 0, countedPages: [] });
  });

  it('listen plans past pages already heard in this voice without spending the limit on them', async () => {
    heardYesterday(1, A.hash);
    heardYesterday(2, A.hash);
    const extraction = { id: 'ext-1', content_sha256: 'sha-1', status: 'complete', pages_total: 5, finalized_through_page: 5, prompt_version: 2, model: 'm' };
    db.state.extractions.set(extraction.id, extraction);
    db.addPages(BOOK, 5);
    for (let n = 1; n <= 5; n++) db.landPage(extraction, BOOK, n, { blocks: [], pageType: 'body' });
    db.state.segments.forEach((s) => { s.extraction_id = extraction.id; });

    const result = await window.listen({ userId: USER, book: db.state.books.get(BOOK), extraction, fromSeq: 1, voice: A, pagesAhead: 3 });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ usedToday: 0, remainingToday: 2 });
    expect(result.body.items.map((i) => i.seq)).toEqual([1, 2, 3, 4]);
  });
});
