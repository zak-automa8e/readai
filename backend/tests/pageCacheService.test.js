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
            voicePersonaService.getPersonaByName.mockResolvedValue(persona);
            voicePersonaService.buildPrompt.mockReturnValue('System prompt');
            supabaseService.getOrCreatePage.mockResolvedValue(pageRecord);
            geminiService.generateAudio.mockResolvedValue(audioResult);
            supabaseService.saveAudioFile.mockResolvedValue('http://example.com/new-audio.wav');
            supabaseService.savePageAudio.mockResolvedValue({});

            const result = await pageCacheService.getOrGeneratePageAudio(bookId, pageNumber, text, voicePersona, userId, true);

            expect(result.cached).toBe(false);
            expect(result.audioUrl).toContain('http://example.com/new-audio.wav');
            expect(geminiService.generateAudio).toHaveBeenCalled();
            expect(supabaseService.savePageAudio).toHaveBeenCalled();
        });
    });
});
