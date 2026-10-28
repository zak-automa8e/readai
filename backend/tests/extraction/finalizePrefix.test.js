jest.mock('../../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../../src/services/supabaseService', () => require('../helpers/fakeSupabase')());
jest.mock('../../src/services/llm', () => ({ extractionModel: () => 'test/model' }));
jest.mock('../../src/services/extraction/pdfSource', () => ({ forgetPdf: jest.fn().mockResolvedValue() }));

const db = require('../../src/services/supabaseService');
const { finalizePrefix } = require('../../src/services/extraction/extractionService');
const { buildSegments } = require('../../src/services/extraction/segmentBuilder');
const fixtures = require('../fixtures/bakeoff-pages.json');

// Bake-off book b1 (printed pages 5-8, three page-crossing sentences) as a 4-page book
const b1 = fixtures.books.find((b) => b.key === 'b1').pages.map((p, i) => ({ page: i + 1, blocks: p.blocks }));
const BOOK = 'book-1';

async function setup(total = 4) {
  db.reset();
  db.addBook({ id: BOOK, content_sha256: 'sha-1' });
  db.addPages(BOOK, total);
  const extraction = await db.createExtraction({ content_sha256: 'sha-1', source_book_id: BOOK, model: 'test/model', prompt_version: 2 });
  await db.updateExtraction(extraction.id, { pages_total: total, status: 'running' });
  // one chunk job still to run keeps the extraction 'running'
  await db.enqueueJobs([{ kind: 'extract_pages', extraction_id: extraction.id, idempotency_key: 'k-open', payload: { phase: 'realtime', pages: [] } }]);
  return extraction;
}

const land = (extraction, n) => db.landPage(extraction, BOOK, n, { blocks: b1[n - 1].blocks });
const strip = (s) => ({ seq: s.seq, role: s.role, text: s.text, parts: s.parts, status: s.status, start: s.start_page, end: s.end_page });
const expected = () => buildSegments(b1).segments.map((s, i) => ({
  seq: i + 1, role: s.role, text: s.text, parts: s.parts, status: 'final', start: s.startPage, end: s.endPage,
}));

describe('finalizePrefix', () => {
  it('builds the same segments as one pass when pages land in order, seq 1..n without gaps', async () => {
    const extraction = await setup();
    for (let n = 1; n <= 4; n++) {
      land(extraction, n);
      await finalizePrefix(extraction.id);
    }
    const segments = db.segmentsOf(extraction.id);
    expect(segments.map(strip)).toEqual(expected());
    expect(segments.map((s) => s.seq)).toEqual(segments.map((_, i) => i + 1));
    expect(db.state.extractions.get(extraction.id)).toMatchObject({ finalized_through_page: 4, pages_done: 4 });
  });

  it('keeps the page-crossing paragraph open and rewrites it in place when the next page lands', async () => {
    const extraction = await setup();
    land(extraction, 1);
    await finalizePrefix(extraction.id);

    const afterOne = db.segmentsOf(extraction.id);
    const open = afterOne[afterOne.length - 1];
    expect(open.status).toBe('open');
    expect(open.end_page).toBe(1);
    expect(db.state.extractions.get(extraction.id).finalized_through_page).toBe(0);
    expect(db.state.extractions.get(extraction.id).status).toBe('running');

    land(extraction, 2);
    await finalizePrefix(extraction.id);

    const rewritten = db.segmentsOf(extraction.id).find((s) => s.seq === open.seq);
    expect(rewritten.id).toBe(open.id);
    expect(rewritten.start_page).toBe(1);
    expect(rewritten.end_page).toBe(2);
    expect(rewritten.text.startsWith(open.text)).toBe(true);
    expect(rewritten.status).toBe('final');
    // earlier segments untouched, nothing renumbered
    afterOne.slice(0, -1).forEach((s) => expect(db.segmentsOf(extraction.id).find((r) => r.seq === s.seq)).toEqual(s));
  });

  it('wakes the listening follow-ups of the extraction when a pass closes segments, not on a no-op pass', async () => {
    const extraction = await setup();
    land(extraction, 1);
    await finalizePrefix(extraction.id);
    const later = new Date(Date.now() + 60000).toISOString();
    await db.enqueueJobs([{ kind: 'listen_followup', extraction_id: extraction.id, idempotency_key: 'followup:k', run_after: later }]);
    db.wakeQueuedJobs.mockClear();

    await finalizePrefix(extraction.id); // nothing new landed
    expect(db.wakeQueuedJobs).not.toHaveBeenCalled();

    land(extraction, 2);
    await finalizePrefix(extraction.id);
    expect(db.wakeQueuedJobs).toHaveBeenCalledWith(extraction.id, 'listen_followup');
    expect(Date.parse(db.state.jobs.find((j) => j.idempotency_key === 'followup:k').run_after)).toBeLessThanOrEqual(Date.now());
  });

  it('waits for the gap when pages land out of order', async () => {
    const extraction = await setup();
    land(extraction, 3);
    await finalizePrefix(extraction.id);
    expect(db.segmentsOf(extraction.id)).toEqual([]);

    land(extraction, 1);
    await finalizePrefix(extraction.id);
    land(extraction, 4);
    await finalizePrefix(extraction.id);
    expect(Math.max(...db.segmentsOf(extraction.id).map((s) => s.end_page))).toBe(1);

    land(extraction, 2);
    await finalizePrefix(extraction.id);
    expect(db.segmentsOf(extraction.id).map(strip)).toEqual(expected());
  });

  it('is a no-op when replayed', async () => {
    const extraction = await setup();
    land(extraction, 1);
    land(extraction, 2);
    await finalizePrefix(extraction.id);
    const before = JSON.stringify(db.segmentsOf(extraction.id));
    await finalizePrefix(extraction.id);
    await finalizePrefix(extraction.id);
    expect(JSON.stringify(db.segmentsOf(extraction.id))).toBe(before);
  });

  it('recovers without duplicates after a crash between writing segments and moving the prefix', async () => {
    const extraction = await setup();
    land(extraction, 1);
    land(extraction, 2);
    db.state.failNextExtractionUpdate = true;
    await expect(finalizePrefix(extraction.id)).rejects.toThrow('simulated crash');
    expect(db.state.extractions.get(extraction.id).finalized_through_page).toBe(0); // stale

    land(extraction, 3);
    land(extraction, 4);
    await finalizePrefix(extraction.id); // the "restart"

    const segments = db.segmentsOf(extraction.id);
    expect(segments.map(strip)).toEqual(expected());
    expect(new Set(segments.map((s) => s.text)).size).toBe(segments.length);
  });

  it('recovers from the same crash when the last stored segment is already final', async () => {
    const extraction = await setup();
    for (let n = 1; n <= 4; n++) land(extraction, n);
    db.state.failNextExtractionUpdate = true;
    await expect(finalizePrefix(extraction.id)).rejects.toThrow('simulated crash');

    await finalizePrefix(extraction.id);

    expect(db.segmentsOf(extraction.id).map(strip)).toEqual(expected());
    expect(db.state.extractions.get(extraction.id).finalized_through_page).toBe(4);
  });

  it('continues seq after the last stored segment when a new run resumes the book', async () => {
    const extraction = await setup();
    land(extraction, 1);
    land(extraction, 2);
    await finalizePrefix(extraction.id);
    const firstRun = db.segmentsOf(extraction.id).map((s) => ({ ...s }));

    // a new process: nothing in memory, everything derived from the tables
    jest.resetModules();
    jest.doMock('../../src/services/supabaseService', () => db);
    const fresh = require('../../src/services/extraction/extractionService');
    land(extraction, 3);
    land(extraction, 4);
    await fresh.finalizePrefix(extraction.id);

    const segments = db.segmentsOf(extraction.id);
    expect(segments.map((s) => s.seq)).toEqual(segments.map((_, i) => i + 1));
    firstRun.filter((s) => s.status === 'final').forEach((s) => expect(segments.find((r) => r.seq === s.seq)).toEqual(s));
    expect(segments.map(strip)).toEqual(expected());
  });

  it('marks the extraction complete once every page is in final segments', async () => {
    const extraction = await setup();
    db.state.jobs = []; // nothing left to run
    for (let n = 1; n <= 4; n++) land(extraction, n);
    const updated = await finalizePrefix(extraction.id);
    expect(updated).toMatchObject({ status: 'complete', finalized_through_page: 4, pages_done: 4, pages_failed: 0 });
    expect(updated.finished_at).toBeTruthy();
  });

  it('settles as partial with the failed pages listed when a chunk failed for good', async () => {
    const extraction = await setup();
    db.state.jobs = [{ id: 'job-x', kind: 'extract_pages', extraction_id: extraction.id, status: 'failed', idempotency_key: 'k', payload: { phase: 'realtime', pages: [3, 4] } }];
    land(extraction, 1);
    land(extraction, 2);
    const updated = await finalizePrefix(extraction.id);
    // page 2 ends mid-sentence and page 3 is missing: that paragraph stays open, so the prefix is page 1
    expect(updated).toMatchObject({ status: 'partial', pages_done: 2, pages_failed: 2, finalized_through_page: 1 });
    expect(db.segmentsOf(extraction.id).pop().status).toBe('open');
  });

  it('does not count the calling job as outstanding', async () => {
    const extraction = await setup();
    const job = db.state.jobs[0];
    job.status = 'running';
    for (let n = 1; n <= 3; n++) land(extraction, n);
    db.state.jobs.push({ id: 'job-f', kind: 'extract_pages', extraction_id: extraction.id, status: 'failed', idempotency_key: 'k2', payload: { phase: 'realtime', pages: [4] } });
    const updated = await finalizePrefix(extraction.id, { excludeJobId: job.id });
    expect(updated.status).toBe('partial');
  });

  it('settles once its page jobs are done even while audio and follow-up jobs of the extraction are queued', async () => {
    const extraction = await setup();
    db.state.jobs[0].status = 'done';
    db.state.jobs.push(
      { id: 'job-t', kind: 'tts_segment', extraction_id: extraction.id, status: 'queued', idempotency_key: 'tts:k', payload: {} },
      { id: 'job-l', kind: 'listen_followup', extraction_id: extraction.id, status: 'queued', idempotency_key: 'followup:k', payload: {} },
    );
    for (let n = 1; n <= 3; n++) land(extraction, n); // page 4 never extracted
    const updated = await finalizePrefix(extraction.id);
    expect(updated.status).toBe('partial');
  });

  it('serialises passes started at the same time', async () => {
    const extraction = await setup();
    for (let n = 1; n <= 4; n++) land(extraction, n);
    await Promise.all([1, 2, 3, 4].map(() => finalizePrefix(extraction.id)));
    expect(db.segmentsOf(extraction.id).map(strip)).toEqual(expected());
  });
});
