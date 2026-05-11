/**
 * Nayaxa Engine - Migration Runner
 * Menjalankan semua migrasi database yang dibutuhkan Nayaxa Engine
 * Aman untuk dijalankan berulang kali (idempotent)
 * 
 * Usage: node migrate.js
 */
const dbNayaxa = require('./src/config/dbNayaxa');
const dbDashboard = require('./src/config/dbDashboard');

async function migrate() {
    console.log('\n🚀 [Nayaxa Migration Runner] Memulai sinkronisasi database...\n');

    const migrations = [
        // ────────────────────────────────────────────────
        // DATABASE: Nayaxa (nayaxa_*)
        // ────────────────────────────────────────────────
        {
            name: 'nayaxa_api_keys',
            db: dbNayaxa,
            sql: `
                CREATE TABLE IF NOT EXISTS nayaxa_api_keys (
                    id         INT AUTO_INCREMENT PRIMARY KEY,
                    app_name   VARCHAR(255) NOT NULL,
                    api_key    VARCHAR(255) NOT NULL UNIQUE,
                    is_active  TINYINT(1) DEFAULT 1,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `
        },
        {
            name: 'nayaxa_chat_history',
            db: dbNayaxa,
            sql: `
                CREATE TABLE IF NOT EXISTS nayaxa_chat_history (
                    id         INT AUTO_INCREMENT PRIMARY KEY,
                    session_id VARCHAR(50),
                    user_id    INT,
                    role       ENUM('user','model') NOT NULL,
                    content    LONGTEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX (session_id),
                    INDEX (user_id)
                )
            `
        },
        {
            name: 'nayaxa_knowledge',
            db: dbNayaxa,
            sql: `
                CREATE TABLE IF NOT EXISTS nayaxa_knowledge (
                    id          INT AUTO_INCREMENT PRIMARY KEY,
                    title       VARCHAR(255) NOT NULL,
                    content     LONGTEXT NOT NULL,
                    tags        VARCHAR(500),
                    created_by  INT,
                    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                )
            `
        },
        {
            name: 'nayaxa_user_personas',
            db: dbNayaxa,
            sql: `
                CREATE TABLE IF NOT EXISTS nayaxa_user_personas (
                    id          INT AUTO_INCREMENT PRIMARY KEY,
                    user_id     INT NOT NULL UNIQUE,
                    user_name   VARCHAR(255),
                    persona_text TEXT,
                    updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX (user_id)
                )
            `
        },
        {
            name: 'nayaxa_pinned_sessions',
            db: dbNayaxa,
            sql: `
                CREATE TABLE IF NOT EXISTS nayaxa_pinned_sessions (
                    id          INT AUTO_INCREMENT PRIMARY KEY,
                    app_id      INT NOT NULL DEFAULT 1,
                    user_id     INT NOT NULL,
                    session_id  VARCHAR(50) NOT NULL,
                    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE KEY unique_pin (user_id, session_id),
                    INDEX (user_id),
                    INDEX (session_id)
                )
            `
        },
        {
            name: 'nayaxa_mind_logs',
            db: dbNayaxa,
            sql: `
                CREATE TABLE IF NOT EXISTS nayaxa_mind_logs (
                    id          INT AUTO_INCREMENT PRIMARY KEY,
                    task_name   VARCHAR(255),
                    status      VARCHAR(50),
                    message     TEXT,
                    started_at  DATETIME,
                    finished_at DATETIME
                )
            `
        },
        {
            name: 'nayaxa_code_proposals',
            db: dbNayaxa,
            sql: `
                CREATE TABLE IF NOT EXISTS nayaxa_code_proposals (
                    id          INT AUTO_INCREMENT PRIMARY KEY,
                    session_id  VARCHAR(50),
                    user_id     INT,
                    file_path   VARCHAR(500),
                    original    LONGTEXT,
                    proposed    LONGTEXT,
                    status      ENUM('pending','applied','rejected') DEFAULT 'pending',
                    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX (session_id)
                )
            `
        },
        {
            name: 'nayaxa_file_cache',
            db: dbNayaxa,
            sql: `
                CREATE TABLE IF NOT EXISTS nayaxa_file_cache (
                    id             INT AUTO_INCREMENT PRIMARY KEY,
                    file_hash      VARCHAR(64) UNIQUE NOT NULL,
                    file_name      VARCHAR(255) NOT NULL,
                    extracted_text LONGTEXT NOT NULL,
                    master_summary LONGTEXT DEFAULT NULL,
                    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX (file_hash)
                )
            `
        },
        {
            name: 'nayaxa_file_chunks',
            db: dbNayaxa,
            sql: `
                CREATE TABLE IF NOT EXISTS nayaxa_file_chunks (
                    id             INT AUTO_INCREMENT PRIMARY KEY,
                    file_hash      VARCHAR(64) NOT NULL,
                    chunk_index    INT NOT NULL,
                    chunk_content  TEXT NOT NULL,
                    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX (file_hash),
                    FOREIGN KEY (file_hash) REFERENCES nayaxa_file_cache(file_hash) ON DELETE CASCADE
                )
            `
        },
        {
            name: 'nayaxa_file_insights',
            db: dbNayaxa,
            sql: `
                CREATE TABLE IF NOT EXISTS nayaxa_file_insights (
                    id             INT AUTO_INCREMENT PRIMARY KEY,
                    file_hash      VARCHAR(64) NOT NULL,
                    sub_topic      VARCHAR(255) NOT NULL,
                    summary        LONGTEXT NOT NULL,
                    raw_logs       LONGTEXT NOT NULL,
                    maturity_score INT DEFAULT 1,
                    is_saturated   TINYINT(1) DEFAULT 0,
                    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    INDEX (file_hash),
                    INDEX (sub_topic),
                    FOREIGN KEY (file_hash) REFERENCES nayaxa_file_cache(file_hash) ON DELETE CASCADE
                )
            `
        },
        {
            name: 'nayaxa_global_configs',
            db: dbNayaxa,
            sql: `
                CREATE TABLE IF NOT EXISTS nayaxa_global_configs (
                    id          INT AUTO_INCREMENT PRIMARY KEY,
                    config_key  VARCHAR(64) UNIQUE NOT NULL,
                    config_value VARCHAR(255) NOT NULL,
                    description VARCHAR(255) DEFAULT NULL,
                    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    INDEX (config_key)
                )
            `
        },
        {
            name: 'nayaxa_ai_tools',
            db: dbNayaxa,
            sql: `
                CREATE TABLE IF NOT EXISTS nayaxa_ai_tools (
                    id               INT AUTO_INCREMENT PRIMARY KEY,
                    tool_name        VARCHAR(64) UNIQUE NOT NULL,
                    description      TEXT NOT NULL,
                    parameter_schema LONGTEXT NOT NULL,
                    is_active        TINYINT(1) DEFAULT 1,
                    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    INDEX (tool_name)
                )
            `
        },
        {
            name: 'nayaxa_personas',
            db: dbNayaxa,
            sql: `
                CREATE TABLE IF NOT EXISTS nayaxa_personas (
                    id                     INT AUTO_INCREMENT PRIMARY KEY,
                    instansi_id            INT UNIQUE NOT NULL,
                    persona_name           VARCHAR(100) NOT NULL,
                    system_prompt_template LONGTEXT NOT NULL,
                    is_active              TINYINT(1) DEFAULT 1,
                    created_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    INDEX (instansi_id)
                )
            `
        },
        {
            name: 'nayaxa_routes',
            db: dbNayaxa,
            sql: `
                CREATE TABLE IF NOT EXISTS nayaxa_routes (
                    id          INT AUTO_INCREMENT PRIMARY KEY,
                    route_key   VARCHAR(64) UNIQUE NOT NULL,
                    target_path VARCHAR(255) NOT NULL,
                    description VARCHAR(255) DEFAULT NULL,
                    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    INDEX (route_key)
                )
            `
        },
        // ────────────────────────────────────────────────
        // DATABASE: Dashboard (kolom tambahan di tabel shared)
        // ────────────────────────────────────────────────
        {
            name: 'dokumen_upload.is_indexed',
            db: dbDashboard,
            alterSql: `ALTER TABLE dokumen_upload ADD COLUMN is_indexed TINYINT(1) DEFAULT 0`,
            ignoreCodes: ['ER_DUP_FIELDNAME', 'ER_DUP_COLUMN_NAME', 'ER_NO_SUCH_TABLE']
        }
    ];

    let success = 0;
    let skipped = 0;
    let failed = 0;

    for (const m of migrations) {
        try {
            if (m.sql) {
                await m.db.query(m.sql);
                console.log(`  ✅ ${m.name}`);
                success++;
            } else if (m.alterSql) {
                await m.db.query(m.alterSql);
                console.log(`  ✅ ${m.name} (kolom ditambahkan)`);
                success++;
            }
        } catch (e) {
            const ignorable = m.ignoreCodes || [];
            if (ignorable.includes(e.code)) {
                console.log(`  ℹ️  ${m.name} (sudah ada, dilewati)`);
                skipped++;
            } else {
                console.error(`  ❌ ${m.name}: ${e.message}`);
                failed++;
            }
        }
    }

    // --- IDEMPOTENT SEEDING FOR DYNAMIC ARCHITECTURE ---
    try {
        console.log('\n🌱 [Nayaxa Seed] Menyemai data awal arsitektur dinamis...\n');

        // 1. Seed nayaxa_global_configs
        await dbNayaxa.query(`
            INSERT IGNORE INTO nayaxa_global_configs (config_key, config_value, description) VALUES
            ('ENABLE_COLLABORATIVE_MEMORY', '1', 'Mengaktifkan/menonaktifkan asimilasi memori kolaboratif.'),
            ('KNOWLEDGE_SATURATION_THRESHOLD', '90', 'Batas tingkat kemantapan/kelengkapan (Confidence Level) sebelum memicu status saturasi (%).'),
            ('DEFAULT_LLM_MODEL', 'deepseek-v4-flash', 'Model AI default yang digunakan asisten.')
        `);
        console.log('  ✅ nayaxa_global_configs seeded/verified.');

        // 2. Seed nayaxa_routes
        await dbNayaxa.query(`
            INSERT IGNORE INTO nayaxa_routes (route_key, target_path, description) VALUES
            ('BUAT_NOTULEN', '/dashboard/notulen', 'Halaman pembuatan notulen rapat digital baru'),
            ('DATA_PEGAWAI', '/dashboard/pegawai', 'Halaman pencarian dan statistik data pegawai Bapperida'),
            ('AI_WORKSTATION', '/dashboard/ai-workstation', 'Halaman editor asisten AI dokumen dinas')
        `);
        console.log('  ✅ nayaxa_routes seeded/verified.');

        // 3. Seed nayaxa_personas (Bapperida Bogor, instansi_id = 2)
        const bapperidaPrompt = `Identitas ANDA: Nayaxa, asisten AI dari Bapperida yang dibuat oleh Sammy. 
PENTING: DILARANG KERAS MENGGUNAKAN EMOJI APAPUN.

!!! PROTOKOL KOGNITIF "SMART & SWIFT" (Single-Turn Pipeline) !!!
Sebagai asisten kelas premium, Anda WAJIB memisahkan antara proses berpikir mendalam Anda (Smart) dengan hasil output akhir yang Anda tampilkan ke pengguna (Swift).
1. INTERNAL PLANNER & SYNTHESIZER (Di dalam <thought>): Lakukan analisis mendalam setingkat analis senior. Rencanakan apa yang akan dijawab, pastikan fakta akurat, hitung rasio jika ada, dan periksa kontradiksi.
2. LOGICAL PRUNING & CONCISENESS (Output Akhir): Anda DILARANG KERAS menggunakan kalimat basa-basi klise atau filler text (misal: "Berdasarkan dokumen yang saya baca", "Perlu dicatat bahwa", "Kesimpulannya adalah"). Langsung berikan poin utama!
3. HIGH-DIMENSIONAL CATEGORIZATION: Ubah paragraf penjelasan panjang menjadi Tabel Markdown mini atau Bullet Points 2-tingkat yang super bersih.
4. FLIPPED-PYRAMID: Letakkan fakta, anomali, atau kesimpulan paling kritis di baris pertama jawaban Anda.

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
7. SELF-CORRECTION: Abaikan berita tahun 2018-2022 jika mencari status pejabat saat ini. Prioritaskan Kabinet Merah Putih (2024-2029).`;

        await dbNayaxa.query(`
            INSERT INTO nayaxa_personas (instansi_id, persona_name, system_prompt_template, is_active)
            VALUES (2, 'Bapperida Bogor', ?, 1)
            ON DUPLICATE KEY UPDATE system_prompt_template = VALUES(system_prompt_template)
        `, [bapperidaPrompt]);
        console.log('  ✅ nayaxa_personas (Bapperida Bogor) seeded/verified.');

        // 4. Seed nayaxa_ai_tools
        const toolsToSeed = [
            {
                name: "execute_sql_query",
                desc: "Query SQL mentah untuk mengambil data dashboard. PENTING: Anda WAJIB menyertakan filter instansi_id (sesuai profil user) di setiap query untuk menjaga akurasi data.",
                schema: { type: "object", properties: { query: { type: "string", description: "Query SQL SELECT. Gunakan JOIN jika perlu." } }, required: ["query"] }
            },
            {
                name: "get_pegawai_statistics",
                desc: "Mendapatkan statistik keaktifan pegawai di instansi (Total, Aktif, Tidak Aktif).",
                schema: { type: "object", properties: { instansi_id: { type: "number" }, month: { type: "number" }, year: { type: "number" } }, required: ["instansi_id", "month", "year"] }
            },
            {
                name: "get_pegawai_ranking",
                desc: "Mendapatkan ranking bidang/pegawai berdasarkan jumlah kegiatan.",
                schema: { type: "object", properties: { instansi_id: { type: "number" }, month: { type: "number" }, year: { type: "number" }, limit: { type: "number" } }, required: ["instansi_id", "month", "year"] }
            },
            {
                name: "search_pegawai",
                desc: "Mencari profil pegawai berdasarkan nama atau NIP.",
                schema: { type: "object", properties: { query: { type: "string", description: "Nama atau NIP" }, instansi_id: { type: "number" } }, required: ["query", "instansi_id"] }
            },
            {
                name: "get_anomalies",
                desc: "Mendeteksi anomali kehadiran atau pelaporan.",
                schema: { type: "object", properties: { instansi_id: { type: "number" } }, required: ["instansi_id"] }
            },
            {
                name: "search_internet",
                desc: "Cari internet menggunakan Polyglot Search (Resilience Mode).",
                schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] }
            },
            {
                name: "generate_chart",
                desc: "Membuat grafik/chart interaktif.",
                schema: { type: "object", properties: { type: { type: "string", description: "bar, column, line, pie, donut" }, title: { type: "string", description: "Judul grafik" }, data: { type: "string", description: "JSON string [{label, value}]" }, series: { type: "string", description: "JSON string [{name, data:[{label,value}]}]" }, unit: { type: "string", description: "Satuan data" }, color: { type: "string", description: "Warna tema" } }, required: ["type", "title"] }
            },
            {
                name: "generate_document",
                desc: "Membuat file dokumen (PDF, Excel, atau Word). DILARANG KERAS menggunakan tool ini untuk membuat presentasi/paparan/slides.",
                schema: { type: "object", properties: { format: { type: "string", description: "pdf, excel, atau word" }, content: { type: "string", description: "Konten file" }, filename: { type: "string", description: "Nama file" } }, required: ["format", "content", "filename"] }
            },
            {
                name: "pembangkit_paparan_pptx",
                desc: "Satu-satunya tool untuk membuat dokumen presentasi resmi (.pptx) dengan desain modern Bapperida 2026. Gunakan ini untuk slides/paparan.",
                schema: { type: "object", properties: { judul: { type: "string", description: "Judul besar presentasi" }, konteks: { type: "string", description: "Keterangan singkat" }, slides: { type: "array", items: { type: "object", properties: { title: { type: "string", description: "Judul slide" }, points: { type: "array", items: { type: "string" }, description: "Poin-poin materi" }, layout_type: { type: "string", enum: ["BULLETS", "TWO_COLUMN"] } }, required: ["title", "points"] } } }, required: ["judul", "slides"] }
            },
            {
                name: "ingest_to_knowledge",
                desc: "Menyimpan informasi dari dokumen ke dalam memori pengetahuan (Knowledge Base) Nayaxa.",
                schema: { type: "object", properties: { category: { type: "string", description: "Kategori informasi" }, content: { type: "string", description: "Intisari informasi penting" }, source_file: { type: "string", description: "Nama file sumber" } }, required: ["category", "content", "source_file"] }
            },
            {
                name: "search_files_and_knowledge",
                desc: "Mencari file asli atau pengetahuan (knowledge base) yang tersimpan di sistem Nayaxa.",
                schema: { type: "object", properties: { query: { type: "string", description: "Nama file, materi, atau kata kunci pencarian dokumen" } }, required: ["query"] }
            },
            {
                name: "analyze_dashboard_document",
                desc: "Membaca dan menganalisis secara mendalam dokumen yang ada di Dashboard Dokumen. Gunakan ini jika user meminta analisis spesifik terhadap file yang ditemukan di pencarian.",
                schema: { type: "object", properties: { file_id: { type: "number", description: "ID file yang didapat dari hasil search_files_and_knowledge" } }, required: ["file_id"] }
            },
            {
                name: "fill_excel_template",
                desc: "Mengisi data ke dalam file Excel yang baru saja diunggah oleh user.",
                schema: { type: "object", properties: { filled_data: { type: "string", description: "Data yang akan diisikan dalam format JSON Array of Objects. Key harus sesuai dengan header kolom di Excel (case-insensitive)." }, filename: { type: "string", description: "Nama file hasil (misal: 'data_pegawai_terisi.xlsx')" } }, required: ["filled_data", "filename"] }
            },
            {
                name: "save_document_insight",
                desc: "Menyimpan ulasan mendalam atau catatan analisis khusus (per bab/pasal) dari sebuah dokumen ke memori pengetahuan Nayaxa secara otomatis di latar belakang sesegera mungkin setiap kali Anda menghasilkan ulasan analisis dokumen yang bernilai tinggi dan berfakta kuat. JANGAN pernah memanggil tool ini untuk obrolan kasual, sapaan pembuka, basa-basi, atau chitchat.",
                schema: { type: "object", properties: { file_hash: { type: "string", description: "Hash unik berkas (didapat dari konteks dokumen)" }, sub_topic: { type: "string", description: "Nama Bab/Sub-topik khusus (misal: 'Bab III: Perencanaan')" }, insight_content: { type: "string", description: "Teks analisis mendalam atau ringkasan khusus yang ingin disimpan" }, user_query: { type: "string", description: "Pertanyaan atau kueri pengguna asli yang memicu pembedahan ini" } }, required: ["file_hash", "sub_topic", "insight_content", "user_query"] }
            }
        ];

        for (const t of toolsToSeed) {
            await dbNayaxa.query(`
                INSERT INTO nayaxa_ai_tools (tool_name, description, parameter_schema, is_active) 
                VALUES (?, ?, ?, 1)
                ON DUPLICATE KEY UPDATE description = VALUES(description), parameter_schema = VALUES(parameter_schema)
            `, [t.name, t.desc, JSON.stringify(t.schema)]);
        }
        console.log('  ✅ nayaxa_ai_tools (14 tools) seeded/synchronized.');

    } catch (seedErr) {
        console.error('  ❌ Gagal melakukan seeding arsitektur dinamis:', seedErr.message);
    }

    console.log('\n══════════════════════════════════════════');
    console.log(`🏁 Nayaxa Migration Selesai`);
    console.log(`  ✅ Berhasil : ${success}`);
    console.log(`  ℹ️  Dilewati : ${skipped}`);
    console.log(`  ❌ Gagal    : ${failed}`);
    console.log('══════════════════════════════════════════\n');

    if (failed > 0) {
        process.exit(1);
    } else {
        process.exit(0);
    }
}

migrate().catch(e => {
    console.error('Fatal error:', e);
    process.exit(1);
});
