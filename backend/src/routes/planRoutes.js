const express = require('express');
const { authenticateUser } = require('../middleware/authMiddleware');
const planController = require('../controllers/planController');

// Mounted at /api/plan
const router = express.Router();

router.get('/', authenticateUser, planController.getPlan);

module.exports = router;
