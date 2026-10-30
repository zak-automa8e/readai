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
const pageRenderer = require('../../src/services/extraction/pageRenderer');
const service = require('../../src/services/extraction/extractionService');
const { BOOK, b3p9, usage, cleanPage, ctx, setupExtraction, chunkJob } = require('../helpers/extractionFixtures');

beforeEach(() => {
  jest.clearAllMocks();
  config.extraction.batchEnabled = false;
  pageRenderer.renderPage.mockImplementation(async (path, page) => ({ png: Buffer.from(`png-${page}`), sha256: `img-${page}` }));
  llm.extractBlocks.mockImplementation(async () => cleanPage(1));
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
