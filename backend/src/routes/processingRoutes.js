const express = require('express');
const { authenticateUser } = require('../middleware/authMiddleware');
const processingController = require('../controllers/processingController');

// Mounted at /api/books
const router = express.Router();

router.post('/:bookId/process', authenticateUser, processingController.startProcessing);
router.get('/:bookId/processing', authenticateUser, processingController.getProcessing);

module.exports = router;
