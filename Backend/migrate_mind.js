const pool = require('./src/config/dbDashboard');

async function migrate() {
    try {
        console.log("Adding is_indexed column to dokumen_upload...");
        try {
            await pool.query('ALTER TABLE dokumen_upload ADD COLUMN is_indexed TINYINT(1) DEFAULT 0');
            console.log("Column added.");
        } catch (e) {
            if (e.code === 'ER_DUP_COLUMN_NAME') {
                console.log("Column already exists.");
            } else {
                throw e;
            }
        }

        console.log("Creating nayaxa_mind_logs table...");
        await pool.query(`
            CREATE TABLE IF NOT EXISTS nayaxa_mind_logs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                task_name VARCHAR(255),
                status VARCHAR(50),
                message TEXT,
                started_at DATETIME,
                finished_at DATETIME
            )
        `);
        console.log("Table created.");

    } catch (e) {
        console.error("Migration Error:", e);
    } finally {
        process.exit();
    }
}

migrate();
