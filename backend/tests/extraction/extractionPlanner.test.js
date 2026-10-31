jest.mock('../../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../../src/services/supabaseService', () => require('../helpers/fakeSupabase')());
jest.mock('../../src/services/llm', () => ({
  extractionModel: () => 'test/model',
  extractBlocks: jest.fn(),
  supportsExtractionBatch: jest.fn(() => true),
  submitExtractionBatch: jest.fn(),
  getExtractionBatch: jest.fn(),
}));
jest.mock('../../src/services/extraction/pdfSource', () => ({
  sha256: jest.requireActual('../../src/services/extraction/pdfSource').sha256,
  downloadPdf: jest.fn(),
  rememberPdf: jest.fn().mockResolvedValue('/tmp/x.pdf'),
  getPdfFile: jest.fn().mockResolvedValue('/tmp/book.pdf'),
  forgetPdf: jest.fn().mockResolvedValue(),
}));
jest.mock('../../src/services/extraction/pageRenderer', () => ({
  pageCount: jest.fn(),
  renderPage: jest.fn(),
}));

const config = require('../../src/config');
const db = require('../../src/services/supabaseService');
const llm = require('../../src/services/llm');
const pdfSource = require('../../src/services/extraction/pdfSource');
const pageRenderer = require('../../src/services/extraction/pageRenderer');
const service = require('../../src/services/extraction/extractionService');
const { BOOK, cleanPage, setupExtraction } = require('../helpers/extractionFixtures');

beforeEach(() => {
  jest.clearAllMocks();
  config.extraction.batchEnabled = false;
  pageRenderer.renderPage.mockImplementation(async (path, page) => ({ png: Buffer.from(`png-${page}`), sha256: `img-${page}` }));
  llm.extractBlocks.mockImplementation(async () => cleanPage(1));
});

describe('runPlan', () => {
  async function planned(total, payload) {
    db.reset();
    db.addBook({ id: BOOK, content_sha256: 'sha-1' });
    db.addBook({ id: 'book-2', content_sha256: 'sha-1' });
    db.addPages(BOOK, 3); // legacy rows for the first pages already exist
    const extraction = await db.createExtraction({ content_sha256: 'sha-1', source_book_id: BOOK, model: 'test/model', prompt_version: 2 });
    pageRenderer.pageCount.mockResolvedValue(total);
    const plan = { id: 'job-plan', book_id: 'book-2', user_id: 'user-1', extraction_id: extraction.id, payload: { phase: 'plan', ...payload } };
    return { extraction, plan };
  }

  it('counts pages, creates page rows, writes total_pages and queues only the first window, once', async () => {
    const { extraction, plan } = await planned(25, { fromPage: 1, ahead: 2 });

    await service.runPlan(plan);
    await service.runPlan(plan); // replay after a lost lease

    expect(db.state.pages.filter((p) => p.book_id === BOOK)).toHaveLength(25);
    expect(db.state.books.get(BOOK).total_pages).toBe(25);
    expect(db.state.books.get('book-2').total_pages).toBe(25);
    expect(db.state.extractions.get(extraction.id)).toMatchObject({ pages_total: 25, status: 'running' });
    expect(db.state.jobs.map((j) => [j.idempotency_key, j.payload.pages])).toEqual([[`extract:${extraction.id}:w1-4`, [1, 2, 3, 4]]]);
    expect(db.state.jobs.every((j) => j.book_id === BOOK && j.payload.phase === 'realtime')).toBe(true);
  });

  it('queues only the window around a later reading position, not the pages before it', async () => {
    const { extraction, plan } = await planned(40, { fromPage: 12, ahead: 2 });

    await service.runPlan(plan);

    expect(db.state.jobs.map((j) => [j.idempotency_key, j.payload.pages])).toEqual([[`extract:${extraction.id}:w11-15`, [11, 12, 13, 14, 15]]]);
  });

  it('marks the extraction failed when the plan fails for good', async () => {
    const extraction = await setupExtraction(1);
    await service.failPlan({ extraction_id: extraction.id }, new Error('pdfinfo exited with 1'));
    expect(db.state.extractions.get(extraction.id)).toMatchObject({ status: 'failed', error: 'pdfinfo exited with 1' });
  });
});

describe('startOrResume', () => {
  beforeEach(() => {
    db.reset();
    db.addBook({ id: BOOK, content_sha256: 'sha-1' });
  });

  it('creates one extraction and its plan job, and returns the same one on the next call', async () => {
    const book = db.state.books.get(BOOK);
    const first = await service.startOrResume({ book, userId: 'user-1', fromPage: 3 });
    const second = await service.startOrResume({ book, userId: 'user-1', fromPage: 9 });

    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(second.extraction.id).toBe(first.extraction.id);
    expect(db.state.extractions.size).toBe(1);
    expect(db.state.jobs).toHaveLength(1);
    expect(db.state.jobs[0]).toMatchObject({ idempotency_key: `extract:${first.extraction.id}:plan`, payload: { phase: 'plan', fromPage: 3 } });
  });

  it('shares the extraction between two books with the same PDF content', async () => {
    db.addBook({ id: 'book-2', content_sha256: 'sha-1' });
    const a = await service.startOrResume({ book: db.state.books.get(BOOK), userId: 'user-1' });
    const b = await service.startOrResume({ book: db.state.books.get('book-2'), userId: 'user-2' });
    expect(b.extraction.id).toBe(a.extraction.id);
    expect(b.extraction.source_book_id).toBe(BOOK);
  });

  it('returns the winner when a concurrent request created the extraction first', async () => {
    const book = db.state.books.get(BOOK);
    const winner = await db.createExtraction({ content_sha256: 'sha-1', source_book_id: BOOK, model: 'test/model', prompt_version: 2 });
    db.getLiveExtraction.mockResolvedValueOnce(null); // our read happened before their insert

    const { extraction } = await service.startOrResume({ book, userId: 'user-1' });

    expect(extraction.id).toBe(winner.id);
    expect(db.state.extractions.size).toBe(1);
  });

  it('queues the window at the reading position on a later open, and runs again', async () => {
    const book = db.state.books.get(BOOK);
    const { extraction } = await service.startOrResume({ book, userId: 'user-1' });
    db.addPages(BOOK, 40);
    await db.updateExtraction(extraction.id, { pages_total: 40, status: 'partial', finalized_through_page: 6 });
    db.state.jobs.forEach((j) => { j.status = 'done'; });
    for (let n = 1; n <= 6; n++) db.landPage(extraction, BOOK, n, { blocks: [] });

    const again = await service.startOrResume({ book, userId: 'user-1', fromPage: 6, ahead: 2 });

    expect(db.state.jobs.filter((j) => j.payload.phase === 'realtime').map((j) => j.payload.pages)).toEqual([[7, 8, 9]]);
    expect(again.extraction.status).toBe('running');
  });
});

describe('textWindow', () => {
  it('covers the page before, the page and ahead + 1 pages after it, wherever the page is', () => {
    expect(service.textWindow({ page: 10, ahead: 2, total: 50 })).toEqual({ first: 9, last: 13 });
    expect(service.textWindow({ page: 120, ahead: 2, total: 371 })).toEqual({ first: 119, last: 123 });
  });

  it('stays inside the book', () => {
    expect(service.textWindow({ page: 1, ahead: 2, total: 2 })).toEqual({ first: 1, last: 2 });
    expect(service.textWindow({ page: 99, ahead: 2, total: 5 })).toEqual({ first: 4, last: 5 });
  });
});

describe('ensureText', () => {
  async function partway() {
    const extraction = await setupExtraction(20);
    for (let n = 1; n <= 5; n++) db.landPage(extraction, BOOK, n, { blocks: [] });
    await db.updateExtraction(extraction.id, { status: 'partial', finalized_through_page: 5 });
    return db.state.extractions.get(extraction.id);
  }

  it('queues only the window pages that have no text and are in no active job', async () => {
    const extraction = await partway();
    db.state.jobs.push({ id: 'busy', extraction_id: extraction.id, kind: 'extract_pages', status: 'running', idempotency_key: 'k-busy', payload: { phase: 'realtime', pages: [7] } });

    const { queued, extraction: after } = await service.ensureText({ extraction, page: 5, ahead: 2, userId: 'user-2' });

    expect(queued).toEqual([6, 8]);
    expect(db.state.jobs.find((j) => j.idempotency_key === `extract:${extraction.id}:w6-8`)).toMatchObject({ user_id: 'user-2', priority: 10 });
    expect(after.status).toBe('running');
  });

  it('queues nothing on a second call for the same window', async () => {
    const extraction = await partway();
    await service.ensureText({ extraction, page: 5, ahead: 2, userId: 'user-1' });
    const second = await service.ensureText({ extraction: db.state.extractions.get(extraction.id), page: 5, ahead: 2, userId: 'user-1' });
    expect(second.queued).toEqual([]);
    expect(db.state.jobs).toHaveLength(1);
  });

  it('queues failed window pages again under a new round of keys', async () => {
    const extraction = await partway();
    await service.ensureText({ extraction, page: 5, ahead: 2, userId: 'user-1' });
    db.state.jobs[0].status = 'failed';

    await service.ensureText({ extraction, page: 5, ahead: 2, userId: 'user-1' });

    expect(db.state.jobs.map((j) => j.idempotency_key)).toEqual([`extract:${extraction.id}:w6-8`, `extract:${extraction.id}:w6-8:1`]);
  });

  it('does nothing before the plan job has counted the pages, or once the book is complete', async () => {
    const extraction = await partway();
    expect((await service.ensureText({ extraction: { ...extraction, pages_total: null }, page: 1, ahead: 2, userId: 'u' })).queued).toEqual([]);
    expect((await service.ensureText({ extraction: { ...extraction, status: 'complete' }, page: 1, ahead: 2, userId: 'u' })).queued).toEqual([]);
    expect(db.state.jobs).toHaveLength(0);
  });
});

describe('ensureContentHash', () => {
  it('hashes the PDF once, stores it and caches the bytes', async () => {
    db.reset();
    db.addBook({ id: BOOK, content_sha256: null });
    pdfSource.downloadPdf.mockResolvedValue(Buffer.from('%PDF-1.4 test'));

    const hash = await service.ensureContentHash(db.state.books.get(BOOK));

    expect(hash).toBe(pdfSource.sha256(Buffer.from('%PDF-1.4 test')));
    expect(db.state.books.get(BOOK).content_sha256).toBe(hash);
    expect(pdfSource.rememberPdf).toHaveBeenCalledWith(hash, expect.any(Buffer));
  });

  it('does not download when the hash is known', async () => {
    expect(await service.ensureContentHash({ id: BOOK, content_sha256: 'known' })).toBe('known');
    expect(pdfSource.downloadPdf).not.toHaveBeenCalled();
  });
});
