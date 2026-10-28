const express = require('express');
const { authenticateUser } = require('../middleware/authMiddleware');
const { playbackUserLimiter } = require('../middleware/playbackRateLimit');
const segmentsController = require('../controllers/segmentsController');

// Mounted at /api/books
const router = express.Router();

router.get('/:bookId/segments', authenticateUser, playbackUserLimiter, segmentsController.getSegments);
router.post('/:bookId/listen', authenticateUser, playbackUserLimiter, segmentsController.listen);
router.post('/:bookId/listen/wait', authenticateUser, playbackUserLimiter, segmentsController.waitForClips);

module.exports = router;
