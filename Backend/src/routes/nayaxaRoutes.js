const express = require('express');
const router = express.Router();
const nayaxaController = require('../controllers/nayaxaController');
const nayaxaKnowledgeController = require('../controllers/nayaxaKnowledgeController');
const { verifyApiKey } = require('../middleware/apiKeyMiddleware');
const path = require('path');
const expressStatic = express.static;

// Path definitions
const UPLOAD_PATH = path.join(__dirname, '../../uploads');
const isLocal = process.platform === 'win32';
const DASHBOARD_UPLOADS = isLocal 
    ? path.join(__dirname, '../../../../copy-dashboard/Backend/uploads')
    : path.join(__dirname, '../../../../dashboard-ppm/Backend/uploads');

// Public Export Download (For chat links)
router.get('/export/:filename', nayaxaController.downloadExport);
router.get('/api/nayaxa/export/:filename', nayaxaController.downloadExport);

// Debug endpoint for exports diagnostics
router.get('/api/nayaxa/debug-exports', (req, res) => {
    try {
        const fs = require('fs');
        const path = require('path');
        const exportDir = path.join(__dirname, '../../uploads/exports');
        if (!fs.existsSync(exportDir)) {
            return res.json({ success: true, message: 'Export directory does not exist yet.', files: [] });
        }
        const files = fs.readdirSync(exportDir).map(file => {
            const stats = fs.statSync(path.join(exportDir, file));
            return {
                name: file,
                size: stats.size,
                created: stats.birthtime
            };
        });
        files.sort((a, b) => b.created - a.created);
        res.json({ success: true, files });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Public Static Files (For previews in iframes/links)
// Public Routes for Static Files (Dashboard Uploads & System Uploads)
router.use('/uploads/dashboard', expressStatic(DASHBOARD_UPLOADS));
router.use('/uploads', expressStatic(UPLOAD_PATH));

// Fallback for NGINX proxies that don't strip /api/nayaxa prefix
router.use('/api/nayaxa/uploads/dashboard', expressStatic(DASHBOARD_UPLOADS));
router.use('/api/nayaxa/uploads', expressStatic(UPLOAD_PATH));

// Catch-all for any missing files in /uploads to prevent falling through to verifyApiKey
router.all('/uploads/*', (req, res) => {
    res.status(404).json({ success: false, message: 'File tidak ditemukan di server.' });
});
router.all('/api/nayaxa/uploads/*', (req, res) => {
    res.status(404).json({ success: false, message: 'File tidak ditemukan di server.' });
});

// All other routes require an API Key
router.use(verifyApiKey);

router.get('/dashboard-insights', nayaxaController.getDashboardInsights);
router.get('/widget-prompts', nayaxaController.getWidgetPrompts);
router.get('/usage-stats', nayaxaController.getUsageStats);
router.get('/proactive-insight', nayaxaController.getProactiveInsight);
router.get('/sessions', nayaxaController.getChatSessions);
router.get('/history/:session_id', nayaxaController.getChatHistoryBySession);
router.delete('/session/:session_id', nayaxaController.deleteChatSession);
router.post('/session/:session_id/pin', nayaxaController.togglePinSession);
router.post('/chat', nayaxaController.chat);
router.post('/chatStream', nayaxaController.chatStream); // Widget & copy-dashboard
router.post('/chat/stream', nayaxaController.chatStream); // Nayaxa standalone frontend
router.post('/export-selected', nayaxaController.exportSelectedMessages);
router.post('/api/nayaxa/export-selected', nayaxaController.exportSelectedMessages);

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
