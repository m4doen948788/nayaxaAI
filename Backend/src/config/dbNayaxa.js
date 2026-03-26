const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
    host: process.env.NAYAXA_DB_HOST,
    user: process.env.NAYAXA_DB_USER,
    password: process.env.NAYAXA_DB_PASSWORD,
    database: process.env.NAYAXA_DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
});

module.exports = pool;
