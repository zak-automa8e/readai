const config = require('../../config');
const logger = require('../../utils/logger');
const openrouterProvider = require('./openrouterProvider');
const googleProvider = require('./googleProvider');
const { PAGE_TYPES } = require('../../config/prompts/extraction');

/**
 * llmProvider: the one entry point for model calls. Picks the adapter from config.llm.provider,
 * retries transient failures the same way for both adapters and logs usage and cost per call.
 * Every method resolves with `usage: { promptTokens, completionTokens, reasoningTokens, costUsd, provider, model, latencyMs }`.
 */

const RETRIABLE_MESSAGE = /429|500|502|503|504|RESOURCE_EXHAUSTED|UNAVAILABLE|INTERNAL|fetch failed|No audio|empty|timed out|abort/i;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isRetriable(error) {
  if (error.nonRetriable || error.dailyCap) return false;
  if (error.retriable) return true;
  if (error.status) return error.status === 429 || error.status >= 500;
  return error.name === 'AbortError' || RETRIABLE_MESSAGE.test(String(error.message || ''));
}

// Google reports how long to wait inside a JSON blob in the error message
function googleRetryDelay(message) {
  const jsonStart = message.indexOf('{');
  if (jsonStart < 0) return { retryMs: 0, dailyCap: false };
  try {
    const details = JSON.parse(message.slice(jsonStart)).error?.details || [];
    let retryMs = 0;
    let dailyCap = false;
    for (const detail of details) {
      if (/QuotaFailure/.test(detail['@type'])) {
        dailyCap = dailyCap || (detail.violations || []).some((v) => /PerDay/.test(v.quotaId || ''));
      }
      if (/RetryInfo/.test(detail['@type']) && detail.retryDelay) retryMs = parseFloat(detail.retryDelay) * 1000;
    }
    return { retryMs, dailyCap };
  } catch {
    return { retryMs: 0, dailyCap: false };
  }
}

/**
 * Retry transient failures with exponential backoff, honouring Retry-After / retryDelay and
 * giving up at once on daily quota caps and non-retriable errors (bad voice, key limit).
 * @param {Function} operation
 * @param {{label?: string, attempts?: number, baseDelayMs?: number, sleepFn?: Function}} [options]
 */
async function withRetry(operation, options = {}) {
  const {
    label = 'llm call',
    attempts = config.llm.retry.attempts,
    baseDelayMs = config.llm.retry.baseDelayMs,
    sleepFn = sleep,
  } = options;

  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      const { retryMs, dailyCap } = googleRetryDelay(String(error.message || ''));
      if (dailyCap) error.dailyCap = true;
      if (!isRetriable(error) || attempt === attempts - 1) break;

      const waitMs = Math.max(baseDelayMs * 2 ** Math.min(attempt, 3), error.retryAfterMs || 0, retryMs);
      logger.warn(`${label} attempt ${attempt + 1} of ${attempts} failed (${String(error.message).slice(0, 160)}); retrying in ${waitMs}ms`);
      await sleepFn(waitMs);
    }
  }
  throw lastError;
}

let warnedMissingKey = false;

function activeProvider() {
  if (config.llm.provider === 'openrouter') {
    if (openrouterProvider.isConfigured()) return { name: 'openrouter', adapter: openrouterProvider };
    if (!warnedMissingKey) {
      warnedMissingKey = true;
      logger.warn('LLM_PROVIDER is openrouter but OPENROUTER_API_KEY is not set; using the Google adapter');
    }
  }
  return { name: 'google', adapter: googleProvider };
}

function logUsage(method, usage) {
  logger.info(`llm ${method}`, usage);
}

/**
 * Parse an extraction reply into blocks and the page type (null when missing or unknown, e.g.
 * replies to the version-1 prompt).
 * @param {string} raw
 * @returns {{blocks: Object[], pageType: string|null}}
 */
function parseExtraction(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const failure = new Error(`Failed to parse extraction result as JSON: ${error.message}`);
    failure.retriable = true;
    throw failure;
  }
  if (!Array.isArray(parsed.blocks)) {
    const failure = new Error('Extraction result has no blocks array');
    failure.retriable = true;
    throw failure;
  }
  const pageType = PAGE_TYPES.includes(parsed.page_type) ? parsed.page_type : null;
  return { blocks: parsed.blocks, pageType };
}

async function extractFrom(adapter, args) {
  return withRetry(async () => {
    const { raw, usage } = await adapter.extractBlocks(args);
    return { ...parseExtraction(raw), raw, usage };
  }, { label: 'extractBlocks' });
}

/**
 * Split one page image into labelled blocks.
 * Falls back to Google direct when OpenRouter keeps failing and a Gemini key is set.
 * Batch extraction is asynchronous and goes through submitExtractionBatch / getExtractionBatch.
 * @param {{pngBase64: string, mimeType?: string, mode?: 'realtime', reasoning?: 'minimal'|'low'|'medium'}} args
 * @returns {Promise<{blocks: Object[], pageType: string|null, raw: string, usage: Object}>}
 */
async function extractBlocks({ mode = 'realtime', ...args } = {}) {
  if (mode === 'batch') throw new Error('extractBlocks is realtime only; use submitExtractionBatch for batch mode');
  if (!args.pngBase64) throw new Error('pngBase64 is required');

  const { name, adapter } = activeProvider();
  let result;
  try {
    result = await extractFrom(adapter, args);
  } catch (error) {
    if (name !== 'openrouter' || !googleProvider.isConfigured()) throw error;
    logger.warn(`OpenRouter extraction failed (${String(error.message).slice(0, 160)}); falling back to Gemini direct`);
    result = await extractFrom(googleProvider, args);
  }
  logUsage('extractBlocks', result.usage);
  return result;
}

/**
 * Text to speech, returned as raw PCM for the caller to wrap (audio.pcmToWav) or transcode.
 * @param {{text: string, baseVoice: string, styleInstruction?: string|null}} args
 * @returns {Promise<{pcm: Buffer, sampleRate: number, channels: number, bitsPerSample: number, usage: Object}>}
 */
async function synthesize(args) {
  if (!args?.text) throw new Error('text is required');
  if (!args.baseVoice) throw new Error('baseVoice is required');
  const { adapter } = activeProvider();
  const result = await withRetry(() => adapter.synthesize(args), { label: 'synthesize' });
  logUsage('synthesize', result.usage);
  return result;
}

/**
 * One turn of a conversation about a document. OpenRouter takes `pdfUrl`; the Google adapter takes
 * the Gemini File API `fileUri`.
 * @param {{pdfUrl?: string, fileUri?: string, filename?: string, history?: Object[], message: string, systemInstruction?: string|null}} args
 * @returns {Promise<{text: string, annotations: Object|null, usage: Object}>}
 */
async function chatWithDocument(args) {
  if (!args?.message) throw new Error('message is required');
  const { adapter } = activeProvider();
  const result = await withRetry(() => adapter.chatWithDocument(args), { label: 'chatWithDocument' });
  logUsage('chatWithDocument', result.usage);
  return result;
}

/**
 * The model id an extraction recipe is keyed by (book_extractions.model, page_text.model):
 * the configured extraction model of the active adapter, not the dated id a response reports.
 * @returns {string}
 */
function extractionModel() {
  const { name } = activeProvider();
  return name === 'openrouter' ? config.llm.openrouter.models.extract : config.geminiModels.imageToText;
}

/** Whether the asynchronous batch API is available (OpenRouter only). */
function supportsExtractionBatch() {
  return activeProvider().name === 'openrouter';
}

/**
 * Submit pages to the asynchronous extraction batch (half price, done within 24 h).
 * @param {{customId: string, imageUrl: string}[]} pages
 * @param {{reasoning?: 'minimal'|'low'|'medium'}} [options]
 * @returns {Promise<{batchId: string, status: string, model: string}>}
 */
async function submitExtractionBatch(pages, options = {}) {
  if (!supportsExtractionBatch()) throw new Error('Batch extraction needs the OpenRouter provider');
  if (!pages?.length) throw new Error('pages are required');
  const result = await withRetry(() => openrouterProvider.submitExtractionBatch(pages, options), { label: 'submitExtractionBatch' });
  logger.info('llm submitExtractionBatch', { batchId: result.batchId, pages: pages.length });
  return result;
}

/**
 * Poll an extraction batch; finished results come back parsed (or with `error`).
 * @param {string} batchId
 * @returns {Promise<{status: string, done: boolean, results: {customId: string, blocks?: Object[], pageType?: string|null, raw: string|null, usage: Object|null, error: string|null}[]}>}
 */
async function getExtractionBatch(batchId) {
  const batch = await withRetry(() => openrouterProvider.getExtractionBatch(batchId), { label: 'getExtractionBatch' });
  const results = batch.results.map((result) => {
    if (result.error) return result;
    try {
      return { ...result, ...parseExtraction(result.raw) };
    } catch (error) {
      return { ...result, error: error.message };
    }
  });
  return { ...batch, results };
}

module.exports = {
  extractBlocks,
  parseExtraction,
  extractionModel,
  supportsExtractionBatch,
  submitExtractionBatch,
  getExtractionBatch,
  synthesize,
  chatWithDocument,
  withRetry,
};
