const dbDashboard = require('../config/dbDashboard');
const dbNayaxa = require('../config/dbNayaxa');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const mammoth = require('mammoth');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const knowledgeTool = require('./knowledgeTool');
const nayaxaStandalone = require('./nayaxaStandalone');

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
                const absolutePath = path.join(__dirname, '../../', file.path);
                
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
                        const result = await mammoth.extractRawText({ buffer });
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

            // Fetch basic stats across system
            const [stats, forecast, alerts] = await Promise.all([
                nayaxaStandalone.getPegawaiStatistics(null, month, year),
                nayaxaStandalone.forecastTrends(null, month, year),
                nayaxaStandalone.detectAnomalies(null)
            ]);

            const apiKey = await getApiKey();
            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

            const dataToAnalyze = JSON.stringify({ stats, forecast, alerts });
            const prompt = `Analisis data statistik sistem Bapperida ini (Bulan ${month} Tahun ${year}). 
            Berikan narasi ringkas tentang tren keaktifan pegawai, anomali yang ditemukan, dan wawasan penting lainnya untuk diingat oleh Nayaxa. 
            Data: ${dataToAnalyze}`;

            const result = await model.generateContent(prompt);
            const insightText = result.response.text();

            // Save to Knowledge Base
            await knowledgeTool.ingestToKnowledge(1, 'System Snapshot', insightText, `Snapshot-${month}-${year}`);
            
            await nayaxaMindService.finishLog(logId, 'SUCCESS', `System snapshot complete. [Sig: ${dbStatus.signature}]`);
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
     * Main Initializer
     */
    init: (intervalMinutes = 60) => {
        console.log(`[Mind] System initialized. Pulse every ${intervalMinutes} minutes.`);
        
        // Immediate first run (deferred 10sec to let server start)
        setTimeout(async () => {
            // learnNewDocuments disabled as per user request (focus on DB only)
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
