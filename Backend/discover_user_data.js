const pool = require('./src/config/dbDashboard');

async function discoverSchema() {
    try {
        const [tables] = await pool.query('SHOW TABLES');
        console.log("TABLES:");
        console.log(tables.map(t => Object.values(t)[0]));
        
        console.log("\nDESCRIBING KEY TABLES:");
        const tablesToDescribe = ['profil_pegawai', 'master_bidang_instansi', 'master_instansi_daerah', 'kegiatan_harian_pegawai'];
        
        for (const table of tablesToDescribe) {
            const [columns] = await pool.query(`DESCRIBE ${table}`);
            console.log(`\nTable: ${table}`);
            console.log(columns.map(c => `${c.Field} (${c.Type})`).join(', '));
        }
    } catch (e) {
        console.error(e);
    }
}

discoverSchema();
