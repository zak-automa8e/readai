const express = require('express');
const { authenticateUser } = require('../middleware/authMiddleware');
const segmentsController = require('../controllers/segmentsController');

// Mounted at /api/books
const router = express.Router();

router.get('/:bookId/segments', authenticateUser, segmentsController.getSegments);

module.exports = router;
