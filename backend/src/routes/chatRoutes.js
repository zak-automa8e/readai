const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');
const authMiddleware = require('../middleware/authMiddleware');

const authenticateUser = authMiddleware.authenticateUser || authMiddleware.default || authMiddleware;

if (typeof authenticateUser !== 'function') {
  console.error('Chat routes auth middleware invalid export shape:', authMiddleware);
  throw new Error('Chat routes require authenticateUser middleware function');
}
console.log('Chat routes using auth middleware function:', authenticateUser.name || 'anonymous');
const rateLimit = require('express-rate-limit');

// All chat routes require authentication
router.use(authenticateUser);

// Rate limiting for chat endpoints
const chatUploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Max 10 uploads per 15 minutes
  message: 'Too many book uploads, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

const chatMessageLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // Max 30 messages per minute
  message: 'Too many messages, please slow down',
  standardHeaders: true,
  legacyHeaders: false,
});

// Chat routes
router.get('/conversation/:bookId', chatController.getOrCreateConversation);
router.post('/upload-book', chatUploadLimiter, chatController.uploadBookToGemini);
router.post('/message', chatMessageLimiter, chatController.sendMessage);
router.post('/extend-cache', chatController.extendCache);
router.delete('/cache/:conversationId', chatController.deleteCache);

module.exports = router;