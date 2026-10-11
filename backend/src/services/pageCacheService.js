const supabaseService = require('./supabaseService');
const geminiService = require('./geminiService');
const voicePersonaService = require('./voicePersonaService');
const { convertToWav } = require('../utils/audioUtils');
const logger = require('../utils/logger');

class PageCacheService {
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

      // Extract text using Gemini
      logger.info('Calling Gemini for fresh text extraction...', { bookId, pageNumber });
      const extractedText = await geminiService.processImageToText(imageData, mimeType);

      const normalized = this.normalizeExtractedText(extractedText);
      logger.info('Gemini extraction complete', {
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
   * @param {string} voicePersona - Voice persona name
   * @param {string} userId - User ID for logging and file paths
   * @param {boolean} forceRefresh - Whether to bypass cache and regenerate
   * @returns {Promise<Object>} - { cached: boolean, audioUrl: string, duration: number, page: object }
   */
  async getOrGeneratePageAudio(bookId, pageNumber, text, voicePersona = 'Sadaltager', userId, forceRefresh = false) {
    const startTime = Date.now();

    try {
      // Try to get existing audio from cache
      const existingAudio = await supabaseService.getPageAudioByBookAndNumber(bookId, pageNumber, voicePersona);

      if (existingAudio && existingAudio.audio_url && !forceRefresh) {
        logger.info('Page audio cache HIT', { bookId, pageNumber, voicePersona, userId });
        return {
          cached: true,
          audioUrl: existingAudio.audio_url,
          duration: existingAudio.audio_duration_seconds,
          page: existingAudio.pages,
          processingTime: Date.now() - startTime
        };
      }

      logger.info(forceRefresh ? 'Page audio FORCE REFRESH' : 'Page audio cache MISS - generating', { bookId, pageNumber, voicePersona, userId });

      // Fetch persona details to build a proper prompt
      const persona = await voicePersonaService.getPersonaByName(voicePersona, userId);
      let systemInstruction = null;
      let baseVoiceName = voicePersona;

      if (persona) {
        systemInstruction = voicePersonaService.buildPrompt(persona);
        baseVoiceName = persona.base_voice_name;
        logger.debug('Using persona-specific system instruction', { voicePersona, baseVoiceName });
      } else {
        logger.warn('Persona not found, falling back to base voice', { voicePersona });
      }

      // Get or create page record
      const page = await supabaseService.getOrCreatePage(bookId, pageNumber, 'placeholder');

      // Generate audio using Gemini
      logger.info('Calling Gemini for fresh audio generation...', { bookId, pageNumber, voicePersona });
      const { data: audioData, mimeType } = await geminiService.generateAudio(text, baseVoiceName, systemInstruction);

      // Convert to WAV
      const wavBuffer = convertToWav(audioData, mimeType);

      // Save audio file to storage
      // Use a consistent naming scheme that includes persona and timestamp to ensure freshness
      const timestamp = Date.now();
      const fileName = `page_${pageNumber}_${voicePersona.toLowerCase().replace(/\s+/g, '_')}_${timestamp}.wav`;
      const filePath = `audio/${userId}/${bookId}/${fileName}`;

      logger.info('Saving fresh audio file to storage...', { bookId, pageNumber, filePath });
      const audioUrl = await supabaseService.saveAudioFile(wavBuffer, filePath);

      // Calculate audio duration (approximate: WAV file size / bitrate)
      const estimatedDuration = Math.round(wavBuffer.length / (44100 * 2 * 2));

      // Save audio metadata to cache (upsert handles existing records)
      await supabaseService.savePageAudio(page.id, {
        voice_persona: voicePersona,
        audio_url: audioUrl,
        audio_duration_seconds: estimatedDuration,
        audio_format: 'wav',
        audio_size_bytes: wavBuffer.length,
        voice_settings: persona ? {
          pace: persona.pace,
          tone: persona.tone,
          emotion: persona.emotion,
          style: persona.speaking_style
        } : { voiceName: voicePersona },
        processing_duration_ms: Date.now() - startTime
      });

      logger.info('Page audio generated and cached', { bookId, pageNumber, voicePersona, userId, audioUrl });

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