const pool = require('./src/config/dbDashboard');

async function findLinks() {
    try {
        const [rows] = await pool.query("SELECT TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE COLUMN_NAME IN ('profil_pegawai_id', 'jabatan_id', 'bidang_id') AND TABLE_SCHEMA = DATABASE()");
        console.log("TABLES WITH USER LINKS:");
        rows.forEach(r => console.log(`${r.TABLE_NAME}: ${r.COLUMN_NAME}`));
    } catch (e) {
        console.error(e);
    }
}

findLinks();
