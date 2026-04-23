const nayaxaGemini = require('../services/nayaxaGeminiService');
const nayaxaDeepSeek = require('../services/nayaxaDeepSeekService');
const nayaxaStandalone = require('../services/nayaxaStandalone');
const personaService = require('../services/personaService');
const dbNayaxa = require('../config/dbNayaxa');
const dbDashboard = require('../config/dbDashboard');
const codeAgent = require('../services/codeAgentService');
const pdf = require('pdf-parse');

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
            // --- SMART SENSING: Identify PDF Type (Text vs Scan) ---
            let hasScannedPdf = false;
            for (const file of attachmentList) {
                if (file.mimeType?.includes('pdf')) {
                    try {
                        const cleanB64 = file.base64.includes('base64,') ? file.base64.split('base64,')[1] : file.base64;
                        const buffer = Buffer.from(cleanB64, 'base64');
                        const pdfData = await pdf(buffer);
                        const textLength = pdfData.text?.trim().length || 0;
                        
                        if (textLength < 100) {
                            console.log(`[SmartSensing] PDF "${file.name}" identified as SCANNED (Text length: ${textLength}). Routing to Gemini.`);
                            hasScannedPdf = true;
                        } else {
                            console.log(`[SmartSensing] PDF "${file.name}" identified as TEXTUAL (Text length: ${textLength}). Routing to DeepSeek.`);
                        }
                    } catch (e) {
                        console.warn(`[SmartSensing] Failed to peak into PDF: ${e.message}`);
                        hasScannedPdf = true; // Safety fallback to Gemini if parsing fails
                    }
                }
            }

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
            // --- Parallel Data Fetching for Context ---
            const [nama_instansi, userProfile, personaText, activity] = await Promise.all([
                nayaxaStandalone.getInstansiName(instansi_id),
                nayaxaStandalone.getPegawaiProfile(profil_id, user_name),
                personaService.getPersona(user_id),
                history.length === 1 ? nayaxaStandalone.getLastUserActivity(profil_id, user_id) : Promise.resolve(null)
            ]);

            const personaPromptSnippet = personaService.formatForPrompt(personaText);

            // --- CONTEXT: Fetch Latest Activity (Contextual Greeting) ---
            let lastActivityContext = null;
            if (activity) {
                // Anti-Repetition: Check recent history (last 1 hour) to see if this activity was already greeted
                const [dupRows] = await dbNayaxa.query(
                    'SELECT id FROM nayaxa_chat_history WHERE user_id = ? AND content LIKE ? AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR) LIMIT 1',
                    [user_id, `%${activity.description}%`]
                );
                if (dupRows.length === 0) {
                    lastActivityContext = activity.description;
                }
            }

            const isDeepSeekEnabled = process.env.DEEPSEEK_ENABLED === 'true';
            const hasImages = attachmentList.some(f => 
                (f.mimeType && f.mimeType.startsWith('image/')) || 
                (f.name && /\.(png|jpg|jpeg|webp|gif|bmp)$/i.test(f.name))
            );
            const isEditorFeedback = message.includes('[NAYAXA_EDITOR_FEEDBACK]');
            
            // ROUTING LOGIC:
            // 1. If contains IMAGES or SCANNED PDFs (OCR required) -> Always Use Gemini (Vision)
            // 2. Otherwise if it's Editor Feedback -> Prefer DeepSeek (for doc tools)
            // 3. Otherwise if DeepSeek is enabled -> Use DeepSeek (Absolute priority for text/logic)
            let isDeepSeekPrefered = isDeepSeekEnabled && !hasImages && !hasScannedPdf;
            
            // Force DeepSeek for text-only queries
            if (!hasImages && !hasFiles && isDeepSeekEnabled) {
                isDeepSeekPrefered = true;
            }

            const tryGemini = async (isFallback = false) => {
                brain = isFallback ? 'Gemini (Fallback)' : 'Gemini';
                return await nayaxaGemini.chatWithNayaxa(
                     message, attachmentList, instansi_id, month, year, history, user_name, profil_id, 
                     '', current_page, page_title, baseUrl, fullDate, nama_instansi, personaPromptSnippet, 
                     userProfile, lastActivityContext, !!coding_mode, activeSessionId
                );
            };

            const tryDeepSeek = async (isFallback = false) => {
                brain = isFallback ? 'DeepSeek (Fallback)' : 'DeepSeek';
                // Clean up attachment context: DeepSeek handles text better
                const textOnlyAttachments = attachmentList.filter(f => !f.mimeType?.includes('image'));
                
                try {
                    return await nayaxaDeepSeek.chatWithNayaxa(
                        message, textOnlyAttachments, instansi_id, month, year, history, user_name, profil_id, 
                        '', current_page, page_title, baseUrl, fullDate, nama_instansi, personaPromptSnippet, 
                        userProfile, lastActivityContext, !!coding_mode, activeSessionId
                    );
                } catch (err) {
                    console.error('[DeepSeek Service Error]:', err.message);
                    throw err;
                }
            };

            if (isDeepSeekPrefered) {
                try {
                    // Try DeepSeek first for text/docs
                    responseText = await tryDeepSeek();
                } catch (dsError) {
                    console.warn(`[Nayaxa] DeepSeek issue: ${dsError.message}. Falling back to Gemini...`);
                    try {
                        // Fallback to Gemini only if absolutely necessary
                        responseText = await tryGemini(true);
                    } catch (geminiError) {
                        // If backup engine also fails (e.g. leaked key), throw a friendly error
                        console.error('[Nayaxa] Both engines failed:', geminiError.message);
                        if (geminiError.message?.includes('leaked')) {
                            throw new Error("Nayaxa Engine sedang mengalami gangguan teknis pada sistem cadangan. Kami sedang memperbaikinya. Mohon gunakan kueri singkat sementara waktu.");
                        }
                        throw geminiError;
                    }
                }
            } else {
                try {
                    // Try Gemini first for images or if DeepSeek is disabled
                    responseText = await tryGemini();
                } catch (geminiError) {
                    const status = geminiError.status || geminiError.response?.status;
                    const isGeminiOverloaded = status === 503 || status === 429 || 
                                              geminiError.message?.includes('503') || geminiError.message?.includes('429') ||
                                              geminiError.message?.includes('leaked');
                    
                    if (isGeminiOverloaded && isDeepSeekEnabled && !hasImages) {
                        console.warn('[Nayaxa] Gemini failed/leaked, falling back to DeepSeek...');
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
        res.flushHeaders();

        const sendEvent = (event, data) => {
            try {
                res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
            } catch (e) { /* connection might be closed */ }
        };

        await queueRequest();
        try {
            // --- SMART SENSING: Identify PDF Type (Text vs Scan) ---
            let hasScannedPdf = false;
            const pdfFiles = attachmentList.filter(f => f.mimeType?.includes('pdf'));
            if (pdfFiles.length > 0) {
                sendEvent('step', { icon: '📄', label: `Membaca ${pdfFiles.length} file PDF...` });
            }
            
            for (const file of attachmentList) {
                if (file.mimeType?.includes('pdf')) {
                    try {
                        const cleanB64 = file.base64.includes('base64,') ? file.base64.split('base64,')[1] : file.base64;
                        const buffer = Buffer.from(cleanB64, 'base64');
                        const pdfData = await pdf(buffer);
                        const textLength = pdfData.text?.trim().length || 0;
                        
                        if (textLength < 100) {
                            console.log(`[SmartSensing_SSE] PDF "${file.name}" identified as SCANNED (Text length: ${textLength}). Routing to Gemini.`);
                            hasScannedPdf = true;
                        } else {
                            console.log(`[SmartSensing_SSE] PDF "${file.name}" identified as TEXTUAL (Text length: ${textLength}). Routing to DeepSeek.`);
                        }
                    } catch (e) {
                        console.warn(`[SmartSensing_SSE] Failed to peak into PDF: ${e.message}`);
                        hasScannedPdf = true; // Safety fallback to Gemini if parsing fails
                    }
                }
            }
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
            const fullDate = now.toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

            const protocol = req.get('x-forwarded-proto') || req.protocol;
            const host = req.get('host');
            const baseUrl = `${protocol}://${host}`;

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
            const onStepCallback = (data) => {
                if (data.type === 'thought') {
                    sendEvent('thought', { text: data.text });
                } else if (data.type === 'message_chunk') {
                    // --- REAL-TIME STREAMING FILTER ---
                    // Strip technical leaks immediately before sending to frontend
                    let chunk = data.text;
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
            
            // ROUTING: Use Gemini for images or scanned PDFs, otherwise try DeepSeek
            const useDeepSeek = isDeepSeekEnabled && !hasImages && !hasScannedPdf;
            console.log(`[Trace] Routing decision: ${useDeepSeek ? 'DeepSeek' : 'Gemini'} | hasImages=${hasImages}, hasScannedPdf=${hasScannedPdf}`);

            try {
                if (useDeepSeek) {
                    console.log(`[Trace] Starting DeepSeek call...`);
                    brainUsed = 'DeepSeek';
                    const textOnlyAttachments = attachmentList.filter(f => !f.mimeType?.includes('image'));
                    responseText = await nayaxaDeepSeek.chatWithNayaxa(
                        message, textOnlyAttachments, instansi_id, month, year, history, user_name, profil_id,
                        blueprintContext, current_page, page_title, baseUrl, fullDate, nama_instansi, personaPromptSnippet,
                        userProfile, lastActivityContext, !!coding_mode, activeSessionId, onStepCallback, signal
                    );
                } else {
                    brainUsed = 'Gemini';
                    responseText = await nayaxaGemini.chatWithNayaxa(
                        message, attachmentList, instansi_id, month, year, history, user_name, profil_id,
                        blueprintContext, current_page, page_title, baseUrl, fullDate, nama_instansi, personaPromptSnippet,
                        userProfile, lastActivityContext, !!coding_mode, activeSessionId, onStepCallback, signal
                    );
                }
            } catch (err) {
                console.error('[Nayaxa_SSE_Error] Primary model failed, trying fallback...', err.message);
                
                if (brainUsed === 'DeepSeek') {
                    brainUsed = 'Gemini (Fallback)';
                    sendEvent('step', { icon: '🔄', label: 'Menyiapkan otak cadangan untuk analisis...' });
                    responseText = await nayaxaGemini.chatWithNayaxa(
                        message, attachmentList, instansi_id, month, year, history, user_name, profil_id,
                        blueprintContext, current_page, page_title, baseUrl, fullDate, nama_instansi, personaPromptSnippet,
                        userProfile, lastActivityContext, !!coding_mode, activeSessionId, onStepCallback, signal
                    );
                } else {
                    // Gemini failed, try DeepSeek if no images
                    if (!hasImages && isDeepSeekEnabled) {
                        brainUsed = 'DeepSeek (Fallback)';
                        sendEvent('step', { icon: '🔄', label: 'Sedang mencari rute alternatif...' });
                        responseText = await nayaxaDeepSeek.chatWithNayaxa(
                            message, [], instansi_id, month, year, history, user_name, profil_id,
                            blueprintContext, current_page, page_title, baseUrl, fullDate, nama_instansi, personaPromptSnippet,
                            userProfile, lastActivityContext, !!coding_mode, activeSessionId, onStepCallback, signal
                        );
                    } else {
                        throw err;
                    }
                }
            }

            if (signal.aborted) return;

            // Save response
            const contentToSave = responseText
                .replace(/\[NAYAXA_CHART\][\s\S]*?\[\/NAYAXA_CHART\]/g, '[Grafik]')
                .replace(/\[ACTION:REQUEST_LOCATION\]/g, '');
            await dbNayaxa.query(
                'INSERT INTO nayaxa_chat_history (app_id, user_id, session_id, role, content, brain_used) VALUES (?, ?, ?, ?, ?, ?)',
                [app_id, user_id, activeSessionId, 'model', contentToSave, brainUsed]
            );

            // Send final response
            // --- CENTRALIZED CLEANUP ---
            // Remove any leaked technical tags or DSML robot-speak
            responseText = responseText.replace(/<\|[\s\S]*?\|>/g, '');
            responseText = responseText.replace(/<[\s\S]*?DSML[\s\S]*?>/gi, '');
            responseText = responseText.replace(/<[\s\S]*?function_calls[\s\S]*?>/gi, '');
            responseText = responseText.replace(/<[\s\S]*?invoke[\s\S]*?>/gi, '');
            responseText = responseText.replace(/<[\s\S]*?parameter[\s\S]*?>/gi, '');
            responseText = responseText.trim();

            sendEvent('done', { text: responseText, brain_used: brainUsed, session_id: activeSessionId });
            res.end();

        } catch (error) {
            console.error('ChatStream Error:', error);
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

            // PDF Smart Preview: If it's a PDF, try to send as inline preview
            if (filename.toLowerCase().endsWith('.pdf')) {
                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', 'inline; filename="' + filename + '"');
                return res.sendFile(filePath);
            }

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
    }
};


module.exports = nayaxaController;
