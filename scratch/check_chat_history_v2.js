const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../Backend/.env') });

const pool = mysql.createPool({
    host: process.env.NAYAXA_DB_HOST,
    user: process.env.NAYAXA_DB_USER,
    password: process.env.NAYAXA_DB_PASSWORD,
    database: process.env.NAYAXA_DB_NAME,
});

async function checkHistory() {
    try {
        const [rows] = await pool.query('SELECT role, content FROM nayaxa_chat_history ORDER BY created_at DESC LIMIT 10');
        console.log(JSON.stringify(rows.reverse(), null, 2));
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

checkHistory();
