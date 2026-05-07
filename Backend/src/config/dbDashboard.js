const mysql = require('mysql2/promise');
require('dotenv').config();

// Read-only connection to the main Dashboard database
const pool = mysql.createPool({
    host: process.env.DASHBOARD_DB_HOST,
    user: process.env.DASHBOARD_DB_USER,
    password: process.env.DASHBOARD_DB_PASSWORD,
    database: process.env.DASHBOARD_DB_NAME,
    waitForConnections: true,
    connectionLimit: 20,
    dateStrings: true,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000
});

pool.on('error', (err) => {
    console.error('[MySQL Pool Error] dbDashboard:', err.message);
    if (err.code === 'PROTOCOL_CONNECTION_LOST' || err.code === 'ECONNRESET') {
        console.warn('[MySQL] Connection lost/reset. Re-attempt will happen on next query.');
    }
});

module.exports = pool;
