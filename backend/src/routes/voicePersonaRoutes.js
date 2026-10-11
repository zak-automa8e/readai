const express = require('express');
const router = express.Router();
const voicePersonaController = require('../controllers/voicePersonaController');
const { authenticateUser, optionalAuth } = require('../middleware/authMiddleware');

// Public routes (or optionally auth)
router.get('/config', voicePersonaController.getConfig);
router.get('/marketplace', voicePersonaController.getMarketplace);
router.get('/templates', voicePersonaController.getTemplates);

// Protected routes
router.use(authenticateUser);

router.get('/', voicePersonaController.getPersonas);
router.post('/', voicePersonaController.createPersona);
router.post('/preview', voicePersonaController.generatePreview);
router.put('/:id', voicePersonaController.updatePersona);
router.delete('/:id', voicePersonaController.deletePersona);

module.exports = router;
