const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const config = require('./config');
const routes = require('./routes');
const errorHandler = require('./middleware/errorHandler');
const corsMiddleware = require('./middleware/corsMiddleware');
const logger = require('./utils/logger');

// Initialize Express app
const app = express();

// Security middleware - disable contentSecurityPolicy for development
app.use(helmet({
  contentSecurityPolicy: process.env.NODE_ENV === 'production',
  crossOriginEmbedderPolicy: false
}));

// CORS middleware - apply globally
app.use(corsMiddleware);

// Rate limiting
const limiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: config.rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  // JSON like every other API error, so the frontend can show it instead of failing to parse
  message: { error: 'RATE_LIMITED', message: 'Too many requests from this IP, please try again later.' }
});

// Apply rate limiting to API routes
app.use('/api', limiter);

// Body parsing middleware with increased limit for base64 images
app.use(express.json({ limit: config.maxRequestSize }));
app.use(express.urlencoded({ extended: true, limit: config.maxRequestSize }));

// Request logging middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.originalUrl} - ${req.ip}`);
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: config.nodeEnv
  });
});

// API routes
app.use('/api', routes);

// Serve static frontend in production
if (process.env.NODE_ENV === 'production') {
  const frontendPath = path.join(__dirname, '../../frontend/dist');
  app.use(express.static(frontendPath));
  
  // Handle client-side routing - serve index.html for non-API routes
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path === '/health') {
      return next();
    }
    res.sendFile(path.join(frontendPath, 'index.html'));
  });
}

// 404 handler (for API routes only in production, all routes in development)
app.use((req, res) => {
  logger.warn(`Route not found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({
    error: 'Not Found',
    message: `Cannot ${req.method} ${req.originalUrl}`
  });
});

// Error handling middleware
app.use(errorHandler);

module.exports = app;
