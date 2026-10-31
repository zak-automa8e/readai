const crypto = require('crypto');
const logger = require('../../utils/logger');
const supabaseService = require('../supabaseService');
const pdfSource = require('./pdfSource');
const { buildSegments } = require('./segmentBuilder');
const jobRunner = require('../jobs/jobRunner');

const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

/**
 * Turns done pages into segments and rebuilds settled extractions (spec §5.2, listen-ahead story 2).
 *
 * Text arrives a few pages at a time wherever listeners are, so the done pages form runs anywhere
 * in the book. book_extractions.built_runs lists the pages whose segments are built; a pass rebuilds
 * the region around the pages done since, and replace_segments swaps that region's rows and moves
 * built_runs in one transaction (compare-and-set on segment_version).
 *
 * seq = start_page × 1000 + the segment's index among those starting on that page (a head: the seq
 * just before its page): stable while other runs are built, with gaps between runs. A run's first paragraph is 'head' while the page
 * before it has no text (it may continue that page); its last is 'open' while its sentence may go
 * on to the next page. Both are rebuilt when the neighbouring page lands, and never voiced.
 */

const SEQ_PER_PAGE = 1000;
const VERSION_CONFLICT = 'SEGMENT_VERSION_CONFLICT';

/** Sorted page numbers → [[first, last], ...] of consecutive pages. */
function runsOf(pages) {
  const runs = [];
  for (const n of pages) {
    const last = runs[runs.length - 1];
    if (last && n === last[1] + 1) last[1] = n;
    else runs.push([n, n]);
  }
  return runs;
}

function pagesOfRuns(runs) {
  const pages = new Set();
  for (const [first, last] of runs) for (let n = first; n <= last; n++) pages.add(n);
  return pages;
}

const addRun = (runs, run) => runsOf([...pagesOfRuns([...runs, run])].sort((a, b) => a - b));

function segmentRow(extractionId, seq, segment) {
  return {
    extraction_id: extractionId,
    seq,
    role: segment.role,
    start_page: segment.startPage,
    end_page: segment.endPage,
    parts: segment.parts,
    text: segment.text,
    text_sha256: sha256(segment.text),
    char_count: segment.charCount,
    sentence_offsets: segment.sentenceOffsets,
    footnote_markers: segment.footnoteMarkers,
    status: segment.status,
  };
}

/**
 * Segment rows for consecutive pages, with page-anchored seqs. The first is 'head' when it is body
 * text on the first page and the page before has no text yet. A head takes the seq just before its
 * page (page × 1000 − 1, where the previous page, having no text, has no segments), so the page's
 * own paragraphs keep their seqs when the head later merges into the paragraph before it.
 * @param {{moreToCome: boolean, headUnknown: boolean}} options
 */
function regionRows(extractionId, pages, { moreToCome, headUnknown }) {
  const { segments } = buildSegments(pages, { moreToCome });
  const perPage = new Map();
  return segments.map((segment, i) => {
    if (i === 0 && headUnknown && segment.role === 'body' && segment.startPage === pages[0].page) {
      return segmentRow(extractionId, segment.startPage * SEQ_PER_PAGE - 1, { ...segment, status: 'head' });
    }
    const index = perPage.get(segment.startPage) || 0;
    perPage.set(segment.startPage, index + 1);
    return segmentRow(extractionId, segment.startPage * SEQ_PER_PAGE + index, segment);
  });
}

/**
 * Widen the new pages [from, to] to clean page breaks: no stored segment crosses an edge, and the
 * paragraph on either side is settled (an 'open' or 'head' one next to the new pages is rebuilt).
 */
async function regionFor(extractionId, from, to) {
  let first = from;
  let last = to;
  for (;;) {
    const before = await supabaseService.getSegmentsTouching(extractionId, first - 1, first);
    const left = before.filter((s) => s.start_page < first && (s.end_page >= first || s.status !== 'final'));
    const after = await supabaseService.getSegmentsTouching(extractionId, last, last + 1);
    const right = after.filter((s) => s.end_page > last && (s.start_page <= last || s.status === 'head'));
    const widerFirst = Math.min(first, ...left.map((s) => s.start_page));
    const widerLast = Math.max(last, ...right.map((s) => s.end_page));
    if (widerFirst === first && widerLast === last) return [first, last];
    first = widerFirst;
    last = widerLast;
  }
}

async function failedPagesOf(extractionId, jobs, doneAfter) {
  const candidates = new Set();
  jobs.filter((job) => job.status === 'failed' && job.payload?.phase !== 'plan')
    .forEach((job) => (job.payload?.pages || []).forEach((n) => candidates.add(n)));
  if (!candidates.size) return [];
  const done = new Set(doneAfter || await supabaseService.getDonePageNumbers(extractionId, Math.min(...candidates) - 1));
  return [...candidates].filter((n) => !done.has(n)).sort((a, b) => a - b);
}

// The last page whose text is all in final segments, counting from page 1 (0 when page 1 has no text)
async function finalizedThrough(extractionId, runs) {
  const [first, last] = runs[0] || [];
  if (first !== 1) return 0;
  const tail = await supabaseService.getSegmentBefore(extractionId, (last + 1) * SEQ_PER_PAGE);
  return tail && tail.status !== 'final' ? tail.start_page - 1 : last;
}

/**
 * Build the segments of the done runs that have new pages (every run when `rebuild`), one
 * replace_segments per run.
 * @returns {Promise<{changed: boolean, done: number[], runs: number[][]}>}
 */
async function buildRuns(extraction, { rebuild = false } = {}) {
  const total = extraction.pages_total;
  const done = await supabaseService.getDonePageNumbers(extraction.id, 0);
  const doneSet = new Set(done);
  let built = rebuild ? [] : (extraction.built_runs || []);
  const builtPages = pagesOfRuns(built);
  let version = extraction.segment_version || 0;
  let changed = false;

  for (const run of runsOf(done)) {
    const fresh = [];
    for (let n = run[0]; n <= run[1]; n++) if (!builtPages.has(n)) fresh.push(n);
    if (!fresh.length) continue;
    const [from, to] = rebuild ? run : await regionFor(extraction.id, fresh[0], fresh[fresh.length - 1]);
    const pages = await supabaseService.getPageBlocksRange(extraction.id, from, to);
    const rows = regionRows(extraction.id, pages, {
      moreToCome: to < total && !doneSet.has(to + 1),
      headUnknown: from > 1 && !doneSet.has(from - 1),
    });
    built = addRun(built, run);
    version = await supabaseService.replaceSegments(extraction.id, { fromPage: from, toPage: to, rows, builtRuns: built, expectVersion: version });
    changed = true;
  }
  return { changed, done, runs: runsOf(done) };
}

async function finalizeOnce(extractionId, { excludeJobId = null, rebuild = false } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const extraction = await supabaseService.getExtractionById(extractionId);
    if (!extraction || extraction.status === 'failed' || !extraction.pages_total) return extraction;
    const total = extraction.pages_total;

    let built;
    try {
      built = await buildRuns(extraction, { rebuild });
    } catch (error) {
      if (error.code !== VERSION_CONFLICT) throw error;
      logger.warn('Segments changed under us; another finaliser is running (run ONE job process)', { extractionId });
      continue;
    }
    const { changed, done, runs } = built;

    const jobs = await supabaseService.getExtractionJobs(extractionId);
    const failedPages = await failedPagesOf(extractionId, jobs, done);
    const outstanding = jobs.filter((job) => (job.status === 'queued' || job.status === 'running') && job.id !== excludeJobId).length;
    const status = done.length >= total ? 'complete' : outstanding > 0 ? 'running' : 'partial';

    const updated = await supabaseService.updateExtraction(extractionId, {
      finalized_through_page: await finalizedThrough(extractionId, runs),
      pages_done: done.length,
      pages_failed: failedPages.length,
      status,
      finished_at: status === 'running' ? null : (extraction.finished_at || new Date().toISOString()),
    });

    if (status !== 'running' && extraction.status === 'running') {
      logger.info('Extraction settled', { extractionId, status, pagesDone: done.length, pagesFailed: failedPages.length, runs });
      pdfSource.forgetPdf(extraction.content_sha256).catch(() => {});
    }
    if (changed || status !== 'running') await wakeFollowups(extractionId);
    return updated;
  }
  throw new Error(`Could not finalize extraction ${extractionId}: concurrent updates`);
}

/**
 * Rebuild a settled extraction's segments from its stored page text with the current builder
 * (after a merge-rule fix, or to move older extractions to page-anchored seqs). Segment audio is
 * keyed by text hash, so unchanged paragraphs keep their clips. A running extraction is refused
 * (its finaliser owns the segments).
 * @returns {{before: number, after: number, changed: number, runs: number[][]}}
 */
async function resegment(extractionId, { apply = false } = {}) {
  const extraction = await supabaseService.getExtractionById(extractionId);
  if (!extraction) throw new Error(`Extraction ${extractionId} not found`);
  if (extraction.status === 'running') throw new Error(`Extraction ${extractionId} is running; rebuild it once it settles`);

  const stored = await supabaseService.getSegmentHashes(extractionId);
  const done = await supabaseService.getDonePageNumbers(extractionId, 0);
  const doneSet = new Set(done);
  const runs = runsOf(done);
  const rows = [];
  for (const [from, to] of runs) {
    const pages = await supabaseService.getPageBlocksRange(extractionId, from, to);
    rows.push(...regionRows(extractionId, pages, {
      moreToCome: to < extraction.pages_total && !doneSet.has(to + 1),
      headUnknown: from > 1,
    }));
  }
  const storedHashes = new Set(stored.map((s) => s.text_sha256));
  const result = { before: stored.length, after: rows.length, changed: rows.filter((r) => !storedHashes.has(r.text_sha256)).length, runs };
  if (!apply) return result;

  await finalizeOnce(extractionId, { rebuild: true });
  logger.info('Extraction resegmented', { extractionId, ...result });
  return result;
}

// Listening windows waiting on this extraction (listen_followup) re-check now: segments closed or it settled
async function wakeFollowups(extractionId) {
  try {
    if (await supabaseService.wakeQueuedJobs(extractionId, 'listen_followup')) jobRunner.wake();
  } catch (error) {
    // The follow-up still checks back on its own poll interval
    logger.warn('Could not wake listening follow-ups', { extractionId, error: error.message });
  }
}

// Passes for one extraction run one after another in this process (pages finish in parallel)
const finalizeQueues = new Map();

function finalizePrefix(extractionId, options = {}) {
  const previous = finalizeQueues.get(extractionId) || Promise.resolve();
  const run = previous.then(() => finalizeOnce(extractionId, options));
  const tail = run.catch(() => {});
  finalizeQueues.set(extractionId, tail);
  tail.then(() => {
    if (finalizeQueues.get(extractionId) === tail) finalizeQueues.delete(extractionId);
  });
  return run;
}

module.exports = { finalizePrefix, resegment, failedPagesOf, SEQ_PER_PAGE, VERSION_CONFLICT };
