/**
 * Nayaxa DB Migration - Add User Personas Table
 * Run once: node src/migrations/add_persona_table.js
 */
const dbNayaxa = require('../config/dbNayaxa');

async function migrate() {
    console.log('[Migrate] Creating nayaxa_user_personas table...');
    try {
        await dbNayaxa.query(`
            CREATE TABLE IF NOT EXISTS nayaxa_user_personas (
                id          INT AUTO_INCREMENT PRIMARY KEY,
                user_id     INT NOT NULL UNIQUE,
                user_name   VARCHAR(255),
                persona_text TEXT,
                updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX (user_id)
            )
        `);
        console.log('[Migrate] nayaxa_user_personas table ready.');
    } catch (err) {
        console.error('[Migrate] Error:', err.message);
    } finally {
        process.exit(0);
    }
}

migrate();
