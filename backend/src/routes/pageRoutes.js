const express = require('express');
const pageController = require('../controllers/pageController');
const { authenticateUser } = require('../middleware/authMiddleware');

const router = express.Router();

// All page routes require authentication
router.use(authenticateUser);

// Get or extract page text with caching
router.post('/text', pageController.getPageText);

// Get or generate page audio with caching
router.post('/audio', pageController.getPageAudio);

module.exports = router;