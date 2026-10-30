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
const { BOOK, usage, cleanPage, ctx, setupExtraction, chunkJob } = require('../helpers/extractionFixtures');

beforeEach(() => {
  jest.clearAllMocks();
  config.extraction.batchEnabled = false;
  pageRenderer.renderPage.mockImplementation(async (path, page) => ({ png: Buffer.from(`png-${page}`), sha256: `img-${page}` }));
  llm.extractBlocks.mockImplementation(async () => cleanPage(1));
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
