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
const codeAgent = require('./codeAgentService');
const nayaxaPromptService = require('./nayaxaPromptService');
const pdf = require('pdf-parse');
const docxTableUpdater = require('./docxTableUpdater');

const summaryCache = new Map();
const _keyCache = { data: null, ts: 0, ttl: 120000 }; // 2 minutes cache

/**
 * Get the primary Gemini API key.
 * Now supports excluding a key that just failed and preferring a specific type.
 */
const getApiKey = async (excludeKeys = null, preferredType = null) => {
    try {
        const now = Date.now();
        // Check cache (only if not rotating/excluding)
        if (!excludeKeys && _keyCache.data && (now - _keyCache.ts < _keyCache.ttl)) {
            const filtered = preferredType 
                ? _keyCache.data.filter(k => k.jenis_ai === preferredType)
                : _keyCache.data.filter(k => k.jenis_ai.includes('Gemini'));
            
            if (filtered.length > 0) return filtered[0].api_key;
        }

        let query = 'SELECT api_key, jenis_ai FROM gemini_api_keys WHERE is_active = 1';
        let params = [];
        
        if (preferredType) {
            query += ' AND jenis_ai = ?';
            params.push(preferredType);
        } else {
            query += " AND jenis_ai IN ('Gemini Free', 'Gemini Paid')";
        }

        if (excludeKeys) {
            const excludes = Array.isArray(excludeKeys) ? excludeKeys : [excludeKeys];
            if (excludes.length > 0) {
                query += ` AND api_key NOT IN (${excludes.map(() => '?').join(',')})`;
                params.push(...excludes);
            }
        }
        
        query += ' ORDER BY FIELD(jenis_ai, "Gemini Paid", "Gemini Free"), last_used ASC';
        
        const [rows] = await dbNayaxa.query(query, params);
        if (rows.length > 0) {
            // Update cache
            if (!excludeKeys && !preferredType) {
                _keyCache.data = rows;
                _keyCache.ts = now;
            }

            const selectedKey = rows[0].api_key;
            dbNayaxa.query('UPDATE gemini_api_keys SET last_used = NOW() WHERE api_key = ?', [selectedKey]).catch(() => {});
            return selectedKey;
        }
    } catch (err) {
        console.error('Error fetching API Key:', err);
    }
    return process.env.GEMINI_API_KEY;
};


const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

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
            description: "Membuat dokumen teks atau tabel baru. Jika user ingin mengekspor RIWAYAT OBROLAN, gunakan 'export_discussion_to_word'. DILARANG KERAS menggunakan tool ini untuk membuat presentasi/paparan/slides.",
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
            name: "export_discussion_to_word",
            description: "Alat khusus untuk mencetak riwayat percakapan ke file Word (.docx). DILARANG KERAS mengetik ulang isi percakapan di layar chat jika user hanya meminta file Word. Gunakan alat ini untuk mengambil data langsung dari database secara otomatis dan memberikan link download secara instan.",
            parameters: {
                type: "object",
                properties: {
                    topik_yang_dipilih: { type: "string", description: "Topik spesifik yang ingin dirangkum (misal: 'Metode Penelitian'). Jika user meminta merangkum semua obrolan, isi dengan 'ALL'." },
                    filename: { type: "string", description: "Nama file output (misal: 'Rangkuman_Diskusi.docx')" }
                },
                required: ["topik_yang_dipilih", "filename"]
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
            name: "analyze_dashboard_document",
            description: "Membaca dan menganalisis secara mendalam dokumen yang ada di Dashboard Dokumen. Gunakan ini jika user meminta analisis spesifik terhadap file yang ditemukan di pencarian.",
            parameters: {
                type: "object",
                properties: {
                    file_id: { type: "number", description: "ID file yang didapat dari hasil search_files_and_knowledge" },
                    query: { type: "string", description: "Pertanyaan spesifik user untuk menggunakan sistem RAG (Semantic Search). Kosongkan jika user hanya meminta ringkasan umum." }
                },
                required: ["file_id"]
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
        { 
            name: "save_document_insight", 
            description: "Menyimpan ulasan mendalam atau catatan analisis khusus (per bab/pasal) dari sebuah dokumen ke memori pengetahuan Nayaxa secara otomatis di latar belakang sesegera mungkin setiap kali Anda menghasilkan ulasan analisis dokumen yang bernilai tinggi dan berfakta kuat. JANGAN pernah memanggil tool ini untuk obrolan kasual, sapaan pembuka, basa-basi, atau chitchat.", 
            parameters: { 
                type: "object", 
                properties: { 
                    file_hash: { type: "string", description: "Hash unik berkas (didapat dari konteks dokumen)" },
                    sub_topic: { type: "string", description: "Nama Bab/Sub-topik khusus (misal: 'Bab III: Perencanaan')" },
                    insight_content: { type: "string", description: "Teks analisis mendalam atau ringkasan khusus yang ingin disimpan" },
                    user_query: { type: "string", description: "Pertanyaan atau kueri pengguna asli yang memicu pembedahan ini" }
                }, 
                required: ["file_hash", "sub_topic", "insight_content", "user_query"] 
            } 
        },
        {
            name: "scan_document_tables",
            description: "Memindai dan membaca struktur semua tabel di dalam dokumen DOCX yang diunggah user. Gunakan tool ini PERTAMA KALI sebelum update_document_tables untuk mengetahui ID tabel, nama header kolom, dan label baris yang tersedia.",
            parameters: {
                type: "object",
                properties: {},
                required: []
            }
        },
        {
            name: "update_document_tables",
            description: "Memperbarui data di dalam tabel-tabel dokumen DOCX berdasarkan mapping yang telah dianalisis. Hasilkan dokumen DOCX baru yang lengkap dengan data yang sudah diperbarui. WAJIB dipanggil setelah scan_document_tables.",
            parameters: {
                type: "object",
                properties: {
                    updates_json: {
                        type: "string",
                        description: "JSON Array berisi daftar update. Format: [{\"table_id\": 1, \"row_label\": \"Nama Program/Kegiatan\", \"column_header\": \"Realisasi\", \"new_value\": \"450000000\"}]"
                    },
                    filename: {
                        type: "string",
                        description: "Nama file output DOCX (misal: 'laporan_updated.docx')"
                    }
                },
                required: ["updates_json", "filename"]
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
        },
        {
            name: "execute_database_update",
            description: "Mengeksekusi SQL query untuk manipulasi data atau struktur database (INSERT, UPDATE, DELETE, ALTER, DROP, CREATE) secara asinkron.",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string", description: "Query SQL DML atau DDL yang akan dieksekusi secara langsung terhadap database." }
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

            const downloadPath = await (format === 'excel' ? exportService.generateExcel(content, filename) :
                                format === 'pdf' ? exportService.generatePDF(content, filename) :
                                exportService.generateWord(content, filename, options));
            
            const downloadUrl = downloadPath.startsWith('http') ? downloadPath : `${baseUrl}${downloadPath}`;
            
            return { 
                success: true, 
                download_url: downloadUrl, 
                message: `File ${format.toUpperCase()} '${filename}' berhasil dibuat. JANGAN tuliskan link download di jawaban Anda, karena sistem sudah menampilkannya secara otomatis melalui tombol.` 
            };
        } catch (err) {
            console.error('[DocumentTool] Error:', err);
            return { success: false, error: err.message };
        }
    },
    export_discussion_to_word: async ({ topik_yang_dipilih, filename }, { baseUrl, session_id }) => {
        try {
            if (!session_id) return { success: false, error: "Session ID tidak ditemukan." };
            
            const [rows] = await dbNayaxa.query(
                "SELECT content FROM nayaxa_chat_history WHERE session_id = ? AND role = 'assistant' AND brain_used IS NOT NULL ORDER BY created_at ASC",
                [session_id]
            );

            if (rows.length === 0) {
                return { success: false, error: "Tidak ada riwayat pembahasan dari AI dalam sesi ini." };
            }

            let filteredMessages = rows.map(r => r.content);

            if (topik_yang_dipilih && topik_yang_dipilih.toUpperCase() !== 'ALL') {
                const topicKeywords = topik_yang_dipilih.toLowerCase().split(' ').filter(k => k.length > 3);
                if (topicKeywords.length > 0) {
                    const matched = rows.map(r => r.content).filter(content => {
                        const lower = content.toLowerCase();
                        return topicKeywords.some(k => lower.includes(k));
                    });
                    if (matched.length > 0) {
                        filteredMessages = matched;
                    }
                }
            }

            const fullContent = filteredMessages.join('\n\n');
            const downloadPath = await exportService.generateWord(fullContent, filename || 'Rangkuman_Diskusi.docx');
            const downloadUrl = downloadPath.startsWith('http') ? downloadPath : `${baseUrl}${downloadPath}`;

            return { 
                success: true, 
                download_url: downloadUrl, 
                message: `File Word rangkuman obrolan '${filename}' untuk topik '${topik_yang_dipilih}' berhasil dibuat secara otomatis dari riwayat. JANGAN tuliskan link download di jawaban Anda, karena sistem sudah menampilkannya melalui tombol.` 
            };
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
    analyze_dashboard_document: async ({ file_id, query }, { app_id, onStepCallback }) => {
        const nayaxaMindService = require('./nayaxaMindService');
        const result = await nayaxaMindService.analyzeAndIngestDocument(file_id, app_id, query, onStepCallback);
        return { analysis_result: result };
    },
    fill_excel_template: async ({ filled_data, filename }, { excelBase64, baseUrl }) => {
        try {
            if (!excelBase64) {
                return { success: false, error: "Tidak ada file Excel yang ditemukan dalam konteks percakapan untuk diisi." };
            }
            const downloadUrl = await exportService.fillExcelTemplate(excelBase64, filled_data, filename);
            const fullUrl = downloadUrl.startsWith('http') ? downloadUrl : `${baseUrl}${downloadUrl}`;
            return { success: true, download_url: fullUrl, message: `Excel berhasil diisi! JANGAN tuliskan link download di jawaban Anda, karena sistem sudah menampilkannya secara otomatis melalui tombol.` };
        } catch (err) {
            return { success: false, error: err.message };
        }
    },
    pembangkit_paparan_pptx: async (data, { baseUrl }) => {
        try {
            const res = await pptxService.generatePresentation(data);
            const downloadUrl = res.url.startsWith('http') ? res.url : `${baseUrl}${res.url}`;
            return { 
                success: true, 
                download_url: downloadUrl, 
                message: `Paparan PPTX '${data.judul}' berhasil dibuat. JANGAN tuliskan link download di jawaban Anda, karena sistem sudah menampilkannya secara otomatis melalui tombol.` 
            };
        } catch (err) {
            return { success: false, error: err.message };
        }
    },
    save_document_insight: async ({ file_hash, sub_topic, insight_content, user_query }) => {
        const nayaxaMindService = require('./nayaxaMindService');
        return await nayaxaMindService.saveDocumentInsight(file_hash, sub_topic, insight_content, user_query);
    },
    scan_document_tables: async (args, { excelBase64, docxBase64 }) => {
        try {
            const base64 = docxBase64 || excelBase64;
            if (!base64) return { success: false, error: 'Tidak ada dokumen DOCX yang ditemukan dalam konteks percakapan. Pastikan user sudah mengunggah file DOCX.' };
            const result = await docxTableUpdater.getTableSummary(base64);
            return result;
        } catch (err) {
            return { success: false, error: err.message };
        }
    },
    update_document_tables: async ({ updates_json, filename }, { excelBase64, docxBase64, baseUrl }) => {
        try {
            const base64 = docxBase64 || excelBase64;
            if (!base64) return { success: false, error: 'Tidak ada dokumen DOCX yang ditemukan dalam konteks percakapan.' };
            const result = await docxTableUpdater.updateDocumentTables(base64, updates_json, filename);
            if (result.success) {
                const fullUrl = result.download_path.startsWith('http') ? result.download_path : `${baseUrl}${result.download_path}`;
                result.download_url = fullUrl;
                result.download_path = undefined;
                result.message = `${result.message} JANGAN tuliskan link download di jawaban Anda, karena sistem sudah menampilkannya secara otomatis melalui tombol.`;
            }
            return result;
        } catch (err) {
            return { success: false, error: err.message };
        }
    },
    // --- CODING AGENT TOOL IMPLEMENTATIONS ---
    list_project_files: async ({ dir_path }) => {
        const codeAgent = require('./codeAgentService');
        return await codeAgent.listFiles(dir_path || 'D:\\nayaxa-engine');
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
    },
    execute_database_update: async ({ query }) => {
        const jsonResult = await nayaxaStandalone.executeSystemQuery(query);
        return { database_result: jsonResult };
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

const checkNeedSchema = (userMessage, prevHistory = [], coding_mode = false) => {
    if (coding_mode) return true;
    const recentHistoryText = prevHistory.slice(-3).map(h => {
        if (typeof h.content === 'string') return h.content;
        if (Array.isArray(h.content)) {
            return h.content.map(part => part.text || '').join(' ');
        }
        return '';
    }).join(' ');
    const combinedText = (userMessage + ' ' + recentHistoryText).toLowerCase();
    return /database|sql|query|tabel|table|pegawai|absen|kehadiran|kegiatan|aktivitas|ranking|bidang|jabatan|rekap|statistik|data|jumlah|scoring/i.test(combinedText);
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
            score += count * (word.length); // Longer words are weighted more heavily
        } catch (e) {}
    });
    return score;
};

const isSummaryRequest = (query) => {
    return /rangkum|ringkas|summary|summarize|analisis komprehensif|master summary|kesimpulan|inti dari|poin-poin|seluruh isi/i.test(query);
};

// --- BACKGROUND MASTER SUMMARY GENERATOR ---
const generateMasterSummaryInBackground = async (fileHash, fileName, extractedText, apiKey) => {
    try {
        console.log(`[Gemini:Background] Starting Master Summary generation for "${fileName}"...`);
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: DEFAULT_MODEL });

        const prompt = `Analisis dan ringkas isi dokumen berikut secara mendalam agar saya bisa memahaminya sebagai referensi masa depan. 
        Sertakan: (1) Inti dokumen, (2) Angka-angka penting jika ada, (3) Aturan/Ketentuan kritis.
        NAMA FILE: ${fileName}
        ISI TEKS:
        ${extractedText.substring(0, 30000)}`;

        const result = await model.generateContent(prompt);
        const masterSummary = result.response.text();

        if (masterSummary) {
            await dbNayaxa.query(
                'UPDATE nayaxa_file_cache SET master_summary = ? WHERE file_hash = ?',
                [masterSummary, fileHash]
            );
            console.log(`[Gemini:Background] Successfully saved Master Summary for "${fileName}".`);
        }
    } catch (err) {
        console.error(`[Gemini:Background] Failed to generate Master Summary for "${fileName}":`, err.message);
    }
};

// --- DYNAMIC COLLABORATIVE MEMORY & SATURATION HELPERS ---
const retrieveHybridContext = async (fileHash, query, onStepCallback = null) => {
    let context = "";
    let isSaturated = false;

    try {
        // Check global configuration for Collaborative Memory
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
            // Cari sub_topic paling relevan berdasarkan relevansi kueri pengguna
            let maxScore = 0;
            insights.forEach(ins => {
                const score = calculateRelevanceScore(ins.sub_topic + " " + ins.summary, query);
                if (score > maxScore && score > 5) { // Threshold minimal kecocokan
                    maxScore = score;
                    relevantInsight = ins;
                }
            });
        }

        if (relevantInsight) {
            console.log(`[CollaborativeMemory] Found relevant insight for topic "${relevantInsight.sub_topic}" (Maturity: ${relevantInsight.maturity_score}, Saturated: ${relevantInsight.is_saturated})`);
            
            if (onStepCallback) {
                onStepCallback({
                    icon: '🧠',
                    label: `Membaca memori pengetahuan kolaboratif: "${relevantInsight.sub_topic}"`
                });
            }

            context += `\n=== MEMORI PENGETAHUAN KOLABORATIF (${relevantInsight.sub_topic.toUpperCase()}) ===\n${relevantInsight.summary}\n`;

            if (relevantInsight.is_saturated === 1) {
                isSaturated = true;
                if (onStepCallback) {
                    onStepCallback({
                        icon: '🎓',
                        label: `Materi "${relevantInsight.sub_topic}" sudah matang sepenuhnya. Melewati ekstraksi dokumen mentah.`
                    });
                }
            }
        }

        // 2. Jika tidak jenuh (not saturated), kita juga ambil chunks teks mentah yang relevan (Hybrid style!)
        if (!isSaturated) {
            if (onStepCallback) {
                onStepCallback({
                    icon: '🔍',
                    label: "Memindai bagian dokumen mentah secara matematis semantik..."
                });
            }

            const [chunks] = await dbNayaxa.query(
                'SELECT chunk_content FROM nayaxa_file_chunks WHERE file_hash = ?',
                [fileHash]
            );

            if (chunks.length > 0) {
                // Berikan skor kecocokan kata kunci pada tiap chunk teks
                const scoredChunks = chunks.map((c, idx) => ({
                    content: c.chunk_content,
                    score: calculateRelevanceScore(c.chunk_content, query),
                    index: idx
                }));

                // Urutkan berdasarkan skor tertinggi dan ambil maksimal 8 chunk paling relevan
                const topChunks = scoredChunks
                    .filter(c => c.score > 0)
                    .sort((a, b) => b.score - a.score)
                    .slice(0, 8);

                // Jika tidak ada kata kunci yang cocok sama sekali, ambil 4 chunks pertama sebagai default fallback
                const selectedChunks = topChunks.length > 0 ? topChunks : scoredChunks.slice(0, 4);

                context += `\n=== TEKS DOKUMEN ASLI ===\n` + selectedChunks.map(c => `[Fragmen #${c.index + 1}]\n${c.content}`).join('\n\n');
            }
        }

    } catch (err) {
        console.error('[CollaborativeMemory_Retrieve_Error]:', err.message);
    }

    return context;
};

const nayaxaGeminiService = {

    chatWithNayaxa: async (userMessage, files, instansi_id, month, year, prevHistory = [], user_name = "Pengguna", profil_id = null, fileContext = '', current_page = '', page_title = '', baseUrl = '', fullDate = '', nama_instansi = 'N/A', personaPromptSnippet = '', userProfile = null, lastActivityContext = null, coding_mode = false, session_id = null, onStepCallback = null, signal = null, keyPreference = false) => {
        // keyPreference can be: true (Paid), false (Auto), 'Gemini Paid', or 'Gemini Free'
        let preferredType = null;
        if (keyPreference === true || keyPreference === 'Gemini Paid') preferredType = 'Gemini Paid';
        else if (keyPreference === 'Gemini Free') preferredType = 'Gemini Free';

        let apiKey = await getApiKey(null, preferredType);
        let attempts = 0;
        let excludedKeys = [];
        let currentModelName = DEFAULT_MODEL;

        const safetySettings = [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
        ];
        let lastError = null;

        const needSchema = checkNeedSchema(userMessage, prevHistory, coding_mode);
        let schemaMapString = "[DATABASE SCHEMA] Skema database lengkap hanya dilampirkan jika terdeteksi pertanyaan berbasis data/statistik.";
        let glossaryString = "[GLOSSARY] Glosarium resmi hanya dilampirkan jika terdeteksi pertanyaan berbasis data/statistik.";

        if (needSchema) {
            schemaMapString = await nayaxaStandalone.getDatabaseSchema();
            glossaryString = await nayaxaStandalone.getMasterDataGlossary();
        }

        // Format identity string
        let identitasUser = `Nama: ${user_name}, Instansi: ${nama_instansi} (ID: ${instansi_id}).`;
        if (userProfile) {
            identitasUser += ` 
            DETAIL PROFIL:
            - Bidang: ${userProfile.bidang || 'N/A'}
            - Jabatan: ${userProfile.jabatan || 'N/A'}
            - Nama Instansi: ${userProfile.nama_instansi || nama_instansi}
            - Instansi yang Diampu: ${Array.isArray(userProfile.instansi_diampu) && userProfile.instansi_diampu.length > 0 ? userProfile.instansi_diampu.join(', ') : (typeof userProfile.instansi_diampu === 'string' ? userProfile.instansi_diampu : 'Tidak ada data pengampuan instansi.')}
            - Urusan/Tugas yang Diampu: ${Array.isArray(userProfile.urusan_diampu) && userProfile.urusan_diampu.length > 0 ? userProfile.urusan_diampu.join(', ') : (typeof userProfile.urusan_diampu === 'string' ? userProfile.urusan_diampu : 'Tidak ada data pengampuan urusan.')}`;
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

        const generalPersonaPrompt = nayaxaPromptService.getNayaxaGeneralPersonaPrompt(userProfile, user_name, lastActivityContext); /*
Gaya Bahasa: Sangat ceria, antusias, hangat, penuh semangat, profesional, dan empatik. Di akhir setiap penjelasan, SELALU tawarkan bantuan ekstra atau berikan satu pertanyaan pendek.
PENTING: DILARANG KERAS MENGGUNAKAN EMOJI APAPUN.
        
PENTING - ADAPTASI FORMALITAS: Sesuaikan tingkat formalitas Anda dengan Profil Kepribadian User (${userProfile?.detected_formality || 'Formal'}). Jika user terbiasa santai (Gue/Lo, Gw/Lu), gunakan gaya casual-professional.
- Meskipun tingkat formalitas disesuaikan (menggunakan Saya/Anda untuk user formal, atau Aku/Kamu/Gue/Lo untuk user santai), Anda **WAJIB tetap mempertahankan kepribadian yang ceria, ramah, optimis, dan penuh semangat**. Jangan biarkan bahasa formal membuat Anda terdengar kaku atau robotik. Tetaplah hangat dan ceria dalam menyampaikan saran!
        
*/

        const systemInstruction = coding_mode ? codingAgentPrompt : `
            ${generalPersonaPrompt}

            !!! VISION & MULTIMODAL CAPABILITY (PENTING) !!!
            - Jika user mengirimkan GAMBAR, SCREENSHOT, atau DATA VISUAL, Anda WAJIB menganalisisnya secara mendalam.
            - Gunakan konten visual tersebut sebagai konteks utama untuk menjawab pertanyaan user.
            - Jika user bertanya tentang "ini" atau "itu" sambil mengirimkan screenshot, asumsikan "ini/itu" merujuk pada objek di dalam gambar tersebut.

            !!! PROTOKOL RISET & PENCARIAN (STRICT) !!!
            1. PRIORITAS INTERNAL: Jika user bertanya tentang data organisasi (Kegiatan, Bidang, Pegawai, Urusan, atau Statistik Dashboard), Anda WAJIB menggunakan tool 'execute_sql_query' atau 'get_pegawai_statistics'.
            2. PEMBATASAN INTERNET: DILARANG KERAS menggunakan 'search_internet' untuk data internal di atas secara default.
            3. PENGECUALIAN INTERNET: Anda HANYA boleh menggunakan 'search_internet' untuk data internal JIKA user menyebutkan instruksi eksplisit seperti "cari di internet juga", "cek berita terkait", atau "verifikasi secara online".
            4. FAKTA PUBLIK: Tetap gunakan 'search_internet' secara proaktif untuk fakta yang bisa berubah di luar organisasi (Berita Nasional, Jabatan Menteri, Presiden, Pilkada 2024, Pelantikan 2025, atau Teknologi).
            5. JANGAN PERNAH MENGARANG: Jika database kosong untuk bulan berjalan, katakan "Data belum tersedia di database" daripada mencari di internet tanpa perintah.
            6. PENCARIAN BERTINGKAT: 
               - Step 1: 'execute_sql_query' (Internal Data).
               - Step 2: 'search_files_and_knowledge' (Internal Documents).
               - Step 3: 'search_internet' (Public Facts OR Explicit User Request).
            7. SELF-CORRECTION: Abaikan berita tahun 2018-2022 jika mencari status pejabat saat ini. Prioritaskan Kabinet Merah Putih (2024-2029).

            !!! PROTOKOL URUTAN EKSEKUSI TOOL & STRUKTUR RESPONS (MUTLAK) !!!
             - **TAHAP 1: EKSEKUSI ALAT (SILENT FIRST TURN)**: Jika Anda memutuskan untuk memanggil alat/tool apa pun (seperti 'search_files_and_knowledge' atau 'execute_sql_query'), Anda **DILARANG KERAS** menulis teks biasa, sapaan pembuka, janji pencarian, atau kalimat "Mohon tunggu" (seperti "Saya akan mencari...", "Tunggu sebentar...") di obrolan utama pada giliran pertama. Anda **WAJIB langsung melakukan pemanggilan tool secara instan** tanpa karakter teks biasa. Narasi pencarian atau rencana Anda hanya boleh ditulis secara internal di dalam tag <thought>...</thought>.
             - **TAHAP 2: PENYAJIAN RESPONS ANALITIS (SETELAH TOOL SELESAI)**: Narasi pembuka yang ramah, pengantar konteks, tabel data utama, analisis wawasan mendalam (insights), dan kesimpulan **HANYA BOLEH Anda susun setelah seluruh tool selesai dieksekusi** dan Anda telah memegang data riilnya.
             - Kegagalan mematuhi urutan ini (yaitu menulis teks janji pencarian di giliran pertama tanpa memanggil tool) akan merusak alur aplikasi dan membuat Anda terhenti tanpa memberikan data!

            - **AKURASI METADATA (PENTING)**: Saat melakukan kueri 'profil_pegawai', Anda WAJIB melakukan LEFT JOIN dengan 'master_bidang_instansi' (on bidang_id) dan 'master_jabatan' (on jabatan_id) untuk mendapatkan nama Bidang dan Jabatan yang valid.
            - **STRATEGI KUERI KEGIATAN PER BIDANG (PENTING)**: 
              * View 'v_rekap_kegiatan_harian' dan tabel 'kegiatan_harian_pegawai' **TIDAK memiliki** kolom 'bidang_id' atau 'nama_bidang'!
              * Jika Anda ingin memfilter atau mencari kegiatan pegawai berdasarkan Bidang tertentu (seperti PPM [ID: 2], dll), Anda **WAJIB melakukan JOIN** dengan 'profil_pegawai' (pp) terlebih dahulu karena hanya tabel profil yang menyimpan relasi 'bidang_id'.
              * Contoh kueri gabungan yang benar dan dijamin sukses:
                \`SELECT pp.nama_lengkap, vr.nama_kegiatan, vr.tanggal FROM v_rekap_kegiatan_harian vr JOIN profil_pegawai pp ON vr.profil_pegawai_id = pp.id WHERE pp.bidang_id = 2 AND MONTH(vr.tanggal) = 3 AND YEAR(vr.tanggal) = 2026\`
            - **PENGGUNAAN ID**: Gunakan ID dari GLOSARIUM RESMI (misal: [ID: 2] untuk PPM) dalam kueri SQL Anda untuk akurasi filter 100%. DILARANG menebak ID.
            - **DILARANG HALUSINASI**: Jangan menuliskan "(Belum terisi)" jika Anda belum melakukan join ke tabel master. Jika data memang NULL setelah join, gunakan "Tanpa Bidang".
            - Gunakan 'execute_sql_query' untuk data spesifik per bidang.
            
            PENTING - FORMAT JAWABAN & ANALISIS MENDALAM:
            - **DILARANG TERLALU TO-THE-POINT / SINGKAT**: Jangan pernah menyajikan tabel data atau hasil kueri mentah begitu saja tanpa penjelasan. Anda adalah seorang Asisten Analis Senior Bapperida yang cerdas, sehingga Anda **WAJIB** memberikan narasi penjelasan yang kaya, interpretasi makna data, identifikasi tren, anomali, serta implikasi praktisnya terhadap instansi di setiap respon Anda.
${nayaxaPromptService.getNayaxaProtokolPrompt()}
            - **STRUKTUR RESPONS ANALITIS PREMIUM**:
                1. **Konteks & Pengantar**: Berikan pengantar ramah yang menjelaskan relevansi data yang sedang disajikan.
                2. **Data Utama**: Sajikan data pokok secara rapi menggunakan Tabel Markdown, Grafik (melalui tool generate_chart jika relevan), atau List bertingkat yang indah.
                3. **Analisis & Wawasan Mendalam (Insights)**: Berikan sub-bab khusus (misal: "### 📊 Analisis & Wawasan") untuk mengulas tren kenaikan/penurunan, perbandingan dengan periode lalu, efektivitas kinerja, atau anomali yang ditemukan.
                4. **Rekomendasi / Kesimpulan**: Berikan ringkasan penutup taktis dan tawarkan bantuan lanjutan yang spesifik secara empatik.
            - SELALU gunakan format Markdown (Heading, Bold, Bullet Points, dan Tabel Markdown).
            - **ATURAN SPASI BOLD (PENTING)**: Anda WAJIB memberikan spasi yang jelas sebelum dan sesudah kata yang ditebalkan (bold). Contoh yang BENAR: "Gubernur **Andra Soni** dilantik", Contoh yang SALAH: "Gubernur**Andra Soni**dilantik". Ini demi kerapian konversi dokumen.
            - **DILARANG KERAS mengeluarkan output berupa kode SQL mentah (seperti SELECT, JOIN, atau WHERE) langsung ke dalam chat.** Kode SQL hanya boleh digunakan secara internal di dalam parameter fungsi 'execute_sql_query'. Anda harus menyajikan hasil eksekusinya dalam bentuk Tabel Markdown.
            - DILARANG JSON mentah di chat.
            - ATURAN TRANSPARANSI: Jika jawaban berasal dari 'search_internet' (berita/pejabat/fakta publik), Anda WAJIB menambahkan footer transparansi di akhir jawaban Anda dengan format sebagai berikut:
              
              ---
              🔍 **RESEARCH TRANSPARENCY**
              **Sumber Utama:** [Nama Situs/Link]
              **Waktu Akses:** [Gunakan 'search_date' dari hasil tool secara utuh]
              **Catatan:** Informasi ini ditarik secara real-time melalui Nayaxa Resilience Mode. Untuk keperluan resmi, silakan merujuk pada dokumen negara atau situs kementerian terkait.
            
            WAKTU AKTIF: ${fullDate}. Selalu gunakan nilai ini sebagai filter waktu default dan referensi sapaan waktu (Pagi/Siang/Sore/Malam).
            
            CATATAN DOKUMEN & FILE: 
            - **FILE UNGGULAN CHAT (PENTING)**: Jika pesan pengguna diawali dengan format \`[FILE: nama_file -> ACTION: tindakan]\` (seperti \`[FILE: PM-3201-13-6-inovasi-pmba-1776053180.pdf -> ACTION: Analisis]\`), ini adalah file yang BARU saja diunggah di dalam chat obrolan ini. Teks dari file ini SUDAH diekstrak dan disertakan dalam konteks pesan (\`[DOKUMEN DIUNGGAH DI CHAT]\`). Anda **DILARANG KERAS** menggunakan tool 'analyze_dashboard_document' atau 'search_files_and_knowledge' untuk mencari file ini di database/dashboard. Cukup baca isi teks yang sudah diberikan dan langsung jawab secara instan!
            - **DOKUMEN TERLAMPIR / DIUNGGAH**: Jika user mengunggah file (PDF/Excel/Word/Gambar) dan meminta Anda menganalisisnya, **ANDA WAJIB LANGSUNG membaca, menganalisis, dan menyajikan hasilnya di pesan yang sama secara instan!** DILARANG KERAS beralasan "membutuhkan waktu untuk memproses", "izinkan saya menganalisis", atau "sembari saya membaca". Anda adalah AI yang memproses seketika, BUKAN manusia!
            - Jika user bertanya tentang dokumen, mencari file, atau meminta file spesifik ("Mana dokumen X?", "Minta file Y"), Anda WAJIB LANGSUNG menggunakan tool 'search_files_and_knowledge' tanpa basa-basi.
            - **ANDA WAJIB memberikan link download** untuk setiap hasil berkategori [FILE].
            - **DILARANG KERAS** memberikan jawaban tanpa link jika file ditemukan.
            - **DILARANG KERAS MENULIS LINK SECARA MANUAL** di dalam teks jawaban Anda (seperti http://localhost...). Cukup gunakan tool, dan sistem akan menampilkannya secara otomatis.
            - **ON-DEMAND LEARNING**: Jika user meminta Anda untuk "Membaca", "Menganalisis", "Mempelajari", atau "Meringkas" dokumen yang ditemukan di Dashboard (bukan file yang baru saja diunggah di chat), gunakan tool 'analyze_dashboard_document' dengan ID file yang sesuai. Hasil analisis akan secara otomatis disimpan ke memori jangka panjang Anda (Nayaxa Intelligence) agar hemat token di masa depan.
            - Format Link: [Unduh (Nama File)](URL_DARI_TOOL). Letakkan link ini secara menonjol di bagian ATAS jawaban Anda dengan format tombol Markdown yang jelas.
            
            PENGISIAN EXCEL: Jika user mengunggah file Excel (Template) dan meminta Anda untuk "mengisi", "lengkapi", atau "masukkan data" ke dalamnya, gunakan tool 'fill_excel_template'. 
            TEKNIK PENGISIAN: 
            - Gunakan key "uraian" atau "label" untuk mencocokkan baris yang ingin diisi. 
            - Gunakan key lain yang sesuai dengan Nama Header Kolom (misal: "hasil verifikasi", "rekomendasi", "keterangan") untuk mengisi nilainya.
            - Contoh: [{"uraian": "Lokasi", "rekomendasi": "Masukkan alamat lengkap"}] akan mencari baris yang mengandung kata 'Lokasi' dan mengisi kolom 'REKOMENDASI' di baris tersebut.
            
            UPDATE DOCX TABLES: Jika user mengunggah file DOCX dan meminta Anda untuk "memperbarui tabel", "mengganti isian tabel", atau "memasukkan data ke tabel dokumen", ikuti 2 langkah wajib ini:
            1. Panggil tool 'scan_document_tables' terlebih dahulu untuk memindai ID tabel, nama kolom, dan label baris yang ada di dokumen.
            2. Setelah menerima hasil scan, panggil tool 'update_document_tables' dengan menyertakan JSON updates_json yang berisi pemetaan data baru ke tabel/baris/kolom yang tepat.
            
            Identitas USER: ${identitasUser}
            PENTING: DILARANG KERAS memunculkan "ID", "NIP", "Profil ID", "Instansi ID", atau angka identitas teknis lainnya (seperti: "ID: 151", "ID: 66", dsb) kecuali user bertanya secara spesifik. 
            - Anda WAJIB MEMBERSIHKAN (sanitasi) semua kolom ID dari hasil database sebelum menyajikannya.
            - Untuk 'Lampiran', jangan tampilkan ID-nya. Cukup sebutkan "Tersedia" atau berikan link. Jangan pernah menulis "(ID: 66)".
            - Jika data ditemukan dari internet atau database, LANGSUNG sajikan jawabannya tanpa menceritakan langkah-langkah teknis Anda. Narasi pencarian HANYA boleh ada di dalam tag <thought>.
            ${personaPromptSnippet}
            
            ${schemaMapString}
            (Analisis data secara ramah dan bantu user ${user_name} sepenuh hati).
        `;


        const maxAttempts = preferredType === 'Gemini Paid' ? 1 : 5; // Increased retry for Free keys to utilize the pool better
        while (attempts < maxAttempts) {
            try {
                const genAI = new GoogleGenerativeAI(apiKey);
                const model = genAI.getGenerativeModel({ 
                    model: currentModelName, 
                    systemInstruction: systemInstruction, 
                    tools: nayaxaTools,
                    safetySettings: safetySettings
                });

                // Conversion for Gemini history (MUST start with 'user')
                let history = prevHistory.map(h => {
                    const parts = (h.parts || []).map(p => {
                        if (p.functionCall) {
                            const newCall = { ...p.functionCall };
                            delete newCall.thoughtSignature;
                            delete newCall.thought_signature;
                            return {
                                functionCall: newCall,
                                thoughtSignature: "skip_thought_signature_validator",
                                thought_signature: "skip_thought_signature_validator"
                            };
                        }
                        return { text: p.text || h.content || "" };
                    });
                    if (parts.length === 0) parts.push({ text: h.content || "" });
                    return {
                        role: h.role === 'user' ? 'user' : 'model',
                        parts: parts
                    };
                });
                while (history.length > 0 && history[0].role !== 'user') history.shift();
                if (history.length > 0) history.pop();

                let localFileContext = '';
                const attachmentList = Array.isArray(files) ? files : [];
                
                // --- MULTI-FILE PRE-PROCESSOR (v4.6.5: Hashing, Caching & Hybrid RAG) ---
                for (const file of attachmentList) {
                    const { base64, mimeType } = file;
                    if (!base64 || !mimeType) continue;
                    const fileName = file.name || 'file-tanpa-nama';

                    const isExcel = mimeType?.includes('spreadsheetml') || mimeType?.includes('excel') || mimeType?.includes('officedocument.spreadsheetml.sheet');
                    const isCSV = mimeType?.includes('csv');
                    const extension = file.name ? file.name.split('.').pop().toLowerCase() : '';
                    
                    const isDoc = isExcel || isCSV || extension === 'xlsx' || extension === 'xls' || extension === 'csv' ||
                                  mimeType?.includes('wordprocessingml') || mimeType?.includes('msword') || extension === 'docx' || extension === 'doc' ||
                                  mimeType?.includes('pdf') || extension === 'pdf' || extension === 'txt' || mimeType?.includes('text/plain');

                    if (isDoc) {
                        try {
                            const cleanB64 = base64.includes('base64,') ? base64.split('base64,')[1] : base64;
                            const buffer = Buffer.from(cleanB64, 'base64');
                            const fileHash = crypto.createHash('sha256').update(buffer).digest('hex');

                            console.log(`[Gemini] Processing document "${fileName}" (Hash: ${fileHash}). Checking cache...`);
                            if (onStepCallback) onStepCallback({ icon: '🔍', label: `Memverifikasi sidik jari dokumen: ${fileName}...` });

                            const [cachedRows] = await dbNayaxa.query(
                                'SELECT extracted_text, master_summary FROM nayaxa_file_cache WHERE file_hash = ? LIMIT 1',
                                [fileHash]
                            );

                            let extractedText = '';
                            let cachedSummary = null;
                            let isCacheHit = false;

                            if (cachedRows.length > 0) {
                                extractedText = cachedRows[0].extracted_text || '';
                                cachedSummary = cachedRows[0].master_summary;
                                isCacheHit = true;
                                console.log(`[Gemini] Cache HIT for "${fileName}" (${fileHash})!`);
                                if (onStepCallback) onStepCallback({ icon: '⚡', label: `Dokumen terdeteksi! Memuat instan dari cache lokal...` });
                            } else {
                                console.log(`[Gemini] Cache MISS for "${fileName}". Parsing file physically...`);
                                if (onStepCallback) onStepCallback({ icon: '📂', label: `Mengekstrak berkas baru: ${fileName}...` });

                                if (isExcel || isCSV || extension === 'xlsx' || extension === 'xls' || extension === 'csv') {
                                    if (onStepCallback) onStepCallback({ icon: '📊', label: `Membaca lembar kerja Excel...` });
                                    const workbook = XLSX.read(buffer, { type: 'buffer' });
                                    workbook.SheetNames.forEach(sheetName => {
                                        const sheet = workbook.Sheets[sheetName];
                                        const csv = XLSX.utils.sheet_to_csv(sheet);
                                        extractedText += `\n--- Sheet: ${sheetName} ---\n${csv}\n`;
                                    });
                                } else if (extension === 'txt' || mimeType?.includes('text/plain')) {
                                    if (onStepCallback) onStepCallback({ icon: '📄', label: `Membaca berkas teks murni...` });
                                    extractedText = buffer.toString('utf8');
                                } else if (mimeType?.includes('wordprocessingml') || mimeType?.includes('msword') || extension === 'docx' || extension === 'doc') {
                                    if (onStepCallback) onStepCallback({ icon: '📝', label: `Membaca dokumen Word...` });
                                    const wordResult = await mammoth.convertToHtml({ buffer });
                                    extractedText = wordResult.value.replace(/<img[^>]*>/g, '[Gambar]');
                                } else if (mimeType?.includes('pdf') || extension === 'pdf') {
                                    if (onStepCallback) onStepCallback({ icon: '📄', label: `Membaca dokumen PDF...` });
                                    const pdfParser = typeof pdf === 'function' ? pdf : pdf.default;
                                    if (!pdfParser) throw new Error('Library pdf-parse tidak ditemukan.');
                                    const pdfData = await pdfParser(buffer);
                                    extractedText = pdfData.text?.trim() || '';
                                }
                            }

                            // --- SMART DETECTOR FOR VISION FALLBACK (v4.8.0) ---
                            const isPDF = mimeType?.includes('pdf') || extension === 'pdf';
                            if (isPDF) {
                                const isDetailedQuery = /jelaskan|analisis|detil|detail|daftar|apa saja|inovasi|isi|ringkas|rangkum|pembedahan/i.test(userMessage);
                                const textLength = extractedText.trim().length;
                                let triggerVision = false;

                                if (textLength < 100) {
                                    // 1. Teks sangat pendek (< 100 karakter) -> Pasti scan/gambar -> Langsung Vision Fallback!
                                    triggerVision = true;
                                    console.warn(`[Gemini] PDF '${fileName}' memiliki teks sangat pendek (${textLength} karakter). Menggunakan native vision fallback.`);
                                } else if (textLength < 500 && isDetailedQuery) {
                                    // 2. Teks pendek (< 500 karakter) tapi user meminta penjelasan detil/analisis -> Judul/Metadata saja -> Gunakan Vision Fallback!
                                    triggerVision = true;
                                    console.warn(`[Gemini] PDF '${fileName}' memiliki teks terbatas (${textLength} karakter) dan tidak sesuai kueri analisis pengguna. Menggunakan native vision fallback.`);
                                }

                                if (triggerVision) {
                                    // if (onStepCallback) onStepCallback({ icon: '👁️', label: `Mengaktifkan Gemini Vision untuk analisis visual mendalam...` });
                                    file._useVisionFallback = true;
                                    localFileContext = (localFileContext ? localFileContext + '\n\n' : '') +
                                        `[PERINGATAN: File "${fileName}" adalah PDF berbasis gambar/scan. ` +
                                        `Isi dokumen sedang diproses langsung melalui kemampuan visual Gemini (native vision). ` +
                                        `Bacalah konten visualnya secara langsung dari lampiran dan jawab pertanyaan pengguna berdasarkan apa yang Anda lihat di dalamnya.]`;
                                    continue; // Lewati seluruh pipeline pemotongan teks murni
                                }
                            }

                            // Simpan ke Cache dan Chunks jika Cache MISS dan teksnya panjang & valid
                            if (!isCacheHit && extractedText.trim().length > 0) {
                                await dbNayaxa.query(
                                    'INSERT IGNORE INTO nayaxa_file_cache (file_hash, file_name, extracted_text) VALUES (?, ?, ?)',
                                    [fileHash, fileName, extractedText]
                                );

                                const chunks = chunkDocument(extractedText, 1200, 250);
                                for (let j = 0; j < chunks.length; j++) {
                                    await dbNayaxa.query(
                                        'INSERT INTO nayaxa_file_chunks (file_hash, chunk_index, chunk_content) VALUES (?, ?, ?)',
                                        [fileHash, j, chunks[j]]
                                    );
                                }

                                if (onStepCallback) onStepCallback({ icon: '⚙️', label: `Memulai pembuatan Ringkasan Induk di latar belakang...` });
                                generateMasterSummaryInBackground(fileHash, fileName, extractedText, apiKey);
                            }

                            if (onStepCallback) onStepCallback({ icon: '🧠', label: `Menjalankan Hybrid RAG pencarian relevansi...` });

                            if (isSummaryRequest(userMessage)) {
                                const summaryToUse = cachedSummary || extractedText.substring(0, 15000);
                                const label = cachedSummary ? 'Menggunakan Ringkasan Induk instan' : 'Mengekstrak porsi utama berkas';
                                if (onStepCallback) onStepCallback({ icon: '📋', label: `${label}...` });

                                localFileContext = (localFileContext ? localFileContext + '\n\n' : '') + 
                                    `RINGKASAN INDUK DOKUMEN (NAMA FILE: "${fileName}", HASH: "${fileHash}"):\n${summaryToUse}`;
                            } else {
                                const hybridContext = await retrieveHybridContext(fileHash, userMessage, onStepCallback);
                                localFileContext = (localFileContext ? localFileContext + '\n\n' : '') + 
                                    `KONTEKS DOKUMEN (NAMA FILE: "${fileName}", HASH: "${fileHash}"):\n${hybridContext}`;
                            }
                        } catch (err) {
                            console.error(`[Gemini] Error processing document ${fileName}:`, err);
                            if (onStepCallback) onStepCallback({ icon: '❌', label: `Gagal membaca dokumen: ${err.message}` });
                            localFileContext = (localFileContext ? localFileContext + '\n\n' : '') + 
                                `DATA FILE (ERROR) - NAMA FILE: "${fileName}":\nGagal memproses file: ${err.message}.`;
                        }
                    }
                }

                const parts = [];
                let userText = userMessage;

                const combinedFileContext = (fileContext || '') + (localFileContext || '');
                if (combinedFileContext) {
                    userText = `[DOKUMEN DIUNGGAH DI CHAT]\nBerikut adalah isi dokumen referensi utama yang baru saja saya unggah di chat ini. Dokumen ini BUKAN dokumen dari Dashboard, melainkan dokumen lokal saya untuk diskusi ini. Baca dan gunakan konten berikut untuk menjawab:\n\n${combinedFileContext}\n\n---\n\nPertanyaan saya:\n${userText}`;
                }

                for (const file of attachmentList) {
                    const { base64, mimeType } = file;
                    if (!base64 || !mimeType) continue;
                    const extension = file.name ? file.name.split('.').pop().toLowerCase() : '';

                    const isExcel = mimeType?.includes('spreadsheetml') || mimeType?.includes('excel') || mimeType?.includes('officedocument.spreadsheetml.sheet');
                    const isCSV = mimeType?.includes('csv');
                    const isPDF = mimeType?.includes('pdf') || extension === 'pdf';
                    const isDoc = isExcel || isCSV || extension === 'xlsx' || extension === 'xls' || extension === 'csv' ||
                                  mimeType?.includes('wordprocessingml') || mimeType?.includes('msword') || extension === 'docx' || extension === 'doc' ||
                                  isPDF || extension === 'txt' || mimeType?.includes('text/plain');

                    // Kirimkan sebagai inlineData jika: (1) bukan dokumen teks (gambar dll), atau
                    // (2) PDF yang ditandai sebagai scan/gambar (vision fallback)
                    if (!isDoc || (isPDF && file._useVisionFallback)) {
                        parts.push({
                            inlineData: { mimeType: mimeType, data: base64.split('base64,')[1] || base64 }
                        });
                    }
                }

                parts.unshift({ text: userText });


                const chat = model.startChat({ history: history, generationConfig: { maxOutputTokens: 8192 } });
                
                // Use streaming version to show typing effect character-by-character
                let resultStream = await chat.sendMessageStream(parts, { signal });
                let responseText = "";
                try {
                    for await (const chunk of resultStream.stream) {
                        const chunkText = chunk.text();
                        responseText += chunkText;
                        if (onStepCallback) onStepCallback({ type: 'message_chunk', text: chunkText });
                    }
                } catch (streamErr) {
                    console.error('[Gemini] Stream iteration error:', streamErr.message);
                    if (!responseText) throw streamErr;
                    console.warn('[Gemini] Stream interrupted but some content was received.');
                }
                
                let response = await resultStream.response;
                
                const generatedChartMarkers = [];
                const generatedDocLinks = [];
                let loop = 0;

                while (response.functionCalls()?.length > 0 && loop < 5) {
                    loop++;
                    const callResponses = [];
                    for (const call of response.functionCalls()) {
                        const excelFile = attachmentList.find(f => f.mimeType?.includes('excel') || f.mimeType?.includes('spreadsheetml'));
                        const excelBase64 = excelFile ? excelFile.base64 : null;
                        const docxFile = attachmentList.find(f => f.mimeType?.includes('wordprocessingml') || f.mimeType?.includes('msword') || f.name?.toLowerCase().endsWith('.docx') || f.name?.toLowerCase().endsWith('.doc'));
                        const docxBase64 = docxFile ? docxFile.base64 : null;
                        
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

                        let res = await toolFunctions[call.name]({ ...call.args, instansi_id, month, year }, { baseUrl, excelBase64, docxBase64, app_id: 1, session_id, onStepCallback });
                        
                        if (res.success && res.download_url) {
                            const actualFileName = res.download_url.split('/').pop();
                            generatedDocLinks.push({ url: res.download_url, name: actualFileName || call.args.filename || "Dokumen" });
                        }

                        if (call.name === 'generate_chart' && res.success) {
                            generatedChartMarkers.push(res.chart_marker);
                            res = { success: true, message: 'Chart ready.' };
                        }
                        callResponses.push({ functionResponse: { name: call.name, response: res } });
                    }
                    if (chat._history && Array.isArray(chat._history)) {
                        chat._history.forEach(turn => {
                            if (turn.parts && Array.isArray(turn.parts)) {
                                turn.parts.forEach(part => {
                                    if (part.functionCall) {
                                        delete part.functionCall.thoughtSignature;
                                        delete part.functionCall.thought_signature;
                                        part.thoughtSignature = "skip_thought_signature_validator";
                                        part.thought_signature = "skip_thought_signature_validator";
                                    }
                                });
                            }
                        });
                    }
                    try {
                        resultStream = await chat.sendMessageStream(callResponses, { signal });
                        for await (const chunk of resultStream.stream) {
                            try {
                                const text = chunk.text();
                                if (text && onStepCallback) {
                                    onStepCallback({ type: 'message_chunk', text });
                                }
                            } catch (e) {}
                        }
                        response = await resultStream.response;
                    } catch (loopErr) {
                        console.error('[Gemini] Tool response streaming error:', loopErr.message);
                        break;
                    }
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
                
                if (attempts < maxAttempts) {
                    console.warn(`[Gemini] Error encountered (Attempt ${attempts}): ${error.message}. Status: ${status}. Retrying alternate keys...`);
                    
                    // Add a small delay to avoid slamming the next key immediately (esp. if 429)
                    await new Promise(resolve => setTimeout(resolve, 1000));

                    // Retrying with another key of the same preferred type (if any) or any other healthy key
                    excludedKeys.push(apiKey);
                    apiKey = await getApiKey(excludedKeys, preferredType);
                    continue;
                }
                
                console.error(`[Gemini] Final attempt failed. Model: ${currentModelName}, Key: ${apiKey.substring(0, 8)}..., Error: ${error.message}`);
                
                // Debug log to database
                try {
                    await dbNayaxa.query(
                        'INSERT INTO nayaxa_mind_logs (task_name, status, message, started_at, finished_at) VALUES (?, ?, ?, NOW(), NOW())',
                        ['Gemini Error Debug', 'FAILED', `Model: ${currentModelName} | Key: ${apiKey.substring(0, 8)}... | Error: ${error.message}`]
                    );
                } catch (logErr) {
                    console.error('Failed to log error to DB:', logErr.message);
                }

                if (status) error.status = status;
                throw error;
            }
        }
    }
};


module.exports = nayaxaGeminiService;
