const logger = require('../utils/logger');

class ConversationService {
  constructor() {
    logger.info('Conversation service initialized');
  }

  /**
   * Format conversation history for Gemini API
   * @param {Array} messages - Array of {role: 'user'|'assistant', content: string}
   * @returns {Array} - Formatted for Gemini contents parameter
   */
  formatHistoryForGemini(messages) {
    if (!messages || !Array.isArray(messages)) {
      return [];
    }

    return messages.map(message => ({
      role: message.role === 'user' ? 'user' : 'model',
      parts: [{ text: message.content }],
    }));
  }

  /**
   * Trim conversation history to fit context window
   * @param {Array} messages - Full conversation history
   * @param {number} maxMessages - Maximum messages to keep
   * @returns {Array} - Trimmed history
   */
  trimHistory(messages, maxMessages = 10) {
    if (!messages || !Array.isArray(messages)) {
      return [];
    }

    // Keep the most recent messages, but always keep pairs (user + assistant)
    const trimmed = messages.slice(-maxMessages);
    
    // Ensure we don't break message pairs
    if (trimmed.length % 2 !== 0 && trimmed.length > 1) {
      // Remove the oldest message to maintain pairs
      return trimmed.slice(1);
    }

    return trimmed;
  }

  /**
   * Calculate approximate token count
   * @param {string} text - Text to count
   * @returns {number} - Approximate token count
   */
  estimateTokens(text) {
    if (!text || typeof text !== 'string') {
      return 0;
    }

    // Simple approximation: 1 token ≈ 4 characters for English text
    // For Arabic text, this might be less accurate but gives a rough estimate
    return Math.ceil(text.length / 4);
  }

  /**
   * Calculate total tokens for conversation history
   * @param {Array} messages - Conversation messages
   * @returns {number} - Total estimated tokens
   */
  estimateHistoryTokens(messages) {
    if (!messages || !Array.isArray(messages)) {
      return 0;
    }

    return messages.reduce((total, message) => {
      return total + this.estimateTokens(message.content);
    }, 0);
  }

  /**
   * Build complete prompt with history
   * @param {string} userMessage - Current user message
   * @param {Array} history - Previous messages
   * @returns {Object} - Complete prompt structure for Gemini
   */
  buildPrompt(userMessage, history) {
    if (!userMessage) {
      throw new Error('User message is required');
    }

    const formattedHistory = this.formatHistoryForGemini(history);
    const contents = [...formattedHistory, {
      role: 'user',
      parts: [{ text: userMessage }],
    }];

    return {
      contents,
      totalTokens: this.estimateHistoryTokens(history) + this.estimateTokens(userMessage),
    };
  }

  /**
   * Validate conversation history
   * @param {Array} messages - Messages to validate
   * @returns {Object} - { isValid: boolean, error: string | null }
   */
  validateHistory(messages) {
    if (!messages || !Array.isArray(messages)) {
      return { isValid: false, error: 'Messages must be an array' };
    }

    if (messages.length > 50) {
      return { isValid: false, error: 'Conversation history too long (max 50 messages)' };
    }

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      
      if (!message.role || !message.content) {
        return { isValid: false, error: `Message ${i} missing role or content` };
      }

      if (!['user', 'assistant'].includes(message.role)) {
        return { isValid: false, error: `Message ${i} has invalid role: ${message.role}` };
      }

      if (typeof message.content !== 'string') {
        return { isValid: false, error: `Message ${i} content must be a string` };
      }

      if (message.content.length > 10000) {
        return { isValid: false, error: `Message ${i} too long (max 10000 characters)` };
      }
    }

    return { isValid: true, error: null };
  }

  /**
   * Check if conversation history is balanced (user/assistant pairs)
   * @param {Array} messages - Messages to check
   * @returns {boolean} - True if balanced
   */
  isHistoryBalanced(messages) {
    if (!messages || messages.length === 0) {
      return true;
    }

    // Count user and assistant messages
    const userCount = messages.filter(m => m.role === 'user').length;
    const assistantCount = messages.filter(m => m.role === 'assistant').length;

    // Should have at most one more user message than assistant messages
    return Math.abs(userCount - assistantCount) <= 1;
  }

  /**
   * Get conversation summary for logging
   * @param {Array} messages - Messages to summarize
   * @returns {Object} - Summary statistics
   */
  getConversationSummary(messages) {
    if (!messages || !Array.isArray(messages)) {
      return {
        messageCount: 0,
        userMessages: 0,
        assistantMessages: 0,
        totalCharacters: 0,
        estimatedTokens: 0,
      };
    }

    const userMessages = messages.filter(m => m.role === 'user');
    const assistantMessages = messages.filter(m => m.role === 'assistant');
    const totalCharacters = messages.reduce((sum, m) => sum + m.content.length, 0);

    return {
      messageCount: messages.length,
      userMessages: userMessages.length,
      assistantMessages: assistantMessages.length,
      totalCharacters,
      estimatedTokens: this.estimateHistoryTokens(messages),
    };
  }

  /**
   * Sanitize message content
   * @param {string} content - Message content to sanitize
   * @returns {string} - Sanitized content
   */
  sanitizeContent(content) {
    if (!content || typeof content !== 'string') {
      return '';
    }

    // Remove excessive whitespace
    let sanitized = content.trim().replace(/\s+/g, ' ');
    
    // Remove potential prompt injection attempts
    sanitized = sanitized.replace(/(system|assistant|user):\s*/gi, '');
    
    // Limit length
    if (sanitized.length > 10000) {
      sanitized = sanitized.substring(0, 10000);
    }

    return sanitized;
  }

  /**
   * Prepare messages for database storage
   * @param {Array} messages - Messages to prepare
   * @returns {Array} - Messages ready for database
   */
  prepareForStorage(messages) {
    if (!messages || !Array.isArray(messages)) {
      return [];
    }

    return messages.map(message => ({
      role: message.role,
      content: this.sanitizeContent(message.content),
      // Additional metadata can be added here
      message_metadata: {
        timestamp: new Date().toISOString(),
        tokens: this.estimateTokens(message.content),
      },
    }));
  }
}

module.exports = new ConversationService();