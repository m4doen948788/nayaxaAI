const express = require('express');
const router = express.Router();
const nayaxaController = require('../controllers/nayaxaController');
const nayaxaKnowledgeController = require('../controllers/nayaxaKnowledgeController');
const { verifyApiKey } = require('../middleware/apiKeyMiddleware');
const path = require('path');
const expressStatic = express.static;

// Path definitions
const UPLOAD_PATH = path.join(__dirname, '../../uploads');
const DASHBOARD_UPLOADS = path.join(__dirname, '../../../../copy-dashboard/Backend/uploads');

// Public Export Download (For chat links)
router.get('/export/:filename', nayaxaController.downloadExport);

// Public Static Files (For previews in iframes/links)
// Public Routes for Static Files (Dashboard Uploads & System Uploads)
router.use('/uploads/dashboard', expressStatic(DASHBOARD_UPLOADS));
router.use('/uploads', expressStatic(UPLOAD_PATH));

// Catch-all for any missing files in /uploads to prevent falling through to verifyApiKey
router.all('/uploads/*', (req, res) => {
    res.status(404).json({ success: false, message: 'File tidak ditemukan di server.' });
});

// All other routes require an API Key
router.use(verifyApiKey);

router.get('/dashboard-insights', nayaxaController.getDashboardInsights);
router.get('/proactive-insight', nayaxaController.getProactiveInsight);
router.get('/sessions', nayaxaController.getChatSessions);
router.get('/history/:session_id', nayaxaController.getChatHistoryBySession);
router.delete('/session/:session_id', nayaxaController.deleteChatSession);
router.post('/session/:session_id/pin', nayaxaController.togglePinSession);
router.post('/chat', nayaxaController.chat);
router.post('/chatStream', nayaxaController.chatStream); // Widget & copy-dashboard
router.post('/chat/stream', nayaxaController.chatStream); // Nayaxa standalone frontend

// Knowledge management
router.get('/knowledge', nayaxaKnowledgeController.getAll);
router.post('/knowledge', nayaxaKnowledgeController.create);
router.put('/knowledge/:id', nayaxaKnowledgeController.update);
router.delete('/knowledge/:id', nayaxaKnowledgeController.deleteKnowledge);

// Proposals
router.get('/proposals/:id', nayaxaController.getProposal);
router.post('/proposals/:id/apply', nayaxaController.applyProposal);
router.post('/proposals/:id/reject', nayaxaController.rejectProposal);

module.exports = router;
