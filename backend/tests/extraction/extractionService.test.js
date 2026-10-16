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
const fixtures = require('../fixtures/bakeoff-pages.json');

const BOOK = 'book-1';
const b3p9 = fixtures.books.find((b) => b.key === 'b3').pages.find((p) => p.page === 9);
const usage = (cost = 0.004) => ({ promptTokens: 2329, completionTokens: 700, reasoningTokens: 0, cachedTokens: 0, costUsd: cost, provider: 'openrouter', model: 'test/model-dated' });
const cleanPage = (n) => ({
  blocks: [
    { role: 'running_header', text: 'عنوان الكتاب' },
    { role: 'body', text: `نص الصفحة ${n} كاملا.`, starts_mid_sentence: false, ends_mid_sentence: false },
    { role: 'page_number', text: String(n) },
  ],
  pageType: 'body',
  usage: usage(),
});
const ctx = { updatePayload: jest.fn().mockResolvedValue(true) };

async function setupExtraction(total = 4) {
  db.reset();
  db.addBook({ id: BOOK, content_sha256: 'sha-1' });
  db.addPages(BOOK, total);
  const extraction = await db.createExtraction({ content_sha256: 'sha-1', source_book_id: BOOK, model: 'test/model', prompt_version: 2, started_by: 'user-1' });
  await db.updateExtraction(extraction.id, { pages_total: total, status: 'running' });
  return db.state.extractions.get(extraction.id);
}

function chunkJob(extraction, pages, phase = 'realtime', extra = {}) {
  return { id: 'job-chunk', kind: 'extract_pages', book_id: BOOK, user_id: 'user-1', extraction_id: extraction.id, attempts: 1, max_attempts: 5, payload: { phase, pages, ...extra } };
}

beforeEach(() => {
  jest.clearAllMocks();
  config.extraction.batchEnabled = false;
  pageRenderer.renderPage.mockImplementation(async (path, page) => ({ png: Buffer.from(`png-${page}`), sha256: `img-${page}` }));
  llm.extractBlocks.mockImplementation(async () => cleanPage(1));
});

describe('planChunks', () => {
  it('puts the ten pages from the reading position first, then the pages before it, then the tail', () => {
    const plan = service.planChunks({ total: 40, fromPage: 12 });
    expect(plan[0]).toMatchObject({ first: 12, last: 21, mode: 'realtime', priority: 10 });
    expect(plan.slice(1, 3).map((c) => [c.first, c.last, c.mode])).toEqual([[1, 10, 'realtime'], [11, 11, 'realtime']]);
    expect(plan.slice(3).map((c) => [c.first, c.last])).toEqual([[22, 31], [32, 40]]);
    const priorities = plan.map((c) => c.priority);
    expect([...priorities].sort((a, b) => a - b)).toEqual(priorities);
    expect(plan.flatMap((c) => c.pages).sort((a, b) => a - b)).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
  });

  it('sends the tail to the batch API in chunks of 50 when batch is enabled', () => {
    const plan = service.planChunks({ total: 130, fromPage: 1, batchEnabled: true });
    expect(plan.map((c) => [c.first, c.last, c.mode])).toEqual([[1, 10, 'realtime'], [11, 60, 'batch'], [61, 110, 'batch'], [111, 130, 'batch']]);
  });

  it('clamps the reading position to the book', () => {
    expect(service.planChunks({ total: 5, fromPage: 99 })[0]).toMatchObject({ first: 5, last: 5 });
    expect(service.planChunks({ total: 5 })[0]).toMatchObject({ first: 1, last: 5 });
  });
});

describe('extractPage validation retry', () => {
  it('retries the «أserver» page once at medium, then keeps it as suspect', async () => {
    llm.extractBlocks.mockResolvedValue({ blocks: b3p9.blocks, pageType: 'body', usage: usage(0.005) });

    const outcome = await service.extractPage(Buffer.from('png'));

    expect(llm.extractBlocks.mock.calls.map(([args]) => args.reasoning)).toEqual(['minimal', 'medium']);
    expect(outcome.validation).toMatchObject({ ok: false, suspect: true, retried: true });
    expect(outcome.validation.issues[0]).toMatchObject({ type: 'latin_glue' });
    expect(outcome.calls).toHaveLength(2);
  });

  it('keeps the medium result when it passes', async () => {
    const fixed = { blocks: [{ role: 'body', text: 'تأملت أن أثمار.' }], pageType: 'body', usage: usage() };
    llm.extractBlocks
      .mockResolvedValueOnce({ blocks: b3p9.blocks, pageType: 'body', usage: usage() })
      .mockResolvedValueOnce(fixed);

    const outcome = await service.extractPage(Buffer.from('png'));

    expect(outcome.result).toBe(fixed);
    expect(outcome.validation).toMatchObject({ ok: true, suspect: false, retried: true });
    expect(outcome.validation.firstIssues[0].type).toBe('latin_glue');
  });

  it('does not retry a clean page', async () => {
    await service.extractPage(Buffer.from('png'));
    expect(llm.extractBlocks).toHaveBeenCalledTimes(1);
  });

  it('saves the suspect page anyway through a chunk run', async () => {
    const extraction = await setupExtraction(1);
    llm.extractBlocks.mockResolvedValue({ blocks: b3p9.blocks, pageType: 'body', usage: usage(0.005) });

    await service.runChunk(chunkJob(extraction, [1]), ctx);

    const saved = db.state.pageTexts.get(db.pageId(BOOK, 1));
    expect(saved.validation.suspect).toBe(true);
    expect(saved.blocks).toBe(b3p9.blocks);
    expect(saved.cost_micros).toBe(10000);
  });
});

describe('runChunk (realtime)', () => {
  it('saves blocks, page type, recipe keys, legacy text, usage and cost for every page', async () => {
    const extraction = await setupExtraction(2);
    llm.extractBlocks.mockImplementation(async () => cleanPage(7));

    await service.runChunk(chunkJob(extraction, [1, 2]), ctx);

    const saved = db.state.pageTexts.get(db.pageId(BOOK, 1));
    expect(saved).toMatchObject({
      extraction_id: extraction.id,
      prompt_version: 2,
      model: 'test/model',
      image_sha256: 'img-1',
      page_type: 'body',
      cost_micros: 4000,
      extraction_confidence: 0.95,
    });
    expect(saved.extracted_text).toEqual({ header: '', body: 'نص الصفحة 7 كاملا.', footer: '7' });
    expect(saved.usage).toMatchObject({ promptTokens: 2329, completionTokens: 700, costUsd: 0.004 });
    expect(saved.validation).toMatchObject({ ok: true, suspect: false });
    expect(db.state.costs).toHaveLength(2);
    expect(db.state.costs[0]).toMatchObject({ user_id: 'user-1', book_id: BOOK, text_extraction_cost: 0.004, tokens_used_text: 3029 });
  });

  it('finalises segments as pages finish', async () => {
    const extraction = await setupExtraction(2);
    await service.runChunk(chunkJob(extraction, [1, 2]), ctx);
    const segments = db.segmentsOf(extraction.id);
    expect(segments.map((s) => [s.seq, s.start_page, s.status])).toEqual([[1, 1, 'final'], [2, 2, 'final']]);
    expect(segments[0].text_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(db.state.extractions.get(extraction.id)).toMatchObject({ finalized_through_page: 2, pages_done: 2, status: 'complete' });
  });

  it('does not settle the extraction or drop the PDF while its last chunk still has pages to do', async () => {
    const extraction = await setupExtraction(4);
    const job = chunkJob(extraction, [1, 2, 3, 4]);
    db.state.jobs.push({ ...job, status: 'running' });
    pageRenderer.renderPage.mockImplementation(async (path, page) => {
      if (page === 4) throw new Error('render failed');
      return { png: Buffer.from(`png-${page}`), sha256: `img-${page}` };
    });

    await expect(service.runChunk(job, ctx)).rejects.toThrow();
    await new Promise((resolve) => setImmediate(resolve));

    expect(db.state.extractions.get(extraction.id).status).toBe('running');
    expect(pdfSource.forgetPdf).not.toHaveBeenCalled();
  });

  it('skips pages this extraction already saved, without rendering them (job replay after a crash)', async () => {
    const extraction = await setupExtraction(3);
    await service.runChunk(chunkJob(extraction, [1, 2]), ctx);
    pageRenderer.renderPage.mockClear();
    llm.extractBlocks.mockClear();

    await service.runChunk(chunkJob(extraction, [1, 2, 3]), ctx);

    expect(pageRenderer.renderPage.mock.calls.map((c) => c[1])).toEqual([3]);
    expect(llm.extractBlocks).toHaveBeenCalledTimes(1);
    expect(db.state.pageTexts.size).toBe(3);
  });

  it('reuses a stored page with the same image and recipe without a model call', async () => {
    const extraction = await setupExtraction(1);
    db.state.pageTexts.set(db.pageId(BOOK, 1), {
      page_id: db.pageId(BOOK, 1), extraction_id: 'old-failed-extraction', prompt_version: 2, model: 'test/model', image_sha256: 'img-1', blocks: cleanPage(1).blocks,
    });

    await service.runChunk(chunkJob(extraction, [1]), ctx);

    expect(llm.extractBlocks).not.toHaveBeenCalled();
    expect(db.state.pageTexts.get(db.pageId(BOOK, 1)).extraction_id).toBe(extraction.id);
  });

  it('re-extracts a legacy page_text row (no image hash) and overwrites it in place', async () => {
    const extraction = await setupExtraction(1);
    db.state.pageTexts.set(db.pageId(BOOK, 1), { page_id: db.pageId(BOOK, 1), extracted_text: '{"header":"","body":"old"}' });

    await service.runChunk(chunkJob(extraction, [1]), ctx);

    expect(llm.extractBlocks).toHaveBeenCalledTimes(1);
    expect(db.state.pageTexts.size).toBe(1);
    expect(db.state.pageTexts.get(db.pageId(BOOK, 1)).extraction_id).toBe(extraction.id);
  });

  it('keeps the pages that worked and throws so the job retries the rest', async () => {
    const extraction = await setupExtraction(3);
    llm.extractBlocks.mockImplementation(async () => cleanPage(1));
    pageRenderer.renderPage.mockImplementation(async (path, page) => {
      if (page === 2) throw new Error('pdftoppm exited with 1');
      return { png: Buffer.from(`png-${page}`), sha256: `img-${page}` };
    });

    await expect(service.runChunk(chunkJob(extraction, [1, 2, 3]), ctx)).rejects.toThrow('1 page(s) failed: p2');
    expect([...db.state.pageTexts.keys()].sort()).toEqual([db.pageId(BOOK, 1), db.pageId(BOOK, 3)].sort());
  });

  it('marks the chunk error non-retriable when the provider spend limit is hit', async () => {
    const extraction = await setupExtraction(1);
    llm.extractBlocks.mockRejectedValue(Object.assign(new Error('key limit'), { status: 402, nonRetriable: true }));

    const error = await service.runChunk(chunkJob(extraction, [1]), ctx).catch((e) => e);

    expect(error.nonRetriable).toBe(true);
  });

  it('does nothing for a failed extraction', async () => {
    const extraction = await setupExtraction(1);
    db.state.extractions.get(extraction.id).status = 'failed';
    await service.runChunk(chunkJob(extraction, [1]), ctx);
    expect(pageRenderer.renderPage).not.toHaveBeenCalled();
  });
});

describe('runPlan', () => {
  it('counts pages, creates page rows, writes total_pages and enqueues the chunks once', async () => {
    db.reset();
    db.addBook({ id: BOOK, content_sha256: 'sha-1' });
    db.addBook({ id: 'book-2', content_sha256: 'sha-1' });
    db.addPages(BOOK, 3); // legacy rows for the first pages already exist
    const extraction = await db.createExtraction({ content_sha256: 'sha-1', source_book_id: BOOK, model: 'test/model', prompt_version: 2 });
    pageRenderer.pageCount.mockResolvedValue(25);
    const plan = { id: 'job-plan', book_id: 'book-2', user_id: 'user-1', extraction_id: extraction.id, payload: { phase: 'plan', fromPage: 1 } };

    await service.runPlan(plan);
    await service.runPlan(plan); // replay after a lost lease

    expect(db.state.pages.filter((p) => p.book_id === BOOK)).toHaveLength(25);
    expect(db.state.books.get(BOOK).total_pages).toBe(25);
    expect(db.state.books.get('book-2').total_pages).toBe(25);
    expect(db.state.extractions.get(extraction.id)).toMatchObject({ pages_total: 25, status: 'running' });
    expect(db.state.jobs.map((j) => j.idempotency_key)).toEqual([
      `extract:${extraction.id}:1-10`, `extract:${extraction.id}:11-20`, `extract:${extraction.id}:21-25`,
    ]);
    expect(db.state.jobs.every((j) => j.book_id === BOOK && j.payload.phase === 'realtime')).toBe(true);
  });

  it('marks the extraction failed when the plan fails for good', async () => {
    const extraction = await setupExtraction(1);
    await service.failPlan({ extraction_id: extraction.id }, new Error('pdfinfo exited with 1'));
    expect(db.state.extractions.get(extraction.id)).toMatchObject({ status: 'failed', error: 'pdfinfo exited with 1' });
  });
});

describe('runChunk (batch)', () => {
  beforeEach(() => {
    config.extraction.batchEnabled = true;
  });

  it('uploads the page images, submits one batch, saves its id at once and comes back to poll', async () => {
    const extraction = await setupExtraction(2);
    llm.submitExtractionBatch.mockResolvedValue({ batchId: 'batch-1', status: 'validating' });

    const result = await service.runChunk(chunkJob(extraction, [1, 2], 'batch'), ctx);

    expect(llm.submitExtractionBatch).toHaveBeenCalledWith([
      { customId: 'p1', imageUrl: expect.stringMatching(/^https:\/\/signed\.test\/extraction-pages\//) },
      { customId: 'p2', imageUrl: expect.stringMatching(/^https:\/\/signed\.test\/extraction-pages\//) },
    ], { reasoning: 'minimal' });
    expect(ctx.updatePayload).toHaveBeenCalledWith(expect.objectContaining({ batch: expect.objectContaining({ id: 'batch-1' }) }));
    expect(result.requeue.delayMs).toBe(config.extraction.batchPollMs);
    expect(result.requeue.payload.batch.pages[1]).toMatchObject({ imageSha256: 'img-1' });
    expect(db.state.files.size).toBe(2);
    expect(llm.extractBlocks).not.toHaveBeenCalled();
  });

  it('re-queues while the batch runs', async () => {
    const extraction = await setupExtraction(1);
    llm.getExtractionBatch.mockResolvedValue({ status: 'in_progress', done: false, results: [] });
    const batch = { id: 'batch-1', submittedAt: new Date().toISOString(), pages: { 1: { pageId: db.pageId(BOOK, 1), imageSha256: 'img-1', path: 'p/1.png' } } };

    const result = await service.runChunk(chunkJob(extraction, [1], 'batch', { batch }), ctx);

    expect(result.requeue.payload.batch.id).toBe('batch-1');
  });

  it('saves finished results, runs failed ones realtime and removes the uploaded images', async () => {
    const extraction = await setupExtraction(2);
    db.state.files.set('p/1.png', 'x');
    db.state.files.set('p/2.png', 'x');
    llm.getExtractionBatch.mockResolvedValue({
      status: 'completed',
      done: true,
      results: [
        { customId: 'p1', ...cleanPage(1), raw: '{}', usage: { ...usage(0.002), batch: true }, error: null },
        { customId: 'p2', raw: null, usage: null, error: 'status 500' },
      ],
    });
    const batch = {
      id: 'batch-1',
      submittedAt: new Date().toISOString(),
      pages: {
        1: { pageId: db.pageId(BOOK, 1), imageSha256: 'img-1', path: 'p/1.png' },
        2: { pageId: db.pageId(BOOK, 2), imageSha256: 'img-2', path: 'p/2.png' },
      },
    };

    const result = await service.runChunk(chunkJob(extraction, [1, 2], 'batch', { batch }), ctx);

    expect(result).toBeNull();
    expect(db.state.pageTexts.get(db.pageId(BOOK, 1))).toMatchObject({ cost_micros: 2000, extraction_metadata: expect.objectContaining({ mode: 'batch' }) });
    expect(db.state.pageTexts.get(db.pageId(BOOK, 2)).extraction_metadata.mode).toBe('realtime');
    expect(llm.extractBlocks).toHaveBeenCalledTimes(1);
    expect(db.state.files.size).toBe(0);
  });

  it('runs a batch chunk realtime when batch is switched off', async () => {
    config.extraction.batchEnabled = false;
    const extraction = await setupExtraction(1);
    await service.runChunk(chunkJob(extraction, [1], 'batch'), ctx);
    expect(llm.submitExtractionBatch).not.toHaveBeenCalled();
    expect(llm.extractBlocks).toHaveBeenCalledTimes(1);
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

  it('re-queues only the missing pages once no job is left, under a new round of keys', async () => {
    const book = db.state.books.get(BOOK);
    const { extraction } = await service.startOrResume({ book, userId: 'user-1' });
    db.addPages(BOOK, 4);
    await db.updateExtraction(extraction.id, { pages_total: 4, status: 'partial', pages_failed: 2 });
    db.state.jobs.forEach((j) => { j.status = 'done'; });
    db.state.jobs.push({ id: 'failed-job', extraction_id: extraction.id, status: 'failed', idempotency_key: `extract:${extraction.id}:1-4`, payload: { phase: 'realtime', pages: [1, 2, 3, 4] } });
    db.landPage(extraction, BOOK, 1, { blocks: [] });
    db.landPage(extraction, BOOK, 2, { blocks: [] });

    const again = await service.startOrResume({ book, userId: 'user-1' });
    await service.startOrResume({ book, userId: 'user-1' }); // still queued: no second round

    const retries = db.state.jobs.filter((j) => j.idempotency_key.includes(':retry'));
    expect(retries).toHaveLength(1);
    expect(retries[0]).toMatchObject({ idempotency_key: `extract:${extraction.id}:retry1:3-4`, payload: { phase: 'realtime', pages: [3, 4] } });
    expect(again.extraction.status).toBe('running');
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
