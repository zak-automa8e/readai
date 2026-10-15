jest.mock('../../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../../src/services/llm/openrouterProvider', () => ({
  isConfigured: jest.fn(), extractBlocks: jest.fn(), synthesize: jest.fn(), chatWithDocument: jest.fn(),
}));
jest.mock('../../src/services/llm/googleProvider', () => ({
  isConfigured: jest.fn(), extractBlocks: jest.fn(), synthesize: jest.fn(), chatWithDocument: jest.fn(),
}));

const config = require('../../src/config');
const openrouter = require('../../src/services/llm/openrouterProvider');
const google = require('../../src/services/llm/googleProvider');
const llm = require('../../src/services/llm');

const usage = { promptTokens: 1, completionTokens: 1, reasoningTokens: 0, costUsd: 0, provider: 'x', model: 'm', latencyMs: 1 };
const goodExtraction = { raw: '{"blocks":[{"role":"body","text":"x"}]}', usage };

describe('llm index', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    config.llm.provider = 'openrouter';
    config.llm.retry = { attempts: 3, baseDelayMs: 1 };
    openrouter.isConfigured.mockReturnValue(true);
    google.isConfigured.mockReturnValue(true);
  });

  describe('provider switch', () => {
    it('uses OpenRouter when configured for it', async () => {
      openrouter.synthesize.mockResolvedValue({ pcm: Buffer.alloc(2), usage });

      await llm.synthesize({ text: 'Hi', baseVoice: 'Zephyr' });

      expect(openrouter.synthesize).toHaveBeenCalledWith({ text: 'Hi', baseVoice: 'Zephyr' });
      expect(google.synthesize).not.toHaveBeenCalled();
    });

    it('uses the Google adapter when configured for google', async () => {
      config.llm.provider = 'google';
      google.synthesize.mockResolvedValue({ pcm: Buffer.alloc(2), usage });

      await llm.synthesize({ text: 'Hi', baseVoice: 'Zephyr', styleInstruction: 'Warm.' });

      expect(google.synthesize).toHaveBeenCalledWith({ text: 'Hi', baseVoice: 'Zephyr', styleInstruction: 'Warm.' });
      expect(openrouter.synthesize).not.toHaveBeenCalled();
    });

    it('uses the Google adapter when OpenRouter has no key', async () => {
      openrouter.isConfigured.mockReturnValue(false);
      google.chatWithDocument.mockResolvedValue({ text: 'ok', annotations: null, usage });

      await llm.chatWithDocument({ fileUri: 'files/a', message: 'Hi' });

      expect(google.chatWithDocument).toHaveBeenCalled();
      expect(openrouter.chatWithDocument).not.toHaveBeenCalled();
    });
  });

  describe('extractBlocks', () => {
    it('parses the reply into blocks and keeps the raw text and usage', async () => {
      openrouter.extractBlocks.mockResolvedValue(goodExtraction);

      const result = await llm.extractBlocks({ pngBase64: 'AAAA', mimeType: 'image/png', reasoning: 'low' });

      expect(openrouter.extractBlocks).toHaveBeenCalledWith({ pngBase64: 'AAAA', mimeType: 'image/png', reasoning: 'low' });
      expect(result.blocks).toEqual([{ role: 'body', text: 'x' }]);
      expect(result.raw).toBe(goodExtraction.raw);
      expect(result.usage).toBe(usage);
    });

    it('throws a stub error for batch mode without calling a provider', async () => {
      await expect(llm.extractBlocks({ pngBase64: 'AAAA', mode: 'batch' })).rejects.toThrow('not implemented — story 4');
      expect(openrouter.extractBlocks).not.toHaveBeenCalled();
    });

    it('retries a reply that is not valid JSON', async () => {
      openrouter.extractBlocks
        .mockResolvedValueOnce({ raw: '{"blocks":[{"role"', usage })
        .mockResolvedValueOnce(goodExtraction);

      const result = await llm.extractBlocks({ pngBase64: 'AAAA' });

      expect(openrouter.extractBlocks).toHaveBeenCalledTimes(2);
      expect(result.blocks).toHaveLength(1);
    });

    it('falls back to Gemini direct when OpenRouter keeps failing', async () => {
      const failure = Object.assign(new Error('OpenRouter /chat/completions failed with 400: bad'), { status: 400 });
      openrouter.extractBlocks.mockRejectedValue(failure);
      google.extractBlocks.mockResolvedValue(goodExtraction);

      const result = await llm.extractBlocks({ pngBase64: 'AAAA' });

      expect(openrouter.extractBlocks).toHaveBeenCalledTimes(1);
      expect(google.extractBlocks).toHaveBeenCalledTimes(1);
      expect(result.blocks).toHaveLength(1);
    });

    it('rethrows the OpenRouter error when there is no Gemini key to fall back to', async () => {
      google.isConfigured.mockReturnValue(false);
      openrouter.extractBlocks.mockRejectedValue(Object.assign(new Error('boom'), { status: 400 }));

      await expect(llm.extractBlocks({ pngBase64: 'AAAA' })).rejects.toThrow('boom');
      expect(google.extractBlocks).not.toHaveBeenCalled();
    });

    it('does not fall back when the Google adapter is already the provider', async () => {
      config.llm.provider = 'google';
      google.extractBlocks.mockRejectedValue(Object.assign(new Error('boom'), { status: 400 }));

      await expect(llm.extractBlocks({ pngBase64: 'AAAA' })).rejects.toThrow('boom');
      expect(google.extractBlocks).toHaveBeenCalledTimes(1);
    });
  });

  describe('withRetry', () => {
    const sleepFn = jest.fn().mockResolvedValue();
    const options = { attempts: 4, baseDelayMs: 100, sleepFn };

    beforeEach(() => sleepFn.mockClear());

    it('retries a 429 with exponential backoff and then succeeds', async () => {
      const operation = jest.fn()
        .mockRejectedValueOnce(Object.assign(new Error('rate limited'), { status: 429 }))
        .mockRejectedValueOnce(Object.assign(new Error('rate limited'), { status: 429 }))
        .mockResolvedValue('ok');

      await expect(llm.withRetry(operation, options)).resolves.toBe('ok');

      expect(operation).toHaveBeenCalledTimes(3);
      expect(sleepFn.mock.calls.map(([ms]) => ms)).toEqual([100, 200]);
    });

    it('waits at least as long as Retry-After', async () => {
      const operation = jest.fn()
        .mockRejectedValueOnce(Object.assign(new Error('rate limited'), { status: 429, retryAfterMs: 9000 }))
        .mockResolvedValue('ok');

      await llm.withRetry(operation, options);

      expect(sleepFn).toHaveBeenCalledWith(9000);
    });

    it('honours the retryDelay Google puts in the error message', async () => {
      const message = `429 {"error":{"details":[{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"12s"}]}}`;
      const operation = jest.fn().mockRejectedValueOnce(new Error(message)).mockResolvedValue('ok');

      await llm.withRetry(operation, options);

      expect(sleepFn).toHaveBeenCalledWith(12000);
    });

    it('stops at once on a daily quota cap', async () => {
      const message = `429 {"error":{"details":[{"@type":"type.googleapis.com/google.rpc.QuotaFailure","violations":[{"quotaId":"GenerateRequestsPerDayPerProjectPerModel"}]}]}}`;
      const operation = jest.fn().mockRejectedValue(new Error(message));

      await expect(llm.withRetry(operation, options)).rejects.toThrow('429');

      expect(operation).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['a 400', Object.assign(new Error('bad voice'), { status: 400 })],
      ['a 402 spend limit', Object.assign(new Error('limit'), { status: 402, nonRetriable: true })],
      ['an unrecognised error', new Error('something else entirely')],
    ])('does not retry %s', async (_label, error) => {
      const operation = jest.fn().mockRejectedValue(error);

      await expect(llm.withRetry(operation, options)).rejects.toBe(error);

      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('retries 5xx statuses, timeouts and empty audio', async () => {
      for (const error of [
        Object.assign(new Error('upstream'), { status: 503 }),
        Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }),
        new Error('No audio data in response'),
      ]) {
        const operation = jest.fn().mockRejectedValueOnce(error).mockResolvedValue('ok');
        await expect(llm.withRetry(operation, options)).resolves.toBe('ok');
      }
    });

    it('gives up after the configured attempts and throws the last error', async () => {
      const operation = jest.fn().mockRejectedValue(Object.assign(new Error('still down'), { status: 503 }));

      await expect(llm.withRetry(operation, options)).rejects.toThrow('still down');

      expect(operation).toHaveBeenCalledTimes(4);
      expect(sleepFn).toHaveBeenCalledTimes(3);
    });
  });

  describe('synthesize', () => {
    it('validates its arguments', async () => {
      await expect(llm.synthesize({ baseVoice: 'Zephyr' })).rejects.toThrow('text is required');
      await expect(llm.synthesize({ text: 'Hi' })).rejects.toThrow('baseVoice is required');
    });

    it('does not retry a bad voice', async () => {
      openrouter.synthesize.mockRejectedValue(Object.assign(new Error('Provider returned 400'), { status: 400 }));

      await expect(llm.synthesize({ text: 'Hi', baseVoice: 'NotAVoice' })).rejects.toThrow('400');

      expect(openrouter.synthesize).toHaveBeenCalledTimes(1);
    });
  });

  describe('chatWithDocument', () => {
    it('forwards the arguments and returns the adapter result', async () => {
      const reply = { text: 'answer', annotations: null, usage };
      openrouter.chatWithDocument.mockResolvedValue(reply);
      const args = { pdfUrl: 'https://example.com/b.pdf', message: 'Hi', history: [] };

      await expect(llm.chatWithDocument(args)).resolves.toBe(reply);

      expect(openrouter.chatWithDocument).toHaveBeenCalledWith(args);
    });

    it('requires a message', async () => {
      await expect(llm.chatWithDocument({ pdfUrl: 'x' })).rejects.toThrow('message is required');
    });
  });
});
