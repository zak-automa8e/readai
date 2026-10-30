const config = require('../../config');
const logger = require('../../utils/logger');
const supabaseService = require('../supabaseService');
const llm = require('../llm');
const pageRenderer = require('./pageRenderer');
const { loadContext, pdfPathFor } = require('./extractionContext');
const { extractPage, validateWithRetry, savePage } = require('./pageExtraction');
const { finalizePrefix } = require('./segmentFinalizer');

// extract_pages jobs for a list of pages: realtime (4 pages in parallel) or through the batch API.

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

module.exports = { runChunk };
