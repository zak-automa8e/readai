require('dotenv').config();

const config = {
  // Server configuration
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 3001,
  
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
      ],
  
  // Request limits
  maxRequestSize: process.env.MAX_REQUEST_SIZE || '10mb',
  
  // API limits
  maxTextLength: parseInt(process.env.MAX_TEXT_LENGTH, 10) || 1000,
  
  // Rate limiting
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX, 10) || 100,
  
  // Retry configuration
  maxRetries: parseInt(process.env.MAX_RETRIES, 10) || 3,
  retryDelay: parseInt(process.env.RETRY_DELAY, 10) || 1000,
  
  // Gemini models
  geminiModels: {
    imageToText: 'gemini-2.5-flash-preview-09-2025',
    textToAudio: 'gemini-2.5-flash-preview-tts',
    documentChat: process.env.GEMINI_DOCUMENT_CHAT_MODEL || 'gemini-2.5-flash'
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

// Validate required configuration
const requiredConfig = ['geminiApiKey'];
const missingConfig = requiredConfig.filter(key => !config[key]);

if (missingConfig.length > 0) {
  throw new Error(`Missing required configuration: ${missingConfig.join(', ')}`);
}

module.exports = config;
