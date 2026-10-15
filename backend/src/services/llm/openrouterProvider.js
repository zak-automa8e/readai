const config = require('../../config');
const { EXTRACTION_PROMPT, RESPONSE_SCHEMA } = require('../../config/prompts/extraction');

/**
 * OpenRouter adapter. Request shapes follow docs/research/2026-10-openrouter-spike.md:
 * chat/completions for extraction and document chat, /audio/speech for TTS with the
 * persona style in the top-level `instructions` field.
 */

const EXTRACTION_USER_TEXT = 'Transcribe this page into blocks.';

// Google `Type` schema to the plain JSON schema OpenRouter's json_schema response_format takes
function toJsonSchema(schema) {
  const out = {};
  if (schema.type) out.type = String(schema.type).toLowerCase();
  if (schema.enum) out.enum = schema.enum;
  if (schema.properties) {
    out.properties = {};
    for (const [key, value] of Object.entries(schema.properties)) out.properties[key] = toJsonSchema(value);
    out.additionalProperties = false;
  }
  if (schema.items) out.items = toJsonSchema(schema.items);
  if (schema.required) out.required = schema.required;
  return out;
}

const PAGE_BLOCKS_SCHEMA = { name: 'page_blocks', strict: true, schema: toJsonSchema(RESPONSE_SCHEMA) };

function settings() {
  return config.llm.openrouter;
}

function isConfigured() {
  return Boolean(settings().apiKey);
}

function buildError(path, response, detail) {
  const error = new Error(`OpenRouter ${path} failed with ${response.status}: ${detail}`);
  error.status = response.status;
  const retryAfter = Number(response.headers?.get?.('retry-after'));
  if (retryAfter > 0) error.retryAfterMs = retryAfter * 1000;
  // A 402 means the key's spend limit is hit: an operator problem, not something a retry fixes
  if (response.status === 402) error.nonRetriable = true;
  return error;
}

async function post(path, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${settings().baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${settings().apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw buildError(path, response, (await response.text()).slice(0, 500));
    }
    return response;
  } finally {
    clearTimeout(timer);
  }
}

function chatUsage(json, model, startedAt) {
  const usage = json.usage || {};
  return {
    promptTokens: usage.prompt_tokens ?? 0,
    completionTokens: usage.completion_tokens ?? 0,
    reasoningTokens: usage.completion_tokens_details?.reasoning_tokens ?? 0,
    cachedTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
    costUsd: usage.cost ?? null,
    provider: 'openrouter',
    model: json.model || model,
    latencyMs: Date.now() - startedAt,
  };
}

async function chat(body, timeoutMs, model) {
  const startedAt = Date.now();
  const response = await post('/chat/completions', { ...body, model, usage: { include: true } }, timeoutMs);
  const json = await response.json();
  const message = json.choices?.[0]?.message;
  return { json, message, usage: chatUsage(json, model, startedAt) };
}

/**
 * Split one page image into labelled text blocks.
 * @param {{pngBase64: string, mimeType?: string, reasoning?: 'minimal'|'low'|'medium'}} args
 */
async function extractBlocks({ pngBase64, mimeType = 'image/png', reasoning = 'minimal' }) {
  const { json, message, usage } = await chat({
    temperature: 0,
    reasoning: { effort: reasoning },
    response_format: { type: 'json_schema', json_schema: PAGE_BLOCKS_SCHEMA },
    messages: [
      { role: 'system', content: EXTRACTION_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${pngBase64}` } },
          { type: 'text', text: EXTRACTION_USER_TEXT },
        ],
      },
    ],
  }, settings().timeouts.extractMs, settings().models.extract);

  const raw = message?.content;
  if (!raw) throw new Error(`OpenRouter extraction returned no content (finish ${json.choices?.[0]?.finish_reason})`);
  return { raw, usage };
}

/**
 * Text to speech. Gemini TTS on OpenRouter returns raw 16-bit PCM only (24 kHz mono), so the
 * caller wraps or transcodes it.
 * @param {{text: string, baseVoice: string, styleInstruction?: string|null}} args
 */
async function synthesize({ text, baseVoice, styleInstruction = null }) {
  const model = settings().models.tts;
  const startedAt = Date.now();
  // The style must not go in `input`: the model reads it aloud
  const body = { model, input: text, voice: baseVoice, response_format: 'pcm' };
  if (styleInstruction) body.instructions = styleInstruction;

  const response = await post('/audio/speech', body, settings().timeouts.ttsMs);
  const pcm = Buffer.from(await response.arrayBuffer());
  if (!pcm.length) throw new Error('OpenRouter speech returned no audio');

  const contentType = response.headers.get('content-type') || '';
  const sampleRate = Number(/rate=(\d+)/.exec(contentType)?.[1]) || 24000;
  const channels = Number(/channels=(\d+)/.exec(contentType)?.[1]) || 1;
  const bitsPerSample = 16;
  const seconds = pcm.length / (sampleRate * channels * bitsPerSample / 8);

  return {
    pcm,
    sampleRate,
    channels,
    bitsPerSample,
    generationId: response.headers.get('x-generation-id') || null,
    usage: {
      promptTokens: null,
      completionTokens: null,
      reasoningTokens: null,
      // The response carries no usage; this is the list price for the audio, which matched OpenRouter's charge in the spike
      costUsd: seconds * settings().ttsUsdPerAudioSecond,
      provider: 'openrouter',
      model,
      latencyMs: Date.now() - startedAt,
    },
  };
}

/**
 * One turn of a conversation about a PDF. The file goes on the first user message and is resent
 * every turn so Gemini's implicit prefix caching can discount it; the native engine returns no
 * annotations to reuse (spike P7).
 * @param {{pdfUrl: string, filename?: string, history?: {role: string, content: string}[], message: string, systemInstruction?: string|null}} args
 */
async function chatWithDocument({ pdfUrl, filename = 'document.pdf', history = [], message, systemInstruction = null }) {
  if (!pdfUrl) throw new Error('pdfUrl is required for OpenRouter document chat');

  const filePart = { type: 'file', file: { filename, file_data: pdfUrl } };
  const turns = [...history.map(({ role, content }) => ({ role, content })), { role: 'user', content: message }];
  const firstUser = turns.findIndex((turn) => turn.role === 'user');
  turns[firstUser] = {
    role: 'user',
    content: [{ type: 'text', text: turns[firstUser].content }, filePart],
  };

  const messages = systemInstruction ? [{ role: 'system', content: systemInstruction }, ...turns] : turns;
  const { message: reply, usage } = await chat({
    reasoning: { effort: 'low' },
    plugins: [{ id: 'file-parser', pdf: { engine: 'native' } }],
    messages,
  }, settings().timeouts.chatMs, settings().models.chat);

  if (!reply?.content) throw new Error('OpenRouter document chat returned no content');
  return { text: reply.content, annotations: reply.annotations || null, usage };
}

module.exports = { isConfigured, extractBlocks, synthesize, chatWithDocument, toJsonSchema };
