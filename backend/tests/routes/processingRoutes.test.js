jest.mock('../../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../../src/services/supabaseService', () => require('../helpers/fakeSupabase')());
jest.mock('../../src/middleware/authMiddleware', () => ({
  authenticateUser: (req, res, next) => {
    req.user = { id: req.headers['x-test-user'] || 'user-1' };
    next();
  },
}));
jest.mock('../../src/services/llm', () => ({ extractionModel: () => 'test/model' }));
jest.mock('../../src/services/extraction/pdfSource', () => ({
  sha256: jest.requireActual('../../src/services/extraction/pdfSource').sha256,
  downloadPdf: jest.fn(),
  rememberPdf: jest.fn().mockResolvedValue('/tmp/x.pdf'),
  getPdfFile: jest.fn(),
  forgetPdf: jest.fn().mockResolvedValue(),
}));
jest.mock('../../src/services/jobs/jobRunner', () => ({ wake: jest.fn() }));

const express = require('express');
const request = require('supertest');
const db = require('../../src/services/supabaseService');
const pdfSource = require('../../src/services/extraction/pdfSource');
const jobRunner = require('../../src/services/jobs/jobRunner');

const app = express();
app.use(express.json());
app.use('/api/books', require('../../src/routes/processingRoutes'));
app.use('/api/books', require('../../src/routes/segmentsRoutes'));

const BOOK = 'book-1';
const PDF = Buffer.from('%PDF-1.4 the book');

beforeEach(() => {
  jest.clearAllMocks();
  db.reset();
  pdfSource.downloadPdf.mockResolvedValue(PDF);
});

describe('POST /api/books/:bookId/process', () => {
  it('refuses a Read-mode book with 409 and a clear code', async () => {
    db.addBook({ id: BOOK, mode: 'read', content_sha256: 'sha-1' });

    const res = await request(app).post(`/api/books/${BOOK}/process`).send({});

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('BOOK_NOT_IN_LISTEN_MODE');
    expect(res.body.message).toMatch(/Listen mode/);
    expect(db.state.extractions.size).toBe(0);
    expect(db.state.jobs).toHaveLength(0);
  });

  it('refuses a user without access', async () => {
    db.addBook({ id: BOOK, user_id: 'someone-else', content_sha256: 'sha-1' });

    const res = await request(app).post(`/api/books/${BOOK}/process`).send({});

    expect(res.status).toBe(403);
    expect(db.state.extractions.size).toBe(0);
  });

  it('starts an extraction (202), computing the missing content hash, and wakes the runner', async () => {
    db.addBook({ id: BOOK, content_sha256: null });

    const res = await request(app).post(`/api/books/${BOOK}/process`).send({ fromPage: 4 });

    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ status: 'queued', pagesTotal: null, pagesDone: 0, finalizedThroughPage: 0, reused: false });
    const hash = pdfSource.sha256(PDF);
    expect(db.state.books.get(BOOK).content_sha256).toBe(hash);
    expect(db.state.extractions.get(res.body.extractionId)).toMatchObject({ content_sha256: hash, source_book_id: BOOK, prompt_version: 2, model: 'test/model', started_by: 'user-1' });
    expect(db.state.jobs[0].payload).toEqual({ phase: 'plan', fromPage: 4, ahead: require('../../src/config').audio.pagesAhead });
    expect(jobRunner.wake).toHaveBeenCalled();
  });

  it('is idempotent: a second request returns the same extraction and adds no job', async () => {
    db.addBook({ id: BOOK, content_sha256: 'sha-1' });

    const first = await request(app).post(`/api/books/${BOOK}/process`).send({});
    const second = await request(app).post(`/api/books/${BOOK}/process`).send({});

    expect(second.status).toBe(202);
    expect(second.body.extractionId).toBe(first.body.extractionId);
    expect(second.body.reused).toBe(true);
    expect(db.state.extractions.size).toBe(1);
    expect(db.state.jobs).toHaveLength(1);
    expect(pdfSource.downloadPdf).not.toHaveBeenCalled();
  });

  it('returns the existing extraction for another book with the same PDF content', async () => {
    db.addBook({ id: BOOK, content_sha256: 'sha-1' });
    db.addBook({ id: 'book-2', user_id: 'user-2', content_sha256: 'sha-1' });
    const first = await request(app).post(`/api/books/${BOOK}/process`).send({});
    const ext = db.state.extractions.get(first.body.extractionId);
    Object.assign(ext, { pages_total: 30, status: 'complete', pages_done: 30, finalized_through_page: 30 });

    const res = await request(app).post('/api/books/book-2/process').set('x-test-user', 'user-2').send({});

    expect(res.body).toMatchObject({ extractionId: first.body.extractionId, status: 'complete', reused: true, pagesTotal: 30 });
    expect(db.state.books.get('book-2').total_pages).toBe(30);
  });

  it('starts from the last read page when no fromPage is given', async () => {
    db.addBook({ id: BOOK, content_sha256: 'sha-1' });
    db.state.userBooks.push({ user_id: 'user-1', book_id: BOOK, last_read_page: 17 });

    await request(app).post(`/api/books/${BOOK}/process`).send({});

    expect(db.state.jobs[0].payload.fromPage).toBe(17);
  });
});

describe('GET /api/books/:bookId/processing', () => {
  it('reports legacy with no extraction', async () => {
    db.addBook({ id: BOOK, content_sha256: 'sha-1', total_pages: 12 });

    const res = await request(app).get(`/api/books/${BOOK}/processing`);

    expect(res.body).toMatchObject({ extractionId: null, status: 'none', mode: 'legacy', bookMode: 'listen', pagesTotal: 12 });
  });

  it('switches to segments once page 1 is finalised', async () => {
    db.addBook({ id: BOOK, content_sha256: 'sha-1' });
    const ext = await db.createExtraction({ content_sha256: 'sha-1', source_book_id: BOOK, model: 'test/model', prompt_version: 2 });
    Object.assign(db.state.extractions.get(ext.id), { status: 'running', pages_total: 20, pages_done: 10, finalized_through_page: 9 });

    const res = await request(app).get(`/api/books/${BOOK}/processing`);

    expect(res.body).toMatchObject({ extractionId: ext.id, status: 'running', pagesTotal: 20, pagesDone: 10, finalizedThroughPage: 9, mode: 'segments' });
  });

  it("reports the reader's own mode over the book's", async () => {
    db.addBook({ id: BOOK, mode: 'read', content_sha256: 'sha-1', visibility: 'public' });
    db.state.userBooks.push({ user_id: 'user-2', book_id: BOOK, mode: 'listen' });

    const own = await request(app).get(`/api/books/${BOOK}/processing`).set('x-test-user', 'user-2');
    const owner = await request(app).get(`/api/books/${BOOK}/processing`);

    expect(own.body.bookMode).toBe('listen');
    expect(owner.body.bookMode).toBe('read');
  });
});

describe('PUT /api/books/:bookId/mode (spec O14)', () => {
  const setMode = (mode, user = 'user-1') => request(app).put(`/api/books/${BOOK}/mode`).set('x-test-user', user).send({ mode });

  it("the owner of a private book changes the book itself", async () => {
    db.addBook({ id: BOOK, mode: 'read', visibility: 'private', content_sha256: 'sha-1' });
    db.state.userBooks.push({ user_id: 'user-1', book_id: BOOK, mode: null });

    const res = await setMode('listen');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ mode: 'listen' });
    expect(db.state.books.get(BOOK).mode).toBe('listen');
    expect(db.state.userBooks[0].mode).toBeNull();
  });

  it('on a shared book every switch, the owner\'s too, changes only that reader', async () => {
    db.addBook({ id: BOOK, mode: 'listen', visibility: 'public', content_sha256: 'sha-1' });
    db.state.userBooks.push({ user_id: 'user-1', book_id: BOOK, mode: null }, { user_id: 'user-2', book_id: BOOK, mode: null });

    await setMode('read', 'user-2');
    await setMode('read', 'user-1');

    expect(db.state.books.get(BOOK).mode).toBe('listen');
    expect(db.state.userBooks.map((u) => u.mode)).toEqual(['read', 'read']);
  });

  it('a reader switched to Listen can start the extraction; one switched to Read cannot', async () => {
    db.addBook({ id: BOOK, mode: 'read', visibility: 'public', content_sha256: 'sha-1' });
    db.state.userBooks.push({ user_id: 'user-2', book_id: BOOK, mode: null });

    expect((await request(app).post(`/api/books/${BOOK}/process`).set('x-test-user', 'user-2').send({})).status).toBe(409);
    await setMode('listen', 'user-2');
    expect((await request(app).post(`/api/books/${BOOK}/process`).set('x-test-user', 'user-2').send({})).status).toBe(202);
    // The owner still has the book in Read
    expect((await request(app).post(`/api/books/${BOOK}/process`).send({})).status).toBe(409);
  });

  it('refuses an unknown mode and a user without access', async () => {
    db.addBook({ id: BOOK, mode: 'read', content_sha256: 'sha-1' });

    expect((await setMode('both')).status).toBe(400);
    expect((await setMode('listen', 'stranger')).status).toBe(403);
    expect(db.state.books.get(BOOK).mode).toBe('read');
  });
});

describe('GET /api/books/:bookId/segments', () => {
  it('returns segments that end on or after fromPage, in seq order, in camelCase', async () => {
    db.addBook({ id: BOOK, content_sha256: 'sha-1' });
    const ext = await db.createExtraction({ content_sha256: 'sha-1', source_book_id: BOOK, model: 'test/model', prompt_version: 2 });
    await db.upsertSegments([
      { extraction_id: ext.id, seq: 1, role: 'heading', start_page: 1, end_page: 1, parts: [{ page: 1, chars: 5 }], text: 'تمهيد', char_count: 5, sentence_offsets: [0], footnote_markers: [], status: 'final' },
      { extraction_id: ext.id, seq: 2, role: 'body', start_page: 1, end_page: 2, parts: [{ page: 1, chars: 4 }, { page: 2, chars: 3 }], text: 'نص في صف', char_count: 7, sentence_offsets: [0], footnote_markers: [], status: 'final' },
      { extraction_id: ext.id, seq: 3, role: 'body', start_page: 2, end_page: 2, parts: [{ page: 2, chars: 4 }], text: 'آخر', char_count: 4, sentence_offsets: [0], footnote_markers: [], status: 'open' },
    ]);

    const res = await request(app).get(`/api/books/${BOOK}/segments?fromPage=2`);

    expect(res.body.extractionId).toBe(ext.id);
    expect(res.body.segments.map((s) => s.seq)).toEqual([2, 3]);
    expect(res.body.segments[0]).toMatchObject({ role: 'body', startPage: 1, endPage: 2, charCount: 7, sentenceOffsets: [0], status: 'final' });
    expect(res.body.segments[1].status).toBe('open');
    // Position in the whole book, for the book-wide progress bar
    expect(res.body.segments.map((s) => s.charStart)).toEqual([5, 12]);
    expect(res.body.book).toMatchObject({ knownChars: 16, complete: false });
  });

  it('atChar starts at the segment holding that character; the total is estimated while extraction runs', async () => {
    db.addBook({ id: BOOK, content_sha256: 'sha-1' });
    const ext = await db.createExtraction({ content_sha256: 'sha-1', source_book_id: BOOK, model: 'test/model', prompt_version: 2 });
    await db.updateExtraction(ext.id, { status: 'running', pages_total: 10 });
    await db.upsertSegments([1, 2, 3, 4].map((seq) => ({
      extraction_id: ext.id, seq, role: 'body', start_page: seq, end_page: seq, parts: [{ page: seq, chars: 100 }],
      text: 'x'.repeat(100), char_count: 100, sentence_offsets: [0], footnote_markers: [], status: 'final',
    })));

    const at = await request(app).get(`/api/books/${BOOK}/segments?atChar=250`);
    expect(at.body.segments.map((s) => s.seq)).toEqual([3, 4]);
    expect(at.body.segments[0].charStart).toBe(200);
    // 400 chars over 4 pages, 10 pages in the book
    expect(at.body.book).toEqual({ knownChars: 400, totalChars: 1000, complete: false });

    const past = await request(app).get(`/api/books/${BOOK}/segments?atChar=5000`);
    expect(past.body.segments.map((s) => s.seq)).toEqual([4]);
  });

  it('returns an empty list for a book that has not been processed', async () => {
    db.addBook({ id: BOOK, content_sha256: null });
    const res = await request(app).get(`/api/books/${BOOK}/segments`);
    expect(res.body).toEqual({ extractionId: null, segments: [], book: null });
  });
});
