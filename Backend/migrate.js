/**
 * NAYAXA DB MIGRATION SCRIPT (PHASE 1)
 * This script sets up the new nayaxa_db and migrates data from the dashboard DB.
 */
const mysql = require('mysql2/promise');
require('dotenv').config();

async function migrate() {
    const connection = await mysql.createConnection({
        host: process.env.NAYAXA_DB_HOST,
        user: process.env.NAYAXA_DB_USER,
        password: process.env.NAYAXA_DB_PASSWORD
    });

    console.log('--- NAYAXA DB MIGRATION START ---');

    const DASHBOARD_DB = process.env.DASHBOARD_DB_NAME;
    const NAYAXA_DB = process.env.NAYAXA_DB_NAME;

    try {
        // 1. Create Database (Catch error if no permission to create)
        try {
            await connection.query(`CREATE DATABASE IF NOT EXISTS ${NAYAXA_DB}`);
            console.log(`[1] Database ${NAYAXA_DB} created/ready.`);
        } catch (dbErr) {
            console.warn(`[!] Note: Could not create database ${NAYAXA_DB}. Proceeding with assuming it exists or using the same DB.`);
        }
        
        await connection.query(`USE ${NAYAXA_DB}`);
        console.log(`[1] Using database ${NAYAXA_DB}.`);

        // 2. Create API Keys Table
        await connection.query(`
            CREATE TABLE IF NOT EXISTS nayaxa_api_keys (
                id INT AUTO_INCREMENT PRIMARY KEY,
                app_name VARCHAR(100) NOT NULL,
                api_key VARCHAR(64) NOT NULL UNIQUE,
                instansi_id INT DEFAULT NULL,
                allowed_tools JSON DEFAULT NULL,
                is_active TINYINT(1) DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log(`[2] Table nayaxa_api_keys created.`);
        
        // 2b. Create Gemini API Keys Table
        await connection.query(`
            CREATE TABLE IF NOT EXISTS gemini_api_keys (
                id INT AUTO_INCREMENT PRIMARY KEY,
                api_key VARCHAR(128) NOT NULL UNIQUE,
                is_active TINYINT(1) DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log(`[2b] Table gemini_api_keys created.`);
        
        // Sync Gemini Key from .env to DB
        if (process.env.GEMINI_API_KEY && !process.env.GEMINI_API_KEY.includes('AIzaSyBznt86')) {
            await connection.query('TRUNCATE TABLE gemini_api_keys');
            await connection.query('INSERT INTO gemini_api_keys (api_key) VALUES (?)', [process.env.GEMINI_API_KEY]);
            console.log(`[2c] Gemini API Key synced from .env to database.`);
        }

        // 3. Insert Initial API Key for Bapperida Dashboard
        const [existingKeys] = await connection.query('SELECT * FROM nayaxa_api_keys WHERE app_name = ?', ['dashboard_bapperida']);
        if (existingKeys.length === 0) {
            await connection.query(`
                INSERT INTO nayaxa_api_keys (app_name, api_key)
                VALUES ('dashboard_bapperida', 'NAYAXA-BAPPERIDA-8888-9999-XXXX')
            `);
            console.log(`[3] Initial API Key inserted for Dashboard Bapperida.`);
        }

        // 4. Create Chat History Table (with app_id)
        await connection.query(`
            CREATE TABLE IF NOT EXISTS nayaxa_chat_history (
                id INT AUTO_INCREMENT PRIMARY KEY,
                app_id INT NOT NULL,
                user_id INT NOT NULL,
                session_id VARCHAR(50) NOT NULL,
                role VARCHAR(20) NOT NULL,
                content TEXT,
                brain_used VARCHAR(50) DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX (session_id),
                INDEX (user_id),
                INDEX (app_id)
            )
        `);
        
        // Ensure app_id column exists if table was pre-existing
        try {
            const [columns] = await connection.query(`SHOW COLUMNS FROM nayaxa_chat_history`);
            if (!columns.map(c => c.Field).includes('app_id')) {
                await connection.query(`ALTER TABLE nayaxa_chat_history ADD COLUMN app_id INT NOT NULL AFTER id`);
                await connection.query(`ALTER TABLE nayaxa_chat_history ADD INDEX (app_id)`);
                console.log(`[4] Column app_id added to existing nayaxa_chat_history.`);
            }
        } catch (colErr) { console.error('Error ensuring app_id column:', colErr); }
        
        console.log(`[4] Table nayaxa_chat_history is ready.`);

        // 5. Create Knowledge Table
        await connection.query(`
            CREATE TABLE IF NOT EXISTS nayaxa_knowledge (
                id INT AUTO_INCREMENT PRIMARY KEY,
                app_id INT DEFAULT 1,
                category VARCHAR(100),
                content TEXT NOT NULL,
                source_file VARCHAR(255),
                is_active TINYINT(1) DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX (app_id)
            )
        `);
        
        // Ensure new columns exist if table was pre-existing
        try {
            const [columns] = await connection.query(`SHOW COLUMNS FROM nayaxa_knowledge`);
            const colNames = columns.map(c => c.Field);
            
            if (colNames.includes('feature_name') && !colNames.includes('category')) {
                await connection.query(`ALTER TABLE nayaxa_knowledge CHANGE COLUMN feature_name category VARCHAR(255)`);
                console.log(`[5] Column feature_name renamed to category.`);
            }
            if (colNames.includes('description') && !colNames.includes('content')) {
                await connection.query(`ALTER TABLE nayaxa_knowledge CHANGE COLUMN description content TEXT`);
                console.log(`[5] Column description renamed to content.`);
            }
            if (!colNames.includes('app_id')) {
                await connection.query(`ALTER TABLE nayaxa_knowledge ADD COLUMN app_id INT DEFAULT 1 AFTER id`);
                await connection.query(`ALTER TABLE nayaxa_knowledge ADD INDEX (app_id)`);
                console.log(`[5] Column app_id added to nayaxa_knowledge.`);
            }
            if (!colNames.includes('source_file')) {
                await connection.query(`ALTER TABLE nayaxa_knowledge ADD COLUMN source_file VARCHAR(255) AFTER content`);
                console.log(`[5] Column source_file added to nayaxa_knowledge.`);
            }
        } catch (colErr) { console.error('Error ensuring nayaxa_knowledge columns:', colErr); }

        console.log(`[5] Table nayaxa_knowledge is ready.`);

        // 6. Migrate Data from Dashboard DB (If tables exist there)
        console.log(`[6] Checking for legacy data in ${DASHBOARD_DB}...`);
        
        try {
            const [history] = await connection.query(`SELECT * FROM ${DASHBOARD_DB}.nayaxa_chat_history`);
            if (history.length > 0) {
                console.log(`Found ${history.length} legacy chat history rows. Migrating...`);
                // Get the app_id we just created
                const [app] = await connection.query('SELECT id FROM nayaxa_api_keys WHERE app_name = ?', ['dashboard_bapperida']);
                const appId = app[0].id;

                for (const h of history) {
                    await connection.query(
                        `INSERT IGNORE INTO nayaxa_chat_history (app_id, user_id, session_id, role, content, brain_used, created_at) 
                         VALUES (?, ?, ?, ?, ?, ?, ?)`,
                        [appId, h.user_id, h.session_id || 'default', h.role, h.content, h.brain_used, h.created_at]
                    );
                }
                console.log('Chat history migration complete.');
            }
        } catch (e) { console.log('No legacy chat history found to migrate.'); }

        try {
            const [knowledge] = await connection.query(`SELECT * FROM ${DASHBOARD_DB}.nayaxa_knowledge`);
            if (knowledge.length > 0) {
                console.log(`Found ${knowledge.length} legacy knowledge rows. Migrating...`);
                for (const k of knowledge) {
                    await connection.query(
                        `INSERT IGNORE INTO nayaxa_knowledge (feature_name, description, is_active, created_at) 
                         VALUES (?, ?, ?, ?)`,
                        [k.feature_name, k.description, k.is_active, k.created_at]
                    );
                }
                console.log('Knowledge migration complete.');
            }
        } catch (e) { console.log('No legacy knowledge found to migrate.'); }

        console.log('--- NAYAXA DB MIGRATION FINISHED SUCCESSFULLY ---');
    } catch (error) {
        console.error('Migration Failed:', error);
    } finally {
        await connection.end();
    }
}

migrate();
