const dbDashboard = require('../config/dbDashboard');
const dbNayaxa = require('../config/dbNayaxa');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const mammoth = require('mammoth');
const XLSX = require('xlsx');
const pdf = require('pdf-parse');
const fs = require('fs');
const path = require('path');
const knowledgeTool = require('./knowledgeTool');
const nayaxaStandalone = require('./nayaxaStandalone');

const isLocal = process.platform === 'win32';
const DASHBOARD_UPLOADS = isLocal 
    ? path.join(__dirname, '../../../../copy-dashboard/Backend/uploads')
    : path.join(__dirname, '../../../../dashboard-ppm/Backend/uploads');

/**
 * Get the primary Gemini API key from DB
 */
const getApiKey = async () => {
    try {
        const [rows] = await dbNayaxa.query('SELECT api_key FROM gemini_api_keys WHERE is_active = 1 LIMIT 1');
        if (rows.length > 0) return rows[0].api_key;
    } catch (err) {
        console.error('[Mind] Error fetching API Key:', err);
    }
    return process.env.GEMINI_API_KEY;
};

/**
 * Get DeepSeek API Key
 */
const getDeepSeekKey = () => process.env.NAYAXA_DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY;

const axios = require('axios');

const analyzeWithDeepSeek = async (text) => {
    try {
        const apiKey = getDeepSeekKey();
        const response = await axios.post('https://api.deepseek.com/v1/chat/completions', {
            model: "deepseek-v4-flash",
            messages: [
                { role: "system", content: "Anda adalah analis dokumen Nayaxa. Tugas Anda adalah meringkas isi dokumen secara mendalam (inti sari) untuk memori pengetahuan jangka panjang. Fokus pada fakta, angka, dan aturan penting. Gunakan bahasa Indonesia yang formal dan profesional." },
                { role: "user", content: `Ringkas isi dokumen berikut untuk memori Nayaxa Intelligence: \n\n${text.substring(0, 30000)}` }
            ],
            temperature: 0.1
        }, {
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        return response.data.choices[0].message.content;
    } catch (error) {
        console.error('[Mind] DeepSeek Analysis Error:', error.message);
        return null;
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
            const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

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

            const apiKey = await getApiKey();
            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

            // Analyze System-Wide
            const sysPrompt = `Analisis data statistik SELURUH SISTEM OPD/Instansi (Bulan ${month} Tahun ${year}). 
            Data ini mencakup total keseluruhan pegawai di database. 
            Berikan narasi ringkas tentang tren keaktifan total, anomali sistemik, dan wawasan global. 
            Data: ${JSON.stringify({ stats: sysStats, forecast: sysForecast, alerts: sysAlerts })}`;
            const sysResult = await model.generateContent(sysPrompt);
            const sysInsight = sysResult.response.text();

            // Analyze Bapperida Specific
            const bapPrompt = `Analisis data statistik khusus instansi BAPPERIDA (Bulan ${month} Tahun ${year}). 
            Data ini HANYA mencakup pegawai yang terdaftar di Bapperida. 
            Berikan narasi ringkas tentang keaktifan internal Bapperida, ranking bidang, dan anomali internal. 
            Data: ${JSON.stringify({ stats: bapStats, forecast: bapForecast, alerts: bapAlerts })}`;
            const bapResult = await model.generateContent(bapPrompt);
            const bapInsight = bapResult.response.text();

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
    analyzeAndIngestDocument: async (fileId, appId = 1) => {
        try {
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

            const apiKey = await getApiKey();
            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

            let textContent = "";
            let summaryContent = "";
            const ext = path.extname(file.nama_file).toLowerCase();

            // STEP 1: Extract Text or Use Multimodal
            if (ext === '.docx' || ext === '.doc') {
                const buffer = fs.readFileSync(absolutePath);
                const result = await mammoth.convertToHtml({ buffer });
                textContent = result.value;
                // Use DeepSeek for Text Summarization
                summaryContent = await analyzeWithDeepSeek(textContent);
            } else if (ext === '.xlsx' || ext === '.xls' || ext === '.csv') {
                const workbook = XLSX.readFile(absolutePath);
                workbook.SheetNames.forEach(sheetName => {
                    const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName]);
                    textContent += `\n--- Sheet: ${sheetName} ---\n${csv}\n`;
                });
                // Use DeepSeek for Data Summarization
                summaryContent = await analyzeWithDeepSeek(textContent);
            } else if (ext === '.pdf') {
                const buffer = fs.readFileSync(absolutePath);
                try {
                    const pdfData = await pdf(buffer);
                    const extractedText = pdfData.text?.trim() || '';
                    
                    if (extractedText.length > 150) {
                        // PDF has real text -> Use DeepSeek
                        console.log(`[Mind] PDF text detected (${extractedText.length} chars). Using DeepSeek.`);
                        summaryContent = await analyzeWithDeepSeek(extractedText);
                    } else {
                        // PDF likely a scan -> Use Gemini Multimodal
                        console.log(`[Mind] PDF text too short. Using Gemini Multimodal.`);
                        const base64 = buffer.toString('base64');
                        const apiKey = await getApiKey();
                        const genAI = new GoogleGenerativeAI(apiKey);
                        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
                        const prompt = "Berikan analisis dan ringkasan mendalam (inti sari) dari dokumen ini. Fokus pada fakta, angka, dan aturan penting.";
                        const result = await model.generateContent([
                            { text: prompt },
                            { inlineData: { mimeType: 'application/pdf', data: base64 } }
                        ]);
                        summaryContent = result.response.text();
                    }
                } catch (pdfErr) {
                    console.error('[Mind] PDF Parse Error, falling back to Gemini:', pdfErr.message);
                    // Fallback to Gemini if pdf-parse fails
                    const base64 = buffer.toString('base64');
                    const apiKey = await getApiKey();
                    const genAI = new GoogleGenerativeAI(apiKey);
                    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
                    const result = await model.generateContent([{ text: "Ringkas dokumen ini:" }, { inlineData: { mimeType: 'application/pdf', data: base64 } }]);
                    summaryContent = result.response.text();
                }
            } else if (ext === '.png' || ext === '.jpg' || ext === '.jpeg') {
                const buffer = fs.readFileSync(absolutePath);
                const base64 = buffer.toString('base64');
                const mimeType = `image/${ext.replace('.','')}`;
                
                // Use Gemini for Image Analysis
                const apiKey = await getApiKey();
                const genAI = new GoogleGenerativeAI(apiKey);
                const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

                const prompt = "Berikan analisis dan ringkasan mendalam (inti sari) dari gambar dokumen ini. Fokus pada fakta, angka, dan aturan penting.";
                const result = await model.generateContent([
                    { text: prompt },
                    { inlineData: { mimeType, data: base64 } }
                ]);
                summaryContent = result.response.text();
            } else {
                textContent = fs.readFileSync(absolutePath, 'utf8');
                summaryContent = await analyzeWithDeepSeek(textContent);
            }

            if (summaryContent && summaryContent.trim()) {
                // Save to Knowledge Base
                await knowledgeTool.ingestToKnowledge(appId, 'Dashboard Analysis', summaryContent, file.nama_file);
                
                // Mark as indexed in dashboard
                await dbDashboard.query('UPDATE dokumen_upload SET is_indexed = 1 WHERE id = ?', [file.id]);

                return {
                    success: true,
                    content: summaryContent,
                    source: file.nama_file
                };
            }

            return { success: false, message: "Gagal mengekstrak teks dari dokumen." };
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
    }
};

module.exports = nayaxaMindService;
