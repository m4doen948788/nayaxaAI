const mysql = require('mysql2/promise');
require('dotenv').config();

// Read-only connection to the main Dashboard database
const pool = mysql.createPool({
    host: process.env.DASHBOARD_DB_HOST,
    user: process.env.DASHBOARD_DB_USER,
    password: process.env.DASHBOARD_DB_PASSWORD,
    database: process.env.DASHBOARD_DB_NAME,
    waitForConnections: true,
    connectionLimit: 5,
});

module.exports = pool;
