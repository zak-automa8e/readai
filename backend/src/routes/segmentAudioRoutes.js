const express = require('express');
const { authenticateUser } = require('../middleware/authMiddleware');
const { playbackUserLimiter } = require('../middleware/playbackRateLimit');
const segmentsController = require('../controllers/segmentsController');

// Mounted at /api/segments
const router = express.Router();

router.get('/:segmentId/audio', authenticateUser, playbackUserLimiter, segmentsController.getSegmentAudio);

module.exports = router;
