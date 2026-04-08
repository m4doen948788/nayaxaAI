const pool = require('./src/config/dbDashboard');

async function testQueryDetail() {
    try {
        const profilId = 1; 
        console.log(`Getting detailed pengampuan for profil_id: ${profilId}`);
        
        // Fetch Instansi Diampu
        const [instansis] = await pool.query(`
            SELECT DISTINCT i.instansi
            FROM profil_pegawai p
            JOIN mapping_bidang_pengampu m ON p.bidang_id = m.bidang_instansi_id
            JOIN master_instansi_daerah i ON m.instansi_id = i.id
            WHERE p.id = ?
        `, [profilId]);
        
        // Fetch Urusan Diampu
        const [urusans] = await pool.query(`
            SELECT DISTINCT u.urusan
            FROM profil_pegawai p
            JOIN mapping_bidang_pengampu m ON p.bidang_id = m.bidang_instansi_id
            JOIN master_urusan u ON m.urusan_id = u.id
            WHERE p.id = ?
        `, [profilId]);
        
        console.log("INSTANSIS DIAMPU:");
        console.log(instansis.map(r => r.instansi).join(', '));
        console.log("\nURUSANS/TUGAS DIAMPU:");
        console.log(urusans.map(r => r.urusan).join(', '));
        
    } catch (e) {
        console.error(e);
    }
}

testQueryDetail();
