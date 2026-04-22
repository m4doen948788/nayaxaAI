const { GoogleGenerativeAI } = require('@google/generative-ai');
const mammoth = require('mammoth');
const crypto = require('crypto');
const dbDashboard = require('../config/dbDashboard');
const dbNayaxa = require('../config/dbNayaxa');
const nayaxaStandalone = require('./nayaxaStandalone');
const exportService = require('./exportService');
const knowledgeTool = require('./knowledgeTool');
const XLSX = require('xlsx');
const pptxService = require('./pptxService');

const summaryCache = new Map();

/**
 * Get the primary Gemini API key.
 * Now supports excluding a key that just failed (503/429).
 */
const getApiKey = async (excludeKey = null) => {
    try {
        let query = 'SELECT api_key FROM gemini_api_keys WHERE is_active = 1';
        let params = [];
        if (excludeKey) {
            query += ' AND api_key != ?';
            params.push(excludeKey);
        }
        query += ' ORDER BY last_used ASC LIMIT 1';
        
        const [rows] = await dbNayaxa.query(query, params);
        if (rows.length > 0) {
            const selectedKey = rows[0].api_key;
            // Background: Update last_used
            dbNayaxa.query('UPDATE gemini_api_keys SET last_used = NOW() WHERE api_key = ?', [selectedKey]).catch(() => {});
            return selectedKey;
        }
    } catch (err) {
        console.error('Error fetching API Key:', err);
    }
    return process.env.GEMINI_API_KEY;
};


const DEFAULT_MODEL = 'gemini-2.5-flash';

const nayaxaTools = [{
    functionDeclarations: [
        {
            name: "get_pegawai_statistics",
            description: "Mendapatkan statistik kehadiran dan tren volume kegiatan total pegawai di instansi terkait untuk bulan ini.",
            parameters: {
                type: "object",
                properties: {
                    instansi_id: { type: "number", description: "ID Instansi" },
                    month: { type: "number", description: "Bulan (1-12)" },
                    year: { type: "number", description: "Tahun" }
                },
                required: ["instansi_id", "month", "year"]
            }
        },
        {
            name: "get_pegawai_ranking",
            description: "Mendapatkan daftar Top 5 pegawai terajin dan Bottom 5 pegawai termalas berdasarkan jumlah kegiatan bulan ini.",
            parameters: {
                type: "object",
                properties: {
                    instansi_id: { type: "number", description: "ID Instansi" },
                    month: { type: "number", description: "Bulan (1-12)" },
                    year: { type: "number", description: "Tahun" }
                },
                required: ["instansi_id", "month", "year"]
            }
        },
        {
            name: "search_pegawai",
            description: "Mencari daftar seluruh pegawai di instansi terkait.",
            parameters: {
                type: "object",
                properties: {
                    instansi_id: { type: "number", description: "ID Instansi" }
                },
                required: ["instansi_id"]
            }
        },
        {
            name: "get_anomalies",
            description: "Mendapatkan daftar pegawai yang bermasalah (Alert Cerdas).",
            parameters: {
                type: "object",
                properties: {
                    instansi_id: { type: "number", description: "ID Instansi" }
                },
                required: ["instansi_id"]
            }
        },
        {
            name: "search_internet",
            description: "Mencari data publik atau referensi eksternal dari internet.",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string", description: "Kata kunci pencarian" }
                },
                required: ["query"]
            }
        },
        {
            name: "generate_document",
            description: "Membuat dokumen teks atau tabel (PDF, Excel, atau Word). DILARANG KERAS menggunakan tool ini untuk membuat presentasi/paparan/slides.",
            parameters: {
                type: "object",
                properties: {
                    format: { type: "string", description: "pdf, excel, atau word" },
                    content: { type: "string", description: "Konten file" },
                    filename: { type: "string", description: "Nama file" },
                    options: { 
                        type: "object", 
                        description: "Opsional: Pengaturan format (khusus Word).",
                        properties: {
                            font: { type: "string", description: "Jenis huruf, misal: 'Arial', 'Times New Roman'" },
                            fontSize: { type: "number", description: "Ukuran huruf, misal: 12" },
                            lineSpacing: { type: "number", description: "Spasi baris, misal: 1.5 atau 2.0" },
                            paperSize: { type: "string", description: "Ukuran kertas, misal: 'A4' atau 'Letter'" },
                            includeTOC: { type: "boolean", description: "Sertakan Daftar Isi (Daftar Isi otomatis di halaman pertama)." }
                        }
                    }
                },
                required: ["format", "content", "filename"]
            }
        },
        {
            name: "generate_chart",
            description: "Membuat grafik/chart interaktif.",
            parameters: {
                type: "object",
                properties: {
                    type: { type: "string", description: "bar, column, line, pie, donut" },
                    title: { type: "string", description: "Judul grafik" },
                    data: { type: "string", description: "JSON string [{label, value}]" },
                    series: { type: "string", description: "JSON string [{name, data:[{label,value}]}]" },
                    unit: { type: "string", description: "Satuan data (misal: orang, persen)" },
                    color: { type: "string", description: "Warna tema (hex code)" }
                },
                required: ["type", "title"]
            }
        },
        {
            name: "ingest_to_knowledge",
            description: "Menyimpan informasi dari dokumen (PDF/Excel) ke dalam memori pengetahuan (Knowledge Base) Nayaxa.",
            parameters: {
                type: "object",
                properties: {
                    category: { type: "string", description: "Kategori informasi, misal: Aturan Absensi, Juknis, atau Data Statis" },
                    content: { type: "string", description: "Intisari informasi penting yang akan disimpan." },
                    source_file: { type: "string", description: "Nama file sumber" }
                },
                required: ["category", "content", "source_file"]
            }
        },
        {
            name: "search_files_and_knowledge",
            description: "Mencari file asli atau pengetahuan (knowledge base) yang tersimpan di sistem Nayaxa.",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string", description: "Nama file, materi, atau kata kunci pencarian dokumen" }
                },
                required: ["query"]
            }
        },
        {
            name: "get_nearby_places",
            description: "Mencari tempat terdekat (restoran, apotek, faskes, dll) berdasarkan koordinat Latitude dan Longitude user.",
            parameters: {
                type: "object",
                properties: {
                    lat: { type: "number", description: "Latitude user" },
                    lng: { type: "number", description: "Longitude user" },
                    category: { type: "string", description: "Kategori tempat (misal: 'Rumah Makan Padang', 'Apotek')" }
                },
                required: ["lat", "lng", "category"]
            }
        },
        {
            name: "execute_sql_query",
            description: "Menjalankan query SQL Read-Only untuk mendapatkan data spesifik dari database yang tidak tercover oleh tool statistik lain (misal: mencari jumlah pegawai per bidang, mencari detail tugas tertentu, dll).",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string", description: "Query SQL SELECT. Wajib menyertakan filter instansi_id jika relevan." }
                },
                required: ["query"]
            }
        },
        {
            name: "fill_excel_template",
            description: "Mengisi data ke dalam file Excel yang baru saja diunggah oleh user.",
            parameters: {
                type: "object",
                properties: {
                    filled_data: { type: "string", description: "Data yang akan diisikan dalam format JSON Array of Objects. Key harus sesuai dengan header kolom di Excel (case-insensitive)." },
                    filename: { type: "string", description: "Nama file hasil (misal: 'data_pegawai_terisi.xlsx')" }
                },
                required: ["filled_data", "filename"]
            }
        },
        {
            name: "pembangkit_paparan_pptx",
            description: "Satu-satunya tool untuk membuat dokumen presentasi resmi (.pptx) dengan desain modern Bapperida 2026. Gunakan ini untuk slides/paparan.",
            parameters: {
                type: "object",
                properties: {
                    judul: { type: "string", description: "Judul besar presentasi" },
                    konteks: { type: "string", description: "Keterangan singkat, misal: 'Laporan Triwulan I 2024'" },
                    slides: {
                        type: "array",
                        description: "Daftar slide (Max 10-15 slide)",
                        items: {
                            type: "object",
                            properties: {
                                title: { type: "string", description: "Judul per slide" },
                                points: { 
                                    type: "array", 
                                    items: { type: "string" }, 
                                    description: "Poin-poin materi slide (Singkat dan padat)" 
                                },
                                layout_type: { 
                                    type: "string", 
                                    enum: ["BULLETS", "TWO_COLUMN"], 
                                    description: "Layout visual" 
                                },
                                notes: { type: "string", description: "Speaker notes (opsional)" }
                            },
                            required: ["title", "points"]
                        }
                    }
                },
                required: ["judul", "slides"]
            }
        },
        // --- CODING AGENT TOOLS ---
        {
            name: "list_project_files",
            description: "Melihat struktur direktori dan daftar file dalam proyek Nayaxa.",
            parameters: {
                type: "object",
                properties: {
                    dir_path: { type: "string", description: "Path direktori (Opsional, default './')" }
                }
            }
        },
        {
            name: "read_code_file",
            description: "Membaca isi konten lengkap dari sebuah file kode.",
            parameters: {
                type: "object",
                properties: {
                    file_path: { type: "string", description: "Path absolut file." }
                },
                required: ["file_path"]
            }
        },
        {
            name: "write_code_file",
            description: "Menyiapkan proposal perubahan untuk SATU file. Kode TIDAK akan langsung ditulis ke disk, melainkan masuk ke tahap review user.",
            parameters: {
                type: "object",
                properties: {
                    file_path: { type: "string", description: "Path absolut file." },
                    content: { type: "string", description: "Konten baru file secara lengkap." }
                },
                required: ["file_path", "content"]
            }
        },
        {
            name: "propose_code_changes",
            description: "Menyiapkan proposal perubahan untuk BANYAK file sekaligus dalam satu paket review.",
            parameters: {
                type: "object",
                properties: {
                    changes: { 
                        type: "array", 
                        items: {
                            type: "object",
                            properties: {
                                file_path: { type: "string" },
                                content: { type: "string" }
                            },
                            required: ["file_path", "content"]
                        }
                    }
                },
                required: ["changes"]
            }
        },
        {
            name: "search_in_codebase",
            description: "Mencari teks/pola tertentu di seluruh file dalam direktori proyek.",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string", description: "Teks yang dicari" },
                    dir_path: { type: "string", description: "Path direktori scan" }
                },
                required: ["query"]
            }
        }
    ]
}];

const toolFunctions = {
    get_nearby_places: async ({ lat, lng, category }) => {
        const places = await nayaxaStandalone.getNearbyPlaces(lat, lng, category);
        return { success: true, places }; // Always return true even if empty to let AI handle it gracefully
    },
    get_pegawai_statistics: async ({ instansi_id, month, year }) => {
        const stats = await nayaxaStandalone.getPegawaiStatistics(instansi_id, month, year);
        const forecast = await nayaxaStandalone.forecastTrends(instansi_id, month, year);
        return { stats, forecast };
    },
    get_pegawai_ranking: async ({ instansi_id, month, year }) => {
        const scoring = await nayaxaStandalone.calculateScoring(instansi_id, month, year);
        return { top_pegawai: scoring.top_pegawai, bottom_pegawai: scoring.bottom_pegawai, ranked_bidang: scoring.ranked_bidang };
    },
    search_pegawai: async ({ instansi_id, month, year }) => {
        const scoring = await nayaxaStandalone.calculateScoring(instansi_id, month, year);
        return { daftar_pegawai: scoring.all_scores.map(p => ({ nama: p.nama, jabatan: p.jabatan, bidang: p.bidang, total_kegiatan: p.total_kegiatan })) };
    },
    get_anomalies: async ({ instansi_id }) => {
        const alerts = await nayaxaStandalone.detectAnomalies(instansi_id);
        return alerts;
    },
    search_internet: async ({ query }) => {
        const jsonResult = await nayaxaStandalone.searchInternet(query);
        return { internet_result: jsonResult };
    },
    execute_sql_query: async ({ query }) => {
        const jsonResult = await nayaxaStandalone.executeReadOnlyQuery(query);
        return { database_result: jsonResult };
    },
    generate_document: async ({ format, content, filename, options }, { baseUrl }) => {
        try {
            // --- ANTI-HALLUCINATION GUARDRAIL ---
            // Jika AI mencoba memanggil tool Word untuk PPTX, tolak secara paksa di level kode.
            if (filename.toLowerCase().endsWith('.pptx') || filename.toLowerCase().includes('presentasi') || filename.toLowerCase().includes('paparan')) {
                console.error(`[Guardrail] AI mencoba membuat PPTX menggunakan tool Word. Menolak pemanggilan.`);
                return { 
                    success: false, 
                    error: "KESALAHAN FATAL: Anda dilarang menggunakan tool 'generate_document' untuk membuat presentasi atau file berakhiran .pptx. Anda WAJIB menggunakan tool 'pembangkit_paparan_pptx' untuk permintaan ini. Silakan ulangi pemanggilan dengan tool yang benar." 
                };
            }

            const downloadUrl = await (format === 'excel' ? exportService.generateExcel(content, filename) :
                                format === 'pdf' ? exportService.generatePDF(content, filename) :
                                exportService.generateWord(content, filename, options));
            
            return { success: true, download_url: downloadUrl, message: `File ${format.toUpperCase()} berhasil dibuat! Silakan berikan link ini kepada user agar mereka bisa mendownloadnya: ${downloadUrl}` };
        } catch (err) {
            return { success: false, error: err.message };
        }
    },
    generate_chart: async ({ type, title, data, series, unit, color }) => {
        try {
            let chartSpec;
            if (series) {
                let parsedSeries = JSON.parse(series).map(s => ({
                    name: String(s.name),
                    data: s.data.map(d => ({ label: String(d.label), value: parseFloat(d.value) || 0 }))
                }));
                chartSpec = { type: type || 'line', title: title || 'Grafik', series: parsedSeries, unit, color };
            } else {
                let parsedData = JSON.parse(data).map(d => ({ label: String(d.label), value: parseFloat(d.value) || 0 }));
                chartSpec = { type: type || 'bar', title: title || 'Grafik', data: parsedData, unit, color };
            }
            const b64 = Buffer.from(JSON.stringify(chartSpec)).toString('base64');
            return { success: true, chart_marker: `[NAYAXA_CHART]${b64}[/NAYAXA_CHART]`, message: 'Grafik dikirim.' };
        } catch (err) {
            return { success: false, error: err.message };
        }
    },
    ingest_to_knowledge: async ({ category, content, source_file }, { app_id }) => {
        return await knowledgeTool.ingestToKnowledge(app_id, category, content, source_file);
    },
    search_files_and_knowledge: async ({ query }) => {
        const results = await nayaxaStandalone.searchLibrary(query);
        return { search_results: results };
    },
    fill_excel_template: async ({ filled_data, filename }, { excelBase64, baseUrl }) => {
        try {
            if (!excelBase64) {
                return { success: false, error: "Tidak ada file Excel yang ditemukan dalam konteks percakapan untuk diisi." };
            }
            const downloadUrl = await exportService.fillExcelTemplate(excelBase64, filled_data, filename);
            const fullUrl = downloadUrl.startsWith('http') ? downloadUrl : `${baseUrl}${downloadUrl}`;
            return { success: true, download_url: fullUrl, message: `Excel berhasil diisi! Berikan link ini ke user: ${fullUrl}` };
        } catch (err) {
            return { success: false, error: err.message };
        }
    },
    pembangkit_paparan_pptx: async (data, { baseUrl }) => {
        try {
            const res = await pptxService.generatePresentation(data);
            return { 
                success: true, 
                download_url: res.url, 
                message: `Paparan PPTX '${data.judul}' berhasil dibuat dengan tema Modern 2026. Link: ${res.url}` 
            };
        } catch (err) {
            return { success: false, error: err.message };
        }
    },
    // --- CODING AGENT TOOL IMPLEMENTATIONS ---
    list_project_files: async ({ dir_path }) => {
        const codeAgent = require('./codeAgentService');
        return await codeAgent.listDir(dir_path || 'D:\\nayaxa-engine');
    },
    read_code_file: async ({ file_path }) => {
        const codeAgent = require('./codeAgentService');
        return await codeAgent.readFile(file_path);
    },
    write_code_file: async ({ file_path, content }, { session_id }) => {
        const proposalService = require('./proposalService');
        const proposalId = await proposalService.createProposal(session_id, [{ file_path, content }]);
        return { 
            success: true, 
            proposal_id: proposalId,
            marker: `[NAYAXA_PROPOSAL:${proposalId}]`,
            message: `Proposal ${proposalId} (Gemini) dibuat. Berikan marker [NAYAXA_PROPOSAL:${proposalId}] di akhir.` 
        };
    },
    propose_code_changes: async ({ changes }, { session_id }) => {
        const proposalService = require('./proposalService');
        const proposalId = await proposalService.createProposal(session_id, changes);
        return { 
            success: true, 
            proposal_id: proposalId,
            marker: `[NAYAXA_PROPOSAL:${proposalId}]`,
            message: `Proposal ${proposalId} (Gemini Multi-file) dibuat. Berikan marker [NAYAXA_PROPOSAL:${proposalId}] di akhir.` 
        };
    },
    search_in_codebase: async ({ query, dir_path }) => {
        const codeAgent = require('./codeAgentService');
        return await codeAgent.searchInFiles(dir_path || 'D:\\nayaxa-engine', query);
    }
};

const TOOL_STEP_LABELS = {
    search_internet:           { icon: '🌐', label: 'Mencari informasi di internet...' },
    execute_sql_query:         { icon: '📊', label: 'Menganalisis database...' },
    get_pegawai_statistics:    { icon: '📈', label: 'Mengambil statistik pegawai...' },
    get_pegawai_ranking:       { icon: '🏆', label: 'Menghitung ranking bidang...' },
    search_pegawai:            { icon: '👤', label: 'Mencari profil pegawai...' },
    get_anomalies:             { icon: '⚠️', label: 'Mendeteksi anomali data...' },
    search_database:           { icon: '📊', label: 'Menganalisis database...' },
    generate_document:         { icon: '📄', label: 'Membuat dokumen...' },
    generate_chart:            { icon: '📈', label: 'Membuat grafik visualisasi...' },
    search_files_and_knowledge:{ icon: '🔍', label: 'Mencari di basis pengetahuan...' },
    fill_excel_template:       { icon: '📋', label: 'Mengisi template Excel...' },
    ingest_to_knowledge:       { icon: '🧠', label: 'Menyimpan ke basis pengetahuan...' },
    list_project_files:        { icon: '📁', label: 'Menjelajahi struktur proyek...' },
    read_code_file:            { icon: '📄', label: 'Membaca isi file kode...' },
    write_code_file:           { icon: '📝', label: 'Menyiapkan proposal kode...' },
    propose_code_changes:      { icon: '📦', label: 'Menyiapkan paket perubahan...' },
    search_in_codebase:        { icon: '🔍', label: 'Mencari di dalam codebase...' },
    execute_database_update:   { icon: '🛠️', label: 'Memodifikasi database...' },
};

const nayaxaGeminiService = {
    chatWithNayaxa: async (userMessage, files, instansi_id, month, year, prevHistory = [], user_name = "Pengguna", profil_id = null, fileContext = '', current_page = '', page_title = '', baseUrl = '', fullDate = '', nama_instansi = 'N/A', personaPromptSnippet = '', userProfile = null, lastActivityContext = null, coding_mode = false, session_id = null, onStepCallback = null, signal = null) => {
        let apiKey = await getApiKey();
        let attempts = 0;
        let lastError = null;

        const schemaMapString = await nayaxaStandalone.getDatabaseSchema();
        const glossaryString = await nayaxaStandalone.getMasterDataGlossary();

        // Format identity string
        let identitasUser = `Nama: ${user_name}, Instansi: ${nama_instansi} (ID: ${instansi_id}).`;
        if (userProfile) {
            identitasUser += ` 
            DETAIL PROFIL:
            - Bidang: ${userProfile.bidang || 'N/A'}
            - Jabatan: ${userProfile.jabatan || 'N/A'}
            - Nama Instansi: ${userProfile.nama_instansi || nama_instansi}
            - Instansi yang Diampu: ${userProfile.instansi_diampu?.length > 0 ? userProfile.instansi_diampu.join(', ') : 'Tidak ada data pengampuan instansi.'}
            - Urusan/Tugas yang Diampu: ${userProfile.urusan_diampu?.length > 0 ? userProfile.urusan_diampu.join(', ') : 'Tidak ada data pengampuan urusan.'}`;
        }

        let projectStructureInfo = '';
        if (fileContext) {
            projectStructureInfo = `\nSTRUKTUR FILE PROYEK (Navigasi Cepat):\n${fileContext}\n`;
        }

        const codingAgentPrompt = `Identitas: Nayaxa Coding Agent (Senior System Engineer).
PROTOKOL EKSEKUSI MUTLAK:
- ANDA ADALAH ROBOT EKSEKUTOR. Abaikan seluruh sapaan ramah atau sejarah percakapan sebelumnya. 
- DILARANG KERAS BERTANYA atau meminta informasi/klarifikasi kepada user (No Questions).
- Jika Anda tidak tahu lokasi file atau struktur tabel, Anda WAJIB menggunakan tool 'search_in_codebase' secara mandiri.
- ANALISIS SECARA DIAM: Jangan tuliskan analisis Anda di chat.

STRUKTUR DATABASE ANDA (Gunakan ini, JANGAN BERTANYA LAGI):
${schemaMapString}
${projectStructureInfo}
WORKFLOW:
1. Begitu menerima instruksi, langkah pertama WAJIB memanggil tool (Search/Read). JANGAN memberikan jawaban teks di turn pertama.
2. Identifikasi file/tabel yang relevan secara mandiri.
3. Lakukan perubahan dengan 'propose_code_changes' atau 'write_code_file'.
4. Akhiri jawaban HANYA dengan ringkasan 1 kalimat perubahan dan marker [NAYAXA_PROPOSAL:id].
- VISION: Jika user mengirimkan screenshot kode, error, atau desain UI, Anda WAJIB menganalisisnya secara visual untuk memandu perbaikan kode.`;

        const generalPersonaPrompt = `Identitas ANDA: Nayaxa, asisten AI dari Bapperida yang dibuat oleh Sammy.
Gaya Bahasa: Sangat ceria, ramah, profesional, dan empatik. Di akhir setiap penjelasan, SELALU tawarkan bantuan ekstra atau berikan satu pertanyaan pendek.
PENTING: DILARANG KERAS MENGGUNAKAN EMOJI APAPUN.
        
PENTING - ADAPTASI FORMALITAS: Sesuaikan tingkat formalitas Anda dengan Profil Kepribadian User (${userProfile?.detected_formality || 'Formal'}). Jika user terbiasa santai (Gue/Lo, Gw/Lu), gunakan gaya casual-professional.
        
${lastActivityContext ? `\nKONTEKS AKTIVITAS: "${lastActivityContext}"\nSapa user dengan hangat.\n` : ''}`;

        const systemInstruction = coding_mode ? codingAgentPrompt : `
            ${generalPersonaPrompt}

            ${generalPersonaPrompt}

            !!! VISION & MULTIMODAL CAPABILITY (PENTING) !!!
            - Jika user mengirimkan GAMBAR, SCREENSHOT, atau DATA VISUAL, Anda WAJIB menganalisisnya secara mendalam.
            - Gunakan konten visual tersebut sebagai konteks utama untuk menjawab pertanyaan user.
            - Jika user bertanya tentang "ini" atau "itu" sambil mengirimkan screenshot, asumsikan "ini/itu" merujuk pada objek di dalam gambar tersebut.

            !!! PROTOKOL RISET BERDASARKAN FAKTA (PENTING) !!!
            1. VERIFIKASI SEKARANG: Jika user bertanya tentang fakta yang bisa berubah (Berita, Jabatan Pejabat, Presiden, Pilkada, Teknologi Terbaru, atau Kejadian di 2024-2026), Anda WAJIB menggunakan tool 'search_internet'.
            2. STRATEGI PENCARIAN PEJABAT: Gunakan kata kunci "Kabinet Merah Putih", "Pilkada 2024", "Pelantikan Serentak 2025", dan "Periode 2025-2029". Namun, SELALU waspada terhadap berita **RESHUFFLE** atau perubahan terbaru di tahun 2025-2029.
            3. PRIORITAS STATUS TERBARU: Jika terdapat berita reshuffle atau pelantikan yang lebih baru dari tanggal awal masa jabatan, Anda WAJIB memprioritaskan data terbaru tersebut. Jika tidak ada berita perubahan, gunakan standar masa jabatan **2025-2029**.
            4. JANGAN PERNAH MENGARANG: Jika pengetahuan internal Anda (cutoff) tidak memiliki data terbaru, katakan "Saya akan mencari data terupdate..." dan LANGSUNG panggil tool.
            5. PENCARIAN BERTINGKAT (LAYERED SEARCH): 
               - Step 1: Cari di 'execute_sql_query' jika terkait data internal instansi.
               - Step 2: Cari di 'search_files_and_knowledge' jika terkait dokumen atau aturan internal.
               - Step 3: Cari di 'search_internet' untuk fakta publik terkini.
            6. RESILIENCE MODE: Jika satu sumber tidak memberikan hasil, coba kueri yang berbeda atau sumber lain. Selalu berikan referensi link sumber di akhir jawaban.
            7. SELF-CORRECTION & VERIFICATION: Periksa tanggal di ringkasan pencarian. Jika berita menyebutkan peristiwa tahun 2018-2022 (seperti Masa Jabatan lama atau PJ lama), Anda WAJIB mengabaikannya untuk pertanyaan status saat ini. Prioritaskan data hasil Pilkada 2024.
            8. INTERNAL KNOWLEDGE DEPRECATION (CRITICAL): Pengetahuan internal Anda tentang Kabinet (Indonesia Maju/Jokowi) sudah USANG. Untuk pertanyaan menteri atau presiden, Anda WAJIB mengikuti data dari 'search_internet'. Prabowo Subianto adalah PRESIDEN (sejak Oct 2024), bukan Menteri. Jangan mencampurkan nama kabinet lama (Indonesia Maju) dengan pemerintahan saat ini (Kabinet Merah Putih).
            
            INSTRUKSI TEKNIS:
            - JANGAN PERNAH mengirimkan pesan "Mohon tunggu" saat Anda akan menggunakan tool.
            - Gunakan 'execute_sql_query' untuk data spesifik per bidang.
            
            PENTING - FORMAT JAWABAN:
            - SELALU gunakan format Markdown (Heading, Bold, Bullet Points, dan Tabel Markdown).
            - **DILARANG KERAS mengeluarkan output berupa kode SQL mentah (seperti SELECT, JOIN, atau WHERE) langsung ke dalam chat.** Kode SQL hanya boleh digunakan secara internal di dalam parameter fungsi 'execute_sql_query'. Anda harus menyajikan hasil eksekusinya dalam bentuk Tabel Markdown.
            - DILARANG JSON mentah di chat.
            - ATURAN TRANSPARANSI: Jika jawaban berasal dari 'search_internet' (berita/pejabat/fakta publik), Anda WAJIB menambahkan footer transparansi di akhir jawaban Anda dengan format sebagai berikut:
              
              ---
              🔍 **RESEARCH TRANSPARENCY**
              **Sumber Utama:** [Nama Situs/Link]
              **Waktu Akses:** [Gunakan 'search_date' dari hasil tool secara utuh]
              **Catatan:** Informasi ini ditarik secara real-time melalui Nayaxa Resilience Mode. Untuk keperluan resmi, silakan merujuk pada dokumen negara atau situs kementerian terkait.
            
            WAKTU AKTIF: Bulan ${month}, Tahun ${year}. Selalu gunakan nilai ini sebagai filter waktu default tanpa konfirmasi.
            
            Identitas USER: ${identitasUser}
            PENTING: DILARANG KERAS memunculkan "ID", "NIP", "Profil ID", "Instansi ID", atau angka identitas teknis lainnya (seperti: "ID: 151", "ID: 66", dsb) kecuali user bertanya secara spesifik. 
            - Anda WAJIB MEMBERSIHKAN (sanitasi) semua kolom ID dari hasil database sebelum menyajikannya.
            - Untuk 'Lampiran', jangan tampilkan ID-nya. Cukup sebutkan "Tersedia" atau berikan link. Jangan pernah menulis "(ID: 66)".
            ${personaPromptSnippet}
            
            ${schemaMapString}
            (Analisis data secara ramah dan bantu user ${user_name} sepenuh hati).
        `;


        while (attempts < 2) {
            try {
                const genAI = new GoogleGenerativeAI(apiKey);
                const model = genAI.getGenerativeModel({ 
                    model: DEFAULT_MODEL, 
                    systemInstruction: systemInstruction, 
                    tools: nayaxaTools 
                });

                // Conversion for Gemini history (MUST start with 'user')
                let history = prevHistory.map(h => ({
                    role: h.role === 'user' ? 'user' : 'model',
                    parts: [{ text: (h.parts && h.parts[0] ? h.parts[0].text : (h.content || "")) }]
                }));
                while (history.length > 0 && history[0].role !== 'user') history.shift();
                if (history.length > 0) history.pop();

                let userText = userMessage;
                if (fileContext) userText = `${fileContext}\n\n${userText}`;
                
                // --- MULTI-FILE PRE-PROCESSOR ---
                const parts = [];
                const attachmentList = Array.isArray(files) ? files : [];
                for (const file of attachmentList) {
                    const { base64, mimeType } = file;
                    if (!base64 || !mimeType) continue;
                    const extension = file.name ? file.name.split('.').pop().toLowerCase() : '';

                    if (mimeType?.includes('spreadsheetml') || mimeType?.includes('excel') || extension === 'xlsx' || extension === 'xls' || extension === 'csv') {
                        try {
                            const buffer = Buffer.from(base64.split('base64,')[1] || base64, 'base64');
                            const workbook = XLSX.read(buffer, { type: 'buffer' });
                            let sheetData = "";
                            workbook.SheetNames.forEach(sheetName => {
                                sheetData += `\n--- Sheet: ${sheetName} ---\n${XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName])}\n`;
                            });
                            userText += `\n\nDATA FILE (EXCEL/CSV): \n${sheetData}`;
                        } catch (err) {}
                    } else if (mimeType?.includes('wordprocessingml') || extension === 'docx' || extension === 'doc') {
                        try {
                            const wordResult = await mammoth.convertToHtml({ buffer: Buffer.from(base64.split('base64,')[1] || base64, 'base64') });
                            userText += `\n\nDATA FILE (WORD/HTML): \n${wordResult.value.replace(/<img[^>]*>/g, '[Gambar]')}`;
                        } catch (err) {}
                    } else {
                        parts.push({
                            inlineData: { mimeType: mimeType, data: base64.split('base64,')[1] || base64 }
                        });
                    }
                }
                parts.unshift({ text: userText });

                const chat = model.startChat({ history: history, generationConfig: { maxOutputTokens: 8192 } });
                let result = await chat.sendMessage(parts);
                let response = result.response;
                
                const generatedChartMarkers = [];
                const generatedDocLinks = [];
                let loop = 0;

                while (response.functionCalls()?.length > 0 && loop < 5) {
                    loop++;
                    const callResponses = [];
                    for (const call of response.functionCalls()) {
                        const excelFile = attachmentList.find(f => f.mimeType?.includes('excel') || f.mimeType?.includes('spreadsheetml'));
                        const excelBase64 = excelFile ? excelFile.base64 : null;
                        
                        // UI Feedback
                        if (onStepCallback) {
                            if (call.name === 'generate_document') {
                                const ext = (call.args.format || 'DOC').toUpperCase();
                                onStepCallback({ icon: '📝', label: `Sedang membuat file (${ext})...` });
                            } else if (call.name === 'pembangkit_paparan_pptx') {
                                onStepCallback({ icon: '📊', label: 'Sedang membuat file (PPTX)...' });
                            } else if (TOOL_STEP_LABELS[call.name]) {
                                onStepCallback({ icon: TOOL_STEP_LABELS[call.name].icon, label: TOOL_STEP_LABELS[call.name].label });
                            } else {
                                onStepCallback({ icon: '⚡', label: `Nayaxa menggunakan: ${call.name}` });
                            }
                        }

                        let res = await toolFunctions[call.name]({ ...call.args, instansi_id, month, year }, { baseUrl, excelBase64, app_id: 1 });
                        
                        if (res.success && res.download_url) {
                            generatedDocLinks.push({ url: res.download_url, name: call.args.filename || call.args.judul || "Dokumen" });
                        }

                        if (call.name === 'generate_chart' && res.success) {
                            generatedChartMarkers.push(res.chart_marker);
                            res = { success: true, message: 'Chart ready.' };
                        }
                        callResponses.push({ functionResponse: { name: call.name, response: res } });
                    }
                    result = await chat.sendMessage(callResponses);
                    response = result.response;
                }

                let finalResponseText = response.text();
                
                // --- AUTO-LINK INJECTION (v4.5.6) ---
                // Pastikan link download selalu muncul di akhir jawaban jika AI lupa menuliskannya
                if (generatedDocLinks.length > 0) {
                    let linkMarkdowns = "\n\n### 📄 File Hasil Generasi:\n";
                    generatedDocLinks.forEach(doc => {
                        const linkText = `[Unduh ${doc.name}](${doc.url})`;
                        if (!finalResponseText.includes(doc.url)) {
                            linkMarkdowns += `- ${linkText}\n`;
                        }
                    });
                    if (linkMarkdowns.length > 30) finalResponseText += linkMarkdowns;
                }

                if (generatedChartMarkers.length > 0) finalResponseText += "\n\n" + generatedChartMarkers.join("\n\n");
                return finalResponseText;

            } catch (error) {
                attempts++;
                lastError = error;
                const status = error.status || error.response?.status;
                const isOverloaded = status === 503 || status === 429 || error.message?.includes('503') || error.message?.includes('429');
                
                if (isOverloaded && attempts < 2) {
                    console.warn(`[Gemini] Overloaded (Attempt ${attempts}). Retrying with alternate key...`);
                    apiKey = await getApiKey(apiKey);
                    continue;
                }
                
                if (status) error.status = status;
                throw error;
            }
        }
    }
};


module.exports = nayaxaGeminiService;
