const express = require('express');
const { authenticateUser } = require('../middleware/authMiddleware');
const { playbackUserLimiter } = require('../middleware/playbackRateLimit');
const planController = require('../controllers/planController');

// Mounted at /api/plan
const router = express.Router();

router.get('/', authenticateUser, playbackUserLimiter, planController.getPlan);

module.exports = router;
