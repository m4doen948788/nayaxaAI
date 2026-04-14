const db = require('./src/config/dbDashboard');
async function run() {
    const [rows] = await db.query("SELECT id, nama_lengkap FROM profil_pegawai WHERE nama_lengkap LIKE '%Nugi Nugraha%'");
    console.log(rows);
    process.exit(0);
}
run();
