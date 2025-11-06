const { GoogleGenAI } = require('@google/genai');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const os = require('os');
const config = require('../config');
const logger = require('../utils/logger');

class GeminiDocumentService {
  constructor() {
    this.ai = new GoogleGenAI({
      apiKey: config.geminiApiKey,
    });
    
    logger.info('Gemini Document service initialized');
  }

  /**
   * Upload a PDF to Gemini File API
   * @param {string} pdfUrl - Public URL to the PDF
   * @param {string} displayName - Human-readable name for the file
   * @returns {Promise<Object>} - { fileUri, name, mimeType, sizeBytes }
   */
  async uploadPdfFromUrl(pdfUrl, displayName) {
    if (!pdfUrl) {
      throw new Error('PDF URL is required');
    }
    if (!displayName) {
      throw new Error('Display name is required');
    }

    logger.info(`Uploading PDF to Gemini File API - URL: ${pdfUrl}, Name: ${displayName}`);

    let tempFilePath = null;

    try {
      // Fetch the PDF from the URL
      const response = await fetch(pdfUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch PDF: ${response.status} ${response.statusText}`);
      }

      // Save to temporary file (SDK works better with file paths in Node.js)
      const pdfBuffer = Buffer.from(await response.arrayBuffer());
      tempFilePath = path.join(os.tmpdir(), `gemini-upload-${Date.now()}.pdf`);
      await fs.writeFile(tempFilePath, pdfBuffer);

      logger.debug(`PDF saved to temporary file: ${tempFilePath}, size: ${pdfBuffer.length} bytes`);

      // Upload to Gemini File API using file path (recommended for Node.js)
      // The SDK will handle mimeType detection from the file extension
      const file = await this.ai.files.upload({
        file: tempFilePath,
        config: {
          displayName,
        },
      });

      logger.info(`PDF uploaded successfully - File URI: ${file.uri}, Name: ${file.name}, MimeType: ${file.mimeType}`);

      // Clean up temp file immediately after successful upload
      try {
        await fs.unlink(tempFilePath);
        logger.debug(`Temporary file deleted: ${tempFilePath}`);
        tempFilePath = null; // Mark as cleaned up
      } catch (unlinkError) {
        logger.warn(`Failed to delete temporary file: ${tempFilePath}`, unlinkError);
      }

      return {
        fileUri: file.uri,
        name: file.name,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        state: file.state,
      };
    } catch (error) {
      logger.error('Error uploading PDF to Gemini File API:', error);
      throw new Error(`Failed to upload PDF: ${error.message}`);
    } finally {
      // Clean up temporary file if it still exists
      if (tempFilePath) {
        try {
          await fs.unlink(tempFilePath);
          logger.debug(`Temporary file deleted in finally: ${tempFilePath}`);
        } catch (unlinkError) {
          // Ignore errors in cleanup
        }
      }
    }
  }

  /**
   * Wait for file to finish processing
   * @param {string} fileName - File name from upload response
   * @returns {Promise<Object>} - File object with ACTIVE state
   */
  async waitForFileProcessing(fileName, timeout = config.geminiChat?.fileUploadTimeout || 60000) {
    if (!fileName) {
      throw new Error('File name is required');
    }

    logger.info(`Waiting for file processing - File: ${fileName}`);
    const startTime = Date.now();

    try {
      while (Date.now() - startTime < timeout) {
        const file = await this.ai.files.get({ name: fileName });
        
        logger.debug(`File status: ${file.state} - File: ${fileName}`);

        if (file.state === 'ACTIVE') {
          logger.info(`File processing completed - File: ${fileName}`);
          return file;
        }

        if (file.state === 'FAILED') {
          throw new Error(`File processing failed - File: ${fileName}`);
        }

        // Wait 2 seconds before checking again
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      throw new Error(`File processing timeout after ${timeout}ms - File: ${fileName}`);
    } catch (error) {
      logger.error('Error waiting for file processing:', error);
      throw error;
    }
  }

  /**
   * Generate content using file URI (with implicit caching)
   * @param {string} fileUri - URI of uploaded file
   * @param {string} userMessage - User's question
   * @param {Array} conversationHistory - Previous messages
   * @param {string} systemInstruction - AI assistant instructions
   * @returns {Promise<Object>} - { text, tokensUsed }
   */
  async generateWithFile(fileUri, userMessage, conversationHistory = [], systemInstruction = null) {
    if (!fileUri) {
      throw new Error('File URI is required');
    }
    if (!userMessage) {
      throw new Error('User message is required');
    }

    logger.info(`Generating content with file - URI: ${fileUri}`);

    try {
      // Build conversation history
      const contents = [];

      // Add conversation history
      // Note: Gemini uses 'model' role, but we store 'assistant' in database
      for (const msg of conversationHistory) {
        contents.push({
          role: msg.role === 'assistant' ? 'model' : msg.role,
          parts: [{ text: msg.content }],
        });
      }

      // Add current user message with file reference
      contents.push({
        role: 'user',
        parts: [
          {
            fileData: {
              fileUri,
              mimeType: 'application/pdf',
            },
          },
          {
            text: userMessage,
          },
        ],
      });

      const requestConfig = {
        model: config.geminiModels?.documentChat || 'gemini-2.0-flash-001',
        contents,
      };

      // Add system instruction if provided
      if (systemInstruction) {
        requestConfig.systemInstruction = {
          parts: [{ text: systemInstruction }],
        };
      }

      const response = await this.ai.models.generateContent(requestConfig);

      const text = response.text;
      const tokensUsed = {
        prompt: response.usageMetadata?.promptTokenCount || 0,
        candidates: response.usageMetadata?.candidatesTokenCount || 0,
        cached: response.usageMetadata?.cachedContentTokenCount || 0,
        total: response.usageMetadata?.totalTokenCount || 0,
      };

      logger.info(`Content generated successfully - Tokens: ${tokensUsed.total} (${tokensUsed.cached} cached)`);

      return {
        text,
        tokensUsed,
      };
    } catch (error) {
      logger.error('Error generating content with file:', error);
      throw new Error(`Failed to generate content: ${error.message}`);
    }
  }

  /**
   * Get system instruction for document chat
   * @returns {string} - System instruction text
   */
  getDocumentChatSystemInstruction() {
    return `You are a knowledgeable reading assistant specialized in analyzing documents. 
Your role is to help users understand and interact with the book they are reading.

Capabilities:
- Answer questions about the document's content with specific page/section references
- Provide summaries of chapters, sections, or the entire document
- Explain complex concepts found in the text
- Find specific information or quotes
- Analyze themes, arguments, and structure
- Compare different parts of the document

Guidelines:
- Always base your answers on the document content
- Cite specific pages or sections when relevant
- If information isn't in the document, clearly state that
- For long answers, structure them with clear headings
- Be concise unless user asks for detailed explanations
- Maintain conversation context across multiple questions

Formatting:
- Use **Markdown formatting** for all responses
- Use **bold** for emphasis and key terms
- Use *italics* for book titles and quotes
- Use bullet points (- or *) for lists
- Use numbered lists (1. 2. 3.) for sequential steps
- Use > for block quotes from the document
- Use ### for section headings when structuring long answers
- Use \`code\` for technical terms or Arabic text when appropriate

Respond in a helpful, scholarly, yet conversational tone.`;
  }

  /**
   * Delete a file from Gemini
   * @param {string} fileName - Name of file to delete
   */
  async deleteFile(fileName) {
    if (!fileName) {
      throw new Error('File name is required');
    }

    logger.info(`Deleting file - File: ${fileName}`);

    try {
      await this.ai.files.delete({ name: fileName });
      logger.info(`File deleted successfully - File: ${fileName}`);
    } catch (error) {
      logger.error('Error deleting file:', error);
      throw new Error(`Failed to delete file: ${error.message}`);
    }
  }

  /**
   * List all uploaded files
   * @returns {Promise<Array>} - Array of file objects
   */
  async listFiles() {
    try {
      const response = await this.ai.files.list();
      return response.files || [];
    } catch (error) {
      logger.error('Error listing files:', error);
      throw new Error(`Failed to list files: ${error.message}`);
    }
  }

  /**
   * Build contents array with conversation history
   * @param {string} userMessage - Current user message
   * @param {Array} conversationHistory - Previous messages
   * @returns {Array} - Formatted contents array
   * @private
   */
  buildContentsWithHistory(userMessage, conversationHistory) {
    const contents = [];

    // Add conversation history
    for (const msg of conversationHistory) {
      contents.push({
        role: msg.role,
        parts: [{ text: msg.content }],
      });
    }

    // Add current user message
    contents.push({
      role: 'user',
      parts: [{ text: userMessage }],
    });

    return contents;
  }
}

module.exports = new GeminiDocumentService();