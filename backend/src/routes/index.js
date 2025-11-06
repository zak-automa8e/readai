const express = require('express');
const cors = require('cors');
const pdfRoutes = require('./pdfRoutes');
const imageRoutes = require('./imageRoutes');
const audioRoutes = require('./audioRoutes');
const booksRoutes = require('./booksRoutes');
const authRoutes = require('./authRoutes');
const pageRoutes = require('./pageRoutes');
const chatRoutes = require('./chatRoutes');

const router = express.Router();

// Enable CORS preflight for all routes
router.options('*', cors());

// Health check endpoint
router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Mount feature routes
router.use('/auth', authRoutes);
router.use('/', pdfRoutes);
router.use('/', imageRoutes);
router.use('/', audioRoutes);
router.use('/books', booksRoutes);
router.use('/pages', pageRoutes);
router.use('/chat', chatRoutes);

module.exports = router;
