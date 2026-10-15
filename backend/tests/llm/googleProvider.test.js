jest.mock('../../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../../src/services/geminiService', () => ({ imageToJsonText: jest.fn(), generateAudio: jest.fn() }));
jest.mock('../../src/services/geminiDocumentService', () => ({ generateWithFile: jest.fn() }));

const geminiService = require('../../src/services/geminiService');
const geminiDocumentService = require('../../src/services/geminiDocumentService');
const provider = require('../../src/services/llm/googleProvider');
const { EXTRACTION_PROMPT, RESPONSE_SCHEMA } = require('../../src/config/prompts/extraction');

describe('googleProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('extractBlocks', () => {
    const usageMetadata = { promptTokenCount: 2077, candidatesTokenCount: 600, thoughtsTokenCount: 0 };

    it('sends the extraction prompt and schema with LOW thinking for minimal', async () => {
      geminiService.imageToJsonText.mockResolvedValue({ text: '{"blocks":[]}', usage: usageMetadata, model: 'gemini-3.8-flash' });

      await provider.extractBlocks({ pngBase64: 'AAAA', mimeType: 'image/png', reasoning: 'minimal' });

      expect(geminiService.imageToJsonText).toHaveBeenCalledWith({
        imageData: 'AAAA',
        mimeType: 'image/png',
        systemPrompt: EXTRACTION_PROMPT,
        responseSchema: RESPONSE_SCHEMA,
        thinkingLevel: 'LOW',
      });
    });

    it('maps medium reasoning to MEDIUM thinking', async () => {
      geminiService.imageToJsonText.mockResolvedValue({ text: '{"blocks":[]}', usage: usageMetadata, model: 'gemini-3.8-flash' });

      await provider.extractBlocks({ pngBase64: 'AAAA', reasoning: 'medium' });

      expect(geminiService.imageToJsonText.mock.calls[0][0].thinkingLevel).toBe('MEDIUM');
    });

    it('returns the raw text and normalised usage', async () => {
      geminiService.imageToJsonText.mockResolvedValue({ text: '{"blocks":[]}', usage: usageMetadata, model: 'gemini-3.8-flash' });

      const result = await provider.extractBlocks({ pngBase64: 'AAAA' });

      expect(result.raw).toBe('{"blocks":[]}');
      expect(result.usage).toMatchObject({
        promptTokens: 2077,
        completionTokens: 600,
        reasoningTokens: 0,
        provider: 'google',
        model: 'gemini-3.8-flash',
      });
    });

    it('throws on an empty response', async () => {
      geminiService.imageToJsonText.mockResolvedValue({ text: '  ', usage: null, model: 'gemini-3.8-flash' });

      await expect(provider.extractBlocks({ pngBase64: 'AAAA' })).rejects.toThrow('empty');
    });
  });

  describe('synthesize', () => {
    it('passes text, voice and style to generateAudio and decodes the PCM', async () => {
      const pcm = Buffer.from([1, 2, 3, 4]);
      geminiService.generateAudio.mockResolvedValue({
        data: pcm.toString('base64'),
        mimeType: 'audio/L16;codec=pcm;rate=24000',
        usage: { promptTokenCount: 10, candidatesTokenCount: 80 },
      });

      const result = await provider.synthesize({ text: 'Hello', baseVoice: 'Zephyr', styleInstruction: 'Warm.' });

      expect(geminiService.generateAudio).toHaveBeenCalledWith('Hello', 'Zephyr', 'Warm.');
      expect(result.pcm.equals(pcm)).toBe(true);
      expect(result).toMatchObject({ sampleRate: 24000, channels: 1, bitsPerSample: 16 });
      expect(result.usage).toMatchObject({ provider: 'google', promptTokens: 10, completionTokens: 80 });
    });

    it('sends a null style when none is given', async () => {
      geminiService.generateAudio.mockResolvedValue({ data: 'AAAA', mimeType: 'audio/L16;rate=24000', usage: null });

      await provider.synthesize({ text: 'Hello', baseVoice: 'Zephyr' });

      expect(geminiService.generateAudio).toHaveBeenCalledWith('Hello', 'Zephyr', null);
    });
  });

  describe('chatWithDocument', () => {
    it('calls generateWithFile with the file uri, message, history and system instruction', async () => {
      geminiDocumentService.generateWithFile.mockResolvedValue({
        text: 'answer',
        tokensUsed: { prompt: 100, candidates: 20, cached: 50, total: 120 },
      });
      const history = [{ role: 'user', content: 'Hi' }];

      const result = await provider.chatWithDocument({ fileUri: 'files/abc', history, message: 'Next?', systemInstruction: 'Be brief.' });

      expect(geminiDocumentService.generateWithFile).toHaveBeenCalledWith('files/abc', 'Next?', history, 'Be brief.');
      expect(result.text).toBe('answer');
      expect(result.annotations).toBeNull();
      expect(result.usage).toMatchObject({ promptTokens: 100, completionTokens: 20, cachedTokens: 50, provider: 'google' });
    });
  });
});
