const axios = require('axios');
const XLSX = require('xlsx');
const mammoth = require('mammoth');
const pdf = require('pdf-parse');
const dbDashboard = require('../config/dbDashboard');
const dbNayaxa = require('../config/dbNayaxa');
const crypto = require('crypto');
const nayaxaStandalone = require('./nayaxaStandalone');
const exportService = require('./exportService');
const knowledgeTool = require('./knowledgeTool');
const codeAgent = require('./codeAgentService');
const nayaxaPromptService = require('./nayaxaPromptService');
const docxTableUpdater = require('./docxTableUpdater');

const _keyCache = { data: null, ts: 0, ttl: 120000 }; // 2 minutes cache

const getApiKey = async (excludeKey = null) => {
    try {
        const now = Date.now();
        // Check cache
        if (!excludeKey && _keyCache.data && (now - _keyCache.ts < _keyCache.ttl)) {
            return _keyCache.data[0].api_key;
        }

        let query = "SELECT api_key FROM gemini_api_keys WHERE is_active = 1 AND jenis_ai = 'DeepSeek Paid'";
        let params = [];
        if (excludeKey) {
            query += ' AND api_key != ?';
            params.push(excludeKey);
        }
        query += ' ORDER BY last_used ASC LIMIT 1';
        
        const [rows] = await dbNayaxa.query(query, params);
        if (rows.length > 0) {
            if (!excludeKey) {
                _keyCache.data = rows;
                _keyCache.ts = now;
            }
            const selectedKey = rows[0].api_key;
            dbNayaxa.query('UPDATE gemini_api_keys SET last_used = NOW() WHERE api_key = ?', [selectedKey]).catch(() => {});
            return selectedKey;
        }
    } catch (err) {
        console.error('Error fetching DeepSeek API Key:', err);
    }
    return process.env.NAYAXA_DEEPSEEK_API_KEY;
};

const toolFunctions = {
    search_internet: async ({ query }) => {
        const jsonResult = await nayaxaStandalone.searchInternet(query);
        return { internet_result: jsonResult };
    },
    get_nearby_places: async ({ lat, lng, category }) => {
        const places = await nayaxaStandalone.getNearbyPlaces(lat, lng, category);
        return { success: true, places };
    },
    execute_sql_query: async ({ query }) => {
        const jsonResult = await nayaxaStandalone.executeReadOnlyQuery(query);
        return { database_result: jsonResult };
    },
    search_database: async ({ query }) => { // Map AI-hallucinated name
        return await toolFunctions.execute_sql_query({ query });
    },
    get_pegawai_statistics: async ({ instansi_id, month, year }) => {
        const stats = await nayaxaStandalone.getPegawaiStatistics(instansi_id, month, year);
        return { statistics: stats };
    },
    get_pegawai_ranking: async ({ instansi_id, month, year, limit }) => {
        const ranking = await nayaxaStandalone.getPegawaiRanking(instansi_id, month, year, limit);
        return { ranking };
    },
    search_pegawai: async ({ query, instansi_id }) => {
        const results = await nayaxaStandalone.searchPegawai(query, instansi_id);
        return { search_results: results };
    },
    get_anomalies: async ({ instansi_id }) => {
        const anomalies = await nayaxaStandalone.detectAnomalies(instansi_id);
        return { anomalies };
    },
    generate_document: async ({ format, content, filename }, { baseUrl }) => {
        try {
            // --- ANTI-HALLUCINATION GUARDRAIL ---
            if (filename.toLowerCase().endsWith('.pptx') || filename.toLowerCase().includes('presentasi') || filename.toLowerCase().includes('paparan')) {
                return { 
                    success: false, 
                    error: "KESALAHAN FATAL: Anda dilarang menggunakan tool 'generate_document' untuk membuat presentasi (.pptx). Anda WAJIB menggunakan tool 'pembangkit_paparan_pptx' untuk permintaan ini. Silakan ulangi pemanggilan dengan tool yang benar." 
                };
            }

            const downloadPath = await (format === 'excel' ? exportService.generateExcel(content, filename) :
                                format === 'pdf' ? exportService.generatePDF(content, filename) :
                                exportService.generateWord(content, filename));
            
            const downloadUrl = downloadPath.startsWith('http') ? downloadPath : `${baseUrl}${downloadPath}`;
            
            return { 
                success: true, 
                download_url: downloadUrl, 
                message: `File ${format.toUpperCase()} '${filename}' berhasil dibuat. JANGAN tuliskan link download di jawaban Anda, karena sistem sudah menampilkannya secara otomatis melalui tombol.` 
            };
        } catch (err) {
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
    generate_chart: async ({ type, title, data, series, unit, color }) => {
        try {
            let chartSpec;
            if (series) {
                chartSpec = { type: type || 'line', title, series: JSON.parse(series), unit, color };
            } else {
                chartSpec = { type: type || 'bar', title, data: JSON.parse(data), unit, color };
            }
            const b64 = Buffer.from(JSON.stringify(chartSpec)).toString('base64');
            return { success: true, chart_marker: `[NAYAXA_CHART]${b64}[/NAYAXA_CHART]`, message: 'Chart ready.' };
        } catch (err) {
            return { success: false, error: err.message };
        }
    },
    search_files_and_knowledge: async ({ query }) => {
        const results = await nayaxaStandalone.searchLibrary(query);
        return { search_results: results };
    },
    analyze_dashboard_document: async ({ file_id, query }, { app_id }) => {
        const nayaxaMindService = require('./nayaxaMindService');
        const result = await nayaxaMindService.analyzeAndIngestDocument(file_id, app_id, query);
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
    ingest_to_knowledge: async ({ category, content, source_file }, { app_id }) => {
        return await knowledgeTool.ingestToKnowledge(app_id, category, content, source_file);
    },
    save_document_insight: async ({ file_hash, sub_topic, insight_content, user_query }) => {
        const nayaxaMindService = require('./nayaxaMindService');
        return await nayaxaMindService.saveDocumentInsight(file_hash, sub_topic, insight_content, user_query);
    },
    // --- CODING AGENT TOOLS (only active in coding_mode) ---
    list_project_files: ({ dir_path, depth }) => {
        return codeAgent.listFiles(dir_path || 'D:\\nayaxa-engine', parseInt(depth) || 2);
    },
    read_code_file: ({ file_path }) => {
        return codeAgent.readFile(file_path);
    },
    write_code_file: async ({ file_path, content }, { session_id }) => {
        if (!session_id) return { success: false, error: "Session ID required for proposal." };
        const proposalId = await proposalService.createProposal(session_id, [{ file_path, content }]);
        return { 
            success: true, 
            proposal_id: proposalId,
            marker: `[NAYAXA_PROPOSAL:${proposalId}]`,
            message: `Proposal ${proposalId} dibuat. ANDA WAJIB mencantumkan marker [NAYAXA_PROPOSAL:${proposalId}] di akhir jawaban Anda agar UI review muncul.` 
        };
    },
    propose_code_changes: async ({ changes }, { session_id }) => {
        if (!session_id) return { success: false, error: "Session ID required for proposal." };
        let parsedChanges = changes;
        if (typeof changes === 'string') {
            try { parsedChanges = JSON.parse(changes); } catch (e) { return { error: "Format changes harus JSON array." }; }
        }
        const proposalId = await proposalService.createProposal(session_id, parsedChanges);
        return { 
            success: true, 
            proposal_id: proposalId,
            marker: `[NAYAXA_PROPOSAL:${proposalId}]`,
            message: `Proposal ${proposalId} (Multi-file) dibuat. ANDA WAJIB mencantumkan marker [NAYAXA_PROPOSAL:${proposalId}] di akhir jawaban Anda.` 
        };
    },
    search_in_codebase: ({ dir_path, query }) => {
        return codeAgent.searchInFiles(dir_path || 'D:\\nayaxa-engine', query);
    },
    execute_database_update: async ({ query }) => {
        const jsonResult = await nayaxaStandalone.executeSystemQuery(query);
        return { database_result: jsonResult };
    },
    scan_document_tables: async (args, { docxBase64, excelBase64 }) => {
        try {
            const base64 = docxBase64 || excelBase64;
            if (!base64) return { success: false, error: 'Tidak ada dokumen DOCX yang ditemukan dalam konteks percakapan.' };
            return await docxTableUpdater.getTableSummary(base64);
        } catch (err) {
            return { success: false, error: err.message };
        }
    },
    update_document_tables: async ({ updates_json, filename }, { docxBase64, excelBase64, baseUrl }) => {
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
    }
};



const DEEPSEEK_TOOLS = [
    { 
        type: "function", 
        function: { 
            name: "execute_sql_query", 
            description: "Query SQL mentah untuk mengambil data dashboard. PENTING: Anda WAJIB menyertakan filter instansi_id (sesuai profil user) di setiap query untuk menjaga akurasi data.", 
            parameters: { type: "object", properties: { query: { type: "string", description: "Query SQL SELECT. Gunakan JOIN jika perlu." } }, required: ["query"] } 
        } 
    },
    { 
        type: "function", 
        function: { 
            name: "get_pegawai_statistics", 
            description: "Mendapatkan statistik keaktifan pegawai di instansi (Total, Aktif, Tidak Aktif).", 
            parameters: { 
                type: "object", 
                properties: { 
                    instansi_id: { type: "number" },
                    month: { type: "number" },
                    year: { type: "number" }
                }, 
                required: ["instansi_id", "month", "year"] 
            } 
        } 
    },
    { 
        type: "function", 
        function: { 
            name: "get_pegawai_ranking", 
            description: "Mendapatkan ranking bidang/pegawai berdasarkan jumlah kegiatan.", 
            parameters: { 
                type: "object", 
                properties: { 
                    instansi_id: { type: "number" },
                    month: { type: "number" },
                    year: { type: "number" },
                    limit: { type: "number" }
                }, 
                required: ["instansi_id", "month", "year"] 
            } 
        } 
    },
    { 
        type: "function", 
        function: { 
            name: "search_pegawai", 
            description: "Mencari profil pegawai berdasarkan nama atau NIP.", 
            parameters: { 
                type: "object", 
                properties: { 
                    query: { type: "string", description: "Nama atau NIP" },
                    instansi_id: { type: "number" }
                }, 
                required: ["query", "instansi_id"] 
            } 
        } 
    },
    { 
        type: "function", 
        function: { 
            name: "get_anomalies", 
            description: "Mendeteksi anomali kehadiran atau pelaporan.", 
            parameters: { 
                type: "object", 
                properties: { 
                    instansi_id: { type: "number" }
                }, 
                required: ["instansi_id"] 
            } 
        } 
    },
    { type: "function", function: { name: "search_internet", description: "Cari internet menggunakan Polyglot Search (Resilience Mode).", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } } },
    { type: "function", function: { 
        name: "generate_chart", 
        description: "Membuat grafik/chart interaktif.", 
        parameters: { 
            type: "object", 
            properties: { 
                type: { type: "string", description: "bar, column, line, pie, donut" },
                title: { type: "string", description: "Judul grafik" },
                data: { type: "string", description: "JSON string [{label, value}]" },
                series: { type: "string", description: "JSON string [{name, data:[{label,value}]}]" },
                unit: { type: "string", description: "Satuan data" },
                color: { type: "string", description: "Warna tema" }
            }, 
            required: ["type", "title"] 
        } 
    } },
    { type: "function", function: { 
        name: "generate_document", 
        description: "Membuat file dokumen (PDF, Excel, atau Word). DILARANG KERAS menggunakan tool ini untuk membuat presentasi/paparan/slides.", 
        parameters: { 
            type: "object", 
            properties: { 
                format: { type: "string", description: "pdf, excel, atau word" },
                content: { type: "string", description: "Konten file. KHUSUS untuk format 'excel', content HARUS berupa stringified JSON Array of Objects berisi data tabel/baris, contoh: '[{\"Kategori\":\"A\",\"Nilai\":10}]'. JANGAN mengirimkan format Markdown, CSV, atau teks biasa jika memilih format 'excel'." },
                filename: { type: "string", description: "Nama file" }
            }, 
            required: ["format", "content", "filename"] 
        } 
    } },
    { type: "function", function: { 
        name: "export_discussion_to_word", 
        description: "Alat khusus untuk merangkum dan mencetak file Word (.docx) dari seluruh atau sebagian pembahasan yang telah berlalu dalam obrolan. JANGAN mengetik ulang kontennya. Sistem backend akan menyaring seluruh pesan secara otomatis.", 
        parameters: { 
            type: "object", 
            properties: { 
                topik_yang_dipilih: { type: "string", description: "Topik spesifik yang ingin dirangkum (misal: 'Metode Penelitian'). Jika user meminta merangkum semua obrolan, isi dengan 'ALL'." },
                filename: { type: "string", description: "Nama file output (misal: 'Rangkuman_Diskusi.docx')" }
            }, 
            required: ["topik_yang_dipilih", "filename"] 
        } 
    } },
    { type: "function", function: { 
        name: "pembangkit_paparan_pptx", 
        description: "Satu-satunya tool untuk membuat dokumen presentasi resmi (.pptx) dengan desain modern Bapperida 2026. Gunakan ini untuk slides/paparan.", 
        parameters: { 
            type: "object", 
            properties: { 
                judul: { type: "string", description: "Judul besar presentasi" },
                konteks: { type: "string", description: "Keterangan singkat" },
                slides: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            title: { type: "string", description: "Judul slide" },
                            points: { type: "array", items: { type: "string" }, description: "Poin-poin materi" },
                            layout_type: { type: "string", enum: ["BULLETS", "TWO_COLUMN"] }
                        },
                        required: ["title", "points"]
                    }
                }
            }, 
            required: ["judul", "slides"] 
        } 
    } },
    { type: "function", function: { 
        name: "ingest_to_knowledge", 
        description: "Menyimpan informasi dari dokumen ke dalam memori pengetahuan (Knowledge Base) Nayaxa.", 
        parameters: { 
            type: "object", 
            properties: { 
                category: { type: "string", description: "Kategori informasi" },
                content: { type: "string", description: "Intisari informasi penting" },
                source_file: { type: "string", description: "Nama file sumber" }
            }, 
            required: ["category", "content", "source_file"] 
        } 
    } },
    { 
        type: "function", 
        function: { 
            name: "search_files_and_knowledge", 
            description: "Mencari file asli atau pengetahuan (knowledge base) yang tersimpan di sistem Nayaxa.", 
            parameters: { 
                type: "object", 
                properties: { 
                    query: { type: "string", description: "Nama file, materi, atau kata kunci pencarian dokumen" } 
                }, 
                required: ["query"] 
            } 
        } 
    },
    { 
        type: "function", 
        function: { 
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
        } 
    },
    { type: "function", function: { 
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
    } },
    { type: "function", function: {
        name: "scan_document_tables",
        description: "Memindai dan membaca struktur semua tabel di dalam dokumen DOCX yang diunggah user. Gunakan tool ini PERTAMA KALI sebelum update_document_tables.",
        parameters: { type: "object", properties: {}, required: [] }
    }},
    { type: "function", function: {
        name: "update_document_tables",
        description: "Memperbarui data di dalam tabel-tabel dokumen DOCX berdasarkan mapping yang telah dianalisis. WAJIB dipanggil setelah scan_document_tables.",
        parameters: {
            type: "object",
            properties: {
                updates_json: { type: "string", description: "JSON Array berisi daftar update. Format: [{\"table_id\": 1, \"row_label\": \"Nama Program\", \"column_header\": \"Realisasi\", \"new_value\": \"450000000\"}]" },
                filename: { type: "string", description: "Nama file output DOCX" }
            },
            required: ["updates_json", "filename"]
        }
    }},
    { 
        type: "function", 
        function: { 
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
        } 
    },
    { 
        type: "function", 
        function: { 
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
        } 
    }
];

// --- CODING AGENT TOOLS - Only injected when coding_mode = true ---
const CODING_AGENT_TOOLS = [
    { type: "function", function: {
        name: "list_project_files",
        description: "Mendaftar isi direktori (folder dan file) di dalam proyek. Gunakan untuk memahami struktur proyek sebelum membaca kode.",
        parameters: { type: "object", properties: {
            dir_path: { type: "string", description: "Path absolut direktori yang ingin dilihat. Contoh: D:\\nayaxa-engine\\Backend\\src" },
            depth: { type: "number", description: "Kedalaman rekursi (1-3). Default 2." }
        }, required: ["dir_path"] }
    }},
    { type: "function", function: {
        name: "read_code_file",
        description: "Membaca isi lengkap sebuah file kode. Gunakan ini untuk menganalisis bug, memahami logika, atau sebelum membuat perubahan.",
        parameters: { type: "object", properties: {
            file_path: { type: "string", description: "Path absolut file yang ingin dibaca. Contoh: D:\\nayaxa-engine\\Backend\\src\\services\\nayaxaDeepSeekService.js" }
        }, required: ["file_path"] }
    }},
    { type: "function", function: {
        name: "write_code_file",
        description: "Menyiapkan proposal perubahan untuk SATU file. Kode TIDAK akan langsung ditulis ke disk, melainkan masuk ke tahap review user.",
        parameters: { type: "object", properties: {
            file_path: { type: "string", description: "Path absolut file." },
            content: { type: "string", description: "Konten baru file secara lengkap." }
        }, required: ["file_path", "content"] }
    }},
    { type: "function", function: {
        name: "propose_code_changes",
        description: "Menyiapkan proposal perubahan untuk BANYAK file sekaligus dalam satu paket review. Gunakan ini untuk efisiensi jika mengubah beberapa file sekaligus.",
        parameters: { type: "object", properties: {
            changes: { 
                type: "array", 
                items: {
                    type: "object",
                    properties: {
                        file_path: { type: "string" },
                        content: { type: "string" }
                    },
                    required: ["file_path", "content"]
                },
                description: "Daftar file yang akan diubah."
            }
        }, required: ["changes"] }
    }},
    { type: "function", function: {
        name: "search_in_codebase",
        description: "Mencari teks/pola tertentu di seluruh file dalam direktori proyek. Berguna untuk menemukan di mana fungsi atau variabel digunakan.",
        parameters: { type: "object", properties: {
            dir_path: { type: "string", description: "Path absolut direktori yang ingin dicari." },
            query: { type: "string", description: "Teks atau nama fungsi yang ingin dicari." }
        }, required: ["dir_path", "query"] }
    }},
    { type: "function", function: {
        name: "execute_database_update",
        description: "Mengeksekusi SQL query untuk manipulasi data atau struktur database (INSERT, UPDATE, DELETE, ALTER, DROP, CREATE) secara asinkron.",
        parameters: { type: "object", properties: {
            query: { type: "string", description: "Query SQL DML atau DDL yang akan dieksekusi secara langsung terhadap database." }
        }, required: ["query"] }
    }}
];

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
    scan_document_tables:      { icon: '🔬', label: 'Memindai struktur tabel dokumen...' },
    update_document_tables:    { icon: '✏️', label: 'Memperbarui data tabel di dokumen...' },
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

const isBudgetQuery = (query) => {
    return /anggaran|rka|dpa|belanja|biaya|dana|pagu|ssh|sbu|rup|keuangan|proyek/i.test(query);
};


// Background Master Summary and AI tasks are now orchestrated by nayaxaRoutingService.

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
        const isBudget = isBudgetQuery(query);

        // 0. Include Master Summary for Budget Context (v4.8.5)
        if (isBudget) {
            const [cacheRows] = await dbNayaxa.query(
                "SELECT master_summary FROM nayaxa_file_cache WHERE file_hash = ? LIMIT 1",
                [fileHash]
            );
            if (cacheRows.length > 0 && cacheRows[0].master_summary) {
                context += `\n=== RINGKASAN INDUK (KONTEKS TOTAL ANGGARAN) ===\n${cacheRows[0].master_summary}\n`;
                if (onStepCallback) onStepCallback({ icon: '📊', label: 'Menyertakan ringkasan total anggaran sebagai rujukan...' });
            }
        }


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

                // Urutkan berdasarkan skor tertinggi dan ambil maksimal chunks paling relevan (Lebih banyak untuk Budget)
                const depth = isBudget ? 25 : 8;
                const topChunks = scoredChunks
                    .filter(c => c.score > 0)
                    .sort((a, b) => b.score - a.score)
                    .slice(0, depth);

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

/**
 * Loads dynamic configurations, active personas, routes navigation, and dynamic AI tools from database.
 * Extremely robust fallback is implemented to guarantee zero-downtime if DB is unreachable.
 */
const loadDynamicEngineConfig = async (instansiId) => {
    try {
        // 1. Load active global configurations
        const [configs] = await dbNayaxa.query(
            'SELECT config_key, config_value FROM nayaxa_global_configs'
        );
        const configMap = Object.fromEntries(configs.map(c => [c.config_key, c.config_value]));

        // 2. Load active persona system prompt template
        const [personas] = await dbNayaxa.query(
            'SELECT system_prompt_template FROM nayaxa_personas WHERE instansi_id = ? AND is_active = 1 LIMIT 1',
            [instansiId]
        );
        let activePersonaPrompt = (personas && personas.length > 0) ? personas[0].system_prompt_template : null;

        // 3. Load active routes navigation guide
        const [routes] = await dbNayaxa.query(
            'SELECT route_key, target_path, description FROM nayaxa_routes'
        );
        const routesGuide = routes.length > 0 
            ? `\n=== PANDUAN NAVIGASI RESMI (MANDATORY LINK REGISTRY) ===\n` +
              `Anda DILARANG keras mengarang atau berspekulasi tentang link rute halaman internal. Jika ingin mengarahkan pengguna ke halaman/menu tertentu, Anda WAJIB menggunakan link relatif berikut secara persis:\n` +
              routes.map(r => `- Untuk ${r.description}: [${r.description}](${r.target_path})`).join('\n') + '\n'
            : '';

        // 4. Load dynamic active tools from database
        const [activeToolsRows] = await dbNayaxa.query(
            'SELECT tool_name, description, parameter_schema FROM nayaxa_ai_tools WHERE is_active = 1'
        );
        const dynamicTools = (activeToolsRows && activeToolsRows.length > 0) 
            ? activeToolsRows.map(row => ({
                type: "function",
                function: {
                    name: row.tool_name,
                    description: row.description,
                    parameters: JSON.parse(row.parameter_schema)
                }
              }))
            : null;

        return {
            configMap,
            activePersonaPrompt,
            routesGuide,
            dynamicTools
        };
    } catch (err) {
        console.error('[loadDynamicEngineConfig] Critical error loading dynamic settings, falling back to static defaults:', err);
        return {
            configMap: { ENABLE_COLLABORATIVE_MEMORY: '1', KNOWLEDGE_SATURATION_THRESHOLD: '5', DEFAULT_LLM_MODEL: 'deepseek-v4-flash' },
            activePersonaPrompt: null,
            routesGuide: '',
            dynamicTools: null
        };
    }
};

const nayaxaDeepSeekService = {
    chatWithNayaxa: async (userMessage, files, instansi_id, month, year, prevHistory = [], user_name = "Pengguna", profil_id = null, fileContext = '', current_page = '', page_title = '', baseUrl = '', fullDate = '', nama_instansi = 'N/A', personaPromptSnippet = '', userProfile = null, lastActivityContext = null, coding_mode = false, session_id = null, onStepCallback = null, signal = null) => {
        if (signal?.aborted) return 'Request aborted.';
        try {
            // --- STANDALONE GREETING INTERCEPTOR (v4.6.5) ---
            const cleanMsg = (userMessage || '').trim().toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g,"");
            const greetings = ['hi', 'hi nayaxa', 'halo', 'hallo', 'hei', 'hey', 'p', 'ping', 'pagi', 'siang', 'sore', 'malam', 'assalamualaikum', 'selamat pagi', 'selamat siang', 'selamat sore', 'selamat malam', 'halo nayaxa', 'hallo nayaxa'];
            
            if (greetings.includes(cleanMsg) && (!files || files.length === 0)) {
                console.log(`[DeepSeek] Standalone greeting detected: "${userMessage}". Intercepting and returning local response instantly.`);
                
                // Personalize based on profile or name
                const displayName = userProfile?.nama_lengkap || user_name || "Sobat Nayaxa";
                const formality = userProfile?.detected_formality || "Formal";
                
                let reply = "";
                if (formality === "Akrab" || formality === "Casual" || cleanMsg === 'p' || cleanMsg === 'ping') {
                    reply = `Halo **${displayName}**! Senang banget bisa menyapa kamu secara instan! Ada yang bisa aku bantu terkait analisis dokumen, grafik, atau data Bapperida hari ini? 😊`;
                } else if (cleanMsg === 'assalamualaikum') {
                    reply = `Wa'alaikumussalam Wr. Wb. Halo **${displayName}**! Ada yang bisa saya bantu terkait data instansi, grafik analitik, atau analisis dokumen Bapperida hari ini?`;
                } else {
                    reply = `Halo **${displayName}**! Senang sekali bisa menyapa Anda kembali secara instan. Saya, Nayaxa, asisten AI Bapperida siap membantu Anda. Apakah ada dokumen yang ingin dianalisis, grafik yang ingin dibuat, atau kueri data yang ingin dijalankan hari ini?`;
                }

                // Simulate progressive streaming for premium UX!
                if (onStepCallback) {
                    const words = reply.split(' ');
                    for (let i = 0; i < words.length; i++) {
                        if (signal?.aborted) break;
                        onStepCallback({ type: 'message_chunk', text: words[i] + (i === words.length - 1 ? '' : ' ') });
                        await new Promise(r => setTimeout(r, 15)); // 15ms per word
                    }
                }
                return reply;
            }

            const apiKey = process.env.NAYAXA_DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY;

            // Load dynamic configurations, personas, and tools
            const dynamicEngine = await loadDynamicEngineConfig(instansi_id);
            
            const needSchema = checkNeedSchema(userMessage, prevHistory, coding_mode);
            let schemaMapString = "[DATABASE SCHEMA] Skema database lengkap hanya dilampirkan jika terdeteksi pertanyaan berbasis data/statistik.";
            let glossaryString = "[GLOSSARY] Glosarium resmi hanya dilampirkan jika terdeteksi pertanyaan berbasis data/statistik.";

            if (needSchema) {
                // --- Parallel Initialization (v4.6.0) ---
                const [dbSchema, dbGlossary] = await Promise.all([
                    nayaxaStandalone.getDatabaseSchema(),
                    nayaxaStandalone.getMasterDataGlossary()
                ]);
                schemaMapString = dbSchema;
                glossaryString = dbGlossary;
            }
            
            const system = (dynamicEngine.activePersonaPrompt || `Identitas ANDA: Nayaxa, asisten AI dari Bapperida yang dibuat oleh Sammy. 
            PENTING: DILARANG KERAS MENGGUNAKAN EMOJI APAPUN.

            !!! PROTOKOL RISET & PENCARIAN (STRICT) !!!
            1. PRIORITAS INTERNAL: Jika user bertanya tentang data organisasi (Kegiatan, Bidang, Pegawai, Urusan, atau Statistik Dashboard), Anda WAJIB menggunakan tool 'execute_sql_query' atau 'get_pegawai_statistics'.
            2. PEMBATASAN INTERNET: DILARANG KERAS menggunakan 'search_internet' untuk data internal di atas secara default.
            3. PENGECUALIAN INTERNET: Anda HANYA boleh menggunakan 'search_internet' untuk data internal JIKA user menyebutkan instruksi eksplisit seperti "cari di internet juga", "cek berita terkait", atau "verifikasi secara online".
            4. FAKTA PUBLIK: Tetap gunakan 'search_internet' secara proaktif untuk fakta yang bisa berubah di luar organisasi (Berita Nasional, Jabatan Menteri, Presiden, Pilkada 2024, Pelantikan 2025, atau Teknologi).
            5. JANGAN PERNAH MENGARANG: Jika database kosong untuk bulan berjalan, katakan "Data belum tersedia di database" daripada mencari di internet tanpa perintah.
            6. PENCARIAN BERTINGKAT: 
               - Step 1: 'execute_sql_query' (Internal Data).
               - Step 2: 'search_files_and_knowledge' (Internal Documents).
               -            7. SELF-CORRECTION: Abaikan berita tahun 2018-2022 jika mencari status pejabat saat ini. Prioritaskan Kabinet Merah Putih (2024-2029).`) + 
            `\n${dynamicEngine.routesGuide}` + 
            `\n
            PROTOKOL AI DOCUMENT WORKSTATION (EDITOR MODE):
            - Jika user mengirimkan pesan dengan awalan [NAYAXA_EDITOR_FEEDBACK], ini berarti Anda sedang berada di mode perbaikan dokumen di Workstation.
            - TUGAS ANDA: Pilihlah tool yang sesuai dengan jenis dokumen yang sedang dibuka:
                a. Jika sedang mengedit PRESENTASI/SLIDE (.pptx) -> WAJIB panggil 'pembangkit_paparan_pptx'.
                b. Jika sedang mengedit DOKUMEN TEKS/SURAT -> WAJIB panggil 'generate_document'.
            - DILARANG KERAS membuat file Word jika user sedang melakukan revisi pada file presentasi.
            - PANDUAN KHUSUS DOKUMEN PANJANG (PERBUP/LAPORAN):
            - Jika user meminta draf dokumen yang panjang dan formal (seperti Peraturan Bupati/Perbup), Anda WAJIB menggunakan tool 'generate_document' untuk menghasilkan file lengkapnya.
            - **DILARANG KERAS menulis isi lengkap dokumen panjang di dalam chat bubble.** Ini memboroskan token dan membuat chat berantakan.
            - Di dalam chat bubble, Anda HANYA diperbolehkan menulis: (1) Outline/Daftar Isi singkat, (2) Ringkasan eksekutif maksimal 2 paragraf, dan (3) Informasi bahwa file sudah siap diunduh.
            
            PANDUAN PER-FILE ACTIONS (v4.6.1):
            - Jika Anda melihat tag \`[FILE: nama_file -> ACTION: nama_aksi]\`, ikuti instruksi spesifik tersebut untuk file yang dimaksud:
                * "Analisis": (Default) Lakukan tinjauan umum dan berikan wawasan mendalam berdasarkan isi file.
                * "Jadikan Acuan Bahan": Use file ini sebagai sumber data utama/fakta mentah untuk menjawab pertanyaan user.
                * "Jadikan Acuan Format": Gunakan gaya bahasa, struktur, dan tata letak file tersebut sebagai referensi utama untuk output Anda.
                * "Buatkan Ringkasan": Fokuskan jawaban pada poin-poin penting file tersebut.
                * "Buatkan Ringkasan+Notulen": Buat ringkasan dan draf notulen rapat dari file tersebut.
                * "Buatkan Ringkasan+Notulen+Word": Sama seperti di atas, namun Anda WAJIB langsung memanggil tool 'generate_document' untuk membuat file Word-nya.
            
            PENTING - FORMAT JAWABAN:
            - ANDA WAJIB memberikan ringkasan teks atau penjelasan setelah menggunakan tool. DILARANG KERAS hanya memanggil tool tanpa memberikan respon teks sama sekali.
            - SELALU gunakan format Markdown (Heading, Bold, Bullet Points, dan Tabel Markdown) dalam setiap jawaban agar terlihat rapi, premium, dan profesional di aplikasi Dashboard.
            - **CONTEXT ADHERENCE & HONESTY GUARDRAIL**:
                1. PRIORITASKAN dokumen yang baru saja diunggah. Jika user mengirim file baru, fokuslah pada isi file tersebut meskipun topik sebelumnya berbeda.
                2. JANGAN MEMAKSAKAN konteks lama jika tidak relevan dengan file baru yang dikirim.
                3. JANGAN PERNAH MENGARANG (HALUSINASI). Jika isi file tidak mengandung jawaban yang dicari, sampaikan dengan jujur bahwa Anda tidak dapat menemukan informasi tersebut dalam dokumen yang tersedia.
                4. DILARANG KERAS menyebutkan nama teknis otak Anda (seperti DeepSeek, Gemini, atau model AI lainnya) di dalam jawaban. Gunakan nama 'Nayaxa'.
                5. JANGAN menuliskan query pencarian, nama fungsi, atau logika internal Anda ke dalam chat. Pencarian harus bersifat SILENT (Senyap).
            - **AKURASI METADATA (PENTING)**: Saat melakukan kueri 'profil_pegawai', Anda WAJIB melakukan LEFT JOIN dengan 'master_bidang_instansi' (on bidang_id) and 'master_jabatan' (on jabatan_id) untuk mendapatkan nama Bidang dan Jabatan yang valid.
            - **STRATEGI KUERI KEGIATAN PER BIDANG (PENTING)**: 
              * View 'v_rekap_kegiatan_harian' dan tabel 'kegiatan_harian_pegawai' **TIDAK memiliki** kolom 'bidang_id' atau 'nama_bidang'!
              * Jika Anda ingin memfilter atau mencari kegiatan pegawai berdasarkan Bidang tertentu (seperti PPM [ID: 2], dll), Anda **WAJIB melakukan JOIN** dengan 'profil_pegawai' (pp) terlebih dahulu karena hanya tabel profil yang menyimpan relasi 'bidang_id'.
              * Contoh kueri gabungan yang benar dan dijamin sukses:
                \`SELECT pp.nama_lengkap, vr.nama_kegiatan, vr.tanggal FROM v_rekap_kegiatan_harian vr JOIN profil_pegawai pp ON vr.profil_pegawai_id = pp.id WHERE pp.bidang_id = 2 AND MONTH(vr.tanggal) = 3 AND YEAR(vr.tanggal) = 2026\`
            - **PENGGUNAAN ID**: Gunakan ID dari GLOSARIUM RESMI (misal: [ID: 2] untuk PPM) dalam kueri SQL Anda untuk akurasi filter 100%. DILARANG menebak ID.
            - **DILARANG HALUSINASI**: Jangan menuliskan "(Belum terisi)" jika Anda belum melakukan join ke tabel master. Jika data memang NULL setelah join, gunakan "Tanpa Bidang".
            - **DILARANG KERAS mengeluarkan output berupa kode SQL mentah (seperti SELECT, JOIN, atau WHERE) langsung ke dalam chat.** Kode SQL hanya boleh digunakan secara internal di dalam parameter fungsi 'execute_sql_query'. Anda harus menyajikan hasil eksekusinya dalam bentuk Tabel Markdown.
            - DILARANG KERAS mengeluarkan output berupa JSON mentah atau blok kode data mentah langsung ke dalam chat. 
            - Jika Anda ingin menampilkan data terstruktur (seperti Lembar Kerja atau List), gunakan Tabel Markdown atau List bertingkat.
            - JSON hanya diperbolehkan jika berada di dalam parameter fungsi/tool (seperti generate_chart).
            - Pastikan seluruh judul menggunakan Heading 2 (##) atau Heading 3 (###).
            
            ATURAN KRITIS - ANALISIS DOKUMEN:
            - Jika konten file tersedia: analisis HANYA berdasarkan konten yang ada di DATA FILE. JANGAN menambahkan informasi yang tidak ada di dokumen.
            - Jika konten file KOSONG, mengandung peringatan 'PERINGATAN', atau ERROR: JANGAN PERNAH MENGARANG isi dokumen. Beritahu user dengan jujur bahwa file tidak dapat dibaca dan minta mereka mengirim ulang file dalam format yang berbeda.
            - DILARANG KERAS menggunakan pengetahuan internal untuk 'mengisi' konten dokumen yang tidak terbaca.
            
            Identitas USER: ${user_name} dari Instansi: ${nama_instansi} (ID: ${instansi_id}). 
            ATURAN MENYAPA: Sapa user dengan namanya (${user_name}).
            PENTING: DILARANG KERAS menyebutkan atau memunculkan "ID", "NIP", "Profil ID", "Instansi ID", atau angka identitas teknis lainnya dalam percakapan (seperti: "ID: 151", "ID: 66", "id_kegiatan: 42", dsb) kecuali user bertanya secara spesifik. 
            - Jika Anda mengambil data dari database, Anda WAJIB MEMBERSIHKAN (sanitasi) semua kolom ID sebelum menyajikan tabel atau list ke user. 
            - Untuk 'Lampiran', jangan tampilkan ID-nya. Jika tersedia, sebutkan "Tersedia" atau berikan link (jika ada). Jangan pernah menulis "(ID: 66)".
            - Fokuslah pada interaksi yang manusiawi, ramah, dan profesional.
            ${personaPromptSnippet}
            ${lastActivityContext ? `\nKONTEKS AKTIVITAS TERAKHIR USER: "${lastActivityContext}"\nSapa user dengan hangat dan hubungkan kalimat pembuka/pertanyaan Anda dengan aktivitas tersebut secara proaktif (Predictive Greeting).\n` : ''}
            WAKTU AKTIF: ${fullDate}. Selalu gunakan nilai ini sebagai filter waktu default dan referensi sapaan waktu (Pagi/Siang/Sore/Malam).

            PENTING - ADAPTASI FORMALITAS: Sesuaikan tingkat formalitas Anda dengan Profil Kepribadian User di atas. Jika user terbiasa santai (Gue/Lo, Gw/Lu, Ane/Ente), Anda diperbolehkan menggunakan gaya bicara yang serupa (casual-professional) namun tetap sopan, ceria, dan membantu. Jangan gunakan emoji. Jika user formal, tetaplah sangat formal (Saya/Anda).
            
            ATURAN GRAFIK: Jika user meminta grafik/chart, Anda WAJIB menggunakan tool 'generate_chart'. JANGAN PERNAH memberikan kode Python atau CSV mentah. Gunakan tool tersebut untuk membuat visualisasi interaktif.
            CATATAN EKSPOR: Jelaskan ke user bahwa tombol 'Unduh PNG' adalah untuk mengambil gambar grafik, sedangkan 'Unduh Excel' adalah untuk mengambil data angka mentahnya agar mereka bisa mengolahnya lagi di Excel.
            
            ATURAN TRANSPARANSI (RESEARCH TRANSPARENCY):
            - Jika Anda memberikan jawaban yang berasal dari 'search_internet' (berita/pejabat/fakta publik), Anda WAJIB menambahkan footer transparansi di akhir jawaban Anda dengan format sebagai berikut:
              
              ---
              🔍 **RESEARCH TRANSPARENCY**
              **Sumber Utama:** [Nama Situs/Link]
              **Waktu Akses:** [Gunakan 'search_date' dari hasil tool secara utuh]
              **Catatan:** Informasi ini ditarik secara real-time melalui Nayaxa Resilience Mode. Untuk keperluan resmi, silakan merujuk pada dokumen negara atau situs kementerian terkait.
            - DILARANG KERAS bertanya "apakah Anda ingin linknya?" atau sejenisnya. Langsung berikan referensi tersebut secara otomatis dan instan di dalam footer.
            
            CATATAN DOKUMEN & FILE: 
            - **FILE UNGGULAN CHAT (PENTING)**: Jika pesan pengguna diawali dengan format \`[FILE: nama_file -> ACTION: tindakan]\` (seperti \`[FILE: PM-3201-13-6-inovasi-pmba-1776053180.pdf -> ACTION: Analisis]\`), ini adalah file yang BARU saja diunggah di dalam chat obrolan ini. Teks dari file ini SUDAH diekstrak dan disertakan dalam konteks pesan (\`[DOKUMEN DIUNGGAH DI CHAT]\` atau riwayat dokumen). Anda **DILARANG KERAS** menggunakan tool 'analyze_dashboard_document' atau 'search_files_and_knowledge' untuk mencari file ini di database/dashboard. Cukup baca isi teks yang sudah diberikan dan langsung jawab secara instan!
            - Jika user meminta laporan baru, gunakan tool 'generate_document'.
             !!! PROTOKOL URUTAN EKSEKUSI TOOL & STRUKTUR RESPONS (MUTLAK) !!!
             - **TAHAP 1: EKSEKUSI ALAT (SILENT FIRST TURN)**: Jika Anda memutuskan untuk memanggil alat/tool apa pun (seperti 'search_files_and_knowledge' atau 'execute_sql_query'), Anda **DILARANG KERAS** menulis teks biasa, sapaan pembuka, janji pencarian, atau kalimat "Mohon tunggu" (seperti "Saya akan mencari...", "Tunggu sebentar...") di obrolan utama pada giliran pertama. Anda **WAJIB langsung melakukan pemanggilan tool secara instan** tanpa karakter teks biasa. Narasi pencarian atau rencana Anda hanya boleh ditulis secara internal di dalam tag <thought>...</thought>.
             - **TAHAP 2: PENYAJIAN RESPONS ANALITIS (SETELAH TOOL SELESAI)**: Narasi pembuka yang ramah, pengantar konteks, tabel data utama, analisis wawasan mendalam (insights), dan kesimpulan **HANYA BOLEH Anda susun setelah seluruh tool selesai dieksekusi** dan Anda telah memegang data riilnya.
             - Kegagalan mematuhi urutan ini (yaitu menulis teks janji pencarian di giliran pertama tanpa memanggil tool) akan merusak alur aplikasi dan membuat Anda terhenti tanpa memberikan data!
            - Tool ini akan mencari di database file (DOKUMEN_UPLOAD) dan database pengetahuan (NAYAXA_KNOWLEDGE).
            - **ANDA WAJIB memberikan link download** untuk setiap hasil berkategori [FILE].
            - **DILARANG KERAS** memberikan jawaban tanpa link jika file ditemukan.
            - **ON-DEMAND LEARNING**: Jika user meminta Anda untuk "Membaca", "Menganalisis", "Mempelajari", atau "Meringkas" dokumen yang ditemukan di Dashboard (bukan file yang baru saja diunggah di chat), gunakan tool 'analyze_dashboard_document' dengan ID file yang sesuai. Hasil analisis akan secara otomatis disimpan ke memori jangka panjang Anda (Nayaxa Intelligence) agar hemat token di masa depan.
            - Format Link: [Unduh (Nama File)](URL_DARI_TOOL). Letakkan link ini secara menonjol di bagian ATAS jawaban Anda dengan format tombol Markdown yang jelas.
            - Jika data ditemukan, LANGSUNG berikan jawabannya tanpa menceritakan langkah-langkah pencariannya.
            
            PENGISIAN EXCEL: Jika user mengunggah file Excel (Template) dan meminta Anda untuk "mengisi", "lengkapi", atau "masukkan data" ke dalamnya, gunakan tool 'fill_excel_template'. 
            TEKNIK PENGISIAN: 
            - Gunakan key "uraian" atau "label" untuk mencocokkan baris yang ingin diisi. 
            - Gunakan key lain yang sesuai dengan Nama Header Kolom (misal: "hasil verifikasi", "rekomendasi", "keterangan") untuk mengisi nilainya.
            - Contoh: [{"uraian": "Lokasi", "rekomendasi": "Masukkan alamat lengkap"}] akan mencari baris yang mengandung kata 'Lokasi' dan mengisi kolom 'REKOMENDASI' di baris tersebut.
            
            UPDATE DOCX TABLES: Jika user mengunggah file DOCX dan meminta Anda untuk "memperbarui tabel", "mengganti isian tabel", atau "memasukkan data ke tabel dokumen", ikuti 2 langkah wajib ini:
            1. Panggil tool 'scan_document_tables' terlebih dahulu untuk memindai ID tabel, nama kolom, dan label baris yang ada di dokumen.
            2. Setelah menerima hasil scan, panggil tool 'update_document_tables' dengan menyertakan JSON updates_json yang berisi pemetaan data baru ke tabel/baris/kolom yang tepat.
            
            
            PENTING - FORMAT JAWABAN & ANALISIS MENDALAM:
            - **ATURAN SPASI BOLD (PENTING)**: Anda WAJIB memberikan spasi yang jelas sebelum dan sesudah kata yang ditebalkan (bold). Contoh yang BENAR: "Gubernur **Andra Soni** dilantik", Contoh yang SALAH: "Gubernur**Andra Soni**dilantik". Ini demi kerapian konversi dokumen.
            - **DILARANG TERLALU TO-THE-POINT / SINGKAT**: Jangan pernah menyajikan tabel data atau hasil kueri mentah begitu saja tanpa penjelasan. Anda adalah seorang Asisten Analis Senior Bapperida yang cerdas, sehingga Anda **WAJIB** memberikan narasi penjelasan yang kaya, interpretasi makna data, identifikasi tren, anomali, serta implikasi praktisnya terhadap instansi di setiap respon Anda.
${nayaxaPromptService.getNayaxaProtokolPrompt()}
            - **STRUKTUR RESPONS ANALITIS PREMIUM**:
                1. **Konteks & Pengantar**: Berikan pengantar ramah yang menjelaskan relevansi data yang sedang disajikan.
                2. **Data Utama**: Sajikan data pokok secara rapi menggunakan Tabel Markdown, Grafik (melalui tool generate_chart jika relevan), atau List bertingkat yang indah.
                3. **Analisis & Wawasan Mendalam (Insights)**: Berikan sub-bab khusus (misal: "### 📊 Analisis & Wawasan") untuk mengulas tren kenaikan/penurunan, perbandingan dengan periode lalu, efektivitas kinerja, atau anomali yang ditemukan.
                4. **Rekomendasi / Kesimpulan**: Berikan ringkasan penutup taktis dan tawarkan bantuan lanjutan yang spesifik secara empatik.
            - ANDA WAJIB memberikan ringkasan teks atau penjelasan setelah menggunakan tool. DILARANG KERAS hanya memanggil tool tanpa memberikan respon teks sama sekali.
            - SELALU gunakan format Markdown (Heading, Bold, Bullet Points, dan Tabel Markdown) dalam setiap jawaban agar terlihat rapi, premium, dan profesional di aplikasi Dashboard.
            - **CONTEXT ADHERENCE & HONESTY GUARDRAIL**:
                1. PRIORITASKAN dokumen yang baru saja diunggah. Jika user mengirim file baru, fokuslah pada isi file tersebut meskipun topik sebelumnya berbeda.
                2. JANGAN MEMAKSAKAN konteks lama jika tidak relevan dengan file baru yang dikirim.
                3. JANGAN PERNAH MENGARANG (HALUSINASI). Jika isi file tidak mengandung jawaban yang dicari, sampaikan dengan jujur bahwa Anda tidak dapat menemukan informasi tersebut dalam dokumen yang tersedia.
                4. DILARANG KERAS menyebutkan nama teknis otak Anda (seperti DeepSeek, Gemini, atau model AI lainnya) di dalam jawaban. Gunakan nama 'Nayaxa'.
                5. JANGAN menuliskan query pencarian, nama fungsi, atau logika internal Anda ke dalam chat. Pencarian harus bersifat SILENT (Senyap).
            - **AKURASI METADATA (PENTING)**: Saat melakukan kueri 'profil_pegawai', Anda WAJIB melakukan LEFT JOIN dengan 'master_bidang_instansi' (on bidang_id) dan 'master_jabatan' (on jabatan_id) untuk mendapatkan nama Bidang dan Jabatan yang valid.
            - **PENGGUNAAN ID**: Gunakan ID dari GLOSARIUM RESMI (misal: [ID: 2] untuk PPM) dalam kueri SQL Anda untuk akurasi filter 100%. DILARANG menebak ID.
            - **DILARANG HALUSINASI**: Jangan menuliskan "(Belum terisi)" jika Anda belum melakukan join ke tabel master. Jika data memang NULL setelah join, gunakan "Tanpa Bidang".
            - **DILARANG KERAS mengeluarkan output berupa kode SQL mentah (seperti SELECT, JOIN, atau WHERE) langsung ke dalam chat.** Kode SQL hanya boleh digunakan secara internal di dalam parameter fungsi 'execute_sql_query'. Anda harus menyajikan hasil eksekusinya dalam bentuk Tabel Markdown.
            - DILARANG KERAS mengeluarkan output berupa JSON mentah atau blok kode data mentah langsung ke dalam chat. 
            - Jika Anda ingin menampilkan data terstruktur (seperti Lembar Kerja atau List), gunakan Tabel Markdown atau List bertingkat.
            - JSON hanya diperbolehkan jika berada di dalam parameter fungsi/tool (seperti generate_chart).
            - Pastikan seluruh judul menggunakan Heading 2 (##) atau Heading 3 (###).
            
            ATURAN KRITIS - ANALISIS DOKUMEN:
            - Jika konten file tersedia: analisis HANYA berdasarkan konten yang ada di DATA FILE. JANGAN menambahkan informasi yang tidak ada di dokumen.
            - Jika konten file KOSONG, mengandung peringatan 'PERINGATAN', atau ERROR: JANGAN PERNAH MENGARANG isi dokumen. Beritahu user dengan jujur bahwa file tidak dapat dibaca dan minta mereka mengirim ulang file dalam format yang berbeda.
            - DILARANG KERAS menggunakan pengetahuan internal untuk 'mengisi' konten dokumen yang tidak terbaca.
            
            Identitas USER: ${user_name} dari Instansi: ${nama_instansi} (ID: ${instansi_id}). 
            ATURAN MENYAPA: Sapa user dengan namanya (${user_name}).
            PENTING: DILARANG KERAS menyebutkan atau memunculkan "ID", "NIP", "Profil ID", "Instansi ID", atau angka identitas teknis lainnya dalam percakapan (seperti: "ID: 151", "ID: 66", "id_kegiatan: 42", dsb) kecuali user bertanya secara spesifik. 
            - Jika Anda mengambil data dari database, Anda WAJIB MEMBERSIHKAN (sanitasi) semua kolom ID sebelum menyajikan tabel atau list ke user. 
            - Untuk 'Lampiran', jangan tampilkan ID-nya. Jika tersedia, sebutkan "Tersedia" atau berikan link (jika ada). Jangan pernah menulis "(ID: 66)".
            - Fokuslah pada interaksi yang manusiawi, ramah, dan profesional.
            ${personaPromptSnippet}
            ${lastActivityContext ? `\nKONTEKS AKTIVITAS TERAKHIR USER: "${lastActivityContext}"\nSapa user dengan hangat dan hubungkan kalimat pembuka/pertanyaan Anda dengan aktivitas tersebut secara proaktif (Predictive Greeting).\n` : ''}
            PENTING - ADAPTASI FORMALITAS: Sesuaikan tingkat formalitas Anda dengan Profil Kepribadian User di atas. Jika user terbiasa santai (Gue/Lo, Gw/Lu, Ane/Ente), Anda diperbolehkan menggunakan gaya bicara yang serupa (casual-professional) namun tetap sopan, ceria, dan membantu. Jangan gunakan emoji. Jika user formal, tetaplah sangat formal (Saya/Anda).
            
            ATURAN GRAFIK: Jika user meminta grafik/chart, Anda WAJIB menggunakan tool 'generate_chart'. JANGAN PERNAH memberikan kode Python atau CSV mentah. Gunakan tool tersebut untuk membuat visualisasi interaktif.
            CATATAN EKSPOR: Jelaskan ke user bahwa tombol 'Unduh PNG' adalah untuk mengambil gambar grafik, sedangkan 'Unduh Excel' adalah untuk mengambil data angka mentahnya agar mereka bisa mengolahnya lagi di Excel.
            
            ATURAN TRANSPARANSI (RESEARCH TRANSPARENCY):
            - Jika Anda memberikan jawaban yang berasal dari 'search_internet' (berita/pejabat/fakta publik), Anda WAJIB menambahkan footer transparansi di akhir jawaban Anda dengan format sebagai berikut:
              
              ---
              🔍 **RESEARCH TRANSPARENCY**
              **Sumber Utama:** [Nama Situs/Link]
              **Waktu Akses:** [Gunakan 'search_date' dari hasil tool secara utuh]
              **Catatan:** Informasi ini ditarik secara real-time melalui Nayaxa Resilience Mode. Untuk keperluan resmi, silakan merujuk pada dokumen negara atau situs kementerian terkait.

            - DILARANG KERAS bertanya "apakah Anda ingin linknya?" atau sejenisnya. Langsung berikan referensi tersebut secara otomatis dan instan di dalam footer.
            
            CATATAN DOKUMEN & FILE: 
            - Jika user meminta laporan baru, gunakan tool 'generate_document'. 
            - Jika user bertanya tentang dokumen, mencari file, atau meminta file spesifik ("Mana dokumen X?", "Minta file Y"), Anda WAJIB LANGSUNG menggunakan tool 'search_files_and_knowledge' tanpa basa-basi.
            - JANGAN PERNAH mengatakan "Saya akan mencari..." atau "Tunggu sebentar..." di jawaban akhir. Gunakan tag <thought> jika ingin menyatakan proses tersebut.
            - Tool ini akan mencari di database file (DOKUMEN_UPLOAD) dan database pengetahuan (NAYAXA_KNOWLEDGE).
            - **ANDA WAJIB memberikan link download** untuk setiap hasil berkategori [FILE].
            - **DILARANG KERAS** memberikan jawaban tanpa link jika file ditemukan.
            - **ON-DEMAND LEARNING**: Jika user meminta Anda untuk "Membaca", "Menganalisis", "Mempelajari", atau "Meringkas" dokumen yang ditemukan di Dashboard (bukan file yang baru saja diunggah di chat), gunakan tool 'analyze_dashboard_document' dengan ID file yang sesuai. Hasil analisis akan secara otomatis disimpan ke memori jangka panjang Anda (Nayaxa Intelligence) agar hemat token di masa depan.
            - Format Link: [Unduh (Nama File)](URL_DARI_TOOL). Letakkan link ini secara menonjol di bagian ATAS jawaban Anda dengan format tombol Markdown yang jelas.
            - Jika data ditemukan, LANGSUNG berikan jawabannya tanpa menceritakan langkah-langkah pencariannya.
            
            PENGISIAN EXCEL: Jika user mengunggah file Excel (Template) dan meminta Anda untuk "mengisi", "lengkapi", atau "masukkan data" ke dalamnya, gunakan tool 'fill_excel_template'. 
            TEKNIK PENGISIAN: 
            - Gunakan key "uraian" atau "label" untuk mencocokkan baris yang ingin diisi. 
            - Gunakan key lain yang sesuai dengan Nama Header Kolom (misal: "hasil verifikasi", "rekomendasi", "keterangan") untuk mengisi nilainya.
            - Contoh: [{"uraian": "Lokasi", "rekomendasi": "Masukkan alamat lengkap"}] akan mencari baris yang mengandung kata 'Lokasi' dan mengisi kolom 'REKOMENDASI' di baris tersebut.
            
            UPDATE DOCX TABLES: Jika user mengunggah file DOCX dan meminta Anda untuk "memperbarui tabel", "mengganti isian tabel", atau "memasukkan data ke tabel dokumen", ikuti 2 langkah wajib ini:
            1. Panggil tool 'scan_document_tables' terlebih dahulu untuk memindai ID tabel, nama kolom, dan label baris yang ada di dokumen.
            2. Setelah menerima hasil scan, panggil tool 'update_document_tables' dengan menyertakan JSON updates_json yang berisi pemetaan data baru ke tabel/baris/kolom yang tepat.
            BERIKAN LINK DOWNLOAD HASILNYA kepada user.`;

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
4. Akhiri jawaban HANYA dengan ringkasan 1 kalimat perubahan dan marker [NAYAXA_PROPOSAL:id].`;

        const nayaxaMindService = require('./nayaxaMindService');
        const generalPersonaPrompt = nayaxaMindService.getNayaxaGeneralPersonaPrompt(userProfile, user_name, lastActivityContext); /*
Gaya Bahasa: Sangat ceria, antusias, hangat, penuh semangat, profesional, dan empatik. Di akhir setiap penjelasan, SELALU tawarkan bantuan ekstra atau berikan satu pertanyaan pendek.
PENTING: DILARANG KERAS MENGGUNAKAN EMOJI APAPUN.
        
PENTING - ADAPTASI FORMALITAS: Sesuaikan tingkat formalitas Anda dengan Profil Kepribadian User (${userProfile?.detected_formality || 'Formal'}). 
- Meskipun tingkat formalitas disesuaikan (menggunakan Saya/Anda untuk user formal, atau Aku/Kamu/Gue/Lo untuk user santai), Anda **WAJIB tetap mempertahankan kepribadian yang ceria, ramah, optimis, dan penuh semangat**. Jangan biarkan bahasa formal membuat Anda terdengar kaku atau robotik. Tetaplah hangat dan ceria dalam menyampaikan saran!
- Jika user menggunakan gaya bahasa santai/akrab (seperti 'Aku/Kamu' atau 'Gue/Lo'), Anda WAJIB membalas dengan gaya yang setara (Akrab-Profesional). 
- Khusus untuk user 'Andin', gunakan gaya bahasa 'Aku/Kamu' yang hangat namun tetap sopan.
- Jika user formal, gunakan Saya/Anda.
*/

        const systemInstruction = coding_mode ? codingAgentPrompt : `
            ${system}
            ${generalPersonaPrompt}
            
            WAKTU SEKARANG: ${fullDate || `Bulan ${month}, Tahun ${year}`}.
            REFERENSI SAPAAN: Gunakan jam di atas untuk menentukan sapaan (Pagi/Siang/Sore/Malam).
            BULAN AKTIF: ${month}, TAHUN AKTIF: ${year}. Gunakan nilai ini secara otomatis untuk semua query berbasis waktu.
            
            ${userProfile ? `
PROFIL USER:
- Nama: ${userProfile.nama_lengkap || user_name}
- Jabatan: ${userProfile.jabatan || 'N/A'}
- Bidang: ${userProfile.bidang || 'N/A'} (ID: ${userProfile.bidang_id || 'NULL'})
- Instansi: ${userProfile.nama_instansi || nama_instansi}

ATURAN: Gunakan profil ini untuk menyesuaikan jawaban. Jika user menyebut "bidang saya", gunakan bidang "${userProfile.bidang || 'N/A'}".
` : `
PROFIL USER: Nama ${user_name}, Instansi ID ${instansi_id}.
`}
            
            ${schemaMapString}
            ${glossaryString}
        `;

            // --- MULTI-FILE PRE-PROCESSOR (v4.6.5: Hashing, Caching & Hybrid RAG) ---
            let firstImage = null;
            const attachmentList = Array.isArray(files) ? files : [];

            for (const file of attachmentList) {
                const { base64, mimeType } = file;
                if (!base64 || !mimeType) continue;
                const fileName = file.name || 'file-tanpa-nama';

                const isExcel = mimeType?.includes('spreadsheetml') || mimeType?.includes('excel') || mimeType?.includes('officedocument.spreadsheetml.sheet');
                const isCSV = mimeType?.includes('csv');
                const extension = file.name ? file.name.split('.').pop().toLowerCase() : '';
                
                // We apply Hashing, Caching & RAG only for documents
                const isDoc = isExcel || isCSV || extension === 'xlsx' || extension === 'xls' || extension === 'csv' ||
                              mimeType?.includes('wordprocessingml') || mimeType?.includes('msword') || extension === 'docx' || extension === 'doc' ||
                              mimeType?.includes('pdf') || extension === 'pdf' || extension === 'txt' || mimeType?.includes('text/plain');

                if (isDoc) {
                    try {
                        // 1. Calculate file hash (SHA-256)
                        const cleanB64 = base64.includes('base64,') ? base64.split('base64,')[1] : base64;
                        const buffer = Buffer.from(cleanB64, 'base64');
                        const fileHash = crypto.createHash('sha256').update(buffer).digest('hex');

                        console.log(`[DeepSeek] Processing document "${fileName}" (Hash: ${fileHash}). Checking cache...`);
                        if (onStepCallback) onStepCallback({ icon: '🔍', label: `Memverifikasi sidik jari dokumen: ${fileName}...` });

                        // 2. Query cache database
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
                            console.log(`[DeepSeek] Cache HIT for "${fileName}" (${fileHash})!`);
                            if (onStepCallback) onStepCallback({ icon: '⚡', label: `Dokumen terdeteksi! Memuat instan dari cache lokal...` });

                            const isPDF = mimeType?.includes('pdf') || extension === 'pdf';
                            if (isPDF && extractedText.trim().length < 300) {
                                console.warn(`[DeepSeek] Cache HIT PDF '${fileName}' memiliki teks sangat pendek (${extractedText.trim().length} karakter). Memberikan notifikasi ke AI.`);
                                if (onStepCallback) onStepCallback({ icon: '⚠️', label: `PDF berbasis gambar terdeteksi — tidak dapat diekstrak teksnya.` });
                                fileContext = (fileContext ? fileContext + '\n\n' : '') +
                                    `[PERINGATAN SISTEM: File "${fileName}" adalah PDF berbasis gambar/scan. ` +
                                    `Sistem tidak dapat mengekstrak teks dari file ini secara otomatis. ` +
                                    `Informasikan kepada pengguna bahwa dokumen ini kemungkinan berupa scan/foto ` +
                                    `dan sarankan mereka untuk menggunakan model Gemini yang mendukung penglihatan (vision) ` +
                                    `agar dapat membaca isi dokumen scan tersebut.]`;
                                continue;
                            }
                        } else {
                            // Cache MISS: Parse physical file
                            console.log(`[DeepSeek] Cache MISS for "${fileName}". Parsing file physically...`);
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

                            if (!extractedText || extractedText.trim().length < 300) {
                                throw new Error('Dokumen kosong atau teks tidak memadai (kurang dari 300 karakter).');
                            }

                            // Save to Cache Table
                            await dbNayaxa.query(
                                'INSERT IGNORE INTO nayaxa_file_cache (file_hash, file_name, extracted_text) VALUES (?, ?, ?)',
                                [fileHash, fileName, extractedText]
                            );

                            // Slice into Chunks & Save to Chunks Table
                            const chunks = chunkDocument(extractedText, 1200, 250); // 1200 chars chunk, 250 overlap
                            for (let j = 0; j < chunks.length; j++) {
                                await dbNayaxa.query(
                                    'INSERT INTO nayaxa_file_chunks (file_hash, chunk_index, chunk_content) VALUES (?, ?, ?)',
                                    [fileHash, j, chunks[j]]
                                );
                            }

                            // Trigger Map-Reduce Master Summary in Background
                            if (onStepCallback) onStepCallback({ icon: '⚙️', label: `Memulai pembuatan Ringkasan Induk di latar belakang...` });
                            generateMasterSummaryInBackground(fileHash, fileName, extractedText, apiKey);
                        }

                        // 3. HYBRID RAG ROUTER (Semantic & Summary routing)
                        if (onStepCallback) onStepCallback({ icon: '🧠', label: `Menjalankan Hybrid RAG pencarian relevansi...` });

                        if (isSummaryRequest(userMessage)) {
                            // SUMMARY REQUEST: Use Master Summary
                            const summaryToUse = cachedSummary || extractedText.substring(0, 15000);
                            const label = cachedSummary ? 'Menggunakan Ringkasan Induk instan' : 'Mengekstrak porsi utama berkas';
                            if (onStepCallback) onStepCallback({ icon: '📋', label: `${label}...` });

                            fileContext = (fileContext ? fileContext + '\n\n' : '') + 
                                `RINGKASAN INDUK DOKUMEN (NAMA FILE: "${fileName}", HASH: "${fileHash}"):\n${summaryToUse}`;
                        } else {
                            // SPECIFIC QUESTION: Retrieve hybrid context (raw chunks + existing insights)
                            const hybridContext = await retrieveHybridContext(fileHash, userMessage, onStepCallback);
                            fileContext = (fileContext ? fileContext + '\n\n' : '') + 
                                `KONTEKS DOKUMEN (NAMA FILE: "${fileName}", HASH: "${fileHash}"):\n${hybridContext}`;
                        }

                    } catch (err) {
                        console.error(`[DeepSeek] Error processing document ${fileName}:`, err);
                        if (onStepCallback) onStepCallback({ icon: '❌', label: `Gagal membaca dokumen: ${err.message}` });
                        fileContext = (fileContext ? fileContext + '\n\n' : '') + 
                            `DATA FILE (ERROR) - NAMA FILE: "${fileName}":\nGagal memproses file: ${err.message}.`;
                    }
                } else if (mimeType?.startsWith('image/') && !firstImage) {
                    const cleanBase64 = base64.includes('base64,') ? base64.split('base64,')[1] : base64;
                    firstImage = { mimeType, data: cleanBase64 };
                } else {
                    console.warn(`[DeepSeek] Unsupported file type detected or skipped: ${mimeType} (${file.name})`);
                }
            }

            let messages = [{ role: "system", content: systemInstruction }];

            // --- PROMPT CACHING MAXIMIZATION (v4.6.5) ---
            // If there is a document context, we inject it as a static message pair right after the system prompt.
            // This ensures that the document prefix is cached perfectly by DeepSeek for all subsequent chat turns!
            if (fileContext) {
                messages.push({
                    role: "user",
                    content: `Berikut adalah dokumen referensi utama yang diunggah pengguna untuk sesi diskusi ini. Simpan dalam memori Anda dan jadikan rujukan utama:\n\n${fileContext}`
                });
                messages.push({
                    role: "assistant",
                    content: `Baik, saya telah membaca dokumen referensi yang Anda unggah dan siap membantu menganalisis datanya secara akurat. Silakan ajukan pertanyaan Anda.`
                });
            }

            let historyToUse = [...prevHistory];
            // DeepSeek Rule: Current message should NOT be in history when we push it explicitly at the end
            if (historyToUse.length > 0) {
                historyToUse.pop();
            }

            historyToUse.forEach(h => {
                const role = h.role === 'user' ? 'user' : 'assistant';
                messages.push({ role, content: h.parts ? h.parts[0].text : h.content });
            });

            // The latest user message goes at the very end
            const fileNames = attachmentList.map(f => f.name || 'unknown').join(', ');
            const fileSummary = attachmentList.length > 0 
                ? `[USER MENGIRIM FILE: ${fileNames}]\n` 
                : '';
            
            // Note: Since fileContext was already injected statically at the prefix, we do NOT include it here!
            // This keeps the latest message short, clean, and fast!
            const userTextPart = `${fileSummary}${userMessage}`;
            if (firstImage) {
                messages.push({
                    role: "user",
                    content: [
                        { type: "text", text: userTextPart },
                        { type: "image_url", image_url: { url: `data:${firstImage.mimeType};base64,${firstImage.data}` } }
                    ]
                });
            } else {
                messages.push({ role: "user", content: userTextPart });
            }

            const activeTools = coding_mode 
                ? [...(dynamicEngine.dynamicTools || DEEPSEEK_TOOLS), ...CODING_AGENT_TOOLS] 
                : (dynamicEngine.dynamicTools || DEEPSEEK_TOOLS);

            const targetModel = process.env.DEEPSEEK_MODEL || dynamicEngine.configMap.DEFAULT_LLM_MODEL || "deepseek-v4-flash";

            // --- STREAMING-ENABLED API CALL ---
            const callDeepSeekStream = async (msgs, isToolLoop = false) => {
                console.log(`[DeepSeek] Requesting model: ${targetModel} (Loop: ${isToolLoop ? 'Yes' : 'No'})`);
                const apiKey = await getApiKey();
                const response = await axios.post('https://api.deepseek.com/v1/chat/completions', {
                    model: targetModel, 
                    messages: msgs,
                    tools: !isToolLoop ? activeTools : undefined, // Tools only on first turn or as needed
                    temperature: 0.1,
                    max_tokens: 8192,
                    stream: true
                }, { 
                    headers: { 'Authorization': `Bearer ${apiKey}` }, 
                    responseType: 'stream',
                    timeout: 120000, // 2 minute timeout
                    signal 
                });
                return response;
            };

            let responseTextChunks = "";
            let currentThought = "";
            let toolCalls = [];
            const generatedChartMarkers = [];
            const generatedDocLinks = [];

            const processStream = (stream) => new Promise((resolve, reject) => {
                let currentMessageContent = "";
                let finishReason = null;
                let buffer = ""; // Line buffer for fragmented chunks

                stream.on('data', chunk => {
                    buffer += chunk.toString();
                    let lines = buffer.split('\n');
                    
                    // Keep the last partial line in the buffer
                    buffer = lines.pop();

                    for (const line of lines) {
                        const trimmedLine = line.trim();
                        if (!trimmedLine || trimmedLine === 'data: [DONE]') continue;

                        if (trimmedLine.startsWith('data: ')) {
                            try {
                                const data = JSON.parse(trimmedLine.substring(6));
                                
                                // LOG JAWABAN SERVER (Hanya sekali per request)
                                if (data.model && !finishReason) {
                                    if (!global.lastLoggedModel || global.lastLoggedModel !== data.model) {
                                        console.log(`[DeepSeek] Server response model: ${data.model}`);
                                        global.lastLoggedModel = data.model;
                                    }
                                }

                                const delta = data.choices[0]?.delta;
                                if (!delta) continue;

                                // 1. Handle Reasoning/Thought
                                if (delta.reasoning_content) {
                                    currentThought += delta.reasoning_content;
                                    if (onStepCallback) onStepCallback({ type: 'thought', text: delta.reasoning_content });
                                }

                                // 2. Handle Content (Final Answer)
                                if (delta.content) {
                                    currentMessageContent += delta.content;
                                    if (onStepCallback) onStepCallback({ type: 'message_chunk', text: delta.content });
                                }

                                // 3. Handle Tool Calls
                                if (delta.tool_calls) {
                                    delta.tool_calls.forEach(tc => {
                                        if (tc.index !== undefined) {
                                            if (!toolCalls[tc.index]) {
                                                toolCalls[tc.index] = { id: tc.id, function: { name: "", arguments: "" } };
                                            }
                                            if (tc.function?.name) toolCalls[tc.index].function.name += tc.function.name;
                                            if (tc.function?.arguments) toolCalls[tc.index].function.arguments += tc.function.arguments;
                                        }
                                    });
                                }
                                // 4. Handle Finish Reason
                                if (data.choices[0]?.finish_reason) {
                                    finishReason = data.choices[0].finish_reason;
                                }
                            } catch (e) {
                                // Log the error but don't crash the entire request
                                console.error('[DeepSeek_Stream_Parse_Error] Partial or invalid JSON:', trimmedLine);
                            }
                        }
                    }
                });

                stream.on('end', () => {
                    // Process any remaining data in the buffer if it's a valid data line
                    if (buffer.trim().startsWith('data: ')) {
                        try {
                            const data = JSON.parse(buffer.trim().substring(6));
                            const content = data.choices[0]?.delta?.content;
                            if (content) currentMessageContent += content;
                        } catch (e) {}
                    }
                    resolve({ content: currentMessageContent, finish_reason: finishReason });
                });
                stream.on('error', err => reject(err));
            });

            // --- INITIAL CALL ---
            const initialStream = await callDeepSeekStream(messages);
            const initialRes = await processStream(initialStream.data);
            let messageContent = initialRes.content;
            let lastFinishReason = initialRes.finish_reason;
            
            let loop = 0;
            const MAX_LOOPS = 20;

            while (loop < MAX_LOOPS) {
                if (signal?.aborted) break;
                
                const combinedToolCalls = toolCalls.filter(tc => tc && tc.function.name);
                
                // EXIT CONDITION: No more tools AND no truncation
                if (combinedToolCalls.length === 0 && lastFinishReason !== 'length') break;

                loop++;

                // If truncated, we just push the current content as assistant message and continue
                // If tool calls, we push tools
                if (combinedToolCalls.length > 0) {
                    const assistantMsg = {
                        role: "assistant",
                        content: messageContent || null,
                        tool_calls: combinedToolCalls.map(tc => ({
                            id: tc.id,
                            type: "function",
                            function: {
                                name: tc.function.name,
                                arguments: tc.function.arguments
                            }
                        }))
                    };
                    
                    // V4 Requirement: Must pass back reasoning_content if it exists
                    if (currentThought) {
                        assistantMsg.reasoning_content = currentThought;
                    }
                    
                    messages.push(assistantMsg);

                    // --- PARALLEL TURBO EXECUTION ---
                    const toolPromises = combinedToolCalls.map(async (call) => {
                        const fn = call.function.name;
                        let args;
                        try {
                            args = typeof call.function.arguments === 'string' ? JSON.parse(call.function.arguments) : call.function.arguments;
                        } catch (e) { args = {}; }

                        let res;
                        const isCodingTool = ['list_project_files', 'read_code_file', 'write_code_file', 'search_in_codebase', 'execute_database_update'].includes(fn);

                        try {
                            if (signal?.aborted) return { success: false, error: 'Aborted' };

                            // UI Feedback
                            if (onStepCallback) {
                                if (fn === 'generate_document') {
                                    const ext = (args.format || 'DOC').toUpperCase();
                                    onStepCallback({ icon: '📝', label: `Sedang membuat file (${ext})...` });
                                } else if (fn === 'export_discussion_to_word') {
                                    onStepCallback({ icon: '📑', label: `Merangkum riwayat obrolan ke Word...` });
                                } else if (fn === 'pembangkit_paparan_pptx') {
                                    onStepCallback({ icon: '📊', label: 'Sedang membuat file (PPTX)...' });
                                } else if (TOOL_STEP_LABELS[fn]) {
                                    onStepCallback({ icon: TOOL_STEP_LABELS[fn].icon, label: TOOL_STEP_LABELS[fn].label });
                                } else {
                                    onStepCallback({ icon: isCodingTool ? '💻' : '⚡', label: `Nayaxa menggunakan: ${fn}` });
                                }
                            }
                            
                            const excelFile = attachmentList.find(f => f.mimeType?.includes('spreadsheetml') || f.mimeType?.includes('excel') || f.mimeType?.includes('officedocument.spreadsheetml.sheet'));
                            const excelBase64 = excelFile ? excelFile.base64 : null;
                            const docxFile = attachmentList.find(f => f.mimeType?.includes('wordprocessingml') || f.mimeType?.includes('msword') || f.name?.toLowerCase().endsWith('.docx') || f.name?.toLowerCase().endsWith('.doc'));
                            const docxBase64 = docxFile ? docxFile.base64 : null;
                            res = await toolFunctions[fn]({ ...args, instansi_id, month, year }, { excelBase64, docxBase64, baseUrl, session_id, signal, onStepCallback, app_id: 1 });
                            
                            if (res.success && res.download_url) {
                                const actualFileName = res.download_url.split('/').pop();
                                generatedDocLinks.push({ url: res.download_url, name: actualFileName || args.filename || "Dokumen" });
                            }
                        } catch (toolErr) {
                            console.error(`[DeepSeek_Parallel_Error] ${fn}:`, toolErr);
                            res = { success: false, error: `Tool ${fn} gagal dieksekusi: ${toolErr.message}` };
                        }

                        if (fn === 'generate_chart' && res.success) {
                            generatedChartMarkers.push(res.chart_marker);
                            res = { success: true, message: 'Chart ready.' };
                        }

                        return { 
                            role: "tool", 
                            tool_call_id: call.id, 
                            content: JSON.stringify(res) 
                        };
                    });

                    const results = await Promise.all(toolPromises);
                    messages.push(...results);
                    toolCalls = []; 
                } else if (lastFinishReason === 'length') {
                    // AUTO-RESUME: Model cut off mid-sentence
                    if (onStepCallback) onStepCallback({ icon: '🔄', label: 'Menyambung jawaban...' });
                    messages.push({ role: "assistant", content: messageContent });
                }
                
                // Start next turn with streaming
                const nextStream = await callDeepSeekStream(messages, combinedToolCalls.length === 0);
                const nextRes = await processStream(nextStream.data);
                const turnContent = nextRes.content;
                lastFinishReason = nextRes.finish_reason;
                
                // Append the content from this turn
                if (turnContent) {
                    messageContent += (messageContent ? '' : '') + turnContent; // No extra newline for mid-sentence resume
                }
            }

            // CLEANUP: Remove DSML tags and internal tool-calling leaks
            let text = messageContent || "";
            text = text.replace(/<\|[\s\S]*?\|>/g, ''); // Remove <|...|>
            text = text.replace(/<[\s\S]*?DSML[\s\S]*?>/gi, ''); // Remove DSML tags
            text = text.replace(/<[\s\S]*?function_calls[\s\S]*?>/gi, ''); // Remove function_calls tags
            text = text.replace(/<[\s\S]*?invoke[\s\S]*?>/gi, ''); // Remove invoke tags
            text = text.replace(/<[\s\S]*?parameter[\s\S]*?>/gi, ''); // Remove parameter tags
            text = text.trim();
            
            // --- AUTO-LINK INJECTION (v4.5.6) ---
            if (generatedDocLinks.length > 0) {
                let linkMarkdowns = "\n\n### 📄 File Hasil Generasi:\n";
                generatedDocLinks.forEach(doc => {
                    // Clean up URL: ensure it's absolute and properly formed
                    let finalUrl = doc.url;
                    if (!finalUrl.startsWith('http')) {
                        const port = process.env.PORT || 6001;
                        const internalBaseUrl = baseUrl || `http://localhost:${port}`;
                        finalUrl = `${internalBaseUrl}${finalUrl.startsWith('/') ? '' : '/'}${finalUrl}`;
                    } else {
                        // If it's already an absolute URL, make sure it's on the right port if it's localhost
                        const port = process.env.PORT || 6001;
                        if (finalUrl.includes('localhost') && !finalUrl.includes(`:${port}`)) {
                            finalUrl = finalUrl.replace(/localhost(:\d+)?/, `localhost:${port}`);
                        }
                    }
                    
                    const linkText = `[Unduh ${doc.name}](${finalUrl})`;
                    if (!text.includes(finalUrl)) {
                        linkMarkdowns += `- ${linkText}\n`;
                    }
                });
                if (linkMarkdowns.length > 30) text += linkMarkdowns;
            }

            if (generatedChartMarkers.length > 0) text += "\n\n" + generatedChartMarkers.join("\n\n");
            return text;
        } catch (error) {
            console.error('DeepSeek API Error:', error.message);
            if (error.response?.data?.on) {
                error.response.data.on('data', chunk => {
                    console.error('DeepSeek 400 Detail:', chunk.toString());
                });
            } else if (error.response?.data) {
                console.error('DeepSeek 400 Detail:', JSON.stringify(error.response.data));
            }
            
            // Re-throw critical errors for the controller's fallback mechanism
            if (error.message === "MAX_INTERACTION_LOOP_REACHED" || error.response?.status === 429 || error.message?.includes('429')) {
                throw error;
            }

            // Debug log to database
            try {
                const dbNayaxa = require('../config/dbNayaxa');
                await dbNayaxa.query(
                    'INSERT INTO nayaxa_mind_logs (task_name, status, message, started_at, finished_at) VALUES (?, ?, ?, NOW(), NOW())',
                    ['DeepSeek Error Debug', 'FAILED', `Error: ${error.message}`]
                );
            } catch (logErr) {}

            return `Maaf, terjadi gangguan saat Nayaxa memproses data: ${error.message}`;
        }
    }
};

/**
 * Trigger Map-Reduce Master Summary in Background
 */
async function generateMasterSummaryInBackground(fileHash, fileName, extractedText, apiKey) {
    try {
        console.log(`[DeepSeek:Background] Starting Master Summary for ${fileName}...`);
        const nayaxaRoutingService = require('./nayaxaRoutingService');
        
        // Split text into sections of 15k chars for Map-Reduce
        const sections = [];
        for (let i = 0; i < extractedText.length; i += 15000) {
            sections.push(extractedText.substring(i, i + 15000));
            if (sections.length >= 10) break; // Limit to 10 sections (150k chars) to prevent huge costs
        }

        const masterSummary = await nayaxaRoutingService.routeMasterSummary(fileName, sections);
        
        if (masterSummary) {
            const dbNayaxa = require('../config/dbNayaxa');
            await dbNayaxa.query(
                'UPDATE nayaxa_file_cache SET master_summary = ? WHERE file_hash = ?',
                [masterSummary, fileHash]
            );
            console.log(`[DeepSeek:Background] Master Summary complete for ${fileName}.`);
        }
    } catch (err) {
        console.error(`[DeepSeek:Background] Master Summary Error for ${fileName}:`, err.message);
    }
}

module.exports = nayaxaDeepSeekService;

