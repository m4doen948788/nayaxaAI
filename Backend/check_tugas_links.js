const pool = require('./src/config/dbDashboard');

async function checkTugas() {
    try {
        console.log("Checking master_tugas_pokok columns:");
        const [c1] = await pool.query('DESCRIBE master_tugas_pokok');
        console.log(c1.map(c => c.Field));
        
        console.log("\nSearching for any table linking profil_pegawai to tugas:");
        const [rows] = await pool.query("SELECT TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE COLUMN_NAME LIKE '%tugas%' AND TABLE_SCHEMA = DATABASE()");
        rows.forEach(r => console.log(`${r.TABLE_NAME}: ${r.COLUMN_NAME}`));

        console.log("\nChecking mapping_bidang_pengampu columns:");
        const [c2] = await pool.query('DESCRIBE mapping_bidang_pengampu');
        console.log(c2.map(c => c.Field));
    } catch (e) {
        console.error(e);
    }
}

checkTugas();
