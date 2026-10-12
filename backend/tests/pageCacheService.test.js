const pageCacheService = require('../src/services/pageCacheService');
const supabaseService = require('../src/services/supabaseService');
const geminiService = require('../src/services/geminiService');
const voicePersonaService = require('../src/services/voicePersonaService');
const logger = require('../src/utils/logger');

// Mock dependencies
jest.mock('../src/services/supabaseService');
jest.mock('../src/services/geminiService');
jest.mock('../src/services/voicePersonaService');
jest.mock('../src/utils/logger');

describe('PageCacheService', () => {
    const bookId = 'book-123';
    const pageNumber = 1;
    const userId = 'user-456';
    const imageData = 'base64-image-data';
    const mimeType = 'image/png';

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('getOrExtractPageText', () => {
        it('should return cached text when available and forceRefresh is false', async () => {
            const existingText = {
                extracted_text: JSON.stringify({ header: 'Header', body: 'Body' }),
                pages: { id: 'page-1' }
            };

            supabaseService.getPageTextByBookAndNumber.mockResolvedValue(existingText);

            const result = await pageCacheService.getOrExtractPageText(bookId, pageNumber, imageData, mimeType, userId, false);

            expect(result.cached).toBe(true);
            expect(result.text.header).toBe('Header');
            expect(supabaseService.getPageTextByBookAndNumber).toHaveBeenCalledWith(bookId, pageNumber);
            expect(geminiService.processImageToText).not.toHaveBeenCalled();
        });

        it('should re-extract text when forceRefresh is true', async () => {
            const existingText = {
                extracted_text: JSON.stringify({ header: 'Old Header', body: 'Old Body' }),
                pages: { id: 'page-1' }
            };
            const freshText = JSON.stringify({ header: 'New Header', body: 'New Body' });
            const pageRecord = { id: 'page-1' };

            supabaseService.getPageTextByBookAndNumber.mockResolvedValue(existingText);
            supabaseService.getOrCreatePage.mockResolvedValue(pageRecord);
            geminiService.processImageToText.mockResolvedValue(freshText);

            const result = await pageCacheService.getOrExtractPageText(bookId, pageNumber, imageData, mimeType, userId, true);

            expect(result.cached).toBe(false);
            expect(result.text.header).toBe('New Header');
            expect(geminiService.processImageToText).toHaveBeenCalled();
            expect(supabaseService.savePageText).toHaveBeenCalled();
        });
    });

    describe('getOrGeneratePageAudio', () => {
        const text = 'Sample text';
        const voicePersona = 'Sadaltager';
        const personaId = '3f2b8c1e-0d4a-4b7e-9c11-aaaaaaaaaaaa';

        it('should return cached audio when available and forceRefresh is false', async () => {
            const existingAudio = {
                audio_url: 'http://example.com/audio.wav',
                pages: { id: 'page-1' }
            };

            supabaseService.getPageAudioByBookAndNumber.mockResolvedValue(existingAudio);

            const result = await pageCacheService.getOrGeneratePageAudio(bookId, pageNumber, text, voicePersona, userId, false);

            expect(result.cached).toBe(true);
            expect(result.audioUrl).toBe('http://example.com/audio.wav');
            expect(geminiService.generateAudio).not.toHaveBeenCalled();
        });

        it('should re-generate audio when forceRefresh is true', async () => {
            const persona = {
                name: 'Sadaltager',
                base_voice_name: 'en-US-Standard-A'
            };
            const audioResult = {
                data: Buffer.from('audio-data'),
                mimeType: 'audio/wav'
            };
            const pageRecord = { id: 'page-1' };

            supabaseService.getPageAudioByBookAndNumber.mockResolvedValue({ audio_url: 'old-url' });
            voicePersonaService.getAccessiblePersona.mockResolvedValue(persona);
            voicePersonaService.buildPrompt.mockReturnValue('System prompt');
            supabaseService.getOrCreatePage.mockResolvedValue(pageRecord);
            geminiService.generateAudio.mockResolvedValue(audioResult);
            supabaseService.saveAudioFile.mockResolvedValue('http://example.com/new-audio.wav');
            supabaseService.savePageAudio.mockResolvedValue({});

            const result = await pageCacheService.getOrGeneratePageAudio(bookId, pageNumber, text, voicePersona, userId, true, personaId);

            expect(result.cached).toBe(false);
            expect(result.audioUrl).toContain('http://example.com/new-audio.wav');
            expect(geminiService.generateAudio).toHaveBeenCalled();
            expect(supabaseService.savePageAudio).toHaveBeenCalled();
        });
    });

    describe('resolveVoice', () => {
        const personaId = '3f2b8c1e-0d4a-4b7e-9c11-aaaaaaaaaaaa';
        const persona = {
            id: personaId,
            user_id: userId,
            base_voice_name: 'Enceladus',
            updated_at: '2026-01-01T00:00:00.000Z'
        };

        it('keys an accessible persona by id and updated_at', async () => {
            voicePersonaService.getAccessiblePersona.mockResolvedValue(persona);

            const result = await pageCacheService.resolveVoice(personaId, 'Zephyr', userId);

            expect(voicePersonaService.getAccessiblePersona).toHaveBeenCalledWith(personaId, userId);
            expect(result.persona).toBe(persona);
            expect(result.baseVoiceName).toBe('Enceladus');
            expect(result.cacheKey).toBe(`persona:${personaId}:${Date.parse(persona.updated_at)}`);
        });

        it('changes the cache key when the persona is updated', async () => {
            voicePersonaService.getAccessiblePersona.mockResolvedValueOnce(persona);
            voicePersonaService.getAccessiblePersona.mockResolvedValueOnce({ ...persona, updated_at: '2026-02-01T00:00:00.000Z' });

            const before = await pageCacheService.resolveVoice(personaId, 'Zephyr', userId);
            const after = await pageCacheService.resolveVoice(personaId, 'Zephyr', userId);

            expect(after.cacheKey).not.toBe(before.cacheKey);
        });

        it('falls back to the base voice when the persona is unknown or not accessible', async () => {
            voicePersonaService.getAccessiblePersona.mockResolvedValue(null);

            const result = await pageCacheService.resolveVoice(personaId, 'Zephyr', userId);

            expect(result.persona).toBeNull();
            expect(result.baseVoiceName).toBe('Zephyr');
            expect(result.cacheKey).toBe('Zephyr');
        });

        it('uses the base voice without a lookup when no persona id is given', async () => {
            const result = await pageCacheService.resolveVoice(null, 'Zephyr', userId);

            expect(voicePersonaService.getAccessiblePersona).not.toHaveBeenCalled();
            expect(result.cacheKey).toBe('Zephyr');
        });

        it('rejects base voice names that are unsafe for storage paths', async () => {
            const result = await pageCacheService.resolveVoice(null, '../evil name', userId);

            expect(result.baseVoiceName).toBe('Sadaltager');
            expect(result.cacheKey).toBe('Sadaltager');
        });
    });

    describe('getOrGeneratePageAudio with a persona', () => {
        const personaId = '3f2b8c1e-0d4a-4b7e-9c11-aaaaaaaaaaaa';
        const persona = {
            id: personaId,
            user_id: userId,
            base_voice_name: 'Enceladus',
            pace: 'slow',
            tone: 'warm',
            emotion: 'calm',
            speaking_style: 'narrative',
            updated_at: '2026-01-01T00:00:00.000Z'
        };

        it('looks up, stores and names audio by the persona cache key', async () => {
            const cacheKey = `persona:${personaId}:${Date.parse(persona.updated_at)}`;
            voicePersonaService.getAccessiblePersona.mockResolvedValue(persona);
            voicePersonaService.buildPrompt.mockReturnValue('System prompt');
            supabaseService.getPageAudioByBookAndNumber.mockResolvedValue(null);
            supabaseService.getOrCreatePage.mockResolvedValue({ id: 'page-1' });
            geminiService.generateAudio.mockResolvedValue({ data: Buffer.from('audio-data'), mimeType: 'audio/wav' });
            supabaseService.saveAudioFile.mockResolvedValue('http://example.com/new-audio.wav');
            supabaseService.savePageAudio.mockResolvedValue({});

            await pageCacheService.getOrGeneratePageAudio(bookId, pageNumber, 'Sample text', 'Zephyr', userId, false, personaId);

            expect(supabaseService.getPageAudioByBookAndNumber).toHaveBeenCalledWith(bookId, pageNumber, cacheKey);
            expect(geminiService.generateAudio).toHaveBeenCalledWith('Sample text', 'Enceladus', 'System prompt');
            expect(supabaseService.savePageAudio).toHaveBeenCalledWith('page-1', expect.objectContaining({ voice_persona: cacheKey }));
            const filePath = supabaseService.saveAudioFile.mock.calls[0][1];
            expect(filePath).toMatch(/^audio\/user-456\/book-123\/page_1_persona_[a-z0-9_-]+\.wav$/);
        });

        it('generates with the base voice when the persona is not accessible', async () => {
            voicePersonaService.getAccessiblePersona.mockResolvedValue(null);
            supabaseService.getPageAudioByBookAndNumber.mockResolvedValue(null);
            supabaseService.getOrCreatePage.mockResolvedValue({ id: 'page-1' });
            geminiService.generateAudio.mockResolvedValue({ data: Buffer.from('audio-data'), mimeType: 'audio/wav' });
            supabaseService.saveAudioFile.mockResolvedValue('http://example.com/new-audio.wav');
            supabaseService.savePageAudio.mockResolvedValue({});

            await pageCacheService.getOrGeneratePageAudio(bookId, pageNumber, 'Sample text', 'Zephyr', userId, false, personaId);

            expect(supabaseService.getPageAudioByBookAndNumber).toHaveBeenCalledWith(bookId, pageNumber, 'Zephyr');
            expect(geminiService.generateAudio).toHaveBeenCalledWith('Sample text', 'Zephyr', null);
            expect(voicePersonaService.buildPrompt).not.toHaveBeenCalled();
        });
    });
});
