const nayaxaGemini = require('./nayaxaGeminiService');
const nayaxaDeepSeek = require('./nayaxaDeepSeekService');
const pdf = require('pdf-parse');
const fs = require('fs');
const path = require('path');
const dbNayaxa = require('../config/dbNayaxa');


// Helper to compile active user profile and job responsibilities context
const compileUserContext = (userProfile, userName, namaInstansi) => {
    if (!userProfile) {
        return `PROFIL PENGGUNA BERINTERAKSI:
- Nama Lengkap: ${userName || 'Pegawai'}
- Instansi: ${namaInstansi || 'Bapperida'}
- Jabatan: Staf / Pengguna Dashboard
- Panggilan/Sapaan Kehormatan: Bapak/Ibu`;
    }
    
    const diampuInstansi = userProfile.instansi_diampu && userProfile.instansi_diampu.length > 0
        ? userProfile.instansi_diampu.join(', ')
        : 'Tidak ada';
        
    const diampuUrusan = userProfile.urusan_diampu && userProfile.urusan_diampu.length > 0
        ? userProfile.urusan_diampu.join(', ')
        : 'Tidak ada';

    // Map gender (jenis_kelamin) to proper Indonesian honorific greeting
    let sapaan = 'Bapak/Ibu';
    if (userProfile.jenis_kelamin) {
        const jk = userProfile.jenis_kelamin.toLowerCase();
        if (jk.startsWith('p') || jk.includes('wanita') || jk.includes('perempuan')) {
            sapaan = 'Ibu';
        } else if (jk.startsWith('l') || jk.includes('pria') || jk.includes('laki')) {
            sapaan = 'Bapak';
        }
    }

    return `PROFIL PENGGUNA BERINTERAKSI:
- Nama Lengkap: ${userProfile.nama_lengkap}
- NIP: ${userProfile.nip || 'N/A'}
- Jabatan: ${userProfile.jabatan || 'Staf'}
- Bidang Kerja: ${userProfile.bidang || 'N/A'} (ID: ${userProfile.bidang_id || 'N/A'})
- Instansi: ${userProfile.nama_instansi || namaInstansi}
- Jenis Kelamin: ${userProfile.jenis_kelamin || 'N/A'}
- Panggilan/Sapaan Kehormatan: ${sapaan}
- Tanggung Jawab Pengampuan Instansi: ${diampuInstansi}
- Urusan Pengampuan Bidang: ${diampuUrusan}

PANDUAN INTERAKSI KARYAWAN:
1. Anda WAJIB menyesuaikan kueri data, analisis, sapaan, dan draf laporan agar secara default memprioritaskan wewenang bidang kerja pengguna di atas (terutama jika ia menanyakan data umum tanpa menyebutkan bidang secara eksplisit).
2. Anda WAJIB memanggil/menyapa pengguna dengan sebutan "${sapaan}" secara konsisten. Namun, jika pada "Profil Kepribadian User (Ingatan Jangka Panjang Nayaxa)" secara eksplisit tercatat nama/panggilan kesukaan user (misal: ingin dipanggil nama saja tanpa gelar, "Kak", "Mas", "Mbak", atau panggilan akrab khusus lainnya), Anda WAJIB memprioritaskan nama/panggilan kesukaan tersebut untuk menyapanya. DILARANG KERAS menyapa pengguna perempuan dengan panggilan laki-laki ("Pak", "Bapak", "Om") atau sebaliknya, kecuali ada preferensi panggilan khusus yang sah di ingatan jangka panjang.`;
};

// Helper: Chunk document
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

/**
 * Nayaxa Routing Service v1.1.0 (STRATEGY ENFORCED)
 * Centralized logic for AI model selection and fallback management.
 * Follows the 6-Point Intelligence Strategy.
 */
const nayaxaRoutingService = {
    /**
     * Determines the best AI model for the given task and executes it.
     */
    routeChat: async (params) => {
        let {
            message, attachmentList, instansi_id, month, year, history, 
            user_name, profil_id, blueprintContext, current_page, 
            page_title, baseUrl, fullDate, nama_instansi, 
            personaPromptSnippet, userProfile, lastActivityContext, 
            coding_mode, activeSessionId, onStepCallback, signal
        } = params;


        // Configuration: Check DeepSeek availability from DB (same source as superadmin page)
        let isDeepSeekEnabled = false;
        try {
            const [dsKeys] = await dbNayaxa.query(
                "SELECT COUNT(*) AS cnt FROM gemini_api_keys WHERE jenis_ai = 'DeepSeek Paid' AND is_active = 1"
            );
            isDeepSeekEnabled = (dsKeys[0]?.cnt || 0) > 0;
        } catch (dsCheckErr) {
            console.warn('[Routing] Failed to check DeepSeek key status from DB, defaulting to disabled.', dsCheckErr.message);
        }
        console.log(`[Routing] isDeepSeekEnabled (from DB): ${isDeepSeekEnabled}`);

        // Helper: Estimate pages
        let estimatedPages = 0;
        attachmentList.forEach(file => {
            if (file.pages) estimatedPages += file.pages;
            else if (file.size) estimatedPages += Math.ceil(file.size / 50000);
            else estimatedPages += 1;
        });

        let isSnapshot = message.includes('[NAYAXA_SNAPSHOT]') || message.includes('[NAYAXA_PERIODIC_INSIGHT]');
        let isDatabaseTask = /data|statistik|pegawai|kegiatan|kinerja|capaian|rka|dpa|anggaran|belanja|analisis|query|tabel|db|database/i.test(message);
        let isDocAnalysis = attachmentList && attachmentList.length > 0;
        let hasImages = attachmentList.some(f => 
            (f.mimeType && f.mimeType.startsWith('image/')) || 
            (f.name && /\.(png|jpg|jpeg|webp|gif|bmp)$/i.test(f.name))
        );
        let isBudgetTask = /RKA|DPA|Rincian Belanja|Anggaran|Belanja|SSH|SBU/i.test(message) || message.includes('ACTION: Analisis RKA/DPA');
        let isHighLogicOrLegalTask = /aturan|hukum|regulasi|permendagri|perpres|uu|undang|perda|permen|sk|pasal|sanksi|legal|analisis|buatkan dokumen|draft|concept|drafting|analisis logika/i.test(message);

        // Define Execution Closures
        const executeGemini = async (type = 'Gemini Free', isFallback = false, customTools = null) => {
            console.log(`[Routing] Executing Gemini (${type})${isFallback ? ' as Fallback' : ''}`);
            try {
                return {
                    brain: isFallback ? `Gemini (${type} Fallback)` : `Gemini (${type})`,
                    text: await nayaxaGemini.chatWithNayaxa(
                        message, attachmentList, instansi_id, month, year, history, user_name, profil_id, 
                        blueprintContext, current_page, page_title, baseUrl, fullDate, nama_instansi, personaPromptSnippet, 
                        userProfile, lastActivityContext, !!coding_mode, activeSessionId, onStepCallback, signal, type, customTools
                    )
                };
            } catch (err) {
                if (type === 'Gemini Paid') {
                    console.warn(`[Routing] Gemini Paid failed: ${err.message}. Falling back to Gemini Free...`);
                    return {
                        brain: `Gemini (Gemini Free Fallback)`,
                        text: await nayaxaGemini.chatWithNayaxa(
                            message, attachmentList, instansi_id, month, year, history, user_name, profil_id, 
                            blueprintContext, current_page, page_title, baseUrl, fullDate, nama_instansi, personaPromptSnippet, 
                            userProfile, lastActivityContext, !!coding_mode, activeSessionId, onStepCallback, signal, 'Gemini Free', customTools
                        )
                    };
                }
                throw err;
            }
        };

        const executeDeepSeek = async (isFallback = false, customTools = null) => {
            console.log(`[Routing] Executing DeepSeek Paid${isFallback ? ' as Fallback' : ''}`);
            // Clean up attachment context for DeepSeek (it doesn't support images directly)
            const textOnlyAttachments = attachmentList.filter(f => !f.mimeType?.includes('image'));
            return {
                brain: isFallback ? 'DeepSeek (Fallback)' : 'DeepSeek',
                text: await nayaxaDeepSeek.chatWithNayaxa(
                    message, textOnlyAttachments, instansi_id, month, year, history, user_name, profil_id, 
                    blueprintContext, current_page, page_title, baseUrl, fullDate, nama_instansi, personaPromptSnippet, 
                    userProfile, lastActivityContext, !!coding_mode, activeSessionId, onStepCallback, signal, customTools
                )
            };
        };



        // --- MULTI-AGENT SPECIFIC CONFIGURATIONS ---
        const SQL_ANALYST_PROMPT = `Identitas: Nayaxa SQL Analyst Agent.
Gaya Bahasa: Profesional, singkat, dan berfokus pada data.
PENTING: DILARANG KERAS MENGGUNAKAN EMOJI APAPUN.

Tugas Anda: Anda adalah analis database khusus Bapperida. Lakukan kueri SQL atau dapatkan statistik yang diperlukan untuk menjawab pertanyaan pengguna secara akurat.
- Gunakan alat SQL yang disediakan.
- Jangan mengarang data atau kueri jika tidak berhasil.
- Kembalikan data mentah atau penjelasan statistik terstruktur.`;

        const LEGAL_AUDITOR_PROMPT = `Identitas: Nayaxa Legal Auditor Agent.
Gaya Bahasa: Formal, objektif, dan teliti.
PENTING: DILARANG KERAS MENGGUNAKAN EMOJI APAPUN.

Tugas Anda: Analisis dokumen atau cari peraturan hukum yang relevan (seperti Permendagri, Perda, UU, dll.) untuk menanggapi kebutuhan pengguna.
- Gunakan alat pencarian dokumen internal atau pencarian internet yang disediakan.
- Sajikan rujukan pasal atau aturan hukum secara presisi.`;

        const DOCUMENT_DESIGNER_PROMPT = `Identitas: Nayaxa Document Designer Agent.
Gaya Bahasa: Rapi, terstruktur, dan teknis.
PENTING: DILARANG KERAS MENGGUNAKAN EMOJI APAPUN.

Tugas Anda: Buat atau perbarui dokumen Word/PPTX/Excel sesuai permintaan pengguna berdasarkan data yang telah dikumpulkan.
- Gunakan alat pembuat dokumen, pembuat paparan, atau pengisian Excel.
- JANGAN menulis draf dokumen panjang di chat bubble, panggil alat generate_document.`;

        const { DEEPSEEK_TOOLS } = nayaxaDeepSeek;

        const getSqlTools = () => {
            if (!DEEPSEEK_TOOLS) return null;
            return DEEPSEEK_TOOLS.filter(t => 
                ['execute_sql_query', 'get_pegawai_statistics', 'get_pegawai_ranking', 'search_pegawai', 'get_anomalies'].includes(t.function.name)
            );
        };

        const getLegalTools = () => {
            if (!DEEPSEEK_TOOLS) return null;
            return DEEPSEEK_TOOLS.filter(t => 
                ['search_internet', 'search_files_and_knowledge', 'analyze_dashboard_document'].includes(t.function.name)
            );
        };

        const getDocTools = () => {
            if (!DEEPSEEK_TOOLS) return null;
            return DEEPSEEK_TOOLS.filter(t => 
                ['generate_document', 'pembangkit_paparan_pptx', 'fill_excel_template', 'scan_document_tables', 'update_document_tables'].includes(t.function.name)
            );
        };

        const convertToGeminiTools = (openAiTools) => {
            if (!openAiTools) return undefined;
            return [{
                functionDeclarations: openAiTools.map(t => ({
                    name: t.function.name,
                    description: t.function.description,
                    parameters: t.function.parameters
                }))
            }];
        };

        // Agent Executors
        const executeSqlAgent = async (userQuery) => {
            console.log('[Routing] Delegating to SQL Analyst Agent...');
            const originalMsg = message;
            const originalSnippet = personaPromptSnippet;
            
            message = userQuery;
            personaPromptSnippet = SQL_ANALYST_PROMPT;
            const sqlTools = getSqlTools();
            const geminiSqlTools = convertToGeminiTools(sqlTools);
            
            let res;
            if (isDeepSeekEnabled) {
                try {
                    res = await executeDeepSeek(false, sqlTools);
                } catch (err) {
                    console.warn('[Routing] SQL Agent on DeepSeek failed, trying Gemini...', err.message);
                }
            }
            if (!res || !res.text) {
                res = await executeGemini('Gemini Paid', false, geminiSqlTools);
            }
            
            message = originalMsg;
            personaPromptSnippet = originalSnippet;
            return res ? res.text : "";
        };

        const executeLegalAgent = async (userQuery) => {
            console.log('[Routing] Delegating to Legal Auditor Agent...');
            const originalMsg = message;
            const originalSnippet = personaPromptSnippet;
            
            message = userQuery;
            personaPromptSnippet = LEGAL_AUDITOR_PROMPT;
            const legalTools = getLegalTools();
            const geminiLegalTools = convertToGeminiTools(legalTools);
            
            let res;
            if (isDeepSeekEnabled) {
                try {
                    res = await executeDeepSeek(false, legalTools);
                } catch (err) {
                    console.warn('[Routing] Legal Agent on DeepSeek failed, trying Gemini...', err.message);
                }
            }
            if (!res || !res.text) {
                res = await executeGemini('Gemini Paid', false, geminiLegalTools);
            }
            
            message = originalMsg;
            personaPromptSnippet = originalSnippet;
            return res ? res.text : "";
        };

        const executeDocAgent = async (userQuery, dataContext) => {
            console.log('[Routing] Delegating to Document Designer Agent...');
            const originalMsg = message;
            const originalSnippet = personaPromptSnippet;
            
            message = `Perintah Pengguna: "${userQuery}"\n\nData & Konteks Analisis:\n${dataContext}`;
            personaPromptSnippet = DOCUMENT_DESIGNER_PROMPT;
            const docTools = getDocTools();
            const geminiDocTools = convertToGeminiTools(docTools);
            
            let res;
            if (isDeepSeekEnabled) {
                try {
                    res = await executeDeepSeek(false, docTools);
                } catch (err) {
                    console.warn('[Routing] Document Agent on DeepSeek failed, trying Gemini...', err.message);
                }
            }
            if (!res || !res.text) {
                res = await executeGemini('Gemini Paid', false, geminiDocTools);
            }
            
            message = originalMsg;
            personaPromptSnippet = originalSnippet;
            return res ? res.text : "";
        };

        // --- MULTI-AGENT DIRECT EXECUTION (NO PLANNING) ---
        const isComplex = !isSnapshot && (isDatabaseTask || isDocAnalysis || isBudgetTask || isHighLogicOrLegalTask);
        if (isComplex) {
            console.log(`[Routing] Complex task detected. Running Multi-Agent Execution directly for session ${activeSessionId}...`);
            
            const userContextString = compileUserContext(userProfile, user_name, nama_instansi);
            let sqlDataResult = "";
            let legalRegulationsResult = "";
            let documentResult = "";

            // 1. Delegate SQL Analyst Agent
            if (isDatabaseTask) {
                sqlDataResult = await executeSqlAgent(`${message}\n\nKonteks Pengguna Aktif:\n${userContextString}`);
            }

            // 2. Delegate Legal Auditor Agent
            if (isHighLogicOrLegalTask || isDocAnalysis) {
                legalRegulationsResult = await executeLegalAgent(`${message}\n\nKonteks Pengguna Aktif:\n${userContextString}`);
            }

            // 3. Delegate Document Designer Agent
            const isDocRequested = /buatkan dokumen|draft|word|docx|excel|xlsx|pptx|presentasi|slide|notulen\+word/i.test(message) || isBudgetTask;
            if (isDocRequested) {
                const combinedContext = `SQL Data:\n${sqlDataResult || 'N/A'}\n\nLegal/Document Context:\n${legalRegulationsResult || 'N/A'}\n\nKonteks Pengguna Aktif:\n${userContextString}`;
                documentResult = await executeDocAgent(message, combinedContext);
            }

            // 4. Orchestrator Synthesis & Polishing (Final response)
            console.log('[Routing] Synthesizing final response...');
            const synthesisPrompt = `Anda adalah Asisten AI Utama Nayaxa. Tugas Anda adalah mensintesis laporan akhir yang premium dan terstruktur berdasarkan hasil kerja agen spesialis berikut:
            
- Permintaan Pengguna: "${message}"
- Hasil Analisis SQL (Data Internal):
${sqlDataResult || 'Tidak ada data SQL.'}
- Hasil Auditor Regulasi (Hukum/Dokumen):
${legalRegulationsResult || 'Tidak ada riset hukum.'}
- Hasil Pembuatan Dokumen (Berkas Ekspor):
${documentResult || 'Tidak ada berkas yang dibuat.'}

Konteks Pengguna Aktif:
${userContextString}

EVALUASI KRITIS (PROTOKOL MITRA KRITIS):
- Tinjau hasil data internal SQL dan temuan regulasi di atas secara mendalam.
- Jika terdapat kejanggalan data (seperti ketidakseimbangan anggaran, kegiatan kosong, tren penurunan kinerja ekstrim, atau ketidakpatuhan hukum), Anda WAJIB memaparkan temuan tersebut secara asertif, jujur, dan objektif.
- Jangan menyembunyikan kelemahan data demi memuaskan keinginan pengguna. Berikan saran korektif/rekomendasi efisiensi yang komprehensif agar pengguna terbantu secara nyata.

PENTING: DILARANG KERAS MENGGUNAKAN EMOJI APAPUN.

Format Jawaban:
Sajikan ringkasan eksekutif (1-2 paragraf) yang memuat tinjauan analitis kritis Anda terhadap data tersebut, lalu tabel data/grafik dan dasar hukum yang rapi menggunakan Markdown Premium. Jika ada berkas dokumen yang diunduh (tercantum dalam hasil pembuatan dokumen), letakkan link unduhnya secara menonjol di bagian atas atau bawah jawaban. 
Sapa pengguna secara personal sesuai nama, jabatan, dan "Panggilan/Sapaan Kehormatan" yang tertera di Konteks Pengguna Aktif (gunakan panggilan/sapaan kehormatan secara tepat berdasarkan Jenis Kelamin, DILARANG KERAS menyapa perempuan dengan sebutan "Pak" atau "Om", namun jika di "Profil Kepribadian User (Ingatan Jangka Panjang)" tertera panggilan/nama kesukaan khusus dari user, prioritaskan panggilan kesukaan tersebut).
WAKTU AKTIF: ${fullDate}
ATURAN SALAM: Saat menyapa, gunakan salam yang sesuai jam pada WAKTU AKTIF: 04:00-10:59 = "Selamat pagi", 11:00-14:59 = "Selamat siang", 15:00-18:29 = "Selamat sore", 18:30-03:59 = "Selamat malam". DILARANG menyapa "Selamat siang" pada malam hari.`;

            const originalMsg = message;
            message = synthesisPrompt;
            let finalRes;
            if (isDeepSeekEnabled) {
                try {
                    finalRes = await executeDeepSeek(false, null);
                } catch (err) {
                    console.warn('[Routing] Synthesis failed on DeepSeek, falling back to Gemini...', err.message);
                }
            }
            if (!finalRes || !finalRes.text) {
                finalRes = await executeGemini('Gemini Paid', false, null);
            }
            
            message = originalMsg; // Restore
            return {
                brain: finalRes.brain ? `${finalRes.brain} (Orchestrator)` : "Orchestrator",
                text: finalRes.text
            };
        }


        try {
        // --- SMART SENSING: Peak into PDFs to identify Scanned vs Textual ---
        let hasScannedPdf = false;
        if (attachmentList && attachmentList.length > 0) {
            for (const file of attachmentList) {
                if (file.mimeType?.includes('pdf') && file.base64) {
                    try {
                        const cleanB64 = file.base64.includes('base64,') ? file.base64.split('base64,')[1] : file.base64;
                        const buffer = Buffer.from(cleanB64, 'base64');
                        const pdfData = await pdf(buffer);
                        const textLength = pdfData.text?.trim().length || 0;
                        
                        if (textLength < 100) {
                            console.log(`[SmartSensing] PDF "${file.name}" identified as SCANNED (Text length: ${textLength}). Routing to Gemini.`);
                            hasScannedPdf = true;
                        } else {
                            console.log(`[SmartSensing] PDF "${file.name}" identified as TEXTUAL (Text length: ${textLength}).`);
                        }
                    } catch (e) {
                        console.warn(`[SmartSensing] Failed to peak into PDF: ${e.message}`);
                        hasScannedPdf = true; // Safety fallback to Gemini if parsing fails
                    }
                }
            }
        }

        if (hasScannedPdf || hasImages) {
            const visualType = hasScannedPdf ? 'Scanned PDF' : 'Images';
            console.log(`[Routing] Poin 6: ${visualType} detected. Triggering "Mata & Otak" (Gemini + DeepSeek) protocol.`);
            
            // If it's a budget task, we MUST use DeepSeek Brain after Gemini Eyes
            if (isBudgetTask) {
                console.log('[Routing] Budget task with visual data. Using Gemini Paid (Eyes) -> DeepSeek Paid (Brain).');
                try {
                    // 1. MATA (Gemini): Extract text/vision
                    const visionPrompt = "Ekstrak seluruh teks dan data tabel dari dokumen/gambar ini secara sangat mendetail. Jangan berikan analisis, cukup berikan data mentah hasil pembacaan Anda.";
                    const visionResult = await executeGemini('Gemini Paid');
                    
                    // 2. OTAK (DeepSeek): Analyze
                    console.log('[Routing] Vision extraction complete. Passing to DeepSeek Brain...');
                    const brainResult = await executeDeepSeek();
                    
                    // Inject vision context into brain result for transparency
                    return {
                        brain: "DeepSeek (Brain) + Gemini (Eyes)",
                        text: brainResult.text
                    };
                } catch (err) {
                    console.warn('[Routing] Collaborative protocol failed, falling back to Gemini Paid only.');
                    return await executeGemini('Gemini Paid', true);
                }
            } else {
                // For non-budget tasks, Gemini Paid is usually sufficient
                console.log('[Routing] Non-budget visual task. Using Gemini Paid.');
                return await executeGemini('Gemini Paid');
            }
        }

            // POIN 1 & 2: Light Conversation / Snapshots
            // Urutan: Gemini Free → DeepSeek Paid (Legal/High-Logic tasks override to DeepSeek Paid first)
            if (isSnapshot || (!isDocAnalysis && !isDatabaseTask)) {
                console.log('[Routing] Poin 1/2: Light task detected.');
                if (isHighLogicOrLegalTask) {
                    console.log('[Routing] Special Override: Precise legal search or high-logic task detected. Routing directly to DeepSeek Paid.');
                    try {
                        return await executeDeepSeek();
                    } catch (err) {
                        console.warn('[Routing] DeepSeek failed for precise legal task, falling back to Gemini Free.');
                        return await executeGemini('Gemini Free', true);
                    }
                }
                try {
                    return await executeGemini('Gemini Free');
                } catch (err) {
                    console.warn('[Routing] Gemini Free failed, falling back to DeepSeek Paid.');
                    return await executeDeepSeek(true);
                }
            } 
            
            // POIN 3: Database Analysis
            // Urutan: DeepSeek Paid → Gemini Paid
            else if (isDatabaseTask && !isDocAnalysis) {
                console.log('[Routing] Poin 3: Database task detected.');
                try {
                    return await executeDeepSeek();
                } catch (err) {
                    console.warn('[Routing] DeepSeek failed for DB task, falling back to Gemini Paid.');
                    return await executeGemini('Gemini Paid', true);
                }
            }
            
            // POIN 4: Document Analysis (Small: 1-10 Pages)
            // Strategy: Budget tasks always use DeepSeek Paid for logic precision.
            else if (isDocAnalysis && estimatedPages <= 10) {
                console.log('[Routing] Poin 4: Small Doc (1-10 pages) detected.');
                
                // --- SPECIAL OVERRIDE: Budget/RKA/DPA or High Logic/Legal always needs DeepSeek Paid ---
                if (isBudgetTask || isHighLogicOrLegalTask) {
                    console.log('[Routing] Budget or High Logic / Precise Legal task detected. Prioritizing DeepSeek Paid for precision.');
                    try {
                        return await executeDeepSeek();
                    } catch (err) {
                        console.warn('[Routing] DeepSeek failed for Budget/Legal task, falling back to Gemini Paid.');
                        return await executeGemini('Gemini Paid', true);
                    }
                }

                try {
                    return await executeGemini('Gemini Free');
                } catch (err) {
                    console.warn('[Routing] Gemini Free failed for Small Doc, falling back to DeepSeek Paid.');
                    try {
                        return await executeDeepSeek(true);
                    } catch (dsErr) {
                        console.warn('[Routing] DeepSeek failed, falling back to Gemini Paid.');
                        return await executeGemini('Gemini Paid', true);
                    }
                }
            }
            
            // POIN 5: Document Analysis (Large: > 10 Pages)
            // Urutan: DeepSeek Paid → Gemini Free (Vision) → Gemini Paid (Vision)
            else if (isDocAnalysis && estimatedPages > 10) {
                console.log('[Routing] Poin 5: Large Doc (>10 pages) detected.');
                try {
                    return await executeDeepSeek();
                } catch (err) {
                    console.warn('[Routing] DeepSeek failed for Large Doc, falling back to Gemini Free.');
                    try {
                        return await executeGemini('Gemini Free', true);
                    } catch (gemFreeErr) {
                        console.warn('[Routing] Gemini Free failed, falling back to Gemini Paid.');
                        return await executeGemini('Gemini Paid', true);
                    }
                }
            }

            // Default Fallback
            if (isHighLogicOrLegalTask) {
                console.log('[Routing] Default fallback: Precise Legal or High Logic task detected. Prioritizing DeepSeek Paid.');
                try {
                    return await executeDeepSeek();
                } catch (err) {
                    console.warn('[Routing] DeepSeek failed in default fallback, falling back to Gemini Free.');
                }
            }

            console.log('[Routing] No specific rule matched. Defaulting to Gemini Free.');
            const finalResult = await executeGemini('Gemini Free');

            // --- BACKGROUND WORKER: Trigger Master Summary for large documents ---
            // If the response is successful and we have a large document in context, 
            // trigger the map-reduce summarizer in the background.
            if (finalResult && finalResult.text) {
                const totalTextLength = attachmentList.reduce((acc, f) => acc + (f.base64 ? f.base64.length : 0), 0);
                if (totalTextLength > 50000) {
                     // This is a simplified trigger. In reality, we'd need the full extracted text.
                     // But for now, we follow the user's wish to centralize the logic here.
                     console.log('[Routing] Large document detected. Background Master Summary logic would trigger here.');
                }
            }

            return finalResult;

        } catch (criticalError) {
            console.error('[Routing] Critical failure in routing logic:', criticalError.message);
            // Absolute safety net
            return await executeGemini('Gemini Free', true);
        }
    },

    /**
     * POIN 6 & 5: Hybrid Document Analysis (Mata & Otak)
     * Gemini extracts visual context, DeepSeek performs logical analysis.
     */
    routeAnalysis: async (absolutePath, query = null) => {
        try {
            console.log(`[Routing] Analysis requested for: ${path.basename(absolutePath)}`);
            const buffer = fs.readFileSync(absolutePath);
            const base64 = buffer.toString('base64');
            const stats = fs.statSync(absolutePath);
            const fileSizeMB = stats.size / (1024 * 1024);

            // 1. MATA (Gemini): Extract text and describe visual elements
            console.log('[Routing] Stage 1: Eyes (Gemini Paid/Free) for Vision extraction...');
            const visionPrompt = `Tugas Anda adalah membaca dokumen PDF ini dan mengubahnya menjadi format teks yang sangat kaya informasi.
            Jika Anda menemukan GAMBAR/GRAFIK/DIAGRAM, berikan deskripsi mendetail di dalam [DESKRIPSI VISUAL: ...].`;
            
            const enrichedText = await nayaxaGemini.chatWithNayaxa(
                visionPrompt, 
                [{ name: path.basename(absolutePath), base64, mimeType: 'application/pdf' }],
                null, null, null, [], 'System', null, '', '', '', '', '', '', '', null, null, false, 'analysis_vision', null, null, 'Gemini Free'
            );

            // 2. OTAK (DeepSeek): Analyze the enriched context
            console.log('[Routing] Stage 2: Brain (DeepSeek Paid) for Logic analysis...');
            const logicPrompt = query 
                ? `Berdasarkan dokumen yang telah diperkaya visual berikut, jawablah: "${query}"`
                : `Berikan ringkasan eksekutif mendalam (inti sari) dari dokumen berikut. Fokus pada fakta, angka, dan aturan penting.`;

            const finalAnalysis = await nayaxaDeepSeek.chatWithNayaxa(
                `${logicPrompt}\n\n=== DOKUMEN DENGAN KONTEKS VISUAL ===\n${enrichedText}`,
                [], null, null, null, [], 'System', null, '', '', '', '', '', '', '', null, null, false, 'analysis_brain', null, null
            );

            return { success: true, summary: finalAnalysis, enrichedText };
        } catch (e) {
            console.error('[Routing] routeAnalysis failed:', e.message);
            return { success: false, error: e.message };
        }
    },

    /**
     * POIN 3: Database / Logic Consolidation (Merging Insights)
     */
    routeConsolidation: async (subTopic, oldSummary, newInsight) => {
        const mergePrompt = `Gabungkan ulasan lama dan baru tentang "${subTopic}" secara rapi tanpa membuang fakta penting. Berikan skor 0-100.
        FORMAT: === SCORE === [angka] \n === CONSOLIDATED SUMMARY === [isi]`;
        
        console.log(`[Routing] Consolidating Knowledge for: ${subTopic}`);
        return await nayaxaDeepSeek.chatWithNayaxa(
            mergePrompt + `\n\nOLD:\n${oldSummary}\n\nNEW:\n${newInsight}`,
            [], null, null, null, [], 'System', null, '', '', '', '', '', '', '', null, null, false, 'consolidation', null, null
        );
    },

    /**
     * POIN 2: Snapshots & Master Summary (Efficiency Mode)
     */
    routeMasterSummary: async (fileName, sections) => {
        console.log(`[Routing] Generating Master Summary for: ${fileName}`);
        const sectionSummaries = [];
        
        for (let i = 0; i < sections.length; i++) {
            const res = await nayaxaGemini.chatWithNayaxa(
                `Ringkas bagian ${i+1} dari ${fileName}:\n\n${sections[i]}`,
                [], null, null, null, [], 'System', null, '', '', '', '', '', '', '', null, null, false, `master_map_${i}`, null, null, 'Gemini Free'
            );
            sectionSummaries.push(res);
        }

        const reducePrompt = `Gabungkan ringkasan berikut menjadi Master Summary premium untuk pimpinan:\n\n${sectionSummaries.join('\n\n')}`;
        try {
            return await nayaxaGemini.chatWithNayaxa(
                reducePrompt, [], null, null, null, [], 'System', null, '', '', '', '', '', '', '', null, null, false, 'master_reduce', null, null, 'Gemini Free'
            );
        } catch (err) {
            console.warn('[Routing] Gemini Free failed for Master Summary reduction, falling back to DeepSeek Paid.');
            return await nayaxaDeepSeek.chatWithNayaxa(
                reducePrompt, [], null, null, null, [], 'System', null, '', '', '', '', '', '', '', null, null, false, 'master_reduce_fallback', null, null
            );
        }
    },

    /**
     * Executes a simple, lightweight AI task
     */
    routeSimpleTask: async (prompt) => {
        try {
            return await nayaxaGemini.chatWithNayaxa(prompt, [], null, null, null, [], 'System', null, '', '', '', '', '', '', '', null, null, false, 'background_task', null, null, 'Gemini Free');
        } catch (e) {
            console.warn('[Routing] routeSimpleTask failed, falling back to DeepSeek Paid.');
            try {
                return await nayaxaDeepSeek.chatWithNayaxa(prompt, [], null, null, null, [], 'System', null, '', '', '', '', '', '', '', null, null, false, 'background_task_fallback', null, null);
            } catch (dsErr) {
                return '';
            }
        }
    }
};

module.exports = nayaxaRoutingService;
