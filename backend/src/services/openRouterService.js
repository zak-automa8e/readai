const config = require('../config');
const logger = require('../utils/logger');

const API = 'https://openrouter.ai/api/v1';

// OpenRouter returns Gemini TTS as raw 16-bit mono PCM at 24 kHz (verified in the spike)
const PCM_MIME_TYPE = 'audio/L16;codec=pcm;rate=24000';

/**
 * OpenRouter calls for page extraction and speech. Request shapes follow
 * docs/research/2026-10-openrouter-spike.md: chat/completions for extraction,
 * /audio/speech for TTS, persona style in the top-level `instructions` field.
 */
class OpenRouterService {
  isEnabled() {
    return config.llmProvider === 'openrouter' && Boolean(config.openRouter.apiKey);
  }

  headers() {
    return {
      Authorization: `Bearer ${config.openRouter.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  async post(path, body, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${API}${path}`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 500);
        throw new Error(`OpenRouter ${path} failed with ${response.status}: ${detail}`);
      }
      return response;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Extract page text with a system prompt that asks for JSON.
   * @returns {Promise<string>} raw JSON text from the model
   */
  async extractPageText(imageData, mimeType, systemPrompt) {
    const model = config.openRouter.extractionModel;
    logger.debug(`Calling OpenRouter ${model} for image-to-text conversion`);
    const response = await this.post('/chat/completions', {
      model,
      temperature: 0,
      reasoning: { effort: 'minimal' },
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [{ type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageData}` } }],
        },
      ],
    }, config.openRouter.extractionTimeoutMs);
    const json = await response.json();
    const text = json.choices?.[0]?.message?.content;
    if (!text) throw new Error('OpenRouter extraction returned no content');
    return text;
  }

  /**
   * Synthesize speech. Returns the same shape as GeminiService.generateAudio.
   * @returns {Promise<{data: string, mimeType: string}>} base64 PCM and its MIME type
   */
  async synthesize(text, voiceName, instructions = null) {
    const model = config.openRouter.ttsModel;
    logger.debug(`Calling OpenRouter ${model} for text-to-audio conversion`, { voiceName });
    const body = { model, input: text, voice: voiceName, response_format: 'pcm' };
    if (instructions) body.instructions = instructions;
    const response = await this.post('/audio/speech', body, config.openRouter.ttsTimeoutMs);
    const audio = Buffer.from(await response.arrayBuffer());
    if (!audio.length) throw new Error('OpenRouter speech returned no audio');
    return { data: audio.toString('base64'), mimeType: PCM_MIME_TYPE };
  }
}

module.exports = new OpenRouterService();
