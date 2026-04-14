const db = require('./src/config/dbDashboard');
async function run() {
    const [rows] = await db.query("SELECT id, profil_pegawai_id, username FROM users WHERE profil_pegawai_id IN (68, 91)");
    console.log(rows);
    process.exit(0);
}
run();
