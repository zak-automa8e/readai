jest.mock('../../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const config = require('../../src/config');
const provider = require('../../src/services/llm/openrouterProvider');
const { EXTRACTION_PROMPT } = require('../../src/config/prompts/extraction');

const openrouter = config.llm.openrouter;

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function audioResponse(pcm, headers = {}) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'audio/pcm;rate=24000;channels=1', ...headers }),
    arrayBuffer: async () => pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength),
  };
}

function sentRequest() {
  const [url, init] = global.fetch.mock.calls[0];
  return { url, init, body: JSON.parse(init.body) };
}

describe('openrouterProvider', () => {
  beforeEach(() => {
    openrouter.apiKey = 'test-key';
    global.fetch = jest.fn();
  });

  describe('extractBlocks', () => {
    const completion = {
      model: 'google/gemini-3.8-flash-20260902',
      choices: [{ finish_reason: 'stop', message: { content: '{"blocks":[]}' } }],
      usage: {
        prompt_tokens: 2329,
        completion_tokens: 600,
        cost: 0.0045,
        prompt_tokens_details: { cached_tokens: 10 },
        completion_tokens_details: { reasoning_tokens: 0 },
      },
    };

    it('posts the spike request body to /chat/completions', async () => {
      global.fetch.mockResolvedValue(jsonResponse(completion));

      await provider.extractBlocks({ pngBase64: 'AAAA', mimeType: 'image/png' });

      const { url, init, body } = sentRequest();
      expect(url).toBe(`${openrouter.baseUrl}/chat/completions`);
      expect(init.method).toBe('POST');
      expect(init.headers.Authorization).toBe('Bearer test-key');
      expect(body).toMatchObject({
        model: openrouter.models.extract,
        temperature: 0,
        reasoning: { effort: 'minimal' },
        usage: { include: true },
      });
      expect(body.messages[0]).toEqual({ role: 'system', content: EXTRACTION_PROMPT });
      expect(body.messages[1].content).toEqual([
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
        { type: 'text', text: 'Transcribe this page into blocks.' },
      ]);
    });

    it('asks for strict structured output with a plain lower-case JSON schema', async () => {
      global.fetch.mockResolvedValue(jsonResponse(completion));

      await provider.extractBlocks({ pngBase64: 'AAAA' });

      const { response_format: format } = sentRequest().body;
      expect(format.type).toBe('json_schema');
      expect(format.json_schema.name).toBe('page_blocks');
      expect(format.json_schema.strict).toBe(true);
      const block = format.json_schema.schema.properties.blocks.items;
      expect(format.json_schema.schema.type).toBe('object');
      expect(format.json_schema.schema.additionalProperties).toBe(false);
      expect(block.properties.role.enum).toContain('running_header');
      expect(block.properties.starts_mid_sentence.type).toBe('boolean');
      expect(block).not.toHaveProperty('propertyOrdering');
    });

    it('passes the requested reasoning effort through', async () => {
      global.fetch.mockResolvedValue(jsonResponse(completion));

      await provider.extractBlocks({ pngBase64: 'AAAA', reasoning: 'medium' });

      expect(sentRequest().body.reasoning).toEqual({ effort: 'medium' });
    });

    it('returns the raw reply and usage from the response', async () => {
      global.fetch.mockResolvedValue(jsonResponse(completion));

      const result = await provider.extractBlocks({ pngBase64: 'AAAA' });

      expect(result.raw).toBe('{"blocks":[]}');
      expect(result.usage).toMatchObject({
        promptTokens: 2329,
        completionTokens: 600,
        reasoningTokens: 0,
        cachedTokens: 10,
        costUsd: 0.0045,
        provider: 'openrouter',
        model: 'google/gemini-3.8-flash-20260902',
      });
      expect(typeof result.usage.latencyMs).toBe('number');
    });

    it('throws when the reply has no content', async () => {
      global.fetch.mockResolvedValue(jsonResponse({ choices: [{ finish_reason: 'length', message: {} }] }));

      await expect(provider.extractBlocks({ pngBase64: 'AAAA' })).rejects.toThrow('no content');
    });

    it('marks a 429 as retriable data and carries Retry-After', async () => {
      global.fetch.mockResolvedValue(jsonResponse({ error: 'slow down' }, { status: 429, headers: { 'retry-after': '7' } }));

      const error = await provider.extractBlocks({ pngBase64: 'AAAA' }).catch((e) => e);

      expect(error.message).toContain('failed with 429');
      expect(error.status).toBe(429);
      expect(error.retryAfterMs).toBe(7000);
    });

    it('flags a 402 spend-limit error as non-retriable', async () => {
      global.fetch.mockResolvedValue(jsonResponse({ error: 'key limit' }, { status: 402 }));

      const error = await provider.extractBlocks({ pngBase64: 'AAAA' }).catch((e) => e);

      expect(error.status).toBe(402);
      expect(error.nonRetriable).toBe(true);
    });
  });

  describe('synthesize', () => {
    it('posts to /audio/speech with pcm output and the voice as given', async () => {
      global.fetch.mockResolvedValue(audioResponse(Buffer.alloc(48000)));

      await provider.synthesize({ text: 'مرحبا', baseVoice: 'Zephyr' });

      const { url, body } = sentRequest();
      expect(url).toBe(`${openrouter.baseUrl}/audio/speech`);
      expect(body).toEqual({
        model: openrouter.models.tts,
        input: 'مرحبا',
        voice: 'Zephyr',
        response_format: 'pcm',
      });
    });

    it('sends the persona style in the top-level instructions field, never in the input', async () => {
      global.fetch.mockResolvedValue(audioResponse(Buffer.alloc(48000)));

      await provider.synthesize({ text: 'Hello', baseVoice: 'Enceladus', styleInstruction: 'Read slowly and warmly.' });

      const { body } = sentRequest();
      expect(body.instructions).toBe('Read slowly and warmly.');
      expect(body.input).toBe('Hello');
    });

    it('returns PCM with the rate from the Content-Type header and the generation id', async () => {
      const pcm = Buffer.alloc(96000, 1);
      global.fetch.mockResolvedValue(audioResponse(pcm, { 'content-type': 'audio/pcm;rate=24000;channels=1', 'x-generation-id': 'gen-tts-1' }));

      const result = await provider.synthesize({ text: 'Hello', baseVoice: 'Zephyr' });

      expect(result.pcm.equals(pcm)).toBe(true);
      expect(result).toMatchObject({ sampleRate: 24000, channels: 1, bitsPerSample: 16, generationId: 'gen-tts-1' });
    });

    it('prices the audio from its duration at the list rate', async () => {
      global.fetch.mockResolvedValue(audioResponse(Buffer.alloc(48000 * 10)));

      const { usage } = await provider.synthesize({ text: 'Hello', baseVoice: 'Zephyr' });

      expect(usage.costUsd).toBeCloseTo(10 * openrouter.ttsUsdPerAudioSecond, 10);
      expect(usage).toMatchObject({ provider: 'openrouter', model: openrouter.models.tts });
    });

    it('throws on an empty audio body', async () => {
      global.fetch.mockResolvedValue(audioResponse(Buffer.alloc(0)));

      await expect(provider.synthesize({ text: 'Hello', baseVoice: 'Zephyr' })).rejects.toThrow('no audio');
    });

    it('surfaces an unknown-voice 400 with its status', async () => {
      global.fetch.mockResolvedValue(jsonResponse({ error: 'Provider returned 400' }, { status: 400 }));

      const error = await provider.synthesize({ text: 'Hello', baseVoice: 'NotAVoice' }).catch((e) => e);

      expect(error.status).toBe(400);
    });
  });

  describe('chatWithDocument', () => {
    const reply = {
      model: 'google/gemini-3.8-flash',
      choices: [{ message: { content: 'الجواب' } }],
      usage: { prompt_tokens: 14100, completion_tokens: 40, cost: 0.0107, prompt_tokens_details: { cached_tokens: 12235 } },
    };

    it('attaches the PDF to the first user message with the native file parser', async () => {
      global.fetch.mockResolvedValue(jsonResponse(reply));

      await provider.chatWithDocument({
        pdfUrl: 'https://example.com/book.pdf',
        filename: 'book.pdf',
        history: [
          { role: 'user', content: 'ما عنوان الفصل الأول؟' },
          { role: 'assistant', content: 'منهجية قرآنية' },
        ],
        message: 'وما الثاني؟',
        systemInstruction: 'You are a reading assistant.',
      });

      const { body } = sentRequest();
      expect(body.model).toBe(openrouter.models.chat);
      expect(body.plugins).toEqual([{ id: 'file-parser', pdf: { engine: 'native' } }]);
      expect(body.reasoning).toEqual({ effort: 'low' });
      expect(body.messages).toEqual([
        { role: 'system', content: 'You are a reading assistant.' },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'ما عنوان الفصل الأول؟' },
            { type: 'file', file: { filename: 'book.pdf', file_data: 'https://example.com/book.pdf' } },
          ],
        },
        { role: 'assistant', content: 'منهجية قرآنية' },
        { role: 'user', content: 'وما الثاني؟' },
      ]);
    });

    it('attaches the PDF to the current message on the first turn', async () => {
      global.fetch.mockResolvedValue(jsonResponse(reply));

      await provider.chatWithDocument({ pdfUrl: 'https://example.com/book.pdf', message: 'Summarise' });

      const { body } = sentRequest();
      expect(body.messages).toHaveLength(1);
      expect(body.messages[0].content[0]).toEqual({ type: 'text', text: 'Summarise' });
      expect(body.messages[0].content[1].file.filename).toBe('document.pdf');
    });

    it('returns the text, null annotations and usage including cached tokens', async () => {
      global.fetch.mockResolvedValue(jsonResponse(reply));

      const result = await provider.chatWithDocument({ pdfUrl: 'https://example.com/book.pdf', message: 'Hi' });

      expect(result.text).toBe('الجواب');
      expect(result.annotations).toBeNull();
      expect(result.usage).toMatchObject({ promptTokens: 14100, cachedTokens: 12235, costUsd: 0.0107 });
    });

    it('requires a pdfUrl', async () => {
      await expect(provider.chatWithDocument({ message: 'Hi' })).rejects.toThrow('pdfUrl is required');
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });
});
