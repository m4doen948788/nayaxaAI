const mysql = require('mysql2/promise');
require('dotenv').config();

async function checkGeminiKeys() {
    const pool = mysql.createPool({
        host: process.env.NAYAXA_DB_HOST,
        user: process.env.NAYAXA_DB_USER,
        password: process.env.NAYAXA_DB_PASSWORD,
        database: process.env.NAYAXA_DB_NAME,
    });

    try {
        const [rows] = await pool.query('SELECT * FROM gemini_api_keys');
        console.log('--- GEMINI API KEYS ---');
        console.log(JSON.stringify(rows, null, 2));
        await pool.end();
    } catch (err) {
        console.error('Error:', err.message);
    }
}

checkGeminiKeys();
