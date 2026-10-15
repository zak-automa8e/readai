const config = require('../../config');
const logger = require('../../utils/logger');
const openrouterProvider = require('./openrouterProvider');
const googleProvider = require('./googleProvider');

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

function parseBlocks(raw) {
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
  return parsed.blocks;
}

async function extractFrom(adapter, args) {
  return withRetry(async () => {
    const { raw, usage } = await adapter.extractBlocks(args);
    return { blocks: parseBlocks(raw), raw, usage };
  }, { label: 'extractBlocks' });
}

/**
 * Split one page image into labelled blocks.
 * Falls back to Google direct when OpenRouter keeps failing and a Gemini key is set.
 * @param {{pngBase64: string, mimeType?: string, mode?: 'realtime'|'batch', reasoning?: 'minimal'|'low'|'medium'}} args
 * @returns {Promise<{blocks: Object[], raw: string, usage: Object}>}
 */
async function extractBlocks({ mode = 'realtime', ...args } = {}) {
  if (mode === 'batch') throw new Error('extractBlocks batch mode is not implemented — story 4');
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

module.exports = { extractBlocks, synthesize, chatWithDocument, withRetry };
