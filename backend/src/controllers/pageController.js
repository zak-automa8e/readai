const pageCacheService = require('../services/pageCacheService');
const logger = require('../utils/logger');

const pageController = {
  /**
   * Get or extract page text with caching
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getPageText(req, res) {
    try {
      const userId = req.user.id;
      const { bookId, pageNumber, imageData, mimeType } = req.body;

      if (!bookId || !pageNumber || !imageData) {
        return res.status(400).json({ 
          error: 'bookId, pageNumber, and imageData are required' 
        });
      }

      let processedImageData = imageData;
      let resolvedMimeType = mimeType;

      if (typeof imageData === 'string' && imageData.startsWith('data:')) {
        const matches = imageData.match(/^data:(.+);base64,(.+)$/);

        if (!matches || matches.length !== 3) {
          logger.warn('Invalid image data URI received for page text request', { bookId, pageNumber, userId });
          return res.status(400).json({ error: 'Invalid image data format. Expected base64 data URI.' });
        }

        resolvedMimeType = matches[1];
        processedImageData = matches[2].replace(/\s/g, '');
      }

      if (!resolvedMimeType) {
        resolvedMimeType = 'image/png';
      }

      logger.info('Processing page text request', { bookId, pageNumber, userId });

      const result = await pageCacheService.getOrExtractPageText(
        bookId, 
        pageNumber, 
        processedImageData, 
        resolvedMimeType, 
        userId
      );

      res.json({
        success: true,
        cached: result.cached,
        text: result.text,
        processingTime: result.processingTime
      });

    } catch (error) {
      logger.error('Error in getPageText:', error);
      res.status(500).json({
        error: 'Failed to process page text',
        details: error.message
      });
    }
  },

  /**
   * Get or generate page audio with caching
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getPageAudio(req, res) {
    try {
      const userId = req.user.id;
      const { bookId, pageNumber, text, voicePersona = 'Zephyr' } = req.body;

      if (!bookId || !pageNumber || !text) {
        return res.status(400).json({ 
          error: 'bookId, pageNumber, and text are required' 
        });
      }

      logger.info('Processing page audio request', { bookId, pageNumber, voicePersona, userId });

      const result = await pageCacheService.getOrGeneratePageAudio(
        bookId, 
        pageNumber, 
        text, 
        voicePersona, 
        userId
      );

      res.json({
        success: true,
        cached: result.cached,
        audioUrl: result.audioUrl,
        duration: result.duration,
        processingTime: result.processingTime
      });

    } catch (error) {
      logger.error('Error in getPageAudio:', error);
      
      if (error.message && error.message.includes('429')) {
        return res.status(429).json({
          error: 'API rate limit exceeded. Please try again later.',
          details: error.message
        });
      }

      res.status(500).json({
        error: 'Failed to process page audio',
        details: error.message
      });
    }
  }
};

module.exports = pageController;