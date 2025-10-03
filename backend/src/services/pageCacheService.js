const supabaseService = require('./supabaseService');
const geminiService = require('./geminiService');
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
   * @returns {Promise<Object>} - { cached: boolean, text: object, page: object }
   */
  async getOrExtractPageText(bookId, pageNumber, imageData, mimeType, userId) {
    const startTime = Date.now();
    
    try {
      // Try to get existing text from cache
      const existingText = await supabaseService.getPageTextByBookAndNumber(bookId, pageNumber);
      
      if (existingText) {
        logger.info('Page text cache HIT', { bookId, pageNumber, userId });

        const normalizedText = this.normalizeExtractedText(existingText.extracted_text);

        return {
          cached: true,
          text: normalizedText,
          page: existingText.pages,
          processingTime: Date.now() - startTime
        };
      }
      
      logger.info('Page text cache MISS - extracting', { bookId, pageNumber, userId });
      
      // Get or create page record with placeholder image URL
      const page = await supabaseService.getOrCreatePage(bookId, pageNumber, 'placeholder');
      
      // Extract text using Gemini
      const extractedText = await geminiService.processImageToText(imageData, mimeType);
      
      // Save text to cache
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
   * @param {string} voicePersona - Voice persona (default: 'Zephyr')
   * @param {string} userId - User ID for logging and file paths
   * @returns {Promise<Object>} - { cached: boolean, audioUrl: string, duration: number, page: object }
   */
  async getOrGeneratePageAudio(bookId, pageNumber, text, voicePersona = 'Zephyr', userId) {
    const startTime = Date.now();
    
    try {
      // Try to get existing audio from cache
      const existingAudio = await supabaseService.getPageAudioByBookAndNumber(bookId, pageNumber, voicePersona);
      
      if (existingAudio && existingAudio.audio_url) {
        logger.info('Page audio cache HIT', { bookId, pageNumber, voicePersona, userId });
        return {
          cached: true,
          audioUrl: existingAudio.audio_url,
          duration: existingAudio.audio_duration_seconds,
          page: existingAudio.pages,
          processingTime: Date.now() - startTime
        };
      }
      
      logger.info('Page audio cache MISS - generating', { bookId, pageNumber, voicePersona, userId });
      
      // Get or create page record with placeholder image URL
      const page = await supabaseService.getOrCreatePage(bookId, pageNumber, 'placeholder');
      
      // Generate audio using Gemini
      const { data: audioData, mimeType } = await geminiService.generateAudio(text);
      
      // Convert to WAV
      const wavBuffer = convertToWav(audioData, mimeType);
      
      // Save audio file to storage
      const fileName = `page_${pageNumber}_${voicePersona.toLowerCase()}.wav`;
      const filePath = `audio/${userId}/${bookId}/${fileName}`;
      const audioUrl = await supabaseService.saveAudioFile(wavBuffer, filePath);
      
      // Calculate audio duration (approximate: WAV file size / bitrate)
      const estimatedDuration = Math.round(wavBuffer.length / (44100 * 2 * 2)); // 44.1kHz, 16-bit, stereo
      
      // Save audio metadata to cache
      await supabaseService.savePageAudio(page.id, {
        voice_persona: voicePersona,
        audio_url: audioUrl,
        audio_duration_seconds: estimatedDuration,
        audio_format: 'wav',
        audio_size_bytes: wavBuffer.length,
        voice_settings: { voiceName: voicePersona },
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