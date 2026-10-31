jest.mock('../../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../../src/services/supabaseService', () => require('../helpers/fakeSupabase')());
jest.mock('../../src/services/llm', () => ({ extractionModel: () => 'test/model' }));
jest.mock('../../src/services/extraction/pdfSource', () => ({ forgetPdf: jest.fn().mockResolvedValue() }));

const db = require('../../src/services/supabaseService');
const { finalizePrefix, resegment } = require('../../src/services/extraction/extractionService');
const { buildSegments } = require('../../src/services/extraction/segmentBuilder');
const fixtures = require('../fixtures/bakeoff-pages.json');

// Bake-off book b1 (printed pages 5-8) as a 4-page book: a sentence crosses every page break
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
const landAll = async (extraction, pages) => {
  for (const n of pages) {
    land(extraction, n);
    await finalizePrefix(extraction.id);
  }
};
const strip = (s) => ({ seq: s.seq, role: s.role, text: s.text, parts: s.parts, status: s.status, start: s.start_page, end: s.end_page });
// The whole book built in one pass, with page-anchored seqs (page × 1000 + index on the page)
const expected = () => {
  const perPage = new Map();
  return buildSegments(b1).segments.map((s) => {
    const index = perPage.get(s.startPage) || 0;
    perPage.set(s.startPage, index + 1);
    return { seq: s.startPage * 1000 + index, role: s.role, text: s.text, parts: s.parts, status: 'final', start: s.startPage, end: s.endPage };
  });
};
const extractionOf = (extraction) => db.state.extractions.get(extraction.id);

describe('finalizePrefix', () => {
  it('builds the same segments as one pass when pages land in order, seqs anchored to their page', async () => {
    const extraction = await setup();
    await landAll(extraction, [1, 2, 3, 4]);
    expect(db.segmentsOf(extraction.id).map(strip)).toEqual(expected());
    expect(extractionOf(extraction)).toMatchObject({ finalized_through_page: 4, pages_done: 4, built_runs: [[1, 4]] });
  });

  it('keeps the page-crossing paragraph open and rewrites it in place when the next page lands', async () => {
    const extraction = await setup();
    await landAll(extraction, [1]);
    const afterOne = db.segmentsOf(extraction.id);
    const open = afterOne[afterOne.length - 1];
    expect(open).toMatchObject({ status: 'open', end_page: 1 });
    expect(extractionOf(extraction)).toMatchObject({ finalized_through_page: 0, status: 'running' });

    await landAll(extraction, [2]);

    const rewritten = db.segmentsOf(extraction.id).find((s) => s.seq === open.seq);
    expect(rewritten).toMatchObject({ id: open.id, start_page: 1, end_page: 2, status: 'final' });
    expect(rewritten.text.startsWith(open.text)).toBe(true);
    afterOne.slice(0, -1).forEach((s) => expect(db.segmentsOf(extraction.id).find((r) => r.seq === s.seq)).toEqual(s));
  });

  it('builds a run that starts mid-book, its first paragraph held as head while the page before has no text', async () => {
    const extraction = await setup();
    await landAll(extraction, [3, 4]);

    const segments = db.segmentsOf(extraction.id);
    expect(segments[0]).toMatchObject({ seq: 2999, start_page: 3, status: 'head' });
    expect(segments.slice(1).map(strip)).toEqual(expected().filter((s) => s.start >= 3));
    expect(extractionOf(extraction)).toMatchObject({ built_runs: [[3, 4]], finalized_through_page: 0 });
  });

  it('joins two runs when the gap lands: the open tail and the head become one paragraph, nothing else moves', async () => {
    const extraction = await setup();
    await landAll(extraction, [3, 4, 1]);
    const before = db.segmentsOf(extraction.id).map((s) => ({ ...s }));
    expect(extractionOf(extraction).built_runs).toEqual([[1, 1], [3, 4]]);

    await landAll(extraction, [2]);

    const segments = db.segmentsOf(extraction.id);
    expect(segments.map(strip)).toEqual(expected());
    expect(segments.some((s) => s.seq === 2999)).toBe(false);
    // every paragraph that did not touch the gap keeps its seq, its id and its text (so its audio)
    before.filter((s) => s.status === 'final').forEach((s) => expect(segments.find((r) => r.seq === s.seq)).toEqual(s));
    expect(extractionOf(extraction)).toMatchObject({ built_runs: [[1, 4]], finalized_through_page: 4 });
  });

  it('builds any landing order to the same segments', async () => {
    for (const order of [[4, 2, 3, 1], [2, 4, 1, 3], [1, 3, 2, 4]]) {
      const extraction = await setup();
      await landAll(extraction, order);
      expect(db.segmentsOf(extraction.id).map(strip)).toEqual(expected());
    }
  });

  it('wakes the listening follow-ups of the extraction when a pass changes segments, not on a no-op pass', async () => {
    const extraction = await setup();
    await landAll(extraction, [1]);
    const later = new Date(Date.now() + 60000).toISOString();
    await db.enqueueJobs([{ kind: 'listen_followup', extraction_id: extraction.id, idempotency_key: 'followup:k', run_after: later }]);
    db.wakeQueuedJobs.mockClear();

    await finalizePrefix(extraction.id); // nothing new landed
    expect(db.wakeQueuedJobs).not.toHaveBeenCalled();

    await landAll(extraction, [2]);
    expect(db.wakeQueuedJobs).toHaveBeenCalledWith(extraction.id, 'listen_followup');
    expect(Date.parse(db.state.jobs.find((j) => j.idempotency_key === 'followup:k').run_after)).toBeLessThanOrEqual(Date.now());
  });

  it('is a no-op when replayed', async () => {
    const extraction = await setup();
    land(extraction, 1);
    land(extraction, 3);
    await finalizePrefix(extraction.id);
    const before = JSON.stringify(db.segmentsOf(extraction.id));
    const version = extractionOf(extraction).segment_version;
    await finalizePrefix(extraction.id);
    await finalizePrefix(extraction.id);
    expect(JSON.stringify(db.segmentsOf(extraction.id))).toBe(before);
    expect(extractionOf(extraction).segment_version).toBe(version);
  });

  it('writes nothing when a pass crashes before replace_segments commits, and the next pass catches up', async () => {
    const extraction = await setup();
    land(extraction, 1);
    land(extraction, 2);
    db.state.failNextReplace = true;
    await expect(finalizePrefix(extraction.id)).rejects.toThrow('simulated crash');
    expect(db.segmentsOf(extraction.id)).toEqual([]);
    expect(extractionOf(extraction).built_runs).toEqual([]);

    await landAll(extraction, [3, 4]); // the "restart"
    expect(db.segmentsOf(extraction.id).map(strip)).toEqual(expected());
  });

  it('starts over when another finaliser moved the segments first', async () => {
    const extraction = await setup();
    for (let n = 1; n <= 4; n++) land(extraction, n);
    db.replaceSegments.mockImplementationOnce(async () => {
      throw Object.assign(new Error('segment_version_conflict'), { code: 'SEGMENT_VERSION_CONFLICT' });
    });
    await finalizePrefix(extraction.id);
    expect(db.segmentsOf(extraction.id).map(strip)).toEqual(expected());
  });

  it('marks the extraction complete once every page has text', async () => {
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
    // page 2 ends mid-sentence and page 3 is missing: that paragraph stays open, so page 1 is final
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

describe('resegment', () => {
  async function settled(pages = [1, 2, 3, 4]) {
    const extraction = await setup();
    await landAll(extraction, pages);
    await db.updateExtraction(extraction.id, { status: 'complete' });
    return extraction;
  }

  // Segments as before page-anchored seqs (1..n) and an older merge rule: one paragraph split in two
  function storeStale(extraction) {
    const rows = db.segmentsOf(extraction.id);
    const cross = rows.find((s) => s.start_page !== s.end_page);
    const cut = cross.parts[0].chars;
    db.state.segments = db.state.segments.filter((s) => s.extraction_id !== extraction.id);
    let seq = 1;
    for (const s of rows) {
      if (s === cross) {
        db.state.segments.push({ ...s, seq: seq++, text: s.text.slice(0, cut).trim(), text_sha256: 'stale-a', end_page: s.start_page });
        db.state.segments.push({ ...s, id: `${s.id}-b`, seq: seq++, text: s.text.slice(cut), text_sha256: 'stale-b', start_page: s.end_page });
      } else {
        db.state.segments.push({ ...s, seq: seq++ });
      }
    }
    Object.assign(extractionOf(extraction), { built_runs: [] }); // as the migration leaves older extractions
    return rows.length;
  }

  it('reports what would change without writing', async () => {
    const extraction = await settled();
    const count = storeStale(extraction);
    const before = db.segmentsOf(extraction.id).map(strip);

    const result = await resegment(extraction.id);

    expect(result).toEqual({ before: count + 1, after: count, changed: 1, runs: [[1, 4]] });
    expect(db.segmentsOf(extraction.id).map(strip)).toEqual(before);
  });

  it('rewrites older segments with page-anchored seqs and records the built runs', async () => {
    const extraction = await settled();
    storeStale(extraction);

    await resegment(extraction.id, { apply: true });

    expect(db.segmentsOf(extraction.id).map(strip)).toEqual(expected());
    expect(extractionOf(extraction).built_runs).toEqual([[1, 4]]);
  });

  it('rebuilds every run of a book with gaps', async () => {
    const extraction = await settled([1, 3, 4]);
    await resegment(extraction.id, { apply: true });
    const segments = db.segmentsOf(extraction.id);
    expect(segments.find((s) => s.seq === 2999)).toMatchObject({ status: 'head' });
    expect(extractionOf(extraction).built_runs).toEqual([[1, 1], [3, 4]]);
  });

  it('refuses a running extraction', async () => {
    const extraction = await setup();
    await landAll(extraction, [1]);
    await expect(resegment(extraction.id, { apply: true })).rejects.toThrow(/running/);
  });
});
