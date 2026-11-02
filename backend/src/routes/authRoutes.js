const express = require('express');
const authController = require('../controllers/authController');
const { authenticateUser, optionalAuth } = require('../middleware/authMiddleware');

const router = express.Router();

// Public authentication routes
router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/refresh', authController.refreshSession);
router.post('/reset-password', authController.resetPassword);

// Protected routes (require authentication)
router.post('/logout', authenticateUser, authController.logout);
router.get('/profile', authenticateUser, authController.getProfile);
router.put('/profile', authenticateUser, authController.updateProfile);

module.exports = router;
