const nayaxaGemini = require('../services/nayaxaGeminiService');
const nayaxaDeepSeek = require('../services/nayaxaDeepSeekService');
const nayaxaStandalone = require('../services/nayaxaStandalone');
const dbNayaxa = require('../config/dbNayaxa');
const dbDashboard = require('../config/dbDashboard');

// In-Memory Cache for Insights & Repeat Questions
const insightsCache = new Map();
const chatResponseCache = new Map();

// 20-Request Concurrent Queue System
let activeRequests = 0;
const requestQueue = [];
const MAX_CONCURRENT = 20;

const processQueue = () => {
    if (activeRequests < MAX_CONCURRENT && requestQueue.length > 0) {
        const next = requestQueue.shift();
        activeRequests++;
        next();
    }
};

const queueRequest = () => new Promise(resolve => {
    requestQueue.push(resolve);
    processQueue();
});

const releaseRequest = () => {
    activeRequests--;
    processQueue();
};

const nayaxaController = {
    /**
     * Get Dashboard summary using Gemni
     */
    getDashboardInsights: async (req, res) => {
        const { instansi_id, profil_id } = req.query;
        const cacheKey = `insights_${instansi_id}_${profil_id}`;

        // Return cached version if less than 1 hour old
        if (insightsCache.has(cacheKey)) {
            const cached = insightsCache.get(cacheKey);
            if (Date.now() - cached.timestamp < 3600000) {
                console.log(`[Cache] Serving Insights for Instansi ${instansi_id}`);
                return res.json(cached.data);
            }
        }

        await queueRequest();
        try {
            const now = new Date();
            const month = now.getMonth() + 1;
            const year = now.getFullYear();
            const fullDate = now.toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

            const [stats, forecast, scoring, alerts, personalStats] = await Promise.all([
                nayaxaStandalone.getPegawaiStatistics(instansi_id, month, year),
                nayaxaStandalone.forecastTrends(instansi_id, month, year),
                nayaxaStandalone.calculateScoring(instansi_id, month, year),
                nayaxaStandalone.detectAnomalies(instansi_id),
                profil_id ? nayaxaStandalone.getPersonalStatistics(profil_id, month, year) : Promise.resolve(null)
            ]);

            const responseData = {
                success: true,
                data: { insights: { stats, forecast, scoring, alerts, personalStats } }
            };

            insightsCache.set(cacheKey, { timestamp: Date.now(), data: responseData });
            res.json(responseData);
        } catch (error) {
            console.error('Insights Error:', error);
            res.status(500).json({ success: false, message: 'Gagal memuat insight.' });
        } finally {
            releaseRequest();
        }
    },

    /**
     * Core Chat Endpoint
     */
    chat: async (req, res) => {
        const { 
            message, fileBase64, fileMimeType, 
            user_id, user_name, profil_id, instansi_id,
            session_id, current_page, page_title 
        } = req.body;

        const activeSessionId = session_id || `sess_${Date.now()}`;
        const app_id = req.nayaxaApp.id;

        // Cache Key for identical questions (5-minute TTL)
        const chatCacheKey = `${user_id}_${message.toLowerCase().trim()}`;
        if (!fileBase64 && chatResponseCache.has(chatCacheKey)) {
            const cached = chatResponseCache.get(chatCacheKey);
            if (Date.now() - cached.timestamp < 300000) {
                console.log(`[Cache] Serving Chat Response for User ${user_id}`);
                return res.json(cached.data);
            }
        }

        await queueRequest();
        try {
            // 1. Save User Message
            await dbNayaxa.query(
                'INSERT INTO nayaxa_chat_history (app_id, user_id, session_id, role, content) VALUES (?, ?, ?, ?, ?)', 
                [app_id, user_id, activeSessionId, 'user', message]
            );

            // 2. Load History
            const [historyRows] = await dbNayaxa.query(
                'SELECT role, content FROM nayaxa_chat_history WHERE session_id = ? ORDER BY created_at DESC LIMIT 30',
                [activeSessionId]
            );
            const history = historyRows.reverse().map(h => ({
                role: h.role === 'model' ? 'model' : 'user',
                parts: [{ text: h.content }]
            }));

            // 3. Routing
            let responseText = '';
            let brain = 'Gemini';

            const now = new Date();
            const month = now.getMonth() + 1;
            const year = now.getFullYear();
            const fullDate = now.toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

            const protocol = req.protocol;
            const host = req.get('host');
            const baseUrl = `${protocol}://${host}`;

            if (process.env.DEEPSEEK_ENABLED === 'true') {
                const isImageFile = fileMimeType && fileMimeType.startsWith('image/');
                const isSpreadsheet = fileMimeType && (fileMimeType.includes('spreadsheetml') || fileMimeType.includes('excel') || fileMimeType.includes('csv') || fileMimeType.includes('officedocument.spreadsheetml.sheet'));
                // DeepSeek-Chat does not currently support images. We pass them directly to Gemini
                const isDeepSeekCompatible = !fileBase64 || isSpreadsheet;

                if (isDeepSeekCompatible) {
                    try {
                        brain = 'DeepSeek';
                        responseText = await nayaxaDeepSeek.chatWithNayaxa(
                            message, '', instansi_id, month, year, history, user_name, profil_id, baseUrl, fullDate, fileBase64, fileMimeType
                        );
                    } catch (deepseekError) {
                        const isRateLimit = deepseekError.response?.status === 429 || 
                                            deepseekError.message?.includes('429') || 
                                            deepseekError.message?.includes('quota');
                        if (isRateLimit) {
                            console.warn('[Nayaxa] DeepSeek RPM limit hit. Falling back to Gemini...');
                            brain = 'Gemini (Fallback)';
                            responseText = await nayaxaGemini.chatWithNayaxa(
                                message, fileBase64, fileMimeType, instansi_id, month, year, history, user_name, profil_id, '', '', '', baseUrl, fullDate
                            );
                        } else {
                            throw deepseekError;
                        }
                    }
                } else {
                    console.log(`[Nayaxa] File type ${fileMimeType} forwarded directly to Gemini.`);
                    brain = 'Gemini';
                    responseText = await nayaxaGemini.chatWithNayaxa(
                        message, fileBase64, fileMimeType, instansi_id, month, year, history, user_name, profil_id, '', '', '', baseUrl, fullDate
                    );
                }
            } else {
                responseText = await nayaxaGemini.chatWithNayaxa(message, fileBase64, fileMimeType, instansi_id, month, year, history, user_name, profil_id, '', '', '', baseUrl, fullDate);
            }

            // 4. Save & Cache Response
            const contentToSave = responseText
                .replace(/\[NAYAXA_CHART\][\s\S]*?\[\/NAYAXA_CHART\]/g, '[Grafik]')
                .replace(/\[ACTION:REQUEST_LOCATION\]/g, '');
            await dbNayaxa.query(
                'INSERT INTO nayaxa_chat_history (app_id, user_id, session_id, role, content, brain_used) VALUES (?, ?, ?, ?, ?, ?)', 
                [app_id, user_id, activeSessionId, 'model', contentToSave, brain]
            );

            const resultData = { success: true, text: responseText, brain_used: brain, session_id: activeSessionId };
            if (!fileBase64) chatResponseCache.set(chatCacheKey, { timestamp: Date.now(), data: resultData });
            
            res.json(resultData);
        } catch (error) {
            console.error('Chat Error:', error);
            res.status(500).json({ success: false, message: error.message });
        } finally {
            releaseRequest();
        }
    },

    getChatSessions: async (req, res) => {
        try {
            const { user_id } = req.query;
            const app_id = req.nayaxaApp.id;
            const [rows] = await dbNayaxa.query(
                'SELECT session_id, MAX(created_at) as last_msg, SUBSTRING(MAX(content), 1, 50) as title FROM nayaxa_chat_history WHERE app_id = ? AND user_id = ? GROUP BY session_id ORDER BY last_msg DESC LIMIT 10',
                [app_id, user_id]
            );
            res.json({ success: true, sessions: rows });
        } catch (err) { res.status(500).json({ success: false, message: err.message }); }
    },

    getChatHistoryBySession: async (req, res) => {
        try {
            const { session_id } = req.params;
            const [rows] = await dbNayaxa.query(
                'SELECT role, content, brain_used, created_at FROM nayaxa_chat_history WHERE session_id = ? ORDER BY created_at ASC',
                [session_id]
            );
            res.json({ success: true, history: rows });
        } catch (err) { res.status(500).json({ success: false, message: err.message }); }
    },

    deleteChatSession: async (req, res) => {
        try {
            const { session_id } = req.params;
            const app_id = req.nayaxaApp.id;
            await dbNayaxa.query(
                'DELETE FROM nayaxa_chat_history WHERE session_id = ? AND app_id = ?',
                [session_id, app_id]
            );
            res.json({ success: true, message: 'Chat session deleted successfully.' });
        } catch (error) {
            console.error('Delete Session Error:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    }
};

module.exports = nayaxaController;
