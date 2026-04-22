const axios = require('axios');
const XLSX = require('xlsx');
const mammoth = require('mammoth');
const pdf = require('pdf-parse');
const dbDashboard = require('../config/dbDashboard');
const nayaxaStandalone = require('./nayaxaStandalone');
const exportService = require('./exportService');
const knowledgeTool = require('./knowledgeTool');
const codeAgent = require('./codeAgentService');

/**
 * DeepSeek Service - Stable v4.5.3
 * Standard tool-calling service for Nayaxa Engine.
 */

const toolFunctions = {
    search_internet: async ({ query }) => {
        const jsonResult = await nayaxaStandalone.searchInternet(query);
        return { internet_result: jsonResult };
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

            const downloadUrl = await (format === 'excel' ? exportService.generateExcel(content, filename) :
                                format === 'pdf' ? exportService.generatePDF(content, filename) :
                                exportService.generateWord(content, filename));
            
            return { success: true, download_url: downloadUrl, message: `File ${format.toUpperCase()} siap! Berikan link ini ke user: ${downloadUrl}` };
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
    ingest_to_knowledge: async ({ category, content, source_file }, { app_id }) => {
        return await knowledgeTool.ingestToKnowledge(app_id, category, content, source_file);
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
                content: { type: "string", description: "Konten file" },
                filename: { type: "string", description: "Nama file" }
            }, 
            required: ["format", "content", "filename"] 
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
    } }
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
    ingest_to_knowledge:       { icon: '🧠', label: 'Menyimpan ke basis pengetahuan...' },
    list_project_files:        { icon: '📁', label: 'Menjelajahi struktur proyek...' },
    read_code_file:            { icon: '📄', label: 'Membaca isi file kode...' },
    write_code_file:           { icon: '📝', label: 'Menyiapkan proposal kode...' },
    propose_code_changes:      { icon: '📦', label: 'Menyiapkan paket perubahan...' },
    search_in_codebase:        { icon: '🔍', label: 'Mencari di dalam codebase...' },
    execute_database_update:   { icon: '🛠️', label: 'Memodifikasi database...' },
};

const nayaxaDeepSeekService = {
    chatWithNayaxa: async (userMessage, files, instansi_id, month, year, prevHistory = [], user_name = "Pengguna", profil_id = null, fileContext = '', current_page = '', page_title = '', baseUrl = '', fullDate = '', nama_instansi = 'N/A', personaPromptSnippet = '', userProfile = null, lastActivityContext = null, coding_mode = false, session_id = null, onStepCallback = null, signal = null) => {
        if (signal?.aborted) return 'Request aborted.';
        try {
            const apiKey = process.env.DEEPSEEK_API_KEY;
            
            // --- Parallel Initialization (v4.6.0) ---
            const [schemaMapString, glossaryString] = await Promise.all([
                nayaxaStandalone.getDatabaseSchema(),
                nayaxaStandalone.getMasterDataGlossary()
            ]);
            
            const system = `Identitas ANDA: Nayaxa, asisten AI dari Bapperida yang dibuat oleh Sammy. 
            PENTING: DILARANG KERAS MENGGUNAKAN EMOJI APAPUN.

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
                * "Jadikan Acuan Bahan": Gunakan file ini sebagai sumber data utama/fakta mentah untuk menjawab pertanyaan user.
                * "Jadikan Acuan Format": Gunakan gaya bahasa, struktur, dan tata letak file tersebut sebagai referensi utama untuk output Anda.
                * "Buatkan Ringkasan": Fokuskan jawaban pada poin-poin penting file tersebut.
                * "Buatkan Ringkasan+Notulen": Buat ringkasan dan draf notulen rapat dari file tersebut.
                * "Buatkan Ringkasan+Notulen+Word": Sama seperti di atas, namun Anda WAJIB langsung memanggil tool 'generate_document' untuk membuat file Word-nya.
            
            PENTING - FORMAT JAWABAN:
            - ANDA WAJIB memberikan ringkasan teks atau penjelasan setelah menggunakan tool. DILARANG KERAS hanya memanggil tool tanpa memberikan respon teks sama sekali.
            - SELALU gunakan format Markdown (Heading, Bold, Bullet Points, dan Tabel Markdown) dalam setiap jawaban agar terlihat rapi, premium, dan profesional di aplikasi Dashboard.
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
            - JANGAN PERNAH mengatakan "Saya akan mencari..." atau "Tunggu sebentar...". LANGSUNG berikan linknya di jawaban pertama Anda.
            - Tool ini akan mencari di database file (DOKUMEN_UPLOAD) dan database pengetahuan (NAYAXA_KNOWLEDGE).
            - Berikan link download untuk hasil berkategori [FILE] dan ringkasan informasi untuk hasil [KNOWLEDGE].
            - Format Link: [Unduh (Nama File)](URL_DARI_TOOL). Letakkan link ini secara menonjol di bagian atas atau akhir pesan Anda dengan format tombol Markdown yang jelas.
            
            PENGISIAN EXCEL: Jika user mengunggah file Excel (Template) dan meminta Anda untuk "mengisi", "lengkapi", atau "masukkan data" ke dalamnya, gunakan tool 'fill_excel_template'. 
            TEKNIK PENGISIAN: 
            - Gunakan key "uraian" atau "label" untuk mencocokkan baris yang ingin diisi. 
            - Gunakan key lain yang sesuai dengan Nama Header Kolom (misal: "hasil verifikasi", "rekomendasi", "keterangan") untuk mengisi nilainya.
            - Contoh: [{"uraian": "Lokasi", "rekomendasi": "Masukkan alamat lengkap"}] akan mencari baris yang mengandung kata 'Lokasi' dan mengisi kolom 'REKOMENDASI' di baris tersebut.
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

        const generalPersonaPrompt = `Identitas ANDA: Nayaxa, asisten AI dari Bapperida yang dibuat oleh Sammy.
Gaya Bahasa: Sangat ceria, ramah, profesional, dan empatik. Di akhir setiap penjelasan, SELALU tawarkan bantuan ekstra atau berikan satu pertanyaan pendek.
PENTING: DILARANG KERAS MENGGUNAKAN EMOJI APAPUN.
        
PENTING - ADAPTASI FORMALITAS: Sesuaikan tingkat formalitas Anda dengan Profil Kepribadian User (${userProfile?.detected_formality || 'Formal'}). Jika user terbiasa santai (Gue/Lo, Gw/Lu), gunakan gaya casual-professional namun tetap sopan. Jika user formal, gunakan Saya/Anda.
        
${lastActivityContext ? `\nKONTEKS AKTIVITAS: "${lastActivityContext}"\nSapa user dengan hangat dan hubungkan dengan aktivitas tersebut.\n` : ''}`;

        const systemInstruction = coding_mode ? codingAgentPrompt : `
            ${system}
            ${generalPersonaPrompt}
            
            WAKTU SEKARANG: ${fullDate || `Bulan ${month}, Tahun ${year}`}.
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

            // --- MULTI-FILE PRE-PROCESSOR ---
            let firstImage = null;
            const attachmentList = Array.isArray(files) ? files : [];

            for (const file of attachmentList) {
                const { base64, mimeType } = file;
                if (!base64 || !mimeType) continue;
                const fileName = file.name || 'file-tanpa-nama';

                const isExcel = mimeType?.includes('spreadsheetml') || mimeType?.includes('excel') || mimeType?.includes('officedocument.spreadsheetml.sheet');
                const isCSV = mimeType?.includes('csv');
                const extension = file.name ? file.name.split('.').pop().toLowerCase() : '';
                
                if (isExcel || isCSV || extension === 'xlsx' || extension === 'xls' || extension === 'csv') {
                    try {
                        console.log(`[DeepSeek] Pre-processing ${isExcel || extension.includes('xls') ? 'Excel' : 'CSV'} file...`);
                        const cleanB64 = base64.includes('base64,') ? base64.split('base64,')[1] : base64;
                        const buffer = Buffer.from(cleanB64, 'base64');
                        const workbook = XLSX.read(buffer, { type: 'buffer' });
                        let sheetData = "";
                        workbook.SheetNames.forEach(sheetName => {
                            const sheet = workbook.Sheets[sheetName];
                            const csv = XLSX.utils.sheet_to_csv(sheet);
                            sheetData += `\n--- Sheet: ${sheetName} ---\n${csv}\n`;
                        });
                        fileContext = (fileContext ? fileContext + '\n\n' : '') + `DATA FILE (${isExcel || extension.includes('xls') ? 'EXCEL' : 'CSV'}) - NAMA FILE: "${fileName}":\n${sheetData}`;
                    } catch (err) {
                        console.error('DeepSeek File Pre-process Error:', err);
                    }
                } else if (mimeType?.includes('wordprocessingml') || mimeType?.includes('msword') || extension === 'docx' || extension === 'doc') {
                    try {
                        console.log(`[DeepSeek] Pre-processing Word file (HTML mode)...`);
                        const cleanB64 = base64.includes('base64,') ? base64.split('base64,')[1] : base64;
                        const buffer = Buffer.from(cleanB64, 'base64');
                        const wordResult = await mammoth.convertToHtml({ buffer: buffer });
                        // Strip base64 images to prevent 400 "Request Too Large" errors while keeping structure
                        const cleanHtml = wordResult.value.replace(/<img[^>]*>/g, '[Gambar]');
                        fileContext = (fileContext ? fileContext + '\n\n' : '') + `DATA FILE (WORD/HTML) - NAMA FILE: "${fileName}":\n${cleanHtml}`;

                    } catch (err) {
                        console.error('DeepSeek Word Pre-process Error:', err);
                    }
                } else if (mimeType?.includes('pdf') || extension === 'pdf') {
                    try {
                        console.log(`[DeepSeek] Pre-processing PDF file: ${fileName}`);
                        const cleanB64 = base64.includes('base64,') ? base64.split('base64,')[1] : base64;
                        const buffer = Buffer.from(cleanB64, 'base64');
                        const pdfData = await pdf(buffer);
                        const extractedText = pdfData.text?.trim() || '';

                        if (extractedText.length < 80) {
                            console.warn(`[DeepSeek] PDF text too short (${extractedText.length} chars) - likely a scanned PDF.`);
                            fileContext = (fileContext ? fileContext + '\n\n' : '') + 
                                `DATA FILE (PDF - PERINGATAN) - NAMA FILE: "${fileName}":\nFile PDF ini tidak dapat dibaca secara teks. Kemungkinan besar file ini adalah dokumen hasil scan (gambar) atau PDF yang dilindungi. Konten teks tidak tersedia. JANGAN MENGARANG atau MENGASUMSIKAN isi dokumen ini.`;
                        } else {
                            const MAX_PDF_CHARS = 60000;
                            const truncated = extractedText.length > MAX_PDF_CHARS;
                            const finalText = truncated ? extractedText.slice(0, MAX_PDF_CHARS) + '\n\n[...Dokumen terpotong karena terlalu panjang...]' : extractedText;
                            console.log(`[DeepSeek] PDF extracted: ${extractedText.length} chars${truncated ? ' (truncated)' : ''}`);
                            fileContext = (fileContext ? fileContext + '\n\n' : '') + `DATA FILE (PDF) - NAMA FILE: "${fileName}":\n${finalText}`;
                        }
                    } catch (err) {
                        console.error('DeepSeek PDF Pre-process Error:', err);
                        fileContext = (fileContext ? fileContext + '\n\n' : '') + 
                            `DATA FILE (PDF - ERROR) - NAMA FILE: "${fileName}":\nGagal memproses file PDF: ${err.message}. JANGAN MENGARANG isi dokumen ini.`;
                    }
                } else if (mimeType?.startsWith('image/') && !firstImage) {
                    // DeepSeek currently only supports one image via image_url in most compatible implementations
                    const cleanBase64 = base64.includes('base64,') ? base64.split('base64,')[1] : base64;
                    firstImage = { mimeType, data: cleanBase64 };
                } else {
                    console.warn(`[DeepSeek] Unsupported file type detected or skipped: ${mimeType} (${file.name})`);
                }
            }

            let messages = [{ role: "system", content: systemInstruction }];
            let historyToUse = [...prevHistory];
            // DeepSeek Rule: Current message should NOT be in history when we push it explicitly at the end
            if (historyToUse.length > 0) {
                historyToUse.pop();
            }

            historyToUse.forEach(h => {
                const role = h.role === 'user' ? 'user' : 'assistant';
                messages.push({ role, content: h.parts ? h.parts[0].text : h.content });
            });
            // Build user message with file list summary prepended
            const fileNames = attachmentList.map(f => f.name || 'unknown').join(', ');
            const fileSummary = attachmentList.length > 0 
                ? `[USER MENGIRIM FILE: ${fileNames}]\n` 
                : '';
            const userTextPart = fileContext 
                ? `${fileContext}\n\n${fileSummary}${userMessage}` 
                : `${fileSummary}${userMessage}`;
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
                ? [...DEEPSEEK_TOOLS, ...CODING_AGENT_TOOLS] 
                : DEEPSEEK_TOOLS;

            // --- STREAMING-ENABLED API CALL ---
            const callDeepSeekStream = async (msgs, isToolLoop = false) => {
                const response = await axios.post('https://api.deepseek.com/v1/chat/completions', {
                    model: "deepseek-chat", // Use deepseek-reasoner for R1 if applicable
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
                    resolve(currentMessageContent);
                });
                stream.on('error', err => reject(err));
            });

            // --- INITIAL CALL ---
            const initialStream = await callDeepSeekStream(messages);
            let messageContent = await processStream(initialStream.data);
            
            let loop = 0;
            const MAX_LOOPS = 20;

            while (loop < MAX_LOOPS) {
                if (signal?.aborted) break;
                
                // Only proceed if there are pending tool calls
                const combinedToolCalls = toolCalls.filter(tc => tc && tc.function.name);
                if (combinedToolCalls.length === 0) break;

                loop++;

                // Push Assistant's tool calls to messages
                messages.push({
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
                });

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
                        res = await toolFunctions[fn]({ ...args, instansi_id, month, year }, { excelBase64, baseUrl, session_id, signal });
                        
                        if (res.success && res.download_url) {
                            generatedDocLinks.push({ url: res.download_url, name: args.filename || args.judul || "Dokumen" });
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
                
                // CRITICAL: Reset toolCalls for the next turn
                toolCalls = []; 
                
                // Start next turn with streaming
                const nextStream = await callDeepSeekStream(messages, true);
                const turnContent = await processStream(nextStream.data);
                
                // Append the content from this turn
                if (turnContent) {
                    messageContent += (messageContent ? '\n' : '') + turnContent;
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
                    // FORCE ABSOLUTE URL: Ensure links always point to port 6001
                    let finalUrl = doc.url;
                    const port = process.env.PORT || 6001;
                    const baseUrl = `http://localhost:${port}`;

                    if (finalUrl.startsWith('http')) {
                        // If it's already an absolute URL, just make sure it's on the right port if it's localhost
                        if (finalUrl.includes('localhost') && !finalUrl.includes(`:${port}`)) {
                            finalUrl = finalUrl.replace(/localhost(:\d+)?/, `localhost:${port}`);
                        }
                    } else {
                        // SMART ROUTING for relative paths
                        const fileNameOnly = finalUrl.split('/').pop();
                        const isDashboardUpload = /^\d{10,}-/.test(fileNameOnly);

                        if (isDashboardUpload) {
                            finalUrl = `${baseUrl}/uploads/dashboard/${fileNameOnly}`;
                        } else if (finalUrl.includes('export/')) {
                            finalUrl = `${baseUrl}/api/nayaxa/export/${fileNameOnly}`;
                        } else {
                            finalUrl = `${baseUrl}/uploads/${fileNameOnly}`;
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
            console.error('DeepSeek API Error:', error.response?.data || error.message);
            
            // Re-throw critical errors for the controller's fallback mechanism
            if (error.message === "MAX_INTERACTION_LOOP_REACHED" || error.response?.status === 429 || error.message?.includes('429')) {
                throw error;
            }

            return `Maaf, terjadi gangguan saat Nayaxa memproses data: ${error.message}`;
        }
    }
};

module.exports = nayaxaDeepSeekService;
