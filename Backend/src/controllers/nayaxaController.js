const nayaxaGemini = require('../services/nayaxaGeminiService');
const nayaxaDeepSeek = require('../services/nayaxaDeepSeekService');
const nayaxaStandalone = require('../services/nayaxaStandalone');
const personaService = require('../services/personaService');
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
            message, fileBase64, fileMimeType, files,
            user_id, user_name, profil_id, instansi_id,
            session_id, current_page, page_title 
        } = req.body;

        // Support both old single-file and new multi-file format
        let attachmentList = files || [];
        if (fileBase64 && fileMimeType && attachmentList.length === 0) {
            attachmentList = [{ base64: fileBase64, mimeType: fileMimeType }];
        }

        const activeSessionId = session_id || `sess_${Date.now()}`;
        const app_id = req.nayaxaApp.id;

        // Cache Key for identical questions (5-minute TTL)
        const chatCacheKey = `${user_id}_${message.toLowerCase().trim()}`;
        const hasFiles = attachmentList.length > 0;
        
        if (!hasFiles && chatResponseCache.has(chatCacheKey)) {
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

            // 3. Routing (Resilient Fallback System)
            let responseText = '';
            let brain = 'Gemini';

            const now = new Date();
            const month = now.getMonth() + 1;
            const year = now.getFullYear();
            const fullDate = now.toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

            const protocol = req.get('x-forwarded-proto') || req.protocol;
            const host = req.get('host');
            const baseUrl = `${protocol}://${host}`;
            const nama_instansi = await nayaxaStandalone.getInstansiName(instansi_id);
            const userProfile = await nayaxaStandalone.getPegawaiProfile(profil_id);

            // --- PERSONA: Fetch user's long-term profile ---
            const personaText = await personaService.getPersona(user_id);
            const personaPromptSnippet = personaService.formatForPrompt(personaText);

            const isDeepSeekEnabled = process.env.DEEPSEEK_ENABLED === 'true';
            const hasImages = attachmentList.some(f => f.mimeType && f.mimeType.startsWith('image/'));
            const hasPDFs = attachmentList.some(f => f.mimeType && f.mimeType.includes('pdf'));
            const isDeepSeekCompatible = !hasImages && !hasPDFs;

            const tryGemini = async (isFallback = false) => {
                brain = isFallback ? 'Gemini (Fallback)' : 'Gemini';
                return await nayaxaGemini.chatWithNayaxa(
                    message, attachmentList, instansi_id, month, year, history, user_name, profil_id, '', '', '', baseUrl, fullDate, nama_instansi, personaPromptSnippet, userProfile
                );
            };

            const tryDeepSeek = async (isFallback = false) => {
                brain = isFallback ? 'DeepSeek (Fallback)' : 'DeepSeek';
                return await nayaxaDeepSeek.chatWithNayaxa(
                    message, '', instansi_id, month, year, history, user_name, profil_id, baseUrl, fullDate, attachmentList, nama_instansi, personaPromptSnippet
                );
            };

            if (isDeepSeekEnabled && isDeepSeekCompatible) {
                try {
                    responseText = await tryDeepSeek();
                } catch (dsError) {
                    const isDsOverloaded = dsError.response?.status === 429 || dsError.message?.includes('429') || dsError.message?.includes('quota');
                    if (isDsOverloaded) {
                        console.warn('[Nayaxa] DeepSeek overloaded/limited, falling back to Gemini...');
                        responseText = await tryGemini(true);
                    } else {
                        throw dsError;
                    }
                }
            } else {
                try {
                    responseText = await tryGemini();
                } catch (geminiError) {
                    const isGeminiOverloaded = geminiError.status === 503 || geminiError.status === 429 || 
                                              geminiError.message?.includes('503') || geminiError.message?.includes('429');
                    // Fallback to DeepSeek ONLY if compatible (no images/PDFs) and enabled
                    if (isGeminiOverloaded && isDeepSeekEnabled && isDeepSeekCompatible) {
                        console.warn('[Nayaxa] Gemini overloaded/limited, falling back to DeepSeek...');
                        responseText = await tryDeepSeek(true);
                    } else {
                        throw geminiError;
                    }
                }
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
            if (!hasFiles) chatResponseCache.set(chatCacheKey, { timestamp: Date.now(), data: resultData });

            // --- PERSONA: Fire-and-forget background update (NEVER blocks response) ---
            // Uses Gemini as the lightweight analyzer via a simple wrapper
            const simpleAiAnalyzer = async (prompt) => {
                try {
                    const { GoogleGenerativeAI } = require('@google/generative-ai');
                    const [keyRows] = await dbNayaxa.query('SELECT api_key FROM gemini_api_keys WHERE is_active = 1 LIMIT 1');
                    const apiKey = keyRows.length > 0 ? keyRows[0].api_key : process.env.GEMINI_API_KEY;
                    const genAI = new GoogleGenerativeAI(apiKey);
                    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
                    const result = await model.generateContent(prompt);
                    return result.response.text()?.trim() || '';
                } catch (e) { return ''; }
            };
            personaService.triggerPersonaUpdate(user_id, user_name, activeSessionId, simpleAiAnalyzer);

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
                `SELECT 
                    h.session_id, 
                    MAX(h.created_at) as last_msg, 
                    SUBSTRING(MAX(h.content), 1, 50) as title,
                    (p.id IS NOT NULL) as is_pinned
                 FROM nayaxa_chat_history h 
                 LEFT JOIN nayaxa_pinned_sessions p ON h.session_id = p.session_id AND p.user_id = h.user_id
                 WHERE h.app_id = ? AND h.user_id = ? 
                 GROUP BY h.session_id, p.id
                 ORDER BY is_pinned DESC, last_msg DESC 
                 LIMIT 15`,
                [app_id, user_id]
            );
            res.json({ success: true, sessions: rows });
        } catch (err) { res.status(500).json({ success: false, message: err.message }); }
    },

    togglePinSession: async (req, res) => {
        try {
            const { session_id } = req.params;
            const { user_id, pin } = req.body;
            const app_id = req.nayaxaApp.id;
            
            if (pin) {
                const [countRows] = await dbNayaxa.query(
                    'SELECT COUNT(*) as cnt FROM nayaxa_pinned_sessions WHERE app_id = ? AND user_id = ?',
                    [app_id, user_id]
                );
                if (countRows[0].cnt >= 3) {
                    return res.json({ success: false, message: 'Batas maksimal pin percakapan adalah 3.' });
                }
                await dbNayaxa.query(
                    'INSERT IGNORE INTO nayaxa_pinned_sessions (app_id, user_id, session_id) VALUES (?, ?, ?)',
                    [app_id, user_id, session_id]
                );
            } else {
                await dbNayaxa.query(
                    'DELETE FROM nayaxa_pinned_sessions WHERE app_id = ? AND user_id = ? AND session_id = ?',
                    [app_id, user_id, session_id]
                );
            }
            res.json({ success: true, message: pin ? 'Sesi di-pin' : 'Sesi di-unpin' });
        } catch (error) {
            console.error('Toggle Pin Error:', error);
            res.status(500).json({ success: false, message: error.message });
        }
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
    },

    /**
     * Dedicated Download Endpoint for Exports
     */
    downloadExport: (req, res) => {
        try {
            const { filename } = req.params;
            const path = require('path');
            const fs = require('fs');
            const exportDir = path.join(__dirname, '../../uploads/exports');
            const filePath = path.join(exportDir, filename);

            if (!fs.existsSync(filePath)) {
                return res.status(404).send('File not found.');
            }

            // Using Express's built-in res.download for robustness.
            // It automatically sets Content-Disposition, and MIME type based on extension.
            res.download(filePath, filename, (err) => {
                if (err) {
                    console.error('[DOWNLOAD] Error sending file:', err);
                    if (!res.headersSent) {
                        res.status(500).send('Error occurred during file download.');
                    }
                }
            });
        } catch (error) {
            console.error('Download Export Error:', error);
            if (!res.headersSent) res.status(500).send('Internal Server Error.');
        }
    }
};

module.exports = nayaxaController;
