const crypto = require('crypto');
const logger = require('../../utils/logger');
const supabaseService = require('../supabaseService');
const pdfSource = require('./pdfSource');
const { buildSegments, carryFromSegment } = require('./segmentBuilder');
const jobRunner = require('../jobs/jobRunner');

const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

// Turns done pages into segments (prefix finalisation) and rebuilds settled extractions.

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

async function failedPagesOf(extractionId, jobs, doneAfter) {
  const candidates = new Set();
  jobs.filter((job) => job.status === 'failed' && job.payload?.phase !== 'plan')
    .forEach((job) => (job.payload?.pages || []).forEach((n) => candidates.add(n)));
  if (!candidates.size) return [];
  const done = new Set(doneAfter || await supabaseService.getDonePageNumbers(extractionId, Math.min(...candidates) - 1));
  return [...candidates].filter((n) => !done.has(n)).sort((a, b) => a - b);
}

/**
 * One finalisation pass. The stored state is: segments built over pages 1..D, every segment final
 * except possibly the last (status 'open': its sentence may continue on page D+1), and
 * finalized_through_page F = the last page whose text is all in final segments.
 *   D = open ? lastSegment.end_page : max(F, lastSegment.end_page)
 * so a crash after writing segments but before writing F is recovered without duplicates.
 * The pass extends D over the newly done contiguous pages, rebuilding from the open segment (carry),
 * rewrites the open segment in place (same seq) and appends new ones with the next seqs in ONE upsert,
 * then moves F with a compare-and-set.
 */
async function finalizeOnce(extractionId, { excludeJobId = null } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const extraction = await supabaseService.getExtractionById(extractionId);
    if (!extraction || extraction.status === 'failed' || !extraction.pages_total) return extraction;
    const total = extraction.pages_total;

    const last = await supabaseService.getLastSegment(extractionId);
    const open = Boolean(last && last.status === 'open');
    const built = open ? last.end_page : Math.max(extraction.finalized_through_page, last ? last.end_page : 0);

    const doneAfter = await supabaseService.getDonePageNumbers(extractionId, built);
    let end = built;
    for (const n of doneAfter) {
      if (n === end + 1) end = n;
      else if (n > end + 1) break;
    }

    let finalized;
    if (end > built) {
      const pages = await supabaseService.getPageBlocksRange(extractionId, open ? built : built + 1, end);
      let carry = null;
      let input = pages;
      if (open) {
        carry = carryFromSegment(last, pages[0]);
        input = pages.slice(1);
      }
      const { segments } = buildSegments(input, { carry, moreToCome: end < total });
      let nextSeq = (last ? last.seq : 0) + 1;
      const rows = segments.map((segment) => segmentRow(extractionId, segment.carried ? last.seq : nextSeq++, segment));
      await supabaseService.upsertSegments(rows);
      const tail = rows[rows.length - 1];
      finalized = tail && tail.status === 'open' ? tail.start_page - 1 : end;
    } else {
      finalized = open ? last.start_page - 1 : built;
    }

    const jobs = await supabaseService.getExtractionJobs(extractionId);
    const pagesDone = await supabaseService.countDonePages(extractionId);
    const failedPages = await failedPagesOf(extractionId, jobs);
    const outstanding = jobs.filter((job) => (job.status === 'queued' || job.status === 'running') && job.id !== excludeJobId).length;
    const complete = pagesDone >= total && finalized >= total;
    const status = complete ? 'complete' : outstanding > 0 ? 'running' : 'partial';

    const updated = await supabaseService.updateExtraction(extractionId, {
      finalized_through_page: finalized,
      pages_done: pagesDone,
      pages_failed: failedPages.length,
      status,
      finished_at: status === 'running' ? null : (extraction.finished_at || new Date().toISOString()),
    }, { expectFinalizedThrough: extraction.finalized_through_page });

    if (updated) {
      if (status !== 'running' && extraction.status === 'running') {
        logger.info('Extraction settled', { extractionId, status, pagesDone, pagesFailed: failedPages.length, finalized });
        pdfSource.forgetPdf(extraction.content_sha256).catch(() => {});
      }
      if (end > built || status !== 'running') await wakeFollowups(extractionId);
      return updated;
    }
    logger.warn('finalized_through_page moved under us; another finaliser is running (run ONE job process)', { extractionId });
  }
  throw new Error(`Could not finalize extraction ${extractionId}: concurrent updates`);
}

/**
 * Rebuild a settled extraction's segments from its stored page text with the current builder
 * (after a merge-rule fix). Segment audio is keyed by text hash, so unchanged paragraphs keep their
 * clips; only rewritten ones are voiced again. Seqs stay 1..n: rows are rewritten in place, the
 * surplus deleted. A running extraction is refused (its finaliser owns the segments).
 * @returns {{before: number, after: number, changed: number, finalized: number}}
 */
async function resegment(extractionId, { apply = false } = {}) {
  const extraction = await supabaseService.getExtractionById(extractionId);
  if (!extraction) throw new Error(`Extraction ${extractionId} not found`);
  if (extraction.status === 'running') throw new Error(`Extraction ${extractionId} is running; rebuild it once it settles`);

  const stored = await supabaseService.getSegmentHashes(extractionId);
  const built = stored.reduce((max, s) => Math.max(max, s.end_page), extraction.finalized_through_page || 0);
  if (!built) return { before: 0, after: 0, changed: 0, finalized: 0 };

  const pages = await supabaseService.getPageBlocksRange(extractionId, 1, built);
  const { segments } = buildSegments(pages, { moreToCome: built < extraction.pages_total });
  const rows = segments.map((segment, i) => segmentRow(extractionId, i + 1, segment));
  const storedHashes = new Set(stored.map((s) => s.text_sha256));
  const tail = rows[rows.length - 1];
  const finalized = tail && tail.status === 'open' ? tail.start_page - 1 : built;
  const result = { before: stored.length, after: rows.length, changed: rows.filter((r) => !storedHashes.has(r.text_sha256)).length, finalized };
  if (!apply) return result;

  await supabaseService.upsertSegments(rows);
  await supabaseService.deleteSegmentsAfter(extractionId, rows.length);
  if (finalized !== extraction.finalized_through_page) {
    await supabaseService.updateExtraction(extractionId, { finalized_through_page: finalized }, { expectFinalizedThrough: extraction.finalized_through_page });
  }
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

module.exports = { finalizePrefix, resegment, failedPagesOf };
