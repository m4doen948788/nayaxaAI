const nayaxaGemini = require('../services/nayaxaGeminiService');
const nayaxaDeepSeek = require('../services/nayaxaDeepSeekService');
const nayaxaRoutingService = require('../services/nayaxaRoutingService');
const nayaxaStandalone = require('../services/nayaxaStandalone');
const personaService = require('../services/personaService');
const sessionTitleService = require('../services/sessionTitleService');
const dbNayaxa = require('../config/dbNayaxa');
const dbDashboard = require('../config/dbDashboard');
const codeAgent = require('../services/codeAgentService');
const pdf = require('pdf-parse');

// In-Memory Cache for Insights & Repeat Questions
const insightsCache = new Map();
const chatResponseCache = new Map();

// 20-Request Concurrent Queue System (Glossary expanded at 11:11)
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

/**
 * Builds a safe, publicly accessible export download URL.
 * Priority:
 *   1. NAYAXA_PUBLIC_URL env var (set by admin in .env on server)
 *   2. Fallback from request headers — always uses HTTP to avoid SSL errors on bare port
 *
 * NAYAXA_PUBLIC_URL should be the ROOT domain/path WITHOUT a trailing /export segment.
 * e.g. "https://bapperida-ppm.my.id" or "https://bapperida-ppm.my.id/api/nayaxa"
 */
const buildExportDownloadUrl = (req, downloadPath) => {
    let base = process.env.NAYAXA_PUBLIC_URL || '';

    // Smart sensing fallback for production to prevent ERR_SSL_PROTOCOL_ERROR
    const host = (req.get('x-forwarded-host') || req.get('host') || '').toLowerCase();
    
    // If either incoming host header OR loaded NAYAXA_PUBLIC_URL env var contains the production domain,
    // force rewrite base to the official secure SSL subdomain in production.
    if (host.includes('bapperida-ppm.my.id') || base.includes('bapperida-ppm.my.id')) {
        base = 'https://api-nayaxa.bapperida-ppm.my.id';
    }

    if (!base) {
        const proto = req.get('x-forwarded-proto') || 'http';
        base = `${proto}://${host}`;
    }

    // Strip trailing slash from base
    base = base.replace(/\/$/, '');

    // downloadPath starts with /export/... — just append directly
    return `${base}${downloadPath}`;
};

const nayaxaController = {
    /**
     * Get Widget Prompts
     */
    getWidgetPrompts: async (req, res) => {
        try {
            await dbDashboard.query(`
                CREATE TABLE IF NOT EXISTS nayaxa_widget_prompts (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    label VARCHAR(255) NOT NULL,
                    prompt VARCHAR(255) NOT NULL,
                    urutan INT DEFAULT 0,
                    is_active TINYINT DEFAULT 1,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
            `);

            const [rows] = await dbDashboard.query('SELECT * FROM nayaxa_widget_prompts WHERE is_active = 1 ORDER BY urutan ASC, id ASC');
            if (rows.length === 0) {
                await dbDashboard.query(`
                    INSERT INTO nayaxa_widget_prompts (label, prompt, urutan) VALUES 
                    ('Analisis', 'Analisis', 1),
                    ('Analisis RKA/DPA/Rincian Belanja', 'Analisis RKA/DPA/Rincian Belanja', 2),
                    ('Pengecekan Kesesuaian SSH/SBU', 'Pengecekan Kesesuaian SSH/SBU', 3),
                    ('Uji Logika & Konsistensi Anggaran', 'Uji Logika & Konsistensi Anggaran', 4),
                    ('Jadikan Acuan Bahan', 'Jadikan Acuan Bahan', 5),
                    ('Jadikan Acuan Format', 'Jadikan Acuan Format', 6),
                    ('Analisis Kelengkapan Dokumen', 'Analisis Kelengkapan Dokumen', 7),
                    ('Buatkan Ringkasan', 'Buatkan Ringkasan', 8),
                    ('Ringkasan+Notulen', 'Buatkan Ringkasan+Notulen', 9),
                    ('Ringkasan+Notulen+Word', 'Buatkan Ringkasan+Notulen+Word', 10);
                `);
                const [newRows] = await dbDashboard.query('SELECT * FROM nayaxa_widget_prompts WHERE is_active = 1 ORDER BY urutan ASC, id ASC');
                return res.json({ success: true, data: newRows });
            }

            res.json({ success: true, data: rows });
        } catch (error) {
            console.error('Error fetching Widget Prompts:', error);
            res.status(500).json({ success: false, message: 'Gagal mengambil daftar prompt widget' });
        }
    },

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
            session_id, current_page, page_title,
            coding_mode  // ← Coding Agent flag. Only sent by standalone Nayaxa frontend. Widget never sends this.
        } = req.body;

        // Support both old single-file and new multi-file format
        let attachmentList = files || [];
        if (fileBase64 && fileMimeType && attachmentList.length === 0) {
            attachmentList = [{ base64: fileBase64, mimeType: fileMimeType }];
        }

        console.log(`[Nayaxa] Chat Request: "${message.substring(0, 50)}..." | Attachments: ${attachmentList.length}`);
        if (attachmentList.length > 0) {
            console.log(`[Nayaxa] Attachment Types:`, attachmentList.map(f => f.mimeType || 'no-mime'));
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

            // --- FETCH METADATA FOR ROUTING ---
            const now = new Date();
            const month = now.getMonth() + 1;
            const year = now.getFullYear();
            const fullDate = now.toLocaleDateString('id-ID', { 
                weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
                hour: '2-digit', minute: '2-digit', hour12: false
            }) + ' WIB';

            const baseUrl = buildExportDownloadUrl(req, '');

            const [nama_instansi, userProfile, personaText, activity] = await Promise.all([
                nayaxaStandalone.getInstansiName(instansi_id),
                nayaxaStandalone.getPegawaiProfile(profil_id, user_name),
                personaService.getPersona(user_id),
                history.length === 1 ? nayaxaStandalone.getLastUserActivity(profil_id, user_id) : Promise.resolve(null)
            ]);

            const personaPromptSnippet = personaService.formatForPrompt(personaText);
            let lastActivityContext = null;
            if (activity) lastActivityContext = activity.description;

            // --- CENTRALIZED ROUTING (v6.0.0) ---
            const routingParams = {
                message, attachmentList, instansi_id, month, year, history, 
                user_name, profil_id, blueprintContext: '', current_page, 
                page_title, baseUrl, fullDate, nama_instansi, personaPromptSnippet, 
                userProfile, lastActivityContext, coding_mode: !!coding_mode, 
                activeSessionId, onStepCallback: null, signal: null
            };

            const routeResult = await nayaxaRoutingService.routeChat(routingParams);
            const responseText = routeResult.text;
            const brain = routeResult.brain;

            // 4. Save & Cache Response
            const contentToSave = responseText
                .replace(/<thought>[\s\S]*?<\/thought>/gi, '')
                .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
                .replace(/\[NAYAXA_CHART\][\s\S]*?\[\/NAYAXA_CHART\]/g, '[Grafik]')
                .replace(/\[ACTION:REQUEST_LOCATION\]/g, '');
            await dbNayaxa.query(
                'INSERT INTO nayaxa_chat_history (app_id, user_id, session_id, role, content, brain_used) VALUES (?, ?, ?, ?, ?, ?)', 
                [app_id, user_id, activeSessionId, 'model', contentToSave, brain]
            );

            const resultData = { success: true, text: responseText, brain_used: brain, session_id: activeSessionId };
            if (!hasFiles) chatResponseCache.set(chatCacheKey, { timestamp: Date.now(), data: resultData });

            // --- PERSONA: Fire-and-forget background update (NEVER blocks response) ---
            const simpleAiAnalyzer = (prompt) => nayaxaRoutingService.routeSimpleTask(prompt);
            personaService.triggerPersonaUpdate(user_id, user_name, activeSessionId, simpleAiAnalyzer);

            // --- TITLE GENERATION: Fire-and-forget background title update ---
            sessionTitleService.triggerTitleUpdate(app_id, user_id, activeSessionId, simpleAiAnalyzer);

            res.json(resultData);
        } catch (error) {
            console.error('Chat Error:', error);
            let userMessage = error.message;
            if (error.status === 400 || error.message?.includes('400')) {
                userMessage = "Maaf, permintaan Anda terlalu besar untuk diproses (mungkin karena file pendukung yang terlalu panjang). Silakan ringkas pertanyaan Anda atau gunakan file yang lebih kecil.";
            }
            res.status(500).json({ success: false, message: userMessage });
        } finally {

            releaseRequest();
        }
    },

    /**
     * Streaming Chat Endpoint (SSE) - EXCLUSIVELY for Nayaxa Standalone Frontend
     * The widget dashboard uses /chat (non-streaming). This endpoint is NEVER called by the widget.
     */
    chatStream: async (req, res) => {
        const {
            message, files,
            user_id, user_name, profil_id, instansi_id,
            session_id, current_page, page_title, coding_mode
        } = req.body;

        const attachmentList = files || [];
        const activeSessionId = session_id || `sess_${Date.now()}`;
        const app_id = req.nayaxaApp.id;

        // --- Setup SSE Headers ---
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no'); // Prevent Nginx from buffering

        const sendEvent = (event, data) => {
            try {
                res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
            } catch (e) { /* connection might be closed */ }
        };

        // --- IMMEDIATE HANDSHAKE (v4.8.1) ---
        // Flush headers and send initial progress immediately to prevent proxy timeouts
        res.flushHeaders();
        sendEvent('step', { icon: '⚡', label: 'Menghubungkan ke Nayaxa Brain...' });

        await queueRequest();
        try {
            // Save user message
            await dbNayaxa.query(
                'INSERT INTO nayaxa_chat_history (app_id, user_id, session_id, role, content) VALUES (?, ?, ?, ?, ?)',
                [app_id, user_id, activeSessionId, 'user', message]
            );

            // Load history
            console.log(`[Trace] Loading history for session: ${activeSessionId}`);
            const [historyRows] = await dbNayaxa.query(
                'SELECT role, content FROM nayaxa_chat_history WHERE session_id = ? ORDER BY created_at DESC LIMIT 30',
                [activeSessionId]
            );
            const history = historyRows.reverse().map(h => ({
                role: h.role === 'model' ? 'model' : 'user',
                parts: [{ text: h.content }]
            }));

            console.log(`[Trace] Fetching persona and profile data...`);
            const now = new Date();
            const month = now.getMonth() + 1;
            const year = now.getFullYear();
            const fullDate = now.toLocaleDateString('id-ID', { 
                weekday: 'long', 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
            }) + ' WIB';

            const baseUrl = buildExportDownloadUrl(req, '');

            const [nama_instansi, userProfile, personaText, activity] = await Promise.all([
                nayaxaStandalone.getInstansiName(instansi_id),
                nayaxaStandalone.getPegawaiProfile(profil_id, user_name),
                personaService.getPersona(user_id),
                history.length === 1 ? nayaxaStandalone.getLastUserActivity(profil_id, user_id) : Promise.resolve(null)
            ]);

            const personaPromptSnippet = personaService.formatForPrompt(personaText);
            let lastActivityContext = null;
            if (activity) {
                const [dupRows] = await dbNayaxa.query(
                    'SELECT id FROM nayaxa_chat_history WHERE user_id = ? AND content LIKE ? AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR) LIMIT 1',
                    [user_id, `%${activity.description}%`]
                );
                if (dupRows.length === 0) lastActivityContext = activity.description;
            }

            // Step callback: fire SSE event for each tool step or thought chunk
            let isInsideThought = false;
            const onStepCallback = (data) => {
                if (data.type === 'thought') {
                    sendEvent('thought', { text: data.text });
                } else if (data.type === 'message_chunk') {
                    let chunk = data.text;
                    
                    // --- NARRATIVE REDIRECTION ---
                    // If chunk contains <thought> or we are inside a manual thought block
                    if (chunk.includes('<thought>')) {
                        isInsideThought = true;
                        const [before, after] = chunk.split('<thought>');
                        if (before) sendEvent('message', { text: before });
                        if (after) {
                             if (after.includes('</thought>')) {
                                 const [thoughtText, remaining] = after.split('</thought>');
                                 sendEvent('thought', { text: thoughtText });
                                 isInsideThought = false;
                                 if (remaining) onStepCallback({ type: 'message_chunk', text: remaining });
                             } else {
                                 sendEvent('thought', { text: after });
                             }
                        }
                        return;
                    }
                    
                    if (isInsideThought) {
                        if (chunk.includes('</thought>')) {
                            const [thoughtText, remaining] = chunk.split('</thought>');
                            sendEvent('thought', { text: thoughtText });
                            isInsideThought = false;
                            if (remaining) onStepCallback({ type: 'message_chunk', text: remaining });
                        } else {
                            sendEvent('thought', { text: chunk });
                        }
                        return;
                    }

                    // --- REAL-TIME STREAMING FILTER ---
                    // Strip technical leaks immediately before sending to frontend
                    if (chunk.includes('<') || chunk.includes('|') || chunk.includes('DSML')) {
                        chunk = chunk.replace(/<\|[\s\S]*?\|>/g, '')
                                     .replace(/<[\s\S]*?DSML[\s\S]*?>/gi, '')
                                     .replace(/<[\s\S]*?invoke[\s\S]*?>/gi, '')
                                     .replace(/<[\s\S]*?function_calls[\s\S]*?>/gi, '');
                    }
                    if (chunk) sendEvent('message', { text: chunk });
                } else {
                    sendEvent('step', data);
                }
            };

            const abortController = new AbortController();
            const { signal } = abortController;

            // --- NATIVE STABILITY HARDENING ---
            req.socket.setKeepAlive(true);
            req.socket.setTimeout(0); // Disable timeout for long-running streams
            
            const heartbeatInterval = setInterval(() => {
                if (!res.writableEnded) {
                    // Send a formal event to be more active than just a comment
                    sendEvent('heartbeat', { alive: true, timestamp: Date.now() });
                }
            }, 5000);

            req.on('close', () => {
                clearInterval(heartbeatInterval);
                if (!res.writableEnded) {
                    console.log(`[SSE] Client disconnected for session: ${activeSessionId}`);
                    abortController.abort();
                }
            });

            let blueprintContext = '';
            if (coding_mode) {
                const blueprint = codeAgent.getProjectBlueprint();
                blueprintContext = `\nSTRUKTUR PROYEK (BLUEPRINT):\n${JSON.stringify(blueprint, null, 2)}\n`;
            }

            let responseText = '';
            let brainUsed = 'DeepSeek';

            const hasImages = attachmentList.some(f => 
                (f.mimeType && f.mimeType.startsWith('image/')) || 
                (f.name && /\.(png|jpg|jpeg|webp|gif|bmp)$/i.test(f.name))
            );
            const isDeepSeekEnabled = process.env.DEEPSEEK_ENABLED === 'true';
                   // --- CENTRALIZED ROUTING (v6.0.0) ---
            const routingParams = {
                message, attachmentList, instansi_id, month, year, history, 
                user_name, profil_id, blueprintContext, current_page, 
                page_title, baseUrl, fullDate, nama_instansi, personaPromptSnippet, 
                userProfile, lastActivityContext, coding_mode: !!coding_mode, 
                activeSessionId, onStepCallback, signal
            };

            const routeResult = await nayaxaRoutingService.routeChat(routingParams);
            responseText = routeResult.text;
            brainUsed = routeResult.brain;

            if (signal.aborted) return;

            // Save response
            const contentToSave = (responseText || "")
                .replace(/<thought>[\s\S]*?<\/thought>/gi, '')
                .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
                .replace(/\[NAYAXA_CHART\][\s\S]*?\[\/NAYAXA_CHART\]/g, '[Grafik]')
                .replace(/\[ACTION:REQUEST_LOCATION\]/g, '');
            await dbNayaxa.query(
                'INSERT INTO nayaxa_chat_history (app_id, user_id, session_id, role, content, brain_used) VALUES (?, ?, ?, ?, ?, ?)',
                [app_id, user_id, activeSessionId, 'model', contentToSave, brainUsed]
            );

            // Send final response
            let responseTextString = responseText || "";
            responseTextString = responseTextString.replace(/<thought>[\s\S]*?<\/thought>/gi, '');
            responseTextString = responseTextString.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
            responseTextString = responseTextString.replace(/<\|[\s\S]*?\|>/g, '');
            responseTextString = responseTextString.replace(/<[\s\S]*?DSML[\s\S]*?>/gi, '');
            responseTextString = responseTextString.replace(/<[\s\S]*?function_calls[\s\S]*?>/gi, '');
            responseTextString = responseTextString.replace(/<[\s\S]*?invoke[\s\S]*?>/gi, '');
            responseTextString = responseTextString.replace(/<[\s\S]*?parameter[\s\S]*?>/gi, '');
            responseTextString = responseTextString.trim();

            sendEvent('done', { text: responseTextString, brain_used: brainUsed, session_id: activeSessionId });

            // --- PERSONA & TITLE UPDATES: Fire-and-forget background updates ---
            const simpleAiAnalyzer = (prompt) => nayaxaRoutingService.routeSimpleTask(prompt);
            personaService.triggerPersonaUpdate(user_id, user_name, activeSessionId, simpleAiAnalyzer);
            sessionTitleService.triggerTitleUpdate(app_id, user_id, activeSessionId, simpleAiAnalyzer);

            res.end();

        } catch (error) {
            console.error('ChatStream Error:', error);
            try {
                await dbNayaxa.query(
                    'INSERT INTO nayaxa_mind_logs (task_name, status, message, started_at, finished_at) VALUES (?, ?, ?, NOW(), NOW())',
                    ['SSE Final Failure', 'FAILED', `Error: ${error.message} | Stack: ${error.stack?.substring(0, 500)}`]
                );
            } catch (dbErr) {}
            sendEvent('error', { message: error.message || 'Terjadi kesalahan pada Nayaxa.' });
            res.end();
        } finally {
            if (typeof heartbeatInterval !== 'undefined') clearInterval(heartbeatInterval);
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
                    COALESCE(
                        NULLIF(MAX(s.title), ''), 
                        SUBSTRING((
                            SELECT content FROM nayaxa_chat_history 
                            WHERE session_id = h.session_id 
                            ORDER BY id ASC LIMIT 1
                        ), 1, 50)
                    ) as title,
                    (p.id IS NOT NULL) as is_pinned
                 FROM nayaxa_chat_history h 
                 LEFT JOIN nayaxa_chat_sessions s ON h.session_id = s.session_id
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
            // Also clean up from pinned sessions if deleted
            await dbNayaxa.query(
                'DELETE FROM nayaxa_pinned_sessions WHERE session_id = ? AND app_id = ?',
                [session_id, app_id]
            );
            // Clean up session titles
            await dbNayaxa.query(
                'DELETE FROM nayaxa_chat_sessions WHERE session_id = ? AND app_id = ?',
                [session_id, app_id]
            );
            res.json({ success: true, message: 'Chat session deleted successfully.' });
        } catch (error) {
            console.error('Delete Session Error:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    },

    deleteChatSessionsBatch: async (req, res) => {
        try {
            const { session_ids } = req.body;
            const app_id = req.nayaxaApp.id;
            if (!session_ids || !Array.isArray(session_ids) || session_ids.length === 0) {
                return res.status(400).json({ success: false, message: 'Tidak ada sesi yang dipilih.' });
            }
            await dbNayaxa.query(
                'DELETE FROM nayaxa_chat_history WHERE session_id IN (?) AND app_id = ?',
                [session_ids, app_id]
            );
            // Also clean up from pinned sessions if deleted
            await dbNayaxa.query(
                'DELETE FROM nayaxa_pinned_sessions WHERE session_id IN (?) AND app_id = ?',
                [session_ids, app_id]
            );
            // Clean up session titles
            await dbNayaxa.query(
                'DELETE FROM nayaxa_chat_sessions WHERE session_id IN (?) AND app_id = ?',
                [session_ids, app_id]
            );
            res.json({ success: true, message: 'Chat sessions deleted successfully.' });
        } catch (error) {
            console.error('Delete Sessions Batch Error:', error);
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
            
            // 1. Try exact match
            let filePath = path.join(exportDir, filename);

            // 2. Fallback: Try sanitization matching and extension fallbacks
            if (!fs.existsSync(filePath)) {
                console.log(`[DOWNLOAD] Exact match not found for: "${filename}". Attempting sanitization and fuzzy fallbacks...`);
                
                // Fallback A: Standard sanitization matching (spaces -> _, strip non-alphanumeric/./_/-)
                const sanitized = filename.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9._-]/g, '');
                let fallbackPath = path.join(exportDir, sanitized);
                
                if (fs.existsSync(fallbackPath)) {
                    console.log(`[DOWNLOAD] Found via sanitization match: "${sanitized}"`);
                    filePath = fallbackPath;
                } else {
                    // Fallback B: Extension correction (adding ext if stripped or duplicated)
                    let ext = path.extname(filename).toLowerCase();
                    let safeName = sanitized;
                    if (ext && !sanitized.toLowerCase().endsWith(ext)) {
                        safeName = `${sanitized}${ext}`;
                    }
                    fallbackPath = path.join(exportDir, safeName);
                    
                    if (fs.existsSync(fallbackPath)) {
                        console.log(`[DOWNLOAD] Found via extension correction: "${safeName}"`);
                        filePath = fallbackPath;
                    } else {
                        // Fallback C: Alphanumeric core fuzzy matching (ignores casing, punctuation, and extra formatting)
                        try {
                            const files = fs.readdirSync(exportDir);
                            const coreQuery = filename.toLowerCase().replace(/[^a-z0-9]/gi, '');
                            const matchedFile = files.find(f => {
                                const coreF = f.toLowerCase().replace(/[^a-z0-9]/gi, '');
                                return coreF.includes(coreQuery) || coreQuery.includes(coreF);
                            });
                            
                            if (matchedFile) {
                                console.log(`[DOWNLOAD] Found via fuzzy matching: "${matchedFile}" for query: "${filename}"`);
                                filePath = path.join(exportDir, matchedFile);
                            }
                        } catch (dirErr) {
                            console.error('[DOWNLOAD] Directory listing fallback error:', dirErr);
                        }
                    }
                }
            }

            if (!fs.existsSync(filePath)) {
                console.warn(`[DOWNLOAD:404] File not found even after fuzzy fallbacks: "${filename}"`);
                return res.status(404).send('File not found.');
            }

            // Determine actual resolved filename
            const resolvedFilename = path.basename(filePath);

            // PDF Smart Preview: If it's a PDF, try to send as inline preview
            if (resolvedFilename.toLowerCase().endsWith('.pdf')) {
                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', 'inline; filename="' + resolvedFilename + '"');
                return res.sendFile(filePath);
            }

            res.download(filePath, resolvedFilename, (err) => {
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
    },

    exportSelectedMessages: async (req, res) => {
        try {
            const { messages, filename } = req.body;
            if (!messages || !Array.isArray(messages) || messages.length === 0) {
                return res.status(400).json({ success: false, message: 'Tidak ada pesan yang dipilih.' });
            }

            const exportService = require('../services/exportService');
            const fullContent = messages.join('\n\n');
            const downloadPath = await exportService.generateWord(fullContent, filename || 'Pilihan_Obrolan.docx');
            
            const downloadUrl = buildExportDownloadUrl(req, downloadPath);
            res.json({ success: true, download_url: downloadUrl });
        } catch (error) {
            console.error('Export Selected Messages Error:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    },

    getProposal: async (req, res) => {
        try {
            const { id } = req.params;
            const proposal = await proposalService.getProposal(id);
            if (!proposal) return res.status(404).json({ success: false, message: 'Proposal tidak ditemukan' });
            res.json({ success: true, proposal });
        } catch (err) { res.status(500).json({ success: false, message: err.message }); }
    },

    applyProposal: async (req, res) => {
        try {
            const { id } = req.params;
            const result = await proposalService.applyProposal(id);
            res.json(result);
        } catch (err) { res.status(500).json({ success: false, message: err.message }); }
    },

    rejectProposal: async (req, res) => {
        try {
            const { id } = req.params;
            const result = await proposalService.rejectProposal(id);
            res.json(result);
        } catch (err) { res.status(500).json({ success: false, message: err.message }); }
    },

    getProactiveInsight: async (req, res) => {
        const { current_page, instansi_id } = req.query;
        try {
            const now = new Date();
            const month = now.getMonth() + 1;
            const year = now.getFullYear();

            // Fetch minimal data for a quick proactive tip
            let tipsData = null;
            if (instansi_id) {
                try {
                    const stats = await nayaxaStandalone.getPegawaiStatistics(instansi_id, month, year);
                    tipsData = stats;
                } catch (e) { /* graceful — no tip if data unavailable */ }
            }

            const pageInsights = {
                dashboard: 'Pantau statistik kegiatan tim Anda dan identifikasi tren kinerja bulan ini.',
                kegiatan: 'Tambahkan kegiatan hari ini untuk menjaga akurasi laporan bulanan.',
                surat: 'Pastikan semua surat masuk sudah terdaftar dan terklasifikasi dengan benar.',
                default: `Saya siap membantu analisis data dan menjawab pertanyaan seputar kinerja instansi.`
            };

            const tip = pageInsights[current_page] || pageInsights.default;
            const activeCount = tipsData?.total_pegawai_aktif || null;
            const insight = activeCount
                ? `${tip} Saat ini terdapat **${activeCount} pegawai aktif** yang terdaftar.`
                : tip;

            res.json({ success: true, insight, page: current_page });
        } catch (error) {
            console.error('ProactiveInsight Error:', error);
            res.json({ success: true, insight: 'Halo! Ada yang bisa saya bantu hari ini?' });
        }
    },

    /**
     * Get usage statistics per application and user
     */
    getUsageStats: async (req, res) => {
        try {
            // 1. Get stats from Nayaxa Chat History (NAYAXA_DB)
            const [historyStats] = await dbNayaxa.query(`
                SELECT 
                    h.app_id, 
                    a.app_name, 
                    h.user_id, 
                    h.brain_used, 
                    COUNT(h.id) as message_count,
                    SUM(LENGTH(h.content)) as total_chars
                FROM nayaxa_chat_history h
                JOIN nayaxa_api_keys a ON h.app_id = a.id
                GROUP BY h.app_id, a.app_name, h.user_id, h.brain_used
            `);

            // 2. Get Daily Breakdown
            const [dailyStats] = await dbNayaxa.query(`
                SELECT 
                    h.app_id,
                    h.user_id,
                    DATE(h.created_at) as usage_date,
                    COUNT(h.id) as message_count,
                    SUM(LENGTH(h.content)) as total_chars,
                    h.brain_used
                FROM nayaxa_chat_history h
                GROUP BY h.app_id, h.user_id, DATE(h.created_at), h.brain_used
                ORDER BY usage_date DESC
            `);

            if (historyStats.length === 0) {
                return res.json({ success: true, data: [] });
            }

            // 3. Map user names from Dashboard DB (Join users with profil_pegawai)
            const userIds = [...new Set(historyStats.map(s => s.user_id))];

            let userMap = {};
            if (userIds.length > 0) {
                try {
                    const [rows] = await dbDashboard.query(`
                        SELECT u.id, p.nama_lengkap, u.username
                        FROM users u
                        LEFT JOIN profil_pegawai p ON u.profil_pegawai_id = p.id
                        WHERE u.id IN (?)
                    `, [userIds]);
                    rows.forEach(r => { 
                        userMap[r.id] = r.nama_lengkap || r.username; 
                    });
                } catch (dbErr) {
                    console.warn('[UsageStats] Dashboard DB user fetch failed:', dbErr.message);
                }
            }


            // 4. Constants for Cost
            const COST_DEEPSEEK = 0.20 / 1000000;
            const COST_GEMINI = 0.15 / 1000000;
            const CHARS_PER_TOKEN = 3.5;

            const apps = {};
            
            // Helper to calc tokens/cost
            const getCost = (chars, brain) => {
                const tokens = chars / CHARS_PER_TOKEN;
                const rate = (brain || '').toLowerCase().includes('deepseek') ? COST_DEEPSEEK : COST_GEMINI;
                return { tokens: Math.round(tokens), cost: tokens * rate };
            };

            historyStats.forEach(stat => {
                const appId = stat.app_id;
                if (!apps[appId]) {
                    apps[appId] = {
                        app_name: stat.app_name,
                        users: {}
                    };
                }

                const userId = stat.user_id;
                if (!apps[appId].users[userId]) {
                    apps[appId].users[userId] = {
                        user_id: userId,
                        user_name: userMap[userId] || `Personil #${userId}`,
                        message_count: 0,
                        total_tokens: 0,
                        estimated_cost: 0,
                        daily_usage: {}
                    };
                }

                const { tokens, cost } = getCost(stat.total_chars, stat.brain_used);
                apps[appId].users[userId].message_count += parseInt(stat.message_count);
                apps[appId].users[userId].total_tokens += tokens;
                apps[appId].users[userId].estimated_cost += cost;
            });

            // Fill daily usage
            dailyStats.forEach(stat => {
                const app = apps[stat.app_id];
                if (app && app.users[stat.user_id]) {
                    const user = app.users[stat.user_id];
                    const dateStr = new Date(stat.usage_date).toISOString().split('T')[0];
                    
                    if (!user.daily_usage[dateStr]) {
                        user.daily_usage[dateStr] = { date: dateStr, message_count: 0, total_tokens: 0, estimated_cost: 0 };
                    }

                    const { tokens, cost } = getCost(stat.total_chars, stat.brain_used);
                    user.daily_usage[dateStr].message_count += parseInt(stat.message_count);
                    user.daily_usage[dateStr].total_tokens += tokens;
                    user.daily_usage[dateStr].estimated_cost += cost;
                }
            });

            // Convert daily_usage map to sorted array and calculate Global Stats
            const globalDaily = {};
            Object.values(apps).forEach(app => {
                Object.values(app.users).forEach(user => {
                    user.daily_usage = Object.values(user.daily_usage).sort((a, b) => b.date.localeCompare(a.date));
                    
                    // Aggregate to Global
                    user.daily_usage.forEach(day => {
                        if (!globalDaily[day.date]) {
                            globalDaily[day.date] = { date: day.date, message_count: 0, total_tokens: 0, estimated_cost: 0 };
                        }
                        globalDaily[day.date].message_count += day.message_count;
                        globalDaily[day.date].total_tokens += day.total_tokens;
                        globalDaily[day.date].estimated_cost += day.estimated_cost;
                    });
                });
            });

            // Final Structure
            const result = Object.entries(apps).map(([id, app]) => ({
                app_id: parseInt(id),
                app_name: app.app_name.replace(/_/g, ' ').toUpperCase(),
                total_app_cost: Object.values(app.users).reduce((sum, u) => sum + u.estimated_cost, 0),
                total_app_messages: Object.values(app.users).reduce((sum, u) => sum + u.message_count, 0),
                users: Object.values(app.users).sort((a, b) => b.estimated_cost - a.estimated_cost)
            }));

            res.json({ 
                success: true, 
                data: result.sort((a, b) => b.total_app_cost - a.total_app_cost),
                global_daily: Object.values(globalDaily).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30) // Last 30 days
            });

        } catch (error) {
            console.error('Usage Stats Error:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    }

};


module.exports = nayaxaController;
