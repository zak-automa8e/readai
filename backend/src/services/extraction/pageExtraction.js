const logger = require('../../utils/logger');
const supabaseService = require('../supabaseService');
const llm = require('../llm');
const { blocksToLegacyText } = require('../../utils/legacyPageText');
const { validatePage } = require('./validate');

// One page: model call, validation with one retry at medium reasoning, and saving its text and cost.

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

module.exports = { extractPage, validateWithRetry, savePage };
