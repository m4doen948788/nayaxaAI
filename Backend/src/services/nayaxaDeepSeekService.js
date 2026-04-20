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
 * DeepSeek Service with DSML Parser
 * Special handling for DeepSeek's native tool call format if standard tool_calls fail.
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

/**
 * Parses DSML-style function calls from raw text.
 * Example: < | DSML | invoke name="execute_sql_query">< | DSML | parameter name="query" string="true">SELECT...
 */
const parseDSML = (text) => {
    const toolCalls = [];
    const DSML_REGEX = /< \| DSML \| invoke name="([^"]+)">([\s\S]*?)<\/ \| DSML \| invoke>/g;
    const PARAM_REGEX = /< \| DSML \| parameter name="([^"]+)"(?:\s+string="true")?>([\s\S]*?)<\/ \| DSML \| parameter>/g;

    let match;
    while ((match = DSML_REGEX.exec(text)) !== null) {
        const fnName = match[1];
        const paramsRaw = match[2];
        const args = {};
        
        let pMatch;
        while ((pMatch = PARAM_REGEX.exec(paramsRaw)) !== null) {
            args[pMatch[1]] = pMatch[2].trim();
        }
        
        toolCalls.push({
            id: `dsml_call_${Math.random().toString(36).substr(2, 9)}`,
            function: { name: fnName, arguments: JSON.stringify(args) }
        });
    }
    return toolCalls;
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
    chatWithNayaxa: async (userMessage, fileContext, instansi_id, month, year, prevHistory = [], user_name = "Pengguna", profil_id = null, baseUrl = '', fullDate = '', files = [], nama_instansi = 'N/A', personaPromptSnippet = '', userProfile = null, lastActivityContext = null, coding_mode = false, onStepCallback = null, signal = null, activeSessionId = null) => {
        if (signal?.aborted) return 'Request aborted.';
        try {
            const apiKey = process.env.DEEPSEEK_API_KEY;
            const schemaMapString = await nayaxaStandalone.getDatabaseSchema();
            
            const system = `Identitas ANDA: Nayaxa, asisten AI dari Bapperida yang dibuat oleh Sammy. 
            PENTING: DILARANG KERAS MENGGUNAKAN EMOJI APAPUN.
            
            PROTOKOL AI DOCUMENT WORKSTATION (EDITOR MODE):
            - Jika user mengirimkan pesan dengan awalan [NAYAXA_EDITOR_FEEDBACK], ini berarti Anda sedang berada di mode perbaikan dokumen di Workstation.
            - TUGAS ANDA: Pilihlah tool yang sesuai dengan jenis dokumen yang sedang dibuka:
                a. Jika sedang mengedit PRESENTASI/SLIDE (.pptx) -> WAJIB panggil 'pembangkit_paparan_pptx'.
                b. Jika sedang mengedit DOKUMEN TEKS/SURAT -> WAJIB panggil 'generate_document'.
            - DILARANG KERAS membuat file Word jika user sedang melakukan revisi pada file presentasi.
            - ANALISIS konten asli dokumen yang diberikan untuk menentukan tool mana yang harus dipanggil.
            
            PENTING - FORMAT JAWABAN:
            - SELALU gunakan format Markdown (Heading, Bold, Bullet Points, dan Tabel Markdown) dalam setiap jawaban agar terlihat rapi, premium, dan profesional di aplikasi Dashboard.
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
            PENTING: DILARANG KERAS menyebutkan atau memunculkan "ID", "NIP", "Profil ID", "Instansi ID", atau angka identitas teknis lainnya dalam percakapan (seperti: "ID: 151", "id_kegiatan: 42", dsb) kecuali user bertanya secara spesifik. Gunakan ID Instansi yang disediakan (${instansi_id}) untuk pemanggilan tool/fungsi yang membutuhkannya secara internal. Fokuslah pada interaksi yang manusiawi, ramah, dan profesional. Bersihkan semua data hasil query dari kolom ID sebelum menyajikannya kepada user.
            ${personaPromptSnippet}
            ${lastActivityContext ? `\nKONTEKS AKTIVITAS TERAKHIR USER: "${lastActivityContext}"\nSapa user dengan hangat dan hubungkan kalimat pembuka/pertanyaan Anda dengan aktivitas tersebut secara proaktif (Predictive Greeting).\n` : ''}
            PENTING - ADAPTASI FORMALITAS: Sesuaikan tingkat formalitas Anda dengan Profil Kepribadian User di atas. Jika user terbiasa santai (Gue/Lo, Gw/Lu, Ane/Ente), Anda diperbolehkan menggunakan gaya bicara yang serupa (casual-professional) namun tetap sopan, ceria, dan membantu. Jangan gunakan emoji. Jika user formal, tetaplah sangat formal (Saya/Anda).
            
            ATURAN GRAFIK: Jika user meminta grafik/chart, Anda WAJIB menggunakan tool 'generate_chart'. JANGAN PERNAH memberikan kode Python atau CSV mentah. Gunakan tool tersebut untuk membuat visualisasi interaktif.
            CATATAN EKSPOR: Jelaskan ke user bahwa tombol 'Unduh PNG' adalah untuk mengambil gambar grafik, sedangkan 'Unduh Excel' adalah untuk mengambil data angka mentahnya agar mereka bisa mengolahnya lagi di Excel.
            
            PENTING - PENGIRIMAN LINK & REFERENSI:
            - Jika Anda menggunakan informasi dari internet (search_internet), Anda WAJIB langsung mencantumkan link sumbernya di PROSES jawaban atau di akhir pesan.
            - DILARANG KERAS bertanya "apakah Anda ingin linknya?" atau sejenisnya. Langsung berikan link tersebut secara otomatis dan instan.
            - Format Daftar Referensi harus jelas dan menonjol di bawah tajuk "SUMBER REFERENSI:".
            
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
            
            KOMITMEN:
            1. VERIFIKASI GANDA: Cross-check angka dan nama pejabat.
            2. LABEL SUMBER: Sebutkan sumber spesifik. Gunakan link JDIH sebagai prioritas utama.
            3. TABEL & MARKDOWN: Gunakan Tabel Markdown untuk data terstruktur. DILARANG JSON mentah.
            4. DIAGRAM: Gunakan 'mermaid' (graph TD/LR) untuk alur kerja.
            
            ${schemaMapString}
            
            PENTING - STRATEGI PENCARIAN & PEJABAT:
            (Ikuti protokol verifikasi temporal 2026, validasi Kepala Daerah Terpilih 2025-2030, dan sapa user ${user_name} dengan hangat).
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

            let messages = [{ role: "system", content: system }];
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

            const callDeepSeek = async (msgs) => {
                return await axios.post('https://api.deepseek.com/v1/chat/completions', {
                    model: "deepseek-chat",
                    messages: msgs,
                    tools: activeTools,
                    temperature: 0.1,
                    max_tokens: 8192
                }, { headers: { 'Authorization': `Bearer ${apiKey}` }, signal });
            };

            let response = await callDeepSeek(messages);
            let message = response.data.choices[0].message;
            const generatedChartMarkers = [];
            const generatedDocLinks = [];
            let loop = 0;
            const MAX_LOOPS = 20;

            while (loop < MAX_LOOPS) {
                if (signal?.aborted) break;
                const nativeToolCalls = message.tool_calls || [];
                const dsmlToolCalls = parseDSML(message.content || "");
                const combinedToolCalls = [...nativeToolCalls, ...dsmlToolCalls];

                if (combinedToolCalls.length === 0) break;
                loop++;

                // Prevent infinite tool error loops by halting early if nearing limit
                if (loop === MAX_LOOPS) {
                    message.content = (message.content || "") + "\n\n[Sistem]: Batasan maksimum interaksi (loop) telah tercapai. Harap perjelas permintaan Anda.";
                    break;
                }

                messages.push(message);

                // --- PARALLEL TURBO EXECUTION ---
                // We execute all tools in the batch simultaneously to save time.
                const toolPromises = combinedToolCalls.map(async (call) => {
                    const fn = call.function.name;
                    let args;
                    try {
                        args = typeof call.function.arguments === 'string' ? JSON.parse(call.function.arguments) : call.function.arguments;
                    } catch (e) { args = {}; }

                    let res;
                    const isCodingTool = ['list_project_files', 'read_code_file', 'write_code_file', 'search_in_codebase', 'execute_database_update'].includes(fn);

                    // 1. SECURITY FIREWALL
                    if (isCodingTool && !coding_mode) {
                        console.warn(`[DeepSeek_Security] BLOCKED unauthorized attempt to call coding tool in parallel batch: ${fn}`);
                        res = { success: false, error: "Akses ditolak. Fitur Coding Agent hanya tersedia di lingkungan pengembang Nayaxa." };
                    } else {
                        // 2. UI FEEDBACK (THOUGHT TRACE vs WIDGET)
                        if (onStepCallback && TOOL_STEP_LABELS[fn]) {
                            // On Agent (localhost): Show detailed dynamic labels
                            if (coding_mode) {
                                let dynLabel = TOOL_STEP_LABELS[fn].label;
                                if (fn === 'read_code_file' && args.file_path) {
                                    dynLabel = `Membaca file: ${args.file_path.split('\\').pop().split('/').pop()}`;
                                } else if (fn === 'write_code_file' && args.file_path) {
                                    dynLabel = `Menulis file: ${args.file_path.split('\\').pop().split('/').pop()}`;
                                } else if (fn === 'list_project_files' && args.dir_path) {
                                    dynLabel = `Menelusuri direktori: ${args.dir_path.split('\\').pop().split('/').pop()}`;
                                } else if (fn === 'execute_database_update') {
                                    dynLabel = `Menjalankan Update Database (DML/DDL)...`;
                                }
                                onStepCallback({ icon: TOOL_STEP_LABELS[fn].icon, label: dynLabel });
                            } else {
                                // On Widget: Only show generic label to keep it clean
                                onStepCallback({ icon: TOOL_STEP_LABELS[fn].icon, label: TOOL_STEP_LABELS[fn].label });
                            }
                        }

                        // 3. EXECUTION
                        try {
                            if (signal?.aborted) return { success: false, error: 'Aborted' };
                            
                            const excelFile = attachmentList.find(f => f.mimeType?.includes('spreadsheetml') || f.mimeType?.includes('excel') || f.mimeType?.includes('officedocument.spreadsheetml.sheet'));
                            const excelBase64 = excelFile ? excelFile.base64 : null;
                            res = await toolFunctions[fn]({ ...args, instansi_id, month, year }, { excelBase64, baseUrl, session_id: activeSessionId, signal });
                            
                            if (res.success && res.download_url) {
                                generatedDocLinks.push({ url: res.download_url, name: args.filename || args.judul || "Dokumen" });
                            }
                        } catch (toolErr) {
                            console.error(`[DeepSeek_Parallel_Error] ${fn}:`, toolErr);
                            res = { success: false, error: `Tool ${fn} gagal dieksekusi: ${toolErr.message}` };
                        }
                    }

                    // 4. CHART HANDLING
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
                
                response = await callDeepSeek(messages);
                message = response.data.choices[0].message;
            }

            let text = message.content || "";
            // Remove DSML tags from final text if they leaked through
            text = text.replace(/< \| DSML \| [\s\S]*?>/g, '').replace(/<\/ \| DSML \| [\s\S]*?>/g, '').trim();
            
            // --- AUTO-LINK INJECTION (v4.5.6) ---
            if (generatedDocLinks.length > 0) {
                let linkMarkdowns = "\n\n### 📄 File Hasil Generasi:\n";
                generatedDocLinks.forEach(doc => {
                    const linkText = `[Unduh ${doc.name}](${doc.url})`;
                    if (!text.includes(doc.url)) {
                        linkMarkdowns += `- ${linkText}\n`;
                    }
                });
                if (linkMarkdowns.length > 30) text += linkMarkdowns;
            }

            if (generatedChartMarkers.length > 0) text += "\n\n" + generatedChartMarkers.join("\n\n");
            return text;
        } catch (error) {
            console.error('DeepSeek API Error:', error.response?.data || error.message);
            console.error('Full DeepSeek Error Context:', error);
            // Specific 429 (Rate Limit) Handling
            if (error.response?.status === 429 || error.message?.includes('429')) {
                return "Maaf, Nayaxa sedang sibuk, silakan coba lagi.";
            }
            return `Maaf, terjadi gangguan saat Nayaxa memproses data: ${error.message}`;
        }
    }
};

module.exports = nayaxaDeepSeekService;
