const express = require('express');
const router = express.Router();
const nayaxaController = require('../controllers/nayaxaController');
const proactiveController = require('../controllers/proactiveController');
const nayaxaKnowledgeController = require('../controllers/nayaxaKnowledgeController');
const { verifyApiKey } = require('../middleware/apiKeyMiddleware');

// All routes require an API Key
router.use(verifyApiKey);

router.get('/dashboard-insights', nayaxaController.getDashboardInsights);
router.get('/proactive-insight', proactiveController.getProactiveInsight);
router.get('/sessions', nayaxaController.getChatSessions);
router.get('/history/:session_id', nayaxaController.getChatHistoryBySession);
router.delete('/session/:session_id', nayaxaController.deleteChatSession);
router.post('/chat', nayaxaController.chat);

// Knowledge management
router.get('/knowledge', nayaxaKnowledgeController.getAll);
router.post('/knowledge', nayaxaKnowledgeController.create);
router.put('/knowledge/:id', nayaxaKnowledgeController.update);
router.delete('/knowledge/:id', nayaxaKnowledgeController.deleteKnowledge);

module.exports = router;
