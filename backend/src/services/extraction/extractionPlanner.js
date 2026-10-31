const config = require('../../config');
const logger = require('../../utils/logger');
const supabaseService = require('../supabaseService');
const pdfSource = require('./pdfSource');
const pageRenderer = require('./pageRenderer');
const { recipe, chunk, range, loadContext, pdfPathFor } = require('./extractionContext');

/**
 * Starting an extraction and choosing what to extract (spec §5.2, O15). A plan job counts the pages;
 * text is then extracted only for the pages a listener is about to reach (ensureText), never the
 * whole book.
 *
 * Idempotency keys (book_processing_jobs.idempotency_key):
 *   extract:<extractionId>:plan                      one plan job per extraction
 *   extract:<extractionId>:w<first>-<last>[:<n>]     text for a listening window; round n after earlier ones
 *   extract:<extractionId>:<first>-<last>, :retry…   whole-book chunks and retries queued before O15
 */

const PLAN_PRIORITY = 0;
const WINDOW_PRIORITY = 10;
const ACTIVE_JOB = new Set(['queued', 'running']);

/**
 * The pages listening at `page` needs text for (O15): the page before it (does its first paragraph
 * begin there?), the page itself, and `ahead` + 1 pages after it (the last voiced paragraph may run
 * onto the next page). Segments build from any page (story 2), so nothing further back is needed.
 * @param {{page: number, ahead: number, total: number}} args
 * @returns {{first: number, last: number}}
 */
function textWindow({ page, ahead, total }) {
  const p = Math.min(Math.max(parseInt(page, 10) || 1, 1), total);
  return { first: Math.max(p - 1, 1), last: Math.min(p + ahead + 1, total) };
}

/**
 * Queue realtime extraction for the pages of the window around `page` that have no text yet and
 * are not in a queued or running job. Idempotent: a second call for the same window queues nothing.
 * A no-op until the plan job has counted the pages.
 * @param {{extraction: Object, page: number, ahead: number, userId: string}} args
 * @returns {Promise<{extraction: Object, queued: number[]}>} the extraction, 'running' again when pages were queued
 */
async function ensureText({ extraction, page, ahead, userId }) {
  const total = extraction.pages_total;
  if (!total || extraction.status === 'complete' || extraction.status === 'failed') return { extraction, queued: [] };

  const { first, last } = textWindow({ page, ahead, total });
  const done = new Set(await supabaseService.getDonePageNumbers(extraction.id, first - 1));
  const jobs = await supabaseService.getExtractionJobs(extraction.id);
  const busy = new Set(jobs.filter((job) => ACTIVE_JOB.has(job.status)).flatMap((job) => job.payload?.pages || []));
  const todo = range(first, last).filter((n) => !done.has(n) && !busy.has(n));
  if (!todo.length) return { extraction, queued: [] };

  // Chunks keep each job well inside its lease when the reader asks for many pages ahead
  const rows = chunk(todo, config.extraction.realtimeChunkPages).map((pages) => {
    const base = `extract:${extraction.id}:w${pages[0]}-${pages[pages.length - 1]}`;
    const earlier = jobs.filter((job) => job.idempotency_key === base || job.idempotency_key.startsWith(`${base}:`)).length;
    return {
      kind: 'extract_pages',
      book_id: extraction.source_book_id,
      user_id: userId,
      extraction_id: extraction.id,
      payload: { phase: 'realtime', pages },
      idempotency_key: earlier ? `${base}:${earlier}` : base,
      priority: WINDOW_PRIORITY,
    };
  });
  const inserted = await supabaseService.enqueueJobs(rows);
  if (!inserted.length) return { extraction, queued: [] };

  logger.info('Text window queued', { extractionId: extraction.id, page, first, last, pages: todo.length });
  if (extraction.status === 'running') return { extraction, queued: todo };
  const updated = await supabaseService.updateExtraction(extraction.id, { status: 'running', finished_at: null });
  return { extraction: updated || extraction, queued: todo };
}

// ---------------------------------------------------------------- start / resume (POST /process)

/**
 * books.content_sha256, computed and stored on first use (same logic as scripts/backfill-book-hashes.js).
 * The downloaded bytes are kept in the local PDF cache for the plan and page jobs.
 */
async function ensureContentHash(book) {
  if (book.content_sha256) return book.content_sha256;
  const bytes = await pdfSource.downloadPdf(book.pdf_url);
  const hash = pdfSource.sha256(bytes);
  await supabaseService.updateBook(book.id, { content_sha256: hash });
  try {
    await pdfSource.rememberPdf(hash, bytes);
  } catch (error) {
    logger.warn('Could not cache the PDF locally', { bookId: book.id, error: error.message });
  }
  return hash;
}

async function findLiveExtraction(contentSha256) {
  if (!contentSha256) return null;
  const { promptVersion, model } = recipe();
  return supabaseService.getLiveExtraction(contentSha256, promptVersion, model);
}

function planJob(extraction, { bookId, userId, fromPage, ahead }) {
  return {
    kind: 'extract_pages',
    book_id: bookId,
    user_id: userId,
    extraction_id: extraction.id,
    payload: { phase: 'plan', fromPage: fromPage || 1, ahead },
    idempotency_key: `extract:${extraction.id}:plan`,
    priority: PLAN_PRIORITY,
  };
}

/**
 * Start the extraction of a book's content, or return the live one with text queued for the window
 * at fromPage. Idempotent: the extraction is unique per (content, prompt version, model) while not
 * failed, and every job has a fixed key.
 * @param {{book: Object, userId: string, fromPage?: number, ahead?: number}} args book.content_sha256 must be set
 * @returns {Promise<{extraction: Object, reused: boolean}>}
 */
async function startOrResume({ book, userId, fromPage, ahead = config.audio.pagesAhead }) {
  const { promptVersion, model, dpi } = recipe();
  let extraction = await supabaseService.getLiveExtraction(book.content_sha256, promptVersion, model);
  const reused = Boolean(extraction);

  if (!extraction) {
    try {
      extraction = await supabaseService.createExtraction({
        content_sha256: book.content_sha256,
        source_book_id: book.id,
        status: 'queued',
        model,
        prompt_version: promptVersion,
        dpi,
        started_by: userId,
      });
      logger.info('Extraction created', { extractionId: extraction.id, bookId: book.id, model, promptVersion });
    } catch (error) {
      if (error.code !== '23505') throw error;
      // Another request created it between our read and insert
      extraction = await supabaseService.getLiveExtraction(book.content_sha256, promptVersion, model);
      if (!extraction) throw error;
    }
  }

  // The plan job may be missing if a previous request stopped between the two inserts
  await supabaseService.enqueueJobs([planJob(extraction, { bookId: extraction.source_book_id, userId, fromPage, ahead })]);
  // Before the plan job has run there are no pages to queue: it queues the window itself
  if (reused) ({ extraction } = await ensureText({ extraction, page: fromPage || 1, ahead, userId }));
  return { extraction, reused };
}

// ---------------------------------------------------------------- plan job

async function runPlan(job) {
  const context = await loadContext(job.extraction_id);
  if (!context) return;
  const { extraction, book } = context;

  const pdfPath = await pdfPathFor(context);
  const total = await pageRenderer.pageCount(pdfPath);
  await supabaseService.insertPagesBulk(book.id, total);

  for (const bookId of new Set([book.id, job.book_id])) {
    try {
      await supabaseService.updateBook(bookId, { total_pages: total });
    } catch (error) {
      logger.warn('Could not write total_pages', { bookId, error: error.message });
    }
  }

  const planned = await supabaseService.updateExtraction(extraction.id, {
    pages_total: total,
    status: 'running',
    started_at: extraction.started_at || new Date().toISOString(),
  });

  const { queued } = await ensureText({
    extraction: planned || { ...extraction, pages_total: total, status: 'running' },
    page: job.payload?.fromPage || 1,
    ahead: job.payload?.ahead ?? config.audio.pagesAhead,
    userId: job.user_id,
  });
  logger.info('Extraction planned', { extractionId: extraction.id, pages: total, queued: queued.length });
}

async function failPlan(job, error) {
  await supabaseService.updateExtraction(job.extraction_id, {
    status: 'failed',
    error: String(error.message || error).slice(0, 500),
    finished_at: new Date().toISOString(),
  });
}

module.exports = {
  textWindow,
  ensureText,
  ensureContentHash,
  findLiveExtraction,
  startOrResume,
  runPlan,
  failPlan,
};
