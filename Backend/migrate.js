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
