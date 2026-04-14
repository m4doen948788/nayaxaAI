const nayaxaController = require('./src/controllers/nayaxaController');
const nayaxaKnowledgeController = require('./src/controllers/nayaxaKnowledgeController');

console.log('--- Controller Function Check ---');
console.log('nayaxaController.getDashboardInsights:', typeof nayaxaController.getDashboardInsights);
console.log('nayaxaController.getChatSessions:', typeof nayaxaController.getChatSessions);
console.log('nayaxaController.getChatHistoryBySession:', typeof nayaxaController.getChatHistoryBySession);
console.log('nayaxaController.deleteChatSession:', typeof nayaxaController.deleteChatSession);
console.log('nayaxaController.chat:', typeof nayaxaController.chat);

console.log('nayaxaKnowledgeController.getAll:', typeof nayaxaKnowledgeController.getAll);
console.log('nayaxaKnowledgeController.create:', typeof nayaxaKnowledgeController.create);
console.log('nayaxaKnowledgeController.update:', typeof nayaxaKnowledgeController.update);
console.log('nayaxaKnowledgeController.delete:', typeof nayaxaKnowledgeController.delete);

console.log('--- Environment Check ---');
require('dotenv').config();
console.log('MYSQL_HOST:', process.env.MYSQL_HOST ? 'Present' : 'MISSING');
console.log('NAYAXA_DB_NAME:', process.env.NAYAXA_DB_NAME ? 'Present' : 'MISSING');
console.log('PORT:', process.env.PORT);

process.exit(0);
