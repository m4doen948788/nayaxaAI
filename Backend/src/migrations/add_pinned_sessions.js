/**
 * Nayaxa DB Migration - Add Pinned Sessions Table
 * Run once: node src/migrations/add_pinned_sessions.js
 */
const dbNayaxa = require('../config/dbNayaxa');

async function migrate() {
    console.log('[Migrate] Creating nayaxa_pinned_sessions table...');
    try {
        await dbNayaxa.query(`
            CREATE TABLE IF NOT EXISTS nayaxa_pinned_sessions (
                id          INT AUTO_INCREMENT PRIMARY KEY,
                app_id      INT NOT NULL,
                user_id     INT NOT NULL,
                session_id  VARCHAR(50) NOT NULL,
                created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY unique_pin (user_id, session_id),
                INDEX (user_id),
                INDEX (session_id)
            )
        `);
        console.log('[Migrate] nayaxa_pinned_sessions table ready.');
    } catch (err) {
        console.error('[Migrate] Error:', err.message);
    } finally {
        process.exit(0);
    }
}

migrate();
