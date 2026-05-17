const dbDashboard = require('../config/dbDashboard');
const dbNayaxa = require('../config/dbNayaxa');
const mammoth = require('mammoth');
const XLSX = require('xlsx');
const pdf = require('pdf-parse');
const fs = require('fs');
const path = require('path');
const knowledgeTool = require('./knowledgeTool');
const nayaxaStandalone = require('./nayaxaStandalone');
const axios = require('axios');

const isLocal = process.platform === 'win32';
const DASHBOARD_UPLOADS = isLocal 
    ? path.join(__dirname, '../../../../copy-dashboard/Backend/uploads')
    : path.join(__dirname, '../../../../dashboard-ppm/Backend/uploads');

/**
 * Hybrid PDF Processor: Gemini as the Eyes, DeepSeek as the Brain (Orchestrated by Routing)
 */
const processHybridPdf = async (absolutePath, query = null) => {
    const nayaxaRoutingService = require('./nayaxaRoutingService');
    return await nayaxaRoutingService.routeAnalysis(absolutePath, query);
};

/**
 * Hybrid PDF Processor: Gemini as the Eyes, DeepSeek as the Brain (v4.7.0)
 */
const processHybridPdf_OLD = async (absolutePath, modelGemini, query = null) => {
    const nayaxaRoutingService = require('./nayaxaRoutingService');
    return await nayaxaRoutingService.routeAnalysis(absolutePath, query);
};

// --- HELPER CHUNKING & RELEVANCE SCORING (TF-IDF Hybrid style) ---
const chunkDocument = (text, size = 1000, overlap = 200) => {
    const chunks = [];
    let i = 0;
    while (i < text.length) {
        const chunk = text.slice(i, i + size);
        chunks.push(chunk);
        if (text.length - i <= size) break;
        i += (size - overlap);
    }
    return chunks;
};

const calculateRelevanceScore = (text, query) => {
    if (!query) return 0;
    const queryWords = query.toLowerCase()
        .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g,"")
        .split(/\s+/)
        .filter(w => w.length > 2);
    if (queryWords.length === 0) return 0;
    
    let score = 0;
    const lowerText = text.toLowerCase();
    queryWords.forEach(word => {
        try {
            const escapedWord = word.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
            const regex = new RegExp(escapedWord, 'g');
            const count = (lowerText.match(regex) || []).length;
            score += count * (word.length);
        } catch (e) {}
    });
    return score;
};

const isSummaryRequest = (query) => {
    if (!query) return true;
    return /rangkum|ringkas|summary|summarize|analisis komprehensif|master summary|kesimpulan|inti dari|poin-poin|seluruh isi/i.test(query);
};

const retrieveHybridContext = async (fileHash, query) => {
    let context = "";
    let isSaturated = false;

    try {
        const [configRows] = await dbNayaxa.query(
            "SELECT config_value FROM nayaxa_global_configs WHERE config_key = 'ENABLE_COLLABORATIVE_MEMORY' LIMIT 1"
        );
        const isMemEnabled = configRows.length > 0 ? configRows[0].config_value === '1' : true;

        let insights = [];
        if (isMemEnabled) {
            const [res] = await dbNayaxa.query(
                'SELECT sub_topic, summary, is_saturated, maturity_score FROM nayaxa_file_insights WHERE file_hash = ?',
                [fileHash]
            );
            insights = res;
        }

        let relevantInsight = null;
        if (insights.length > 0) {
            let maxScore = 0;
            insights.forEach(ins => {
                const score = calculateRelevanceScore(ins.sub_topic + " " + ins.summary, query);
                if (score > maxScore && score > 5) {
                    maxScore = score;
                    relevantInsight = ins;
                }
            });
        }

        if (relevantInsight) {
            console.log(`[Mind:RAG] Found relevant insight for topic "${relevantInsight.sub_topic}"`);
            context += `\n=== MEMORI PENGETAHUAN KOLABORATIF (${relevantInsight.sub_topic.toUpperCase()}) ===\n${relevantInsight.summary}\n`;
            if (relevantInsight.is_saturated === 1) {
                isSaturated = true;
            }
        }

        if (!isSaturated) {
            console.log(`[Mind:RAG] Insight not saturated. Scanning chunks...`);
            const [chunks] = await dbNayaxa.query(
                'SELECT chunk_content FROM nayaxa_file_chunks WHERE file_hash = ?',
                [fileHash]
            );

            if (chunks.length > 0) {
                const scoredChunks = chunks.map((c, idx) => ({
                    content: c.chunk_content,
                    score: calculateRelevanceScore(c.chunk_content, query),
                    index: idx
                }));

                const topChunks = scoredChunks
                    .filter(c => c.score > 0)
                    .sort((a, b) => b.score - a.score)
                    .slice(0, 8);

                const selectedChunks = topChunks.length > 0 ? topChunks : scoredChunks.slice(0, 4);

                context += `\n=== TEKS DOKUMEN ASLI ===\n` + selectedChunks.map(c => `[Fragmen #${c.index + 1}]\n${c.content}`).join('\n\n');
            }
        }

        return context;
    } catch (err) {
        console.error('[Mind:RAG] Error:', err.message);
        return "";
    }
};
const getNayaxaGeneralPersonaPrompt = (userProfile, user_name, lastActivityContext) => {
    return `Identitas ANDA: Nayaxa, asisten AI dari Bapperida yang dibuat oleh Sammy.
Gaya Bahasa: Sangat ceria, antusias, hangat, penuh semangat, profesional, dan empatik. Di akhir setiap penjelasan, SELALU tawarkan bantuan ekstra atau berikan satu pertanyaan pendek.
PENTING: DILARANG KERAS MENGGUNAKAN EMOJI APAPUN.
        
PENTING - ADAPTASI FORMALITAS: Sesuaikan tingkat formalitas Anda dengan Profil Kepribadian User (${userProfile?.detected_formality || 'Formal'}). 
- Meskipun tingkat formalitas disesuaikan (menggunakan Saya/Anda untuk user formal, atau Aku/Kamu/Gue/Lo untuk user santai), Anda **WAJIB tetap mempertahankan kepribadian yang ceria, ramah, optimis, dan penuh semangat**. Jangan biarkan bahasa formal membuat Anda terdengar kaku atau robotik. Tetaplah hangat dan ceria dalam menyampaikan saran!
- Jika user menggunakan gaya bahasa santai/akrab (seperti 'Aku/Kamu' atau 'Gue/Lo'), Anda WAJIB membalas dengan gaya yang setara (Akrab-Profesional). 
- Khusus untuk user 'Andin', gunakan gaya bahasa 'Aku/Kamu' yang hangat namun tetap sopan.
- Jika user formal, gunakan Saya/Anda.
${lastActivityContext ? `\nKONTEKS AKTIVITAS: "${lastActivityContext}"\nSapa user dengan hangat dan hubungkan dengan aktivitas tersebut.\n` : ''}`;
};

const getNayaxaProtokolPrompt = () => {
    return `
            - **METODOLOGI ANALISIS LANJUTAN (STRATEGI TEMPUR KOGNITIF - CLAUDE-STYLE)**:
                1. **⚔️ Multi-Perspective Self-Debate (Debat Internal)**: Sebelum menyusun kesimpulan akhir, lakukan "debat mandiri" secara internal di dalam tag <thought>. Analisis usulan Anda dari kacamata Auditor/BPK (aspek kepatuhan hukum & risiko) serta kacamata Kepala Dinas (aspek kepraktisan & efisiensi). Sajikan rekomendasi yang sudah disaring dari kelemahan taktis tersebut.
                2. **🧮 Quantitative Verification (Verifikasi Matematis)**: DILARANG keras menebak atau menghitung data kuantitatif secara mental. Gunakan formula matematis atau kueri database agregat secara internal di dalam <thought> sebelum memaparkan persentase, varians, atau total angka agar akurasi matematika 100% mutlak.
                3. **🌐 Cross-Document Synthesis (Sintesis Lintas Memori)**: Jika user menanyakan tentang perbandingan atau keselarasan, lakukan pencarian data sekunder dari tabel memori kolaboratif (nayaxa_file_insights) dokumen lain yang bertema serupa. Bandingkan draf kebijakan dengan aturan di atasnya tanpa memboroskan token dokumen mentah.
                4. **🔮 Scenario Mapping & "What-If" (Skenario Masa Depan)**: Dalam menyajikan rekomendasi, selalu petakan 3 skenario praktis: Skenario Optimis (jika usulan dijalankan penuh), Skenario Moderat (jika terbatas anggaran), dan Skenario Risiko (jika tidak mengambil tindakan/status quo).`;
};

const saveDocumentInsight = async (fileHash, subTopic, newInsight, userQuery) => {
    try {
        console.log(`[CollaborativeMemory] Checking document size for ${fileHash}...`);
        
        // Cek ukuran karakter dokumen asli dari cache
        const [cacheRows] = await dbNayaxa.query(
            "SELECT LENGTH(extracted_text) as char_length FROM nayaxa_file_cache WHERE file_hash = ? LIMIT 1",
            [fileHash]
        );

        if (cacheRows.length > 0) {
            const charLength = cacheRows[0].char_length || 0;
            if (charLength <= 50000) {
                console.log(`[CollaborativeMemory] Skipped. Document length (${charLength} chars) is under threshold (50,001+ chars).`);
                return { 
                    success: true, 
                    action: 'skipped', 
                    message: `Penyimpanan dilewati karena ukuran dokumen (${charLength} karakter) di bawah ambang batas minimum 50.001 karakter.` 
                };
            }
            console.log(`[CollaborativeMemory] Document length: ${charLength} chars. Proceeding with saving/merging...`);
        }

        const nayaxaRoutingService = require('./nayaxaRoutingService');
        const consolidatedSummary = await nayaxaRoutingService.routeConsolidation(subTopic, oldSummary, newInsight);
        if (!consolidatedSummary) {
            return { success: false, error: 'Empty AI Response' };
        }

        let score = 50;
        let summaryText = consolidatedSummary;

        const scoreMatch = consolidatedSummary.match(/===\s*SCORE\s*===[\s\r\n]*(\d+)/i);
        const summaryMatch = consolidatedSummary.match(/===\s*CONSOLIDATED\s*SUMMARY\s*===[\s\r\n]*([\s\S]*)/i);

        if (scoreMatch) score = parseInt(scoreMatch[1]);
        if (summaryMatch) summaryText = summaryMatch[1].trim();
        else summaryText = summaryText.replace(/===\s*SCORE\s*===[\s\S]*?===\s*CONSOLIDATED\s*SUMMARY\s*===/i, '').trim();

        const [thresholdRows] = await dbNayaxa.query(
            "SELECT config_value FROM nayaxa_global_configs WHERE config_key = 'KNOWLEDGE_SATURATION_THRESHOLD' LIMIT 1"
        );
        const threshold = thresholdRows.length > 0 ? parseInt(thresholdRows[0].config_value) : 90;

        const isSaturated = score >= threshold ? 1 : 0;

        if (existing.length === 0) {
            await dbNayaxa.query(
                'INSERT INTO nayaxa_file_insights (file_hash, sub_topic, summary, raw_logs, maturity_score, is_saturated) VALUES (?, ?, ?, ?, ?, ?)',
                [fileHash, subTopic, summaryText, JSON.stringify(logs), score, isSaturated]
            );
            console.log(`[CollaborativeMemory] Successfully created new insight topic: "${subTopic}" with confidence score ${score}% (Saturated: ${isSaturated})`);
            return { success: true, action: 'created', maturity: score, saturated: isSaturated };
        } else {
            await dbNayaxa.query(
                'UPDATE nayaxa_file_insights SET summary = ?, raw_logs = ?, maturity_score = ?, is_saturated = ? WHERE id = ?',
                [summaryText, JSON.stringify(logs), score, isSaturated, rowId]
            );
            console.log(`[CollaborativeMemory] Successfully merged insight for topic "${subTopic}". New Confidence Score: ${score}% (Saturated: ${isSaturated})`);
            return { success: true, action: 'merged', maturity: score, saturated: isSaturated };
        }

    } catch (err) {
        console.error('[CollaborativeMemory_Save_Error]:', err.message);
        return { success: false, error: err.message };
    }
};

const nayaxaMindService = {
    /**
     * Main heart of Nayaxa Mind - Process all new documents
     */
    learnNewDocuments: async () => {
        const logId = await nayaxaMindService.startLog('Document Learning');
        try {
            console.log('[Mind] Scanning for new documents...');
            const [newFiles] = await dbDashboard.query('SELECT id, nama_file, path FROM dokumen_upload WHERE is_indexed = 0 AND is_deleted = 0 LIMIT 10');
            
            if (newFiles.length === 0) {
                await nayaxaMindService.finishLog(logId, 'SUCCESS', 'No new documents to index.');
                return;
            }

            const apiKey = await getApiKey();
            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-2.5-flash' });

            for (const file of newFiles) {
                console.log(`[Mind] Learning document: ${file.nama_file}`);
                // Fix: Point to dashboard uploads folder
                const fileName = path.basename(file.path);
                const absolutePath = path.join(DASHBOARD_UPLOADS, fileName);
                
                if (!fs.existsSync(absolutePath)) {
                    console.warn(`[Mind] File not found: ${absolutePath}`);
                    await dbDashboard.query('UPDATE dokumen_upload SET is_indexed = -1 WHERE id = ?', [file.id]); // Mark as error
                    continue;
                }

                let textContent = "";
                const ext = path.extname(file.nama_file).toLowerCase();

                try {
                    if (ext === '.docx' || ext === '.doc') {
                        const buffer = fs.readFileSync(absolutePath);
                        const result = await mammoth.convertToHtml({ buffer });
                        textContent = result.value;
                    } else if (ext === '.xlsx' || ext === '.xls' || ext === '.csv') {
                        const workbook = XLSX.readFile(absolutePath);
                        workbook.SheetNames.forEach(sheetName => {
                            const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName]);
                            textContent += `\n--- Sheet: ${sheetName} ---\n${csv}\n`;
                        });
                    } else if (ext === '.pdf' || ext === '.png' || ext === '.jpg' || ext === '.jpeg') {
                        // Use Gemini inlineData for vision/PDF capabilities
                        const buffer = fs.readFileSync(absolutePath);
                        const base64 = buffer.toString('base64');
                        const mimeType = ext === '.pdf' ? 'application/pdf' : `image/${ext.replace('.','')}`;
                        
                        const prompt = "Berikan ringkasan mendalam (inti sari) dari dokumen ini agar saya (AI Nayaxa) bisa memahaminya sebagai bagian dari memori jangka panjang saya. Fokus pada fakta, angka, dan aturan penting.";
                        const result = await model.generateContent([
                            { text: prompt },
                            { inlineData: { mimeType, data: base64 } }
                        ]);
                        textContent = result.response.text();
                    } else {
                        // Plain text
                        textContent = fs.readFileSync(absolutePath, 'utf8');
                    }

                    if (textContent && textContent.trim()) {
                        // Summarize if it's raw text (not summarized by Gemini yet)
                        if (ext !== '.pdf' && ext !== '.png' && ext !== '.jpg' && ext !== '.jpeg') {
                             const summaryResult = await model.generateContent(`Ringkas isi dokumen berikut untuk memori Nayaxa Mind (fokus pada poin-poin penting dan fakta): \n\n${textContent.substring(0, 30000)}`);
                             textContent = summaryResult.response.text();
                        }

                        // Save to Knowledge
                        await knowledgeTool.ingestToKnowledge(1, 'Nayaxa Mind - Auto Learn', textContent, file.nama_file);
                    }

                    // Mark as indexed
                    await dbDashboard.query('UPDATE dokumen_upload SET is_indexed = 1 WHERE id = ?', [file.id]);
                    console.log(`[Mind] Successfully indexed: ${file.nama_file}`);

                } catch (err) {
                    console.error(`[Mind] Error indexing ${file.nama_file}:`, err);
                    await dbDashboard.query('UPDATE dokumen_upload SET is_indexed = -1 WHERE id = ?', [file.id]);
                }
            }

            await nayaxaMindService.finishLog(logId, 'SUCCESS', `Indexed ${newFiles.length} documents.`);
        } catch (error) {
            console.error('[Mind] Critical Document Learning Error:', error);
            await nayaxaMindService.finishLog(logId, 'FAILED', error.message);
        }
    },

    /**
     * Check if database has meaningful updates since last snapshot
     */
    checkDatabaseChanges: async () => {
        try {
            // Get combined signature of core tables
            const [rows] = await dbDashboard.query(`
                SELECT 
                    (SELECT COUNT(*) FROM kegiatan_harian_pegawai) as count_kegiatan,
                    (SELECT DATE_FORMAT(MAX(updated_at), '%Y-%m-%d %H:%i:%s') FROM kegiatan_harian_pegawai) as last_update_kegiatan
            `);
            const currentSignature = `${rows[0].count_kegiatan}_${rows[0].last_update_kegiatan}`;

            // Check last successful log
            const [logs] = await dbDashboard.query(`
                SELECT message FROM nayaxa_mind_logs 
                WHERE task_name = 'System Snapshot' AND status = 'SUCCESS' 
                ORDER BY id DESC LIMIT 1
            `);

            if (logs.length > 0) {
                const lastMessage = logs[0].message;
                if (lastMessage.includes(`[Sig: ${currentSignature}]`)) {
                    return { changed: false, signature: currentSignature };
                }
            }

            return { changed: true, signature: currentSignature };
        } catch (e) {
            console.error('[Mind] Error checking DB changes:', e);
            return { changed: true, signature: 'error' }; // Default to true on error to be safe
        }
    },

    /**
     * Periodic snapshot of system trends
     */
    generateSystemSnapshot: async () => {
        const logId = await nayaxaMindService.startLog('System Snapshot');
        try {
            const dbStatus = await nayaxaMindService.checkDatabaseChanges();
            
            if (!dbStatus.changed) {
                console.log('[Mind] No database changes detected. Skipping snapshot to save tokens.');
                await nayaxaMindService.finishLog(logId, 'SUCCESS', `Skipped. No changes since last snapshot. [Sig: ${dbStatus.signature}]`);
                return;
            }

            console.log('[Mind] Database changes detected. Generating System Snapshot...');
            const now = new Date();
            const month = now.getMonth() + 1;
            const year = now.getFullYear();

            // 1. Fetch System-Wide Stats (All Agencies)
            const [sysStats, sysForecast, sysAlerts] = await Promise.all([
                nayaxaStandalone.getPegawaiStatistics(null, month, year),
                nayaxaStandalone.forecastTrends(null, month, year),
                nayaxaStandalone.detectAnomalies(null)
            ]);

            // 2. Fetch Bapperida Specific Stats (Main Agency)
            const [bapStats, bapForecast, bapAlerts] = await Promise.all([
                nayaxaStandalone.getPegawaiStatistics(2, month, year),
                nayaxaStandalone.forecastTrends(2, month, year),
                nayaxaStandalone.detectAnomalies(2)
            ]);

            const nayaxaRoutingService = require('./nayaxaRoutingService');
            // Analyze System-Wide
            const sysPrompt = `Analisis data statistik SELURUH SISTEM (Bulan ${month} Tahun ${year}). Data: ${JSON.stringify({ stats: sysStats, forecast: sysForecast, alerts: sysAlerts })}`;
            const sysInsight = await nayaxaRoutingService.routeSimpleTask(sysPrompt);

            // Analyze Bapperida Specific
            const bapPrompt = `Analisis data statistik BAPPERIDA (Bulan ${month} Tahun ${year}). Data: ${JSON.stringify({ stats: bapStats, forecast: bapForecast, alerts: bapAlerts })}`;
            const bapInsight = await nayaxaRoutingService.routeSimpleTask(bapPrompt);

            // Save to Knowledge Base with clear categorization
            await Promise.all([
                knowledgeTool.ingestToKnowledge(1, 'System Snapshot - Global', sysInsight, `Global-Snapshot-${month}-${year}`),
                knowledgeTool.ingestToKnowledge(1, 'System Snapshot - Bapperida', bapInsight, `Bapperida-Snapshot-${month}-${year}`)
            ]);
            
            await nayaxaMindService.finishLog(logId, 'SUCCESS', `System and Bapperida snapshots complete. [Sig: ${dbStatus.signature}]`);
        } catch (error) {
            console.error('[Mind] Critical Snapshot Error:', error);
            await nayaxaMindService.finishLog(logId, 'FAILED', error.message);
        }
    },

    /**
     * Helper: Start logging a task
     */
    startLog: async (taskName) => {
        try {
            const [result] = await dbDashboard.query(
                'INSERT INTO nayaxa_mind_logs (task_name, status, started_at) VALUES (?, ?, NOW())',
                [taskName, 'RUNNING']
            );
            return result.insertId;
        } catch (e) { return null; }
    },

    /**
     * Helper: Finish logging a task
     */
    finishLog: async (id, status, message) => {
        try {
            if (!id) return;
            await dbDashboard.query(
                'UPDATE nayaxa_mind_logs SET status = ?, message = ?, finished_at = NOW() WHERE id = ?',
                [status, message, id]
            );
        } catch (e) {}
    },

    /**
     * Helper: Learn a specific document from the dashboard
     * This is used for on-demand ingestion to save tokens.
     */
    analyzeAndIngestDocument: async (fileId, appId = 1, query = null, onStepCallback = null) => {
        try {
            if (onStepCallback) onStepCallback({ icon: '🔍', label: 'Memulai analisis dokumen mendalam...' });

            const [files] = await dbDashboard.query(
                'SELECT id, nama_file, path FROM dokumen_upload WHERE id = ? AND is_deleted = 0',
                [fileId]
            );

            if (files.length === 0) return { success: false, message: "Dokumen tidak ditemukan di database." };
            const file = files[0];

            console.log(`[Mind] On-demand learning: ${file.nama_file}`);
            // Fix: Point to dashboard uploads folder
            const fileName = path.basename(file.path);
            const absolutePath = path.join(DASHBOARD_UPLOADS, fileName);
            
            if (!fs.existsSync(absolutePath)) {
                return { success: false, message: `File fisik tidak ditemukan: ${file.path}` };
            }

            // --- COGNITIVE FAST-TRACK RETRIEVAL GATE (v4.6.6) ---
            const crypto = require('crypto');
            const buffer = fs.readFileSync(absolutePath);
            const fileHash = crypto.createHash('sha256').update(buffer).digest('hex');

            // 1. Check if we already have a mature/saturated insight for this document hash
            const [insightRows] = await dbNayaxa.query(
                "SELECT summary, sub_topic FROM nayaxa_file_insights WHERE file_hash = ? AND is_saturated = 1 LIMIT 1",
                [fileHash]
            );

            if (insightRows.length > 0) {
                console.log(`[Mind:FastTrack] HIT saturated memory for "${file.nama_file}". Returning instant memory.`);
                if (query && !isSummaryRequest(query)) {
                    console.log(`[Mind:RAG] Saturated memory found, but specific query requested. Using RAG.`);
                    const hybridContext = await retrieveHybridContext(fileHash, query);
                    return { success: true, content: hybridContext, source: file.nama_file, is_cached: true };
                }
                return {
                    success: true,
                    content: `=== MEMORI MATANG KOLABORATIF (${insightRows[0].sub_topic.toUpperCase()}) ===\n\n${insightRows[0].summary}`,
                    source: file.nama_file,
                    is_cached: true
                };
            }

            // 2. Fallback to cached text/master summary if available
            const [cacheRows] = await dbNayaxa.query(
                "SELECT extracted_text, master_summary FROM nayaxa_file_cache WHERE file_hash = ? LIMIT 1",
                [fileHash]
            );

            if (cacheRows.length > 0) {
                console.log(`[Mind:FastTrack] HIT extracted_text cache for "${file.nama_file}".`);
                if (query && !isSummaryRequest(query)) {
                    console.log(`[Mind:RAG] Cache text found, specific query requested. Using RAG.`);
                    const hybridContext = await retrieveHybridContext(fileHash, query);
                    return { success: true, content: hybridContext, source: file.nama_file, is_cached: true };
                }
                
                // If summary requested
                const summaryToReturn = cacheRows[0].master_summary || (cacheRows[0].extracted_text ? cacheRows[0].extracted_text.substring(0, 15000) : "Dokumen telah diindeks.");
                return {
                    success: true,
                    content: summaryToReturn,
                    source: file.nama_file,
                    is_cached: true
                };
            }
            // --- END COGNITIVE GATE ---

            // --- UNIFIED ROUTING PROTOCOL (v4.9.0) ---
            // Route all document analyses through the central central AI brain router (routeChat)
            // to ensure identical analysis routes, text extraction, fallbacks, and intelligence level.
            const nayaxaRoutingService = require('./nayaxaRoutingService');
            
            const stats = fs.statSync(absolutePath);
            const ext = path.extname(file.nama_file).toLowerCase();
            let mimeType = 'application/octet-stream';
            if (ext === '.pdf') mimeType = 'application/pdf';
            else if (ext === '.docx') mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
            else if (ext === '.doc') mimeType = 'application/msword';
            else if (ext === '.xlsx') mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
            else if (ext === '.xls') mimeType = 'application/vnd.ms-excel';
            else if (ext === '.csv') mimeType = 'text/csv';
            else if (ext === '.png') mimeType = 'image/png';
            else if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
            else if (ext === '.txt') mimeType = 'text/plain';

            const routeParams = {
                message: query || "Berikan ringkasan eksekutif mendalam (inti sari) dari dokumen berikut. Fokus pada fakta, angka, dan aturan penting.",
                attachmentList: [{
                    name: file.nama_file,
                    base64: buffer.toString('base64'),
                    mimeType: mimeType,
                    size: stats.size
                }],
                instansi_id: appId,
                month: new Date().getMonth() + 1,
                year: new Date().getFullYear(),
                history: [],
                user_name: "System",
                profil_id: null,
                onStepCallback: onStepCallback,
                activeSessionId: 'analysis_brain'
            };

            const routingResult = await nayaxaRoutingService.routeChat(routeParams);
            let summaryContent = routingResult ? routingResult.text : "";

            if (summaryContent && summaryContent.trim()) {
                // Save to Knowledge Base
                await knowledgeTool.ingestToKnowledge(appId, 'Dashboard Analysis', summaryContent, file.nama_file);
                
                // Mark as indexed in dashboard
                await dbDashboard.query('UPDATE dokumen_upload SET is_indexed = 1 WHERE id = ?', [file.id]);

                // Update cache table master_summary if it's a summary request
                if (!query || isSummaryRequest(query)) {
                    await dbNayaxa.query(
                        'INSERT IGNORE INTO nayaxa_file_cache (file_hash, file_name, extracted_text) VALUES (?, ?, "")',
                        [fileHash, file.nama_file]
                    );
                    await dbNayaxa.query(
                        'UPDATE nayaxa_file_cache SET master_summary = ? WHERE file_hash = ?',
                        [summaryContent, fileHash]
                    );
                }

                return {
                    success: true,
                    content: summaryContent,
                    source: file.nama_file
                };
            }

            return { success: false, message: "Gagal memproses dokumen melalui Central AI Router." };
        } catch (error) {
            console.error('[Mind] Single Ingestion Error:', error);
            return { success: false, error: error.message };
        }
    },

    /**
     * Main Initializer
     */
    init: (intervalMinutes = 60) => {
        console.log(`[Mind] System initialized. Pulse every ${intervalMinutes} minutes.`);
        
        // Immediate first run (deferred 10sec to let server start)
        setTimeout(async () => {
            // learnNewDocuments DISABLED to save tokens. Use on-demand ingestion instead.
            // await nayaxaMindService.learnNewDocuments(); 
            await nayaxaMindService.generateSystemSnapshot();
        }, 10000);

        // Periodic Interval (Snapshot logic only)
        setInterval(async () => {
            await nayaxaMindService.generateSystemSnapshot();
        }, intervalMinutes * 60 * 1000);
    },

    getNayaxaGeneralPersonaPrompt,
    getNayaxaProtokolPrompt,
    saveDocumentInsight
};

module.exports = nayaxaMindService;
