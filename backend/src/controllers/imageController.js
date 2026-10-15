const llm = require('../services/llm');
const { blocksToLegacyText } = require('../utils/legacyPageText');
const logger = require('../utils/logger');

/**
 * Image processing controller
 */
const imageController = {
  /**
   * Process an image to extract text
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   */
  async imageToText(req, res, next) {
    try {
      const { image } = req.body; // Expecting a base64 encoded image string

      if (!image) {
        return res.status(400).json({ error: 'Image data is required' });
      }

      // Extract mime type and data from base64 string
      let mimeType, data;
      
      if (image.startsWith('data:')) {
        const matches = image.match(/^data:(.+);base64,(.+)$/);
        if (!matches || matches.length !== 3) {
          logger.warn('Invalid image data format received');
          return res.status(400).json({ error: 'Invalid image data format' });
        }
        mimeType = matches[1];
        data = matches[2];
      } else {
        // Handle the case where the image might be just raw base64 without data URI
        mimeType = 'image/png'; // Default to PNG
        data = image;
      }
      
      logger.info(`Processing image-to-text request with mime type: ${mimeType}`);
      
      // Extract the page text through the LLM layer, in the legacy header/body/footer shape
      const { blocks } = await llm.extractBlocks({ pngBase64: data, mimeType });
      const jsonData = blocksToLegacyText(blocks);
      
      // Set CORS headers explicitly
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      
      logger.debug('Image-to-text processing successful');
      res.json(jsonData);
      
    } catch (error) {
      logger.error('Error in image-to-text processing:', error);
      next(error);
    }
  }
};

module.exports = imageController;
