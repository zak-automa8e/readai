const config = require('../../config');
const geminiService = require('../geminiService');
const geminiDocumentService = require('../geminiDocumentService');
const { EXTRACTION_PROMPT, RESPONSE_SCHEMA } = require('../../config/prompts/extraction');
const { pcmFormatFromMime } = require('./audio');

/**
 * Google-direct adapter over geminiService and geminiDocumentService. Dev-only fallback:
 * free-tier keys allow about 10 TTS calls a day, and Gemini rejects `minimal` thinking
 * for page extraction (400), so it is sent as `low`.
 */

const THINKING_LEVELS = { minimal: 'LOW', low: 'LOW', medium: 'MEDIUM' };

function isConfigured() {
  return Boolean(config.geminiApiKey);
}

function toUsage(metadata, model, startedAt) {
  return {
    promptTokens: metadata?.promptTokenCount ?? 0,
    completionTokens: metadata?.candidatesTokenCount ?? 0,
    reasoningTokens: metadata?.thoughtsTokenCount ?? 0,
    cachedTokens: metadata?.cachedContentTokenCount ?? 0,
    costUsd: null,
    provider: 'google',
    model,
    latencyMs: Date.now() - startedAt,
  };
}

/**
 * @param {{pngBase64: string, mimeType?: string, reasoning?: 'minimal'|'low'|'medium'}} args
 */
async function extractBlocks({ pngBase64, mimeType = 'image/png', reasoning = 'minimal' }) {
  const startedAt = Date.now();
  const { text, usage, model } = await geminiService.imageToJsonText({
    imageData: pngBase64,
    mimeType,
    systemPrompt: EXTRACTION_PROMPT,
    responseSchema: RESPONSE_SCHEMA,
    thinkingLevel: THINKING_LEVELS[reasoning] || 'LOW',
  });
  if (!text || !text.trim()) throw new Error('Gemini returned an empty extraction response');
  return { raw: text, usage: toUsage(usage, model, startedAt) };
}

/**
 * @param {{text: string, baseVoice: string, styleInstruction?: string|null}} args
 */
async function synthesize({ text, baseVoice, styleInstruction = null }) {
  const startedAt = Date.now();
  const { data, mimeType, usage } = await geminiService.generateAudio(text, baseVoice, styleInstruction);
  return {
    pcm: Buffer.from(data, 'base64'),
    ...pcmFormatFromMime(mimeType),
    usage: toUsage(usage, config.geminiModels.textToAudio, startedAt),
  };
}

/**
 * One turn over a PDF already uploaded to the Gemini File API.
 * @param {{fileUri: string, history?: {role: string, content: string}[], message: string, systemInstruction?: string|null}} args
 */
async function chatWithDocument({ fileUri, history = [], message, systemInstruction = null }) {
  const startedAt = Date.now();
  const { text, tokensUsed } = await geminiDocumentService.generateWithFile(fileUri, message, history, systemInstruction);
  return {
    text,
    annotations: null,
    usage: toUsage({
      promptTokenCount: tokensUsed?.prompt,
      candidatesTokenCount: tokensUsed?.candidates,
      cachedContentTokenCount: tokensUsed?.cached,
    }, config.geminiModels.documentChat, startedAt),
  };
}

module.exports = { isConfigured, extractBlocks, synthesize, chatWithDocument };
