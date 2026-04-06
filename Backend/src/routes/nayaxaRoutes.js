const express = require('express');
const router = express.Router();
const nayaxaController = require('../controllers/nayaxaController');
const nayaxaKnowledgeController = require('../controllers/nayaxaKnowledgeController');
const { verifyApiKey } = require('../middleware/apiKeyMiddleware');

// Public Export Download (For chat links)
router.get('/export/:filename', nayaxaController.downloadExport);

// All other routes require an API Key
router.use(verifyApiKey);

router.get('/dashboard-insights', nayaxaController.getDashboardInsights);
router.get('/sessions', nayaxaController.getChatSessions);
router.get('/history/:session_id', nayaxaController.getChatHistoryBySession);
router.delete('/session/:session_id', nayaxaController.deleteChatSession);
router.post('/session/:session_id/pin', nayaxaController.togglePinSession);
router.post('/chat', nayaxaController.chat);

// Knowledge management
router.get('/knowledge', nayaxaKnowledgeController.getAll);
router.post('/knowledge', nayaxaKnowledgeController.create);
router.put('/knowledge/:id', nayaxaKnowledgeController.update);
router.delete('/knowledge/:id', nayaxaKnowledgeController.deleteKnowledge);

module.exports = router;
