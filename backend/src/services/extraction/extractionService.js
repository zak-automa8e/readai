const crypto = require('crypto');
const config = require('../../config');
const logger = require('../../utils/logger');
const supabaseService = require('../supabaseService');
const llm = require('../llm');
const { PROMPT_VERSION } = require('../../config/prompts/extraction');
const { blocksToLegacyText } = require('../../utils/legacyPageText');
const pdfSource = require('./pdfSource');
const pageRenderer = require('./pageRenderer');
const { validatePage } = require('./validate');
const { buildSegments, carryFromSegment } = require('./segmentBuilder');
const jobRunner = require('../jobs/jobRunner');

/**
 * Extraction pipeline (spec §5.2): one extraction per PDF content × recipe (prompt version, model),
 * planned by a job that counts pages and enqueues page chunks; every chunk extracts, validates and
 * saves blocks, then finalizePrefix turns the contiguous run of done pages into segments.
 *
 * Idempotency keys (book_processing_jobs.idempotency_key):
 *   extract:<extractionId>:plan                 one plan job per extraction
 *   extract:<extractionId>:<first>-<last>       one job per planned chunk (the plan is fixed by the plan job)
 *   extract:<extractionId>:retry<n>:<first>-<last>  pages re-queued by a later POST /process, round n
 */

const PLAN_PRIORITY = 0;
const RETRY_PRIORITY = 5;
const HEAD_PRIORITY = 10;
const BEFORE_HEAD_PRIORITY = 100;
const TAIL_PRIORITY = 1000;
const HEAD_PAGES = 10;

const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

function recipe() {
  return { promptVersion: PROMPT_VERSION, model: llm.extractionModel(), dpi: config.extraction.dpi };
}

function chunk(pages, size) {
  const out = [];
  for (let i = 0; i < pages.length; i += size) out.push(pages.slice(i, i + size));
  return out;
}

function range(first, last) {
  const out = [];
  for (let n = first; n <= last; n++) out.push(n);
  return out;
}

/**
 * The fixed chunk plan of a book: the ten pages from `fromPage` first (realtime), then the pages
 * before it (realtime — the segment prefix grows from page 1, so they gate listening), then the
 * rest (batch when enabled, else realtime). Lower priority runs first.
 * @returns {{first: number, last: number, pages: number[], mode: 'realtime'|'batch', priority: number}[]}
 */
function planChunks({ total, fromPage = 1, batchEnabled = false }) {
  const { realtimeChunkPages, batchChunkPages } = config.extraction;
  const p0 = Math.min(Math.max(parseInt(fromPage, 10) || 1, 1), total);
  const headLast = Math.min(p0 + HEAD_PAGES - 1, total);
  const plan = [{ pages: range(p0, headLast), mode: 'realtime', priority: HEAD_PRIORITY }];

  chunk(range(1, p0 - 1), realtimeChunkPages).forEach((pages, i) => {
    plan.push({ pages, mode: 'realtime', priority: BEFORE_HEAD_PRIORITY + i });
  });
  const tailMode = batchEnabled ? 'batch' : 'realtime';
  chunk(range(headLast + 1, total), batchEnabled ? batchChunkPages : realtimeChunkPages).forEach((pages, i) => {
    plan.push({ pages, mode: tailMode, priority: TAIL_PRIORITY + i });
  });
  return plan
    .filter((c) => c.pages.length)
    .map((c) => ({ ...c, first: c.pages[0], last: c.pages[c.pages.length - 1] }));
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

function planJob(extraction, { bookId, userId, fromPage }) {
  return {
    kind: 'extract_pages',
    book_id: bookId,
    user_id: userId,
    extraction_id: extraction.id,
    payload: { phase: 'plan', fromPage: fromPage || 1 },
    idempotency_key: `extract:${extraction.id}:plan`,
    priority: PLAN_PRIORITY,
  };
}

/**
 * Start the extraction of a book's content, or return the live one. Idempotent: the extraction is
 * unique per (content, prompt version, model) while not failed, and every job has a fixed key.
 * @param {{book: Object, userId: string, fromPage?: number}} args book.content_sha256 must be set
 * @returns {Promise<{extraction: Object, reused: boolean}>}
 */
async function startOrResume({ book, userId, fromPage }) {
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
  await supabaseService.enqueueJobs([planJob(extraction, { bookId: extraction.source_book_id, userId, fromPage })]);
  if (reused) extraction = (await requeueMissingPages(extraction, userId)) || extraction;
  return { extraction, reused };
}

/**
 * A later POST /process on an extraction with no job left to run re-queues only the pages that have
 * no text yet (failed pages, or pages whose job was lost), under a new round of keys.
 */
async function requeueMissingPages(extraction, userId) {
  if (!extraction.pages_total || extraction.status === 'complete') return null;
  const jobs = await supabaseService.getExtractionJobs(extraction.id);
  if (jobs.some((job) => job.status === 'queued' || job.status === 'running')) return null;

  const done = new Set(await supabaseService.getDonePageNumbers(extraction.id, 0));
  const missing = range(1, extraction.pages_total).filter((n) => !done.has(n));
  if (!missing.length) return finalizePrefix(extraction.id);

  const rounds = jobs
    .map((job) => /:retry(\d+):/.exec(job.idempotency_key))
    .filter(Boolean)
    .map((m) => parseInt(m[1], 10));
  const round = (rounds.length ? Math.max(...rounds) : 0) + 1;

  const rows = chunk(missing, config.extraction.realtimeChunkPages).map((pages) => ({
    kind: 'extract_pages',
    book_id: extraction.source_book_id,
    user_id: userId,
    extraction_id: extraction.id,
    payload: { phase: 'realtime', pages },
    idempotency_key: `extract:${extraction.id}:retry${round}:${pages[0]}-${pages[pages.length - 1]}`,
    priority: RETRY_PRIORITY,
  }));
  await supabaseService.enqueueJobs(rows);
  logger.info('Extraction pages re-queued', { extractionId: extraction.id, round, pages: missing.length });
  return supabaseService.updateExtraction(extraction.id, { status: 'running', finished_at: null });
}

// ---------------------------------------------------------------- plan job

async function loadContext(extractionId) {
  const extraction = await supabaseService.getExtractionById(extractionId);
  if (!extraction || extraction.status === 'failed') return null;
  const book = await supabaseService.getBookById(extraction.source_book_id);
  return { extraction, book };
}

async function pdfPathFor({ extraction, book }) {
  return pdfSource.getPdfFile({ pdfUrl: book.pdf_url, contentSha256: extraction.content_sha256 });
}

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

  await supabaseService.updateExtraction(extraction.id, {
    pages_total: total,
    status: 'running',
    started_at: extraction.started_at || new Date().toISOString(),
  });

  const chunks = planChunks({ total, fromPage: job.payload?.fromPage, batchEnabled: config.extraction.batchEnabled });
  const inserted = await supabaseService.enqueueJobs(chunks.map((c) => ({
    kind: 'extract_pages',
    book_id: book.id,
    user_id: job.user_id,
    extraction_id: extraction.id,
    payload: { phase: c.mode, pages: c.pages },
    idempotency_key: `extract:${extraction.id}:${c.first}-${c.last}`,
    priority: c.priority,
  })));
  logger.info('Extraction planned', { extractionId: extraction.id, pages: total, chunks: chunks.length, inserted: inserted.length });
}

async function failPlan(job, error) {
  await supabaseService.updateExtraction(job.extraction_id, {
    status: 'failed',
    error: String(error.message || error).slice(0, 500),
    finished_at: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------- one page

function sumUsage(calls) {
  const total = (key) => calls.reduce((n, u) => n + (u?.[key] || 0), 0);
  const costs = calls.map((u) => u?.costUsd).filter((c) => typeof c === 'number');
  const costUsd = costs.length ? costs.reduce((a, b) => a + b, 0) : null;
  return {
    usage: {
      promptTokens: total('promptTokens'),
      completionTokens: total('completionTokens'),
      reasoningTokens: total('reasoningTokens'),
      cachedTokens: total('cachedTokens'),
      costUsd,
      calls,
    },
    costMicros: costUsd === null ? null : Math.round(costUsd * 1e6),
  };
}

/**
 * Validate a first result; on failure retry the page once at reasoning 'medium', then keep the
 * retry flagged suspect (spoken anyway, never blocks the book).
 * @param {{blocks: Object[], pageType: string|null, usage: Object}} first
 * @param {Function} retry () => Promise<{blocks, pageType, usage}> at reasoning 'medium'
 */
async function validateWithRetry(first, retry, lengthSample) {
  const firstCheck = validatePage(first.blocks, { lengthSample });
  if (firstCheck.ok) {
    return { result: first, calls: [first.usage], validation: { ok: true, suspect: false, retried: false, issues: [], spokenChars: firstCheck.spokenChars } };
  }

  let second;
  try {
    second = await retry();
  } catch (error) {
    logger.warn('Validation retry failed; keeping the first result as suspect', { error: error.message });
    return {
      result: first,
      calls: [first.usage],
      validation: { ok: false, suspect: true, retried: true, issues: firstCheck.issues, retryError: error.message, spokenChars: firstCheck.spokenChars },
    };
  }
  const secondCheck = validatePage(second.blocks, { lengthSample });
  return {
    result: second,
    calls: [first.usage, second.usage],
    validation: {
      ok: secondCheck.ok,
      suspect: !secondCheck.ok,
      retried: true,
      issues: secondCheck.issues,
      firstIssues: firstCheck.issues,
      spokenChars: secondCheck.spokenChars,
    },
  };
}

/**
 * Realtime extraction of one rendered page with the validation retry policy.
 * @param {Buffer} png
 * @param {{lengthSample?: number[]}} [options]
 */
async function extractPage(png, { lengthSample = [] } = {}) {
  const pngBase64 = png.toString('base64');
  const first = await llm.extractBlocks({ pngBase64, mimeType: 'image/png', reasoning: 'minimal' });
  return validateWithRetry(
    first,
    () => llm.extractBlocks({ pngBase64, mimeType: 'image/png', reasoning: 'medium' }),
    lengthSample,
  );
}

async function savePage({ extraction, pageId, pageNumber, imageSha256, outcome, startedAt, mode }) {
  const { result, calls, validation } = outcome;
  const { usage, costMicros } = sumUsage(calls);

  await supabaseService.upsertPageTextBlocks(pageId, {
    // Legacy {header, body, footer} so /api/pages/text keeps answering for this page
    extracted_text: blocksToLegacyText(result.blocks),
    extraction_confidence: validation.suspect ? 0.5 : 0.95,
    extraction_metadata: { source: 'extraction_pipeline', extraction_id: extraction.id, mode },
    processing_duration_ms: Date.now() - startedAt,
    blocks: result.blocks,
    page_type: result.pageType,
    extraction_id: extraction.id,
    // The recipe keys, not the dated model id in usage (dedup compares these)
    prompt_version: extraction.prompt_version,
    model: extraction.model,
    image_sha256: imageSha256,
    validation,
    usage,
    cost_micros: costMicros,
  });

  logger.info('Page extracted', {
    extractionId: extraction.id,
    page: pageNumber,
    mode,
    pageType: result.pageType,
    blocks: result.blocks.length,
    suspect: validation.suspect,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    reasoningTokens: usage.reasoningTokens,
    costUsd: usage.costUsd,
  });

  if (extraction.started_by && usage.costUsd !== null) {
    try {
      await supabaseService.recordProcessingCost(extraction.started_by, {
        book_id: extraction.source_book_id,
        page_id: pageId,
        text_extraction_cost: usage.costUsd,
        tokens_used_text: usage.promptTokens + usage.completionTokens,
        cost_breakdown: { extraction_id: extraction.id, page: pageNumber, mode, calls: usage.calls.length },
      });
    } catch (error) {
      logger.warn('Could not record processing cost', { extractionId: extraction.id, page: pageNumber, error: error.message });
    }
  }
}

// ---------------------------------------------------------------- page chunk jobs

async function runPool(items, size, worker) {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(size, queue.length) }, async () => {
    while (queue.length) await worker(queue.shift());
  });
  await Promise.all(runners);
}

function chunkError(failures) {
  const first = failures[0].error;
  const error = new Error(`${failures.length} page(s) failed: ${failures.map((f) => `p${f.page}: ${String(f.error.message).slice(0, 120)}`).join('; ')}`);
  // A spend-limit or config error will not fix itself; anything else retries the chunk
  error.nonRetriable = failures.some((f) => f.error.nonRetriable);
  if (first.retryAfterMs) error.retryAfterMs = first.retryAfterMs;
  return error;
}

/**
 * Pages of the chunk that still need work, with their page ids and existing page_text rows.
 * A page already saved by this extraction is skipped without rendering (job replay, resume).
 */
async function pendingPages(extraction, pages) {
  const pageIds = await supabaseService.getPageIdMap(extraction.source_book_id, Math.min(...pages), Math.max(...pages));
  const missingRows = pages.filter((n) => !pageIds.has(n));
  if (missingRows.length) throw new Error(`pages rows missing for ${missingRows.join(', ')}`);

  const texts = await supabaseService.getPageTextsByPageIds(pages.map((n) => pageIds.get(n)));
  const byPageId = new Map(texts.map((t) => [t.page_id, t]));
  return pages
    .map((n) => ({ page: n, pageId: pageIds.get(n), existing: byPageId.get(pageIds.get(n)) || null }))
    .filter(({ existing }) => !(existing
      && existing.extraction_id === extraction.id
      && existing.prompt_version === extraction.prompt_version
      && existing.model === extraction.model));
}

// Same image, prompt version and model as a stored page: reuse its text, no model call (spec §5.2 dedup)
function reusable(existing, extraction, imageSha256) {
  return existing
    && existing.image_sha256 === imageSha256
    && existing.prompt_version === extraction.prompt_version
    && existing.model === extraction.model;
}

async function extractRealtime(job, context, pages) {
  const { extraction } = context;
  const todo = await pendingPages(extraction, pages);
  if (!todo.length) return;

  const pdfPath = await pdfPathFor(context);
  const lengthSample = await supabaseService.getSpokenCharSample(extraction.id);
  const failures = [];

  await runPool(todo, config.extraction.pageConcurrency, async ({ page, pageId, existing }) => {
    const startedAt = Date.now();
    try {
      const { png, sha256: imageSha256 } = await pageRenderer.renderPage(pdfPath, page, { dpi: extraction.dpi });
      if (reusable(existing, extraction, imageSha256)) {
        await supabaseService.attachPageTextToExtraction(pageId, extraction.id);
        logger.info('Page text reused (same image and recipe)', { extractionId: extraction.id, page });
      } else {
        const outcome = await extractPage(png, { lengthSample });
        if (typeof outcome.validation.spokenChars === 'number') lengthSample.push(outcome.validation.spokenChars);
        await savePage({ extraction, pageId, pageNumber: page, imageSha256, outcome, startedAt, mode: 'realtime' });
      }
      // Not awaited: passes queue per extraction; the caller awaits a last pass after the chunk.
      // This job is still running, so it counts as outstanding: the extraction must not settle
      // (and drop the cached PDF) while the chunk's other pages are rendering.
      finalizePrefix(extraction.id).catch((error) => {
        logger.error('Finalize after page failed', { extractionId: extraction.id, page, error: error.message });
      });
    } catch (error) {
      logger.error('Page extraction failed', { extractionId: extraction.id, page, error: error.message });
      failures.push({ page, error });
    }
  });

  if (failures.length) throw chunkError(failures);
}

function batchStoragePath(extractionId, page, imageSha256) {
  return `extraction-pages/${extractionId}/${page}-${imageSha256.slice(0, 12)}.png`;
}

// Batch, step 1: render, upload, submit; the job comes back in 5 minutes to poll
async function submitBatch(job, context, pages, ctx) {
  const { extraction } = context;
  const todo = await pendingPages(extraction, pages);
  if (!todo.length) {
    await finalizePrefix(extraction.id, { excludeJobId: job.id });
    return null;
  }

  const { storageBucket, batchImageUrlSeconds, batchPollMs } = config.extraction;
  const pdfPath = await pdfPathFor(context);
  const submitted = {};
  const requests = [];
  for (const { page, pageId, existing } of todo) {
    const { png, sha256: imageSha256 } = await pageRenderer.renderPage(pdfPath, page, { dpi: extraction.dpi });
    if (reusable(existing, extraction, imageSha256)) {
      await supabaseService.attachPageTextToExtraction(pageId, extraction.id);
      continue;
    }
    const path = batchStoragePath(extraction.id, page, imageSha256);
    await supabaseService.uploadFile(storageBucket, path, png, { contentType: 'image/png', upsert: true });
    const imageUrl = await supabaseService.createSignedUrl(storageBucket, path, batchImageUrlSeconds);
    submitted[page] = { pageId, imageSha256, path };
    requests.push({ customId: `p${page}`, imageUrl });
  }
  if (!requests.length) {
    await finalizePrefix(extraction.id, { excludeJobId: job.id });
    return null;
  }

  const { batchId } = await llm.submitExtractionBatch(requests, { reasoning: 'minimal' });
  const payload = { ...job.payload, batch: { id: batchId, submittedAt: new Date().toISOString(), pages: submitted } };
  // Saved at once: a crash before the job is re-queued must not submit (and pay for) the chunk twice
  await ctx.updatePayload(payload);
  logger.info('Extraction batch submitted', { extractionId: extraction.id, batchId, pages: requests.length });
  return { requeue: { delayMs: batchPollMs, payload } };
}

async function removeBatchImages(batch) {
  const paths = Object.values(batch.pages || {}).map((p) => p.path);
  try {
    await supabaseService.removeFiles(config.extraction.storageBucket, paths);
  } catch (error) {
    logger.warn('Could not remove batch page images', { error: error.message });
  }
}

// Batch, step 2: poll; save finished pages; pages the batch could not do run realtime
async function pollBatch(job, context, pages) {
  const { extraction } = context;
  const { batch } = job.payload;
  const age = Date.now() - Date.parse(batch.submittedAt);
  const status = await llm.getExtractionBatch(batch.id);

  if (!status.done && age < config.extraction.batchMaxAgeMs) {
    logger.info('Extraction batch still running', { extractionId: extraction.id, batchId: batch.id, status: status.status });
    return { requeue: { delayMs: config.extraction.batchPollMs, payload: job.payload } };
  }

  const leftovers = [];
  const lengthSample = await supabaseService.getSpokenCharSample(extraction.id);
  const results = new Map(status.results.map((r) => [r.customId, r]));
  let pdfPath = null;

  for (const [pageKey, info] of Object.entries(batch.pages || {})) {
    const page = parseInt(pageKey, 10);
    const result = results.get(`p${page}`);
    if (!status.done || !result || result.error) {
      leftovers.push(page);
      continue;
    }
    const startedAt = Date.now();
    try {
      const outcome = await validateWithRetry(result, async () => {
        pdfPath = pdfPath || await pdfPathFor(context);
        const { png } = await pageRenderer.renderPage(pdfPath, page, { dpi: extraction.dpi });
        return llm.extractBlocks({ pngBase64: png.toString('base64'), mimeType: 'image/png', reasoning: 'medium' });
      }, lengthSample);
      if (typeof outcome.validation.spokenChars === 'number') lengthSample.push(outcome.validation.spokenChars);
      await savePage({ extraction, pageId: info.pageId, pageNumber: page, imageSha256: info.imageSha256, outcome, startedAt, mode: 'batch' });
    } catch (error) {
      logger.warn('Saving a batch result failed; the page runs realtime', { extractionId: extraction.id, page, error: error.message });
      leftovers.push(page);
    }
  }

  await removeBatchImages(batch);
  if (leftovers.length) {
    logger.warn('Batch pages fall back to realtime', { extractionId: extraction.id, batchId: batch.id, status: status.status, pages: leftovers });
  }
  // Saved pages are skipped; whatever the batch did not deliver runs realtime
  await extractRealtime(job, context, pages);
  await finalizePrefix(extraction.id, { excludeJobId: job.id });
  return null;
}

/**
 * Run one extract_pages job. Returns `{ requeue: {delayMs, payload} }` while a batch is pending.
 * @param {Object} job book_processing_jobs row
 * @param {{updatePayload: Function}} ctx from the job runner
 */
async function runChunk(job, ctx) {
  const context = await loadContext(job.extraction_id);
  if (!context) return null;
  const pages = job.payload?.pages || [];
  if (!pages.length) return null;

  const batchUsable = config.extraction.batchEnabled && llm.supportsExtractionBatch();
  if (job.payload.phase === 'batch' && job.payload.batch) return pollBatch(job, context, pages);
  if (job.payload.phase === 'batch' && batchUsable) return submitBatch(job, context, pages, ctx);

  await extractRealtime(job, context, pages);
  await finalizePrefix(context.extraction.id, { excludeJobId: job.id });
  return null;
}

// ---------------------------------------------------------------- prefix finalisation

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

// ---------------------------------------------------------------- status (GET /processing)

async function getStatus(extraction) {
  let failedPages = [];
  if (extraction.pages_failed > 0) {
    failedPages = await failedPagesOf(extraction.id, await supabaseService.getExtractionJobs(extraction.id));
  }
  return {
    extractionId: extraction.id,
    status: extraction.status,
    pagesTotal: extraction.pages_total,
    pagesDone: extraction.pages_done,
    pagesFailed: extraction.pages_failed,
    failedPages,
    finalizedThroughPage: extraction.finalized_through_page,
    mode: extraction.finalized_through_page >= 1 ? 'segments' : 'legacy',
  };
}

module.exports = {
  recipe,
  planChunks,
  ensureContentHash,
  findLiveExtraction,
  startOrResume,
  requeueMissingPages,
  runPlan,
  failPlan,
  runChunk,
  extractPage,
  validateWithRetry,
  finalizePrefix,
  resegment,
  getStatus,
};
