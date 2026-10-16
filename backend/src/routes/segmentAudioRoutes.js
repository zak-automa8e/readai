const express = require('express');
const { authenticateUser } = require('../middleware/authMiddleware');
const segmentsController = require('../controllers/segmentsController');

// Mounted at /api/segments
const router = express.Router();

router.get('/:segmentId/audio', authenticateUser, segmentsController.getSegmentAudio);

module.exports = router;
