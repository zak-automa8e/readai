const supabaseService = require('../services/supabaseService');
const geminiDocumentService = require('../services/geminiDocumentService');
const conversationService = require('../services/conversationService');
const logger = require('../utils/logger');
const config = require('../config');

// Custom error classes
class GeminiFileUploadError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = 'GeminiFileUploadError';
    this.statusCode = statusCode;
  }
}

class CacheExpiredError extends Error {
  constructor(message = 'Conversation cache has expired') {
    super(message);
    this.name = 'CacheExpiredError';
    this.statusCode = 410; // Gone
  }
}

class ContextLimitExceededError extends Error {
  constructor(message = 'Conversation too long, please start a new session') {
    super(message);
    this.name = 'ContextLimitExceededError';
    this.statusCode = 413; // Payload Too Large
  }
}

/**
 * POST /api/chat/upload-book
 * Upload a book PDF to Gemini and create cached context
 * Creates or updates an ai_conversations record with cache metadata
 */
const uploadBookToGemini = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { bookId, pdfUrl, title } = req.body;

    if (!bookId || !pdfUrl || !title) {
      return res.status(400).json({
        error: 'bookId, pdfUrl, and title are required'
      });
    }

    logger.info(`Uploading book to Gemini - User: ${userId}, Book: ${bookId}`);

    // Verify user has access to this book
    const book = await supabaseService.getBookById(bookId);
    if (!book) {
      return res.status(404).json({
        error: 'Book not found'
      });
    }

    const hasAccess = await supabaseService.ensureUserHasBookAccess(userId, bookId);
    if (!hasAccess) {
      return res.status(403).json({
        error: 'Access denied to this book'
      });
    }

    // Check if conversation already exists
    let conversation = await supabaseService.getConversationByBookId(userId, bookId);
    
    if (!conversation) {
      // Create new conversation
      conversation = await supabaseService.createConversation({
        userId,
        bookId,
        title: `Chat about "${title}"`,
        conversationType: 'general'
      });
    }

    // Upload PDF to Gemini File API
    const uploadResult = await geminiDocumentService.uploadPdfFromUrl(pdfUrl, title);
    
    // Wait for file processing
    const processedFile = await geminiDocumentService.waitForFileProcessing(uploadResult.name);
    
    // Files are automatically cached when used repeatedly with Gemini 2.0+ models
    // Store the file URI for use in chat messages
    const fileExpiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // Files expire after 48 hours

    // Update conversation with file metadata (no explicit cache needed)
    await supabaseService.updateConversation(conversation.id, {
      gemini_file_uri: processedFile.uri,
      gemini_cache_name: uploadResult.name, // Store file name for reference
      cache_expires_at: fileExpiresAt.toISOString()
    });

    logger.info(`Book uploaded to Gemini successfully - Conversation: ${conversation.id}, File: ${uploadResult.name}`);

    res.json({
      success: true,
      conversationId: conversation.id,
      fileUri: processedFile.uri,
      fileName: uploadResult.name,
      expiresAt: fileExpiresAt.toISOString(),
      message: 'Book uploaded successfully and ready for chat (implicit caching enabled)'
    });

  } catch (error) {
    logger.error('Error uploading book to Gemini:', error);
    
    if (error instanceof GeminiFileUploadError) {
      return res.status(error.statusCode).json({
        error: error.message
      });
    }

    next(error);
  }
};

/**
 * POST /api/chat/message
 * Send a message in an active conversation
 * Stores messages in ai_messages table
 */
const sendMessage = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { conversationId, message } = req.body;

    if (!conversationId || !message) {
      return res.status(400).json({
        error: 'conversationId and message are required'
      });
    }

    if (message.length > 10000) {
      return res.status(400).json({
        error: 'Message too long (max 10000 characters)'
      });
    }

    logger.info(`Sending chat message - User: ${userId}, Conversation: ${conversationId}`);

    // Get conversation with cache info
    const conversation = await supabaseService.getConversationById(conversationId);
    if (!conversation) {
      return res.status(404).json({
        error: 'Conversation not found'
      });
    }

    // Verify user owns this conversation
    if (conversation.user_id !== userId) {
      return res.status(403).json({
        error: 'Access denied to this conversation'
      });
    }

    // Check if file is still valid (files expire after 48 hours)
    if (conversation.cache_expires_at && new Date(conversation.cache_expires_at) < new Date()) {
      throw new CacheExpiredError('File has expired. Please upload the book again.');
    }

    if (!conversation.gemini_file_uri) {
      throw new CacheExpiredError('Conversation is not prepared for chat');
    }

    // Get conversation history
    const history = await supabaseService.getConversationMessages(conversationId);
    
    // Validate and trim history
    const validation = conversationService.validateHistory(history);
    if (!validation.isValid) {
      return res.status(400).json({
        error: validation.error
      });
    }

    const trimmedHistory = conversationService.trimHistory(history, config.geminiChat?.maxConversationHistory || 10);

    // Get system instruction
    const systemInstruction = geminiDocumentService.getDocumentChatSystemInstruction();

    // Generate response using file URI (with implicit caching)
    const response = await geminiDocumentService.generateWithFile(
      conversation.gemini_file_uri,
      message,
      trimmedHistory,
      systemInstruction
    );

    // Store user message
    await supabaseService.createMessage({
      conversationId,
      role: 'user',
      content: message,
      tokensUsed: response.tokensUsed?.prompt || 0
    });

    // Store assistant response
    const assistantMessage = await supabaseService.createMessage({
      conversationId,
      role: 'assistant',
      content: response.text,
      tokensUsed: response.tokensUsed?.candidates || 0,
      cost: calculateMessageCost(response.tokensUsed)
    });

    logger.info(`Chat message processed successfully - Conversation: ${conversationId}, Tokens: ${response.tokensUsed.total} (${response.tokensUsed.cached} cached)`);

    res.json({
      success: true,
      message: response.text,
      messageId: assistantMessage.id,
      tokensUsed: response.tokensUsed
    });

  } catch (error) {
    logger.error('Error sending chat message:', error);
    
    if (error instanceof CacheExpiredError) {
      return res.status(error.statusCode).json({
        error: error.message,
        code: 'CACHE_EXPIRED'
      });
    }

    if (error instanceof ContextLimitExceededError) {
      return res.status(error.statusCode).json({
        error: error.message,
        code: 'CONTEXT_LIMIT_EXCEEDED'
      });
    }

    next(error);
  }
};

/**
 * DELETE /api/chat/cache/:conversationId
 * Delete a Gemini file and mark conversation as ended
 */
const deleteCache = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { conversationId } = req.params;

    logger.info(`Deleting chat file - User: ${userId}, Conversation: ${conversationId}`);

    // Get conversation
    const conversation = await supabaseService.getConversationById(conversationId);
    if (!conversation) {
      return res.status(404).json({
        error: 'Conversation not found'
      });
    }

    // Verify user owns this conversation
    if (conversation.user_id !== userId) {
      return res.status(403).json({
        error: 'Access denied to this conversation'
      });
    }

    // Delete file from Gemini if it exists
    if (conversation.gemini_file_uri) {
      try {
        await geminiDocumentService.deleteFile(conversation.gemini_file_uri);
      } catch (fileError) {
        logger.warn('Failed to delete file from Gemini:', fileError);
        // Continue with database cleanup even if file deletion fails
      }
    }

    // Clear file metadata from conversation
    await supabaseService.updateConversation(conversationId, {
      gemini_cache_name: null,
      gemini_file_uri: null,
      cache_expires_at: null
    });

    logger.info(`Chat file deleted successfully - Conversation: ${conversationId}`);

    res.json({
      success: true,
      message: 'File deleted successfully'
    });

  } catch (error) {
    logger.error('Error deleting chat file:', error);
    next(error);
  }
};

/**
 * POST /api/chat/extend-cache
 * Note: Gemini files auto-expire after 48 hours and cannot be manually extended
 * This endpoint returns file expiration info for client awareness
 */
const extendCache = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { conversationId } = req.body;

    if (!conversationId) {
      return res.status(400).json({
        error: 'conversationId is required'
      });
    }

    logger.info(`Checking file expiration - User: ${userId}, Conversation: ${conversationId}`);

    // Get conversation
    const conversation = await supabaseService.getConversationById(conversationId);
    if (!conversation) {
      return res.status(404).json({
        error: 'Conversation not found'
      });
    }

    // Verify user owns this conversation
    if (conversation.user_id !== userId) {
      return res.status(403).json({
        error: 'Access denied to this conversation'
      });
    }

    // Check if file exists and is still valid
    if (!conversation.gemini_file_uri) {
      return res.status(400).json({
        error: 'Conversation file not initialized'
      });
    }

    const expiresAt = new Date(conversation.cache_expires_at);
    const isExpired = expiresAt < new Date();

    logger.info(`File expiration check - Conversation: ${conversationId}, Expires: ${expiresAt.toISOString()}, Expired: ${isExpired}`);

    res.json({
      success: true,
      expiresAt: expiresAt.toISOString(),
      isExpired,
      message: isExpired 
        ? 'File has expired. Please upload the book again.'
        : 'File expires automatically after 48 hours from upload. Cannot be extended.'
    });

  } catch (error) {
    logger.error('Error checking file expiration:', error);
    next(error);
  }
};

/**
 * GET /api/chat/conversation/:bookId
 * Get or create conversation for a book
 * Returns existing conversation with valid cache, or creates new one
 */
const getOrCreateConversation = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { bookId } = req.params;

    logger.info(`Getting or creating conversation - User: ${userId}, Book: ${bookId}`);

    // Verify user has access to this book
    const book = await supabaseService.getBookById(bookId);
    if (!book) {
      return res.status(404).json({
        error: 'Book not found'
      });
    }

    const hasAccess = await supabaseService.ensureUserHasBookAccess(userId, bookId);
    if (!hasAccess) {
      return res.status(403).json({
        error: 'Access denied to this book'
      });
    }

    // Get existing conversation
    let conversation = await supabaseService.getConversationByBookId(userId, bookId);
    
    if (!conversation) {
      // Create new conversation
      conversation = await supabaseService.createConversation({
        userId,
        bookId,
        title: `Chat about "${book.title}"`,
        conversationType: 'general'
      });
    }

    // Get conversation messages
    const messages = await supabaseService.getConversationMessages(conversation.id);

    // Check if cache is still valid
    const hasActiveCache = conversation.gemini_cache_name && 
                          conversation.cache_expires_at && 
                          new Date(conversation.cache_expires_at) > new Date();

    logger.info(`Conversation retrieved successfully - ID: ${conversation.id}, Has active cache: ${hasActiveCache}`);

    res.json({
      success: true,
      conversation: {
        id: conversation.id,
        hasActiveCache,
        cacheExpiresAt: conversation.cache_expires_at,
        messages: messages || []
      }
    });

  } catch (error) {
    logger.error('Error getting or creating conversation:', error);
    next(error);
  }
};

// Helper functions
function calculateMessageCost(tokensUsed) {
  if (!tokensUsed) {
    return 0;
  }

  const cachedTokens = tokensUsed.cached || 0;
  const promptTokens = tokensUsed.prompt || 0;
  const candidateTokens = tokensUsed.candidates || 0;

  // Simple cost calculation based on token usage
  // Adjust these rates based on actual Gemini pricing
  const cachedTokenRate = 0.00001; // $0.01 per 1M tokens
  const promptTokenRate = 0.00015; // $0.15 per 1M tokens  
  const outputTokenRate = 0.00060; // $0.60 per 1M tokens

  return (
    (cachedTokens * cachedTokenRate) +
    (promptTokens * promptTokenRate) +
    (candidateTokens * outputTokenRate)
  );
}

function parseTtlToMs(ttl) {
  // Parse TTL string like "3600s" to milliseconds
  const match = ttl.match(/^(\d+)(s|m|h)$/);
  if (!match) {
    throw new Error('Invalid TTL format. Use format like "3600s", "60m", "1h"');
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case 's':
      return value * 1000;
    case 'm':
      return value * 60 * 1000;
    case 'h':
      return value * 60 * 60 * 1000;
    default:
      throw new Error('Invalid TTL unit. Use s, m, or h');
  }
}

module.exports = {
  uploadBookToGemini,
  sendMessage,
  deleteCache,
  extendCache,
  getOrCreateConversation
};