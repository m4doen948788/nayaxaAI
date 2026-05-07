const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
    host: process.env.NAYAXA_DB_HOST,
    user: process.env.NAYAXA_DB_USER,
    password: process.env.NAYAXA_DB_PASSWORD,
    database: process.env.NAYAXA_DB_NAME,
    waitForConnections: true,
    connectionLimit: 50, // Increased for high concurrency (indexing + chat)
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    dateStrings: true,
});


pool.on('error', (err) => {
    console.error('[MySQL Pool Error] dbNayaxa:', err.message);
    if (err.code === 'PROTOCOL_CONNECTION_LOST' || err.code === 'ECONNRESET') {
        console.warn('[MySQL] Connection lost/reset. Re-attempt will happen on next query.');
    }
});

module.exports = pool;
