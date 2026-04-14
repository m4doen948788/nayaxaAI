const mysql = require('mysql2/promise');
require('dotenv').config();

async function checkKeys() {
    const pool = mysql.createPool({
        host: process.env.NAYAXA_DB_HOST,
        user: process.env.NAYAXA_DB_USER,
        password: process.env.NAYAXA_DB_PASSWORD,
        database: process.env.NAYAXA_DB_NAME,
    });

    try {
        const [rows] = await pool.query('SELECT * FROM nayaxa_api_keys');
        console.log('--- NAYAXA API KEYS ---');
        console.log(JSON.stringify(rows, null, 2));
        await pool.end();
    } catch (err) {
        console.error('Error:', err.message);
    }
}

checkKeys();
