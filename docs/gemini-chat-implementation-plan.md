# Gemini Document Understanding Integration Plan

**Version**: 1.0  
**Date**: October 27, 2025  
**Status**: Ready for Implementation

---

## Executive Summary

Integrate Google Gemini's Document Understanding capabilities into ReadAI's chat functionality, enabling users to ask questions, get summaries, and interact with their books through AI-powered conversations. The implementation uses Gemini's File API with context caching for cost-effective, multi-turn conversations while leveraging your **existing Supabase database schema** (`ai_conversations` and `ai_messages` tables) to minimize new infrastructure.

**Key Highlights**:
- ✅ **Uses existing database tables** - Extends `ai_conversations` with Gemini cache metadata
- ✅ **Conversation persistence** - Chat history automatically saved to `ai_messages`
- ✅ **Supabase MCP Server** - Available for running schema migrations and queries
- ✅ **Cost-effective** - Gemini context caching reduces token costs by 70%+
- ✅ **Backend: JavaScript** (Node.js/Express) | **Frontend: TypeScript** (React)

---

## 1. Architecture Overview

### 1.1 Design Principles (SOLID)

**Single Responsibility Principle**:
- `geminiDocumentService.js`: Handles all document-related Gemini operations
- `conversationService.js`: Manages conversation state and history
- `chatController.js`: Orchestrates chat requests/responses

**Open/Closed Principle**:
- Extend existing `geminiService.js` without modifying core functionality
- New service classes for document-specific operations

**Liskov Substitution**:
- All Gemini services implement consistent error handling patterns
- Maintain compatibility with existing service layer contracts

**Interface Segregation**:
- Separate interfaces for document upload, caching, and chat operations
- Clear API boundaries between frontend and backend

**Dependency Inversion**:
- Controllers depend on service abstractions
- Services can be mocked for testing

### 1.2 Data Flow

```
┌─────────────┐
│   ReadingArea   │ ← User opens book
│   + ChatWindow  │
└────────┬────────┘
         │ 1. uploadBookToGemini(bookId, pdfUrl)
         ▼
┌────────────────────────────────────────┐
│         apiService.ts (Frontend)       │
└────────┬───────────────────────────────┘
         │ POST /api/chat/upload-book
         ▼
┌────────────────────────────────────────┐
│     chatController.js (Backend)        │
│  ┌──────────────────────────────────┐  │
│  │ geminiDocumentService            │  │
│  │  - Upload PDF to File API        │  │
│  │  - Create cached context         │  │
│  │  - Store cache metadata in DB    │  │
│  └──────────────────────────────────┘  │
└────────┬───────────────────────────────┘
         │ Return: { cacheId, fileUri, expiresAt }
         ▼
┌────────────────────────────────────────┐
│         ChatWindow State               │
│  - activeCacheId                       │
│  - conversationHistory                 │
└────────┬───────────────────────────────┘
         │ 2. User asks question
         │ POST /api/chat/message
         ▼
┌────────────────────────────────────────┐
│     chatController.js                  │
│  ┌──────────────────────────────────┐  │
│  │ conversationService              │  │
│  │  - Validate cache exists         │  │
│  │  - Build prompt with history     │  │
│  │  - Query Gemini with cache ref   │  │
│  │  - Return response               │  │
│  └──────────────────────────────────┘  │
└────────┬───────────────────────────────┘
         │ Return: { message, tokensUsed }
         ▼
┌────────────────────────────────────────┐
│         ChatWindow                     │
│  - Append to conversationHistory       │
│  - Display response                    │
└────────────────────────────────────────┘
```

---

## 2. Backend Implementation

### 2.0 Database Setup

**Note**: Your Supabase database already has `ai_conversations` and `ai_messages` tables. We'll extend the existing schema rather than create new tables.

**Using Supabase MCP Server**: You have access to a Supabase MCP server which can be used to run queries directly. Use this for:
- Schema migrations (adding new columns)
- Testing queries during development
- Database inspections and debugging

**Required Schema Changes**:
```sql
-- Run this via Supabase MCP server to add cache metadata fields
ALTER TABLE ai_conversations 
  ADD COLUMN IF NOT EXISTS gemini_cache_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS gemini_file_uri VARCHAR(500),
  ADD COLUMN IF NOT EXISTS cache_expires_at TIMESTAMP WITH TIME ZONE;

-- Add indexes for cache operations
CREATE INDEX IF NOT EXISTS idx_ai_conversations_cache_expires 
  ON ai_conversations(cache_expires_at) WHERE cache_expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_conversations_active_cache 
  ON ai_conversations(user_id, book_id) WHERE gemini_cache_name IS NOT NULL;
```

### 2.1 New Service: `geminiDocumentService.js`

**Location**: `backend/src/services/geminiDocumentService.js`

**Responsibilities**:
- Upload PDFs to Gemini File API
- Create and manage cached contexts
- Monitor file processing status
- Handle cache lifecycle (create, update TTL, delete)

**Key Methods**:

```javascript
class GeminiDocumentService {
  /**
   * Upload a PDF to Gemini File API
   * @param {string} pdfUrl - Public URL to the PDF
   * @param {string} displayName - Human-readable name for the file
   * @returns {Promise<Object>} - { fileUri, name, mimeType, sizeBytes }
   */
  async uploadPdfFromUrl(pdfUrl, displayName)

  /**
   * Wait for file to finish processing
   * @param {string} fileName - File name from upload response
   * @returns {Promise<Object>} - File object with ACTIVE state
   */
  async waitForFileProcessing(fileName)

  /**
   * Create a cached context with PDF and system instruction
   * @param {string} fileUri - URI of uploaded file
   * @param {string} systemInstruction - AI assistant instructions
   * @param {string} ttl - Time to live (e.g., "3600s" for 1 hour)
   * @returns {Promise<Object>} - { cacheName, expiresAt, tokenCount }
   */
  async createCachedContext(fileUri, systemInstruction, ttl)

  /**
   * Generate content using cached context
   * @param {string} cacheName - Name of the cached context
   * @param {string} userMessage - User's question
   * @param {Array} conversationHistory - Previous messages
   * @returns {Promise<Object>} - { text, tokensUsed }
   */
  async generateWithCache(cacheName, userMessage, conversationHistory)

  /**
   * Extend cache TTL for active conversations
   * @param {string} cacheName - Cache identifier
   * @param {string} newTtl - New TTL duration
   */
  async extendCacheTtl(cacheName, newTtl)

  /**
   * Delete a cache when no longer needed
   * @param {string} cacheName - Cache identifier
   */
  async deleteCache(cacheName)

  /**
   * List all active caches (for debugging/monitoring)
   */
  async listCaches()
}
```

**System Instruction Template**:
```javascript
const DOCUMENT_CHAT_SYSTEM_INSTRUCTION = `
You are a knowledgeable reading assistant specialized in analyzing documents. 
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

Respond in a helpful, scholarly, yet conversational tone.
`;
```

### 2.2 New Service: `conversationService.js`

**Location**: `backend/src/services/conversationService.js`

**Responsibilities**:
- Manage conversation history formatting
- Handle context window limits
- Build prompts for Gemini API

**Key Methods**:

```javascript
class ConversationService {
  /**
   * Format conversation history for Gemini API
   * @param {Array} messages - Array of {role: 'user'|'assistant', content: string}
   * @returns {Array} - Formatted for Gemini contents parameter
   */
  formatHistoryForGemini(messages)

  /**
   * Trim conversation history to fit context window
   * @param {Array} messages - Full conversation history
   * @param {number} maxMessages - Maximum messages to keep
   * @returns {Array} - Trimmed history
   */
  trimHistory(messages, maxMessages = 10)

  /**
   * Calculate approximate token count
   * @param {string} text - Text to count
   * @returns {number} - Approximate token count
   */
  estimateTokens(text)

  /**
   * Build complete prompt with history
   * @param {string} userMessage - Current user message
   * @param {Array} history - Previous messages
   * @returns {Object} - Complete prompt structure for Gemini
   */
  buildPrompt(userMessage, history)
}
```

### 2.3 New Controller: `chatController.js`

**Location**: `backend/src/controllers/chatController.js`

**Endpoints**:

```javascript
/**
 * POST /api/chat/upload-book
 * Upload a book PDF to Gemini and create cached context
 * Creates or updates an ai_conversations record with cache metadata
 * 
 * Request Body:
 * {
 *   bookId: string,
 *   pdfUrl: string,
 *   title: string
 * }
 * 
 * Response:
 * {
 *   success: true,
 *   conversationId: string,  // ai_conversations.id
 *   cacheId: string,         // gemini_cache_name
 *   expiresAt: string (ISO timestamp),
 *   message: string
 * }
 */
async uploadBookToGemini(req, res, next)

/**
 * POST /api/chat/message
 * Send a message in an active conversation
 * Stores messages in ai_messages table
 * 
 * Request Body:
 * {
 *   conversationId: string,  // ai_conversations.id
 *   message: string
 * }
 * 
 * Response:
 * {
 *   success: true,
 *   message: string,
 *   messageId: string,  // ai_messages.id
 *   tokensUsed: {
 *     cached: number,
 *     prompt: number,
 *     candidates: number,
 *     total: number
 *   }
 * }
 * 
 * Note: History is loaded from ai_messages table, not sent from frontend
 */
async sendMessage(req, res, next)

/**
 * DELETE /api/chat/cache/:conversationId
 * Delete a cached context and mark conversation as ended
 */
async deleteCache(req, res, next)

/**
 * POST /api/chat/extend-cache
 * Extend cache TTL for active conversations
 * 
 * Request Body:
 * {
 *   conversationId: string,
 *   ttl: string (e.g., "3600s")
 * }
 */
async extendCache(req, res, next)

/**
 * GET /api/chat/conversation/:bookId
 * Get or create conversation for a book
 * Returns existing conversation with valid cache, or creates new one
 * 
 * Response:
 * {
 *   success: true,
 *   conversation: {
 *     id: string,
 *     hasActiveCache: boolean,
 *     cacheExpiresAt: string | null,
 *     messages: Array<Message>
 *   }
 * }
 */
async getOrCreateConversation(req, res, next)
```

### 2.4 Database Schema

**Existing Tables**: Your Supabase database already has conversation tables that we can leverage:

#### `ai_conversations` (Already exists)
```sql
CREATE TABLE ai_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  title text,
  conversation_type text DEFAULT 'general' 
    CHECK (conversation_type IN ('general', 'summary', 'quiz', 'explanation')),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);
```

#### `ai_messages` (Already exists)
```sql
CREATE TABLE ai_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  message_metadata jsonb DEFAULT '{}',
  tokens_used integer DEFAULT 0,
  cost decimal(10,6) DEFAULT 0,
  created_at timestamp with time zone DEFAULT now()
);
```

**Schema Extension Needed**: Add fields to `ai_conversations` to track Gemini cache metadata:

```sql
-- Add these columns to existing ai_conversations table
ALTER TABLE ai_conversations 
  ADD COLUMN IF NOT EXISTS gemini_cache_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS gemini_file_uri VARCHAR(500),
  ADD COLUMN IF NOT EXISTS cache_expires_at TIMESTAMP WITH TIME ZONE;

-- Add index for cache expiration lookups
CREATE INDEX IF NOT EXISTS idx_ai_conversations_cache_expires 
  ON ai_conversations(cache_expires_at) WHERE cache_expires_at IS NOT NULL;

-- Add index for active cache lookups
CREATE INDEX IF NOT EXISTS idx_ai_conversations_active_cache 
  ON ai_conversations(user_id, book_id) WHERE gemini_cache_name IS NOT NULL;
```

**Usage Pattern**:
- Create an `ai_conversations` record when user starts chatting with a book
- Store Gemini cache metadata in the same record
- Store all messages in `ai_messages` linked to the conversation
- Reuse existing conversation if cache is still valid
- Query using **Supabase MCP server** for database operations

**Benefits of Using Existing Schema**:
- ✅ No new tables to create
- ✅ Conversation history already persisted
- ✅ Cost tracking already built-in
- ✅ Indexes already optimized
- ✅ Consistent with existing data model

### 2.5 New Routes: `chatRoutes.js`

**Location**: `backend/src/routes/chatRoutes.js`

```javascript
const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');
const authMiddleware = require('../middleware/authMiddleware');

// All chat routes require authentication
router.use(authMiddleware);

router.get('/conversation/:bookId', chatController.getOrCreateConversation);
router.post('/upload-book', chatController.uploadBookToGemini);
router.post('/message', chatController.sendMessage);
router.post('/extend-cache', chatController.extendCache);
router.delete('/cache/:conversationId', chatController.deleteCache);

module.exports = router;
```

Register in `backend/src/routes/index.js`:
```javascript
const chatRoutes = require('./chatRoutes');
app.use('/api/chat', chatRoutes);
```

### 2.6 Configuration Updates

**File**: `backend/src/config/index.js`

Add new configuration values:

```javascript
module.exports = {
  // ... existing config
  
  geminiChat: {
    defaultCacheTtl: process.env.GEMINI_CACHE_TTL || '3600s', // 1 hour
    maxConversationHistory: parseInt(process.env.MAX_CONVERSATION_HISTORY) || 10,
    fileUploadTimeout: parseInt(process.env.FILE_UPLOAD_TIMEOUT) || 60000, // 60s
    cacheExtensionThreshold: parseInt(process.env.CACHE_EXTENSION_THRESHOLD) || 300, // Extend if <5min left
  }
};
```

### 2.7 Error Handling Patterns

Following your existing error handling middleware pattern:

```javascript
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
```

---

## 3. Frontend Implementation

### 3.1 Update `ChatWindow.tsx`

**Location**: `frontend/src/components/ChatWindow.tsx`

**Key Changes**:

1. **Remove FastAPI references** - Currently hardcoded to `localhost:8000`, should use your existing backend
2. **Integrate with BooksContext** - Get current book from context
3. **Load existing conversation on mount** - Check if conversation exists with valid cache
4. **Improved state management** - Track conversation ID, cache metadata, loading states

**New State**:
```typescript
interface ChatState {
  conversationId: string | null;
  messages: Message[];
  isLoading: boolean;
  cacheExpiresAt: Date | null;
  isUploadingBook: boolean;
  uploadError: string | null;
}
```

**Key Changes from Current Implementation**:
- Messages loaded from database via API (not maintained only in frontend state)
- Conversation persisted across sessions
- No need to pass history array in every request (backend loads from database)

**New Methods**:
```typescript
// Load or create conversation when ChatWindow opens
const initializeConversation = async () => {
  if (!currentBook?.id) {
    setUploadError('No book loaded');
    return;
  }

  setIsUploadingBook(true);
  
  try {
    // Check if conversation exists with valid cache
    const response = await apiService.getOrCreateConversation(currentBook.id);

    setConversationId(response.conversation.id);
    setMessages(response.conversation.messages || []);
    
    if (response.conversation.hasActiveCache) {
      setCacheExpiresAt(new Date(response.conversation.cacheExpiresAt));
      addSystemMessage(`📚 Continuing conversation about "${currentBook.title}"`);
    } else {
      // Need to upload/cache the book
      await uploadBookToGemini(response.conversation.id);
    }

  } catch (error) {
    setUploadError(error.message);
    toast({
      title: "Failed to initialize chat",
      description: error.message,
      variant: "destructive"
    });
  } finally {
    setIsUploadingBook(false);
  }
};

// Upload book and create cache for existing conversation
const uploadBookToGemini = async (conversationId: string) => {
  try {
    const response = await apiService.uploadBookToGemini({
      conversationId,
      bookId: currentBook.id,
      pdfUrl: currentBook.pdf_url,
      title: currentBook.title
    });

    setCacheExpiresAt(new Date(response.expiresAt));
    addSystemMessage(`📚 Successfully loaded "${currentBook.title}". I'm ready to answer your questions!`);

  } catch (error) {
    throw error;
  }
};

// Check if cache is about to expire and extend if needed
const checkAndExtendCache = async () => {
  if (!conversationId || !cacheExpiresAt) return;

  const timeUntilExpiry = cacheExpiresAt.getTime() - Date.now();
  const fiveMinutes = 5 * 60 * 1000;

  if (timeUntilExpiry < fiveMinutes) {
    await apiService.extendCacheLifetime(conversationId);
    // Update local state with new expiry
  }
};
```

**Updated handleSubmit**:
```typescript
const handleSubmit = async (content: string) => {
  if (!conversationId) {
    toast({
      title: "No Active Session",
      description: "Please wait while we load your book...",
      variant: "destructive"
    });
    return;
  }

  // Check if cache needs extension
  await checkAndExtendCache();

  const userMessage: Message = {
    id: generateId(),
    content,
    sender: 'human',
    timestamp: new Date()
  };
  
  // Optimistically add to UI
  setMessages(prev => [...prev, userMessage]);
  setIsLoading(true);

  try {
    const response = await apiService.sendChatMessage({
      conversationId,  // No history array needed!
      message: content
    });

    // Add assistant response
    setMessages(prev => [...prev, {
      id: response.messageId,
      content: response.message,
      sender: 'assistant',
      timestamp: new Date()
    }]);

  } catch (error) {
    handleChatError(error);
  } finally {
    setIsLoading(false);
  }
};
```

### 3.2 Update `apiService.ts`

**Location**: `frontend/src/services/apiService.ts`

**New Methods**:

```typescript
class ApiService {
  // ... existing methods

  /**
   * Get or create conversation for a book
   */
  async getOrCreateConversation(bookId: string): Promise<{
    success: boolean;
    conversation: {
      id: string;
      hasActiveCache: boolean;
      cacheExpiresAt: string | null;
      messages: Array<Message>;
    };
  }> {
    return this.makeAuthenticatedRequest(`/chat/conversation/${bookId}`, {
      method: 'GET'
    });
  }

  /**
   * Upload a book to Gemini for chat functionality
   */
  async uploadBookToGemini(data: {
    conversationId: string;
    bookId: string;
    pdfUrl: string;
    title: string;
  }): Promise<{
    success: boolean;
    conversationId: string;
    cacheId: string;
    expiresAt: string;
    message: string;
  }> {
    return this.makeAuthenticatedRequest('/chat/upload-book', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  /**
   * Send a chat message
   */
  async sendChatMessage(data: {
    conversationId: string;
    message: string;
  }): Promise<{
    success: boolean;
    message: string;
    messageId: string;
    tokensUsed: {
      cached: number;
      prompt: number;
      candidates: number;
      total: number;
    };
  }> {
    return this.makeAuthenticatedRequest('/chat/message', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  /**
   * Extend cache lifetime
   */
  async extendCacheLifetime(conversationId: string, ttl: string = '3600s') {
    return this.makeAuthenticatedRequest('/chat/extend-cache', {
      method: 'POST',
      body: JSON.stringify({ conversationId, ttl })
    });
  }

  /**
   * Delete cache (cleanup)
   */
  async deleteChatCache(conversationId: string) {
    return this.makeAuthenticatedRequest(`/chat/cache/${conversationId}`, {
      method: 'DELETE'
    });
  }
}
```

### 3.3 Update `ReadingArea.tsx`

**Integration Point**: When user clicks to open chat, ensure book is loaded

```typescript
const handleOpenChat = () => {
  if (!currentBook) {
    toast({
      title: "No Book Selected",
      description: "Please select a book from your library first",
      variant: "destructive"
    });
    return;
  }

  setIsAICollapsed(false); // Open the AI assistant panel
};
```

### 3.4 New Context: `ChatContext.tsx` (Optional)

**Location**: `frontend/src/contexts/ChatContext.tsx`

If you want to centralize chat state management (recommended for multi-component access):

```typescript
interface ChatContextType {
  activeCache: CacheInfo | null;
  messages: Message[];
  isLoading: boolean;
  uploadBookToChat: (book: Book) => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  clearConversation: () => void;
}

export function ChatProvider({ children }: { children: React.ReactNode }) {
  // ... implementation
}
```

---

## 4. Security Considerations

### 4.1 Authentication & Authorization

- ✅ All endpoints protected with `authMiddleware`
- ✅ User can only access their own caches (checked in controller)
- ✅ Database RLS policies ensure data isolation

### 4.2 Input Validation

```javascript
// Example validation in controller
const validateChatRequest = (req) => {
  const { cacheId, message, history } = req.body;

  if (!cacheId || typeof cacheId !== 'string') {
    throw new ValidationError('Invalid cacheId');
  }

  if (!message || typeof message !== 'string' || message.length > 10000) {
    throw new ValidationError('Message must be 1-10000 characters');
  }

  if (history && !Array.isArray(history)) {
    throw new ValidationError('History must be an array');
  }

  if (history && history.length > 50) {
    throw new ValidationError('History too long, max 50 messages');
  }
};
```

### 4.3 Rate Limiting

Extend existing rate limiting for chat endpoints:

```javascript
// backend/src/routes/chatRoutes.js
const rateLimit = require('express-rate-limit');

const chatUploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Max 10 uploads per 15 minutes
  message: 'Too many book uploads, please try again later'
});

const chatMessageLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // Max 30 messages per minute
  message: 'Too many messages, please slow down'
});

router.post('/upload-book', chatUploadLimiter, chatController.uploadBookToGemini);
router.post('/message', chatMessageLimiter, chatController.sendMessage);
```

### 4.4 Cost Protection

**Monitor token usage**:
```javascript
// In controller, track usage
const logTokenUsage = async (userId, bookId, tokensUsed) => {
  await supabaseService.logChatUsage({
    user_id: userId,
    book_id: bookId,
    cached_tokens: tokensUsed.cached,
    prompt_tokens: tokensUsed.prompt,
    output_tokens: tokensUsed.candidates,
    total_tokens: tokensUsed.total,
    timestamp: new Date()
  });
};

// Optional: Implement daily limits
const checkUserDailyLimit = async (userId) => {
  const usage = await supabaseService.getUserDailyTokenUsage(userId);
  const limit = 1000000; // 1M tokens per day
  
  if (usage > limit) {
    throw new Error('Daily token limit exceeded');
  }
};
```

---

## 5. Monitoring & Observability

### 5.1 Logging

Extend existing Winston logger:

```javascript
logger.info('Gemini document upload initiated', {
  userId,
  bookId,
  pdfUrl
});

logger.info('Cache created successfully', {
  userId,
  bookId,
  cacheId,
  expiresAt,
  tokenCount
});

logger.info('Chat message processed', {
  userId,
  cacheId,
  messageLength: message.length,
  responseLength: response.text.length,
  tokensUsed: response.tokensUsed
});

logger.error('Cache creation failed', {
  userId,
  bookId,
  error: error.message,
  stack: error.stack
});
```

### 5.2 Metrics to Track

- Total books uploaded to Gemini
- Average cache lifetime
- Messages per conversation
- Token usage (cached vs. new)
- Cache hit rate
- Average response time
- Error rates by type
- User engagement (messages per user per day)

### 5.3 Alerting

**Set up alerts for**:
- High error rates (>5% of requests)
- Slow response times (>10s)
- Excessive token usage (spike detection)
- Cache creation failures
- Gemini API quota exceeded

---

## 6. Cost Estimation

### 6.1 Gemini Pricing (as of Oct 2025)

**Context Caching**:
- Input tokens (cached): ~$0.01 per 1M tokens per hour
- Input tokens (new): ~$0.15 per 1M tokens
- Output tokens: ~$0.60 per 1M tokens

**Average Book** (300 pages):
- ~75,000 tokens per book
- Cache for 1 hour: $0.00075
- Cache for 24 hours: $0.018

**Per Conversation** (10 messages):
- Cached tokens: 75,000 tokens × 10 = 750,000 cached tokens → $0.0001
- New tokens (questions): ~500 tokens × 10 = 5,000 tokens → $0.00075
- Output tokens (responses): ~300 tokens × 10 = 3,000 tokens → $0.0018
- **Total per 10-message conversation: ~$0.02**

**Monthly Estimate** (1000 active users):
- 1000 users × 5 conversations/month × $0.02 = $100/month
- Plus storage: 1000 users × 5 books × $0.018 = $90/month
- **Total: ~$190/month**

### 6.2 Cost Optimization Strategies

1. **Use Gemini 2.5 Flash** instead of Pro (lower costs, still great quality)
2. **Implicit Caching**: Automatic savings on Gemini 2.5 models
3. **Trim History**: Limit conversation history to 10 messages
4. **Aggressive TTL**: Default 1-hour TTL, extend only if actively used
5. **Cleanup Job**: Nightly job to delete expired caches
6. **Monitor Usage**: Set up alerts for unusual spikes

---

## 7. Migration Path from Current Implementation

Your current `ChatWindow.tsx` references a FastAPI backend at `localhost:8000`. Here's the migration strategy:

### 7.1 Parallel Deployment (Recommended)

1. **Add schema changes** to existing `ai_conversations` table using Supabase MCP server
2. **Implement new Gemini endpoints** in Express backend
3. **Update ChatWindow** to use new endpoints with proper conversation management
4. **Test thoroughly** with real users
5. **Monitor** conversation persistence and cache efficiency

### 7.2 Direct Replacement

1. **Run schema migration** via Supabase MCP server
2. **Remove FastAPI references** completely from ChatWindow
3. **Implement new Express endpoints** using existing table structure
4. **Update frontend** to work with persisted conversations
5. **Deploy and monitor**

**Recommended**: Use parallel deployment for safety.

**Key Advantage**: You're extending existing infrastructure rather than building from scratch, so migration risk is lower.

---

## 8. Documentation Requirements

### 8.1 API Documentation

Create `docs/api/chat-endpoints.md`:

```markdown
# Chat API Endpoints

## POST /api/chat/upload-book

Upload a book to Gemini for chat functionality.

**Authentication**: Required (JWT)

**Request Body**:
```json
{
  "bookId": "uuid",
  "pdfUrl": "https://...",
  "title": "Book Title"
}
```

**Response**:
```json
{
  "success": true,
  "cacheId": "cache_name",
  "expiresAt": "2025-10-27T10:00:00Z",
  "message": "Book uploaded successfully"
}
```

**Errors**:
- 400: Invalid request body
- 401: Unauthorized
- 404: Book not found
- 500: Upload failed
```

### 8.2 User Documentation

Create `docs/features/ai-chat-with-books.md`:

```markdown
# AI Chat with Books

## Overview
The AI Chat feature allows you to have intelligent conversations with your books using Google's Gemini AI.

## How to Use
1. Open a book from your library
2. Click the chat icon to open the AI assistant
3. Wait for the book to load (first time only)
4. Start asking questions!

## Tips for Best Results
- Ask specific questions about content
- Request summaries of chapters
- Ask for explanations of complex topics
- Request quotes or specific information

## Limitations
- Chat sessions expire after 1 hour of inactivity
- Maximum 50 messages per conversation
- Books must be under 1000 pages
```

### 8.3 Developer Documentation

Update `memory-bank/systemPatterns.md` with new patterns:

```markdown
## AI Chat Integration Patterns

### Gemini Document Service Pattern:
* All PDF uploads handled via File API
* Context caching for cost optimization
* Cache lifecycle management (create, extend, delete)
* Conversation history maintained client-side

### Session Management:
* Stateless API design
* Frontend manages conversation history
* Backend validates cache existence
* Automatic cache extension for active sessions

### Error Handling:
* Custom error classes for chat-specific errors
* Graceful degradation on API failures
* User-friendly error messages
```

---

## 9. Risks & Mitigation

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| **Gemini API quota exceeded** | High | Medium | Implement rate limiting, usage monitoring, daily user limits |
| **Cache expiration during conversation** | Medium | Medium | Auto-extend TTL on active use, save conversation history |
| **Large PDFs exceeding token limits** | Medium | Low | Validate PDF size before upload, show warning for large files |
| **Network failures during upload** | Low | Medium | Implement retry logic, show clear error messages |
| **Database connection issues** | High | Low | Use connection pooling, implement circuit breaker |
| **Cost spiral from abuse** | High | Low | Rate limiting, user quotas, monitoring alerts |
| **Gemini API downtime** | Medium | Low | Implement fallback message, queue requests for retry |

---

## 10. Research Summary

### Gemini Document Understanding Capabilities

**Key Findings**:

1. **Vision-Based Understanding**: Unlike text extraction, Gemini can interpret charts, tables, diagrams, and formatting context - crucial for academic/complex documents.

2. **Context Caching is Essential**: For cost efficiency in chat scenarios, caching the PDF context is critical:
   - Implicit caching (automatic on Gemini 2.5) saves costs with no code changes
   - Explicit caching (manual) guarantees savings with TTL management
   - Minimum token requirements: 1,024 (Flash) or 4,096 (Pro)

3. **File API Management Pattern**: Upload PDF once → Get file URI → Use in cached context → Reference in multiple chat turns → Auto-cleanup after 48 hours

4. **Session Management**: Gemini API is stateless - you must send conversation history with each request (similar to your current ChatWindow pattern)

### Recommended Approach: File API + Context Caching

This approach balances cost, performance, and feature richness while aligning with your existing architecture patterns.

**Why this approach**:
- ✅ Cost-effective with context caching
- ✅ Native PDF understanding (vision-based)
- ✅ Supports up to 1,000 pages per document
- ✅ 48-hour file retention with automatic cleanup
- ✅ Implicit caching on Gemini 2.5 models (automatic savings)

### Common Mistakes to Avoid

1. **Re-uploading PDF on Every Message**: Use File API + context caching to upload once and reference multiple times
2. **Not Managing Conversation History**: Store and send conversation history array with each request
3. **Ignoring Token Limits**: Limit conversation history, monitor usage_metadata in responses
4. **Poor Cache TTL Management**: Set appropriate TTL, extend on active use, clean up on close
5. **Not Handling File Processing Delays**: Poll file status until ACTIVE, show loading indicators, implement timeout

---

## Conclusion

This implementation plan provides a comprehensive, production-ready approach to integrating Gemini Document Understanding into your ReadAI application. The design follows your established architectural patterns (SOLID principles, service layer abstraction, comprehensive error handling) while leveraging Gemini's powerful document analysis capabilities.

**Key Strengths**:
- ✅ Cost-effective with context caching
- ✅ Maintains existing code patterns
- ✅ Secure with authentication/authorization
- ✅ Scalable with proper monitoring
- ✅ Well-documented architecture

**Implementation Ready**: All components, APIs, and patterns are clearly defined and ready for development.
