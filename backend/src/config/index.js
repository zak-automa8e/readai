require('dotenv').config();

const geminiModels = {
  imageToText: process.env.GEMINI_IMAGE_TO_TEXT_MODEL || 'gemini-3.8-flash',
  // Used when the primary model is overloaded, retired or slower than the timeout
  imageToTextFallback: process.env.GEMINI_IMAGE_TO_TEXT_FALLBACK_MODEL || 'gemini-3.5-flash-lite',
  imageToTextTimeoutMs: parseInt(process.env.GEMINI_IMAGE_TO_TEXT_TIMEOUT_MS, 10) || 25000,
  textToAudio: process.env.GEMINI_TEXT_TO_AUDIO_MODEL || 'gemini-2.5-flash-preview-tts',
  documentChat: process.env.GEMINI_DOCUMENT_CHAT_MODEL || 'gemini-2.5-flash'
};

const config = {
  // Server configuration
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || (process.env.NODE_ENV === 'production' ? 5000 : 3001),
  
  // API Keys
  geminiApiKey: process.env.GEMINI_API_KEY,
  
  // Supabase configuration
  supabase: {
    url: process.env.SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_KEY,
    anonKey: process.env.SUPABASE_ANON_KEY,
  },
  
  // CORS
  allowedOrigins: process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',') 
    : [
        'http://localhost:3000',  // React default
        'http://localhost:5173',  // Vite default
        'http://localhost:5174',  // Vite alternate port
        'http://127.0.0.1:5173',  // Vite IP access
        'http://127.0.0.1:5174',  // Vite IP alternate
        'http://localhost:4173',  // Vite preview port
        'http://localhost:8080',  // Docker frontend port
        'http://127.0.0.1:8080',  // Docker frontend IP access
        'http://localhost:5000',  // Replit frontend port
        'http://0.0.0.0:5000',    // Replit frontend
      ],
  // Allow all Replit domains
  corsAllowAll: process.env.CORS_ALLOW_ALL === 'true' || process.env.NODE_ENV === 'development',
  
  // Request limits
  maxRequestSize: process.env.MAX_REQUEST_SIZE || '10mb',
  
  // API limits
  maxTextLength: parseInt(process.env.MAX_TEXT_LENGTH, 10) || 1000,
  
  // Rate limiting
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
  // Local development shares one IP across the app, tests and tooling, so it gets more headroom
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX, 10) || (process.env.NODE_ENV === 'production' ? 100 : 1000),
  
  // Retry configuration
  maxRetries: parseInt(process.env.MAX_RETRIES, 10) || 3,
  retryDelay: parseInt(process.env.RETRY_DELAY, 10) || 1000,
  
  // Gemini models, used by the Google adapter in services/llm
  geminiModels,

  // Model gateway. 'openrouter' is the production path; 'google' calls Gemini directly and is
  // dev-only (free-tier keys allow about 10 TTS calls a day and throttle parallel extraction)
  llm: {
    provider: process.env.LLM_PROVIDER || (process.env.OPENROUTER_API_KEY ? 'openrouter' : 'google'),
    retry: {
      attempts: parseInt(process.env.LLM_RETRY_ATTEMPTS, 10) || 6,
      baseDelayMs: parseInt(process.env.LLM_RETRY_BASE_DELAY_MS, 10) || 4000,
    },
    openrouter: {
      apiKey: process.env.OPENROUTER_API_KEY,
      baseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
      models: {
        extract: process.env.OPENROUTER_EXTRACTION_MODEL || 'google/gemini-3.8-flash',
        extractBatch: 'google/gemini-3.8-flash:batch',
        tts: process.env.OPENROUTER_TTS_MODEL || 'google/gemini-3.8-flash-tts',
        ttsLite: 'google/gemini-3.8-flash-lite-tts',
        chat: process.env.OPENROUTER_CHAT_MODEL || 'google/gemini-3.8-flash',
      },
      timeouts: {
        extractMs: parseInt(process.env.OPENROUTER_EXTRACTION_TIMEOUT_MS, 10) || 60000,
        ttsMs: parseInt(process.env.OPENROUTER_TTS_TIMEOUT_MS, 10) || 120000,
        chatMs: parseInt(process.env.OPENROUTER_CHAT_TIMEOUT_MS, 10) || 120000,
      },
      // 25 audio tokens per second at $9 per million (list price, measured in the OpenRouter spike)
      ttsUsdPerAudioSecond: 0.000225,
    },
    google: {
      models: geminiModels,
    },
  },

  // Superseded by `llm`; removed with openRouterService
  llmProvider: process.env.LLM_PROVIDER || (process.env.OPENROUTER_API_KEY ? 'openrouter' : 'google'),
  openRouter: {
    apiKey: process.env.OPENROUTER_API_KEY,
    extractionModel: process.env.OPENROUTER_EXTRACTION_MODEL || 'google/gemini-3.8-flash',
    ttsModel: process.env.OPENROUTER_TTS_MODEL || 'google/gemini-3.8-flash-tts',
    extractionTimeoutMs: parseInt(process.env.OPENROUTER_EXTRACTION_TIMEOUT_MS, 10) || 60000,
    ttsTimeoutMs: parseInt(process.env.OPENROUTER_TTS_TIMEOUT_MS, 10) || 120000,
  },

  geminiChat: {
    defaultCacheTtl: process.env.GEMINI_CACHE_TTL || '3600s',
    maxConversationHistory: parseInt(process.env.MAX_CONVERSATION_HISTORY, 10) || 10,
    fileUploadTimeout: parseInt(process.env.FILE_UPLOAD_TIMEOUT, 10) || 60000,
    cacheExtensionThreshold: parseInt(process.env.CACHE_EXTENSION_THRESHOLD, 10) || 300000 // 5 minutes
  },
  
  // Logging
  logLevel: process.env.LOG_LEVEL || 'info',
  
  // Audio processing
  audioDefaults: {
    numChannels: 1,
    sampleRate: 22050,
    bitsPerSample: 16
  }
};

// Validate required configuration (warn instead of fail for development)
const requiredConfig = ['geminiApiKey'];
const missingConfig = requiredConfig.filter(key => !config[key]);

if (missingConfig.length > 0) {
  console.warn(`Warning: Missing configuration: ${missingConfig.join(', ')}. Some features may not work.`);
}

module.exports = config;
