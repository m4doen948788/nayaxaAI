try {
    console.log('1. Manual Route Setup...');
    const express = require('express');
    const router = express.Router();
    
    console.log('2. Requiring controllers...');
    const nayaxaController = require('./src/controllers/nayaxaController');
    const nayaxaKnowledgeController = require('./src/controllers/nayaxaKnowledgeController');
    
    console.log('3. Requiring middleware...');
    const { verifyApiKey } = require('./src/middleware/apiKeyMiddleware');
    
    console.log('4. router.use(verifyApiKey)...');
    router.use(verifyApiKey);
    
    console.log('5. Registering routes...');
    router.get('/dashboard-insights', nayaxaController.getDashboardInsights);
    router.get('/sessions', nayaxaController.getChatSessions);
    router.get('/history/:session_id', nayaxaController.getChatHistoryBySession);
    
    console.log('6. Registering DELETE session...');
    router.delete('/session/:session_id', nayaxaController.deleteChatSession);
    
    console.log('7. Registering POST chat...');
    router.post('/chat', nayaxaController.chat);
    
    console.log('8. Registering knowledge routes...');
    router.get('/knowledge', nayaxaKnowledgeController.getAll);
    router.post('/knowledge', nayaxaKnowledgeController.create);
    router.put('/knowledge/:id', nayaxaKnowledgeController.update);
    
    console.log('9. Registering DELETE knowledge...');
    router.delete('/knowledge/:id', nayaxaKnowledgeController.delete);
    
    console.log('10. Success!');
    process.exit(0);
} catch (error) {
    console.error('--- CRASH ---');
    console.error(error.stack);
    process.exit(1);
}
