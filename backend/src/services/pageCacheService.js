const supabaseService = require('./supabaseService');
const llm = require('./llm');
const { pcmToWav, durationSeconds } = require('./llm/audio');
const voicePersonaService = require('./voicePersonaService');
const { truncateForLegacyAudio } = require('../utils/audioUtils');
const { blocksToLegacyText } = require('../utils/legacyPageText');
const logger = require('../utils/logger');

const DEFAULT_BASE_VOICE = 'Sadaltager';
const BASE_VOICE_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

class PageCacheService {
  /**
   * Resolve the requested voice into a base voice, an optional persona and the cache key.
   * Personas are looked up by id, limited to the user's own or public ones; the cache key
   * embeds updated_at so editing a persona invalidates its cached audio.
   */
  async resolveVoice(voicePersonaId, voicePersona, userId) {
    if (voicePersonaId) {
      const persona = await voicePersonaService.getAccessiblePersona(voicePersonaId, userId);
      if (persona) {
        const version = Date.parse(persona.updated_at || persona.created_at) || 0;
        return {
          persona,
          baseVoiceName: persona.base_voice_name,
          cacheKey: `persona:${persona.id}:${version}`
        };
      }
      logger.warn('Persona not found or not accessible, falling back to base voice', { voicePersonaId, userId });
    }

    const baseVoiceName = BASE_VOICE_PATTERN.test(voicePersona || '') ? voicePersona : DEFAULT_BASE_VOICE;
    return { persona: null, baseVoiceName, cacheKey: baseVoiceName };
  }

  /**
   * Get or extract page text with caching
   * @param {string} bookId - Book ID
   * @param {number} pageNumber - Page number
   * @param {string} imageData - Base64 image data
   * @param {string} mimeType - Image MIME type
   * @param {string} userId - User ID for logging
   * @param {boolean} forceRefresh - Whether to bypass cache and re-extract
   * @returns {Promise<Object>} - { cached: boolean, text: object, page: object }
   */
  async getOrExtractPageText(bookId, pageNumber, imageData, mimeType, userId, forceRefresh = false) {
    const startTime = Date.now();

    try {
      // Try to get existing text from cache
      const existingText = await supabaseService.getPageTextByBookAndNumber(bookId, pageNumber);

      if (existingText && !forceRefresh) {
        logger.info('Page text cache HIT', { bookId, pageNumber, userId });
        return {
          cached: true,
          text: this.normalizeExtractedText(existingText.extracted_text),
          page: existingText.pages,
          processingTime: Date.now() - startTime
        };
      }

      logger.info(forceRefresh ? 'Page text FORCE REFRESH' : 'Page text cache MISS - extracting', { bookId, pageNumber, userId });

      // Get or create page record with placeholder image URL
      const page = await supabaseService.getOrCreatePage(bookId, pageNumber, 'placeholder');

      // Extract text through the LLM layer, stored in the legacy header/body/footer shape
      logger.info('Calling LLM for fresh text extraction...', { bookId, pageNumber });
      const { blocks } = await llm.extractBlocks({ pngBase64: imageData, mimeType });
      const extractedText = blocksToLegacyText(blocks);

      const normalized = this.normalizeExtractedText(extractedText);
      logger.info('LLM extraction complete', {
        bookId,
        pageNumber,
        textPreview: normalized.body ? normalized.body.substring(0, 50) + '...' : 'empty'
      });

      // Save text to cache
      logger.info('Updating page_text cache with fresh extraction...', { bookId, pageNumber });
      await supabaseService.savePageText(page.id, {
        extracted_text: extractedText,
        extraction_confidence: 0.95, // Default confidence
        processing_duration_ms: Date.now() - startTime
      });

      logger.info('Page text extracted and cached', { bookId, pageNumber, userId });

      return {
        cached: false,
        text: this.normalizeExtractedText(extractedText),
        page: page,
        processingTime: Date.now() - startTime
      };

    } catch (error) {
      logger.error('Error in getOrExtractPageText:', error);
      throw error;
    }
  }

  normalizeExtractedText(rawText) {
    if (!rawText) {
      return { header: '', body: '', footer: '' };
    }

    let parsed = rawText;

    if (typeof rawText === 'string') {
      try {
        parsed = JSON.parse(rawText);
      } catch (parseError) {
        logger.warn('Failed to parse cached extracted_text JSON, returning fallback', { message: parseError.message });
        return { header: '', body: rawText, footer: '' };
      }
    }

    const safeHeader = typeof parsed.header === 'string' ? parsed.header : '';
    const safeBody = typeof parsed.body === 'string' ? parsed.body : '';
    const safeFooter = typeof parsed.footer === 'string' ? parsed.footer : '';

    return {
      header: safeHeader,
      body: safeBody,
      footer: safeFooter
    };
  }

  /**
   * Get or generate page audio with caching
   * @param {string} bookId - Book ID
   * @param {number} pageNumber - Page number
   * @param {string} text - Text to convert to audio
   * @param {string} voicePersona - Base voice name, used when no accessible persona is given
   * @param {string} userId - User ID for persona access and file paths
   * @param {boolean} forceRefresh - Whether to bypass cache and regenerate
   * @param {string|null} voicePersonaId - Optional voice persona id (own or public)
   * @returns {Promise<Object>} - { cached: boolean, audioUrl: string, duration: number, page: object }
   */
  async getOrGeneratePageAudio(bookId, pageNumber, text, voicePersona = DEFAULT_BASE_VOICE, userId, forceRefresh = false, voicePersonaId = null) {
    const startTime = Date.now();

    try {
      const { persona, baseVoiceName, cacheKey } = await this.resolveVoice(voicePersonaId, voicePersona, userId);

      // Try to get existing audio from cache
      const existingAudio = await supabaseService.getPageAudioByBookAndNumber(bookId, pageNumber, cacheKey);

      if (existingAudio && existingAudio.audio_url && !forceRefresh) {
        logger.info('Page audio cache HIT', { bookId, pageNumber, cacheKey, userId });
        return {
          cached: true,
          audioUrl: existingAudio.audio_url,
          duration: existingAudio.audio_duration_seconds,
          page: existingAudio.pages,
          processingTime: Date.now() - startTime
        };
      }

      logger.info(forceRefresh ? 'Page audio FORCE REFRESH' : 'Page audio cache MISS - generating', { bookId, pageNumber, cacheKey, userId });

      const systemInstruction = persona ? voicePersonaService.buildPrompt(persona) : null;

      // Get or create page record
      const page = await supabaseService.getOrCreatePage(bookId, pageNumber, 'placeholder');

      // Generate audio through the LLM layer
      logger.info('Calling LLM for fresh audio generation...', { bookId, pageNumber, cacheKey });
      const audio = await llm.synthesize({
        text: truncateForLegacyAudio(text),
        baseVoice: baseVoiceName,
        styleInstruction: systemInstruction
      });

      // Convert to WAV
      const wavBuffer = pcmToWav(audio);

      // Save audio file to storage
      // Use a consistent naming scheme that includes persona and timestamp to ensure freshness
      const timestamp = Date.now();
      const safeKey = cacheKey.toLowerCase().replace(/[^a-z0-9_-]+/g, '_');
      const fileName = `page_${pageNumber}_${safeKey}_${timestamp}.wav`;
      const filePath = `audio/${userId}/${bookId}/${fileName}`;

      logger.info('Saving fresh audio file to storage...', { bookId, pageNumber, filePath });
      const audioUrl = await supabaseService.saveAudioFile(wavBuffer, filePath);

      // Duration from the WAV header; the column is an integer
      const estimatedDuration = Math.round(durationSeconds(wavBuffer));

      // Save audio metadata to cache (upsert handles existing records)
      await supabaseService.savePageAudio(page.id, {
        voice_persona: cacheKey,
        audio_url: audioUrl,
        audio_duration_seconds: estimatedDuration,
        audio_format: 'wav',
        audio_size_bytes: wavBuffer.length,
        voice_settings: persona ? {
          pace: persona.pace,
          tone: persona.tone,
          emotion: persona.emotion,
          style: persona.speaking_style,
          personaId: persona.id
        } : { voiceName: baseVoiceName },
        processing_duration_ms: Date.now() - startTime
      });

      logger.info('Page audio generated and cached', { bookId, pageNumber, cacheKey, userId, audioUrl });

      return {
        cached: false,
        audioUrl: audioUrl,
        duration: estimatedDuration,
        page: page,
        processingTime: Date.now() - startTime
      };

    } catch (error) {
      logger.error('Error in getOrGeneratePageAudio:', error);
      throw error;
    }
  }
}

module.exports = new PageCacheService();