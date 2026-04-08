const pool = require('./src/config/dbDashboard');

async function testQueryDetail() {
    try {
        const profilId = 1; // From previous test
        console.log(`Getting detailed pengampuan for profil_id: ${profilId}`);
        
        const [rows] = await pool.query(`
            SELECT 
                i.instansi as instansi_diampu,
                u.nama_urusan as urusan_diampu
            FROM profil_pegawai p
            JOIN mapping_bidang_pengampu m ON p.bidang_id = m.bidang_instansi_id
            LEFT JOIN master_instansi_daerah i ON m.instansi_id = i.id
            LEFT JOIN master_urusan u ON m.urusan_id = u.id
            WHERE p.id = ?
        `, [profilId]);
        
        console.log("RESULT:");
        console.log(JSON.stringify(rows, null, 2));
    } catch (e) {
        console.error(e);
    }
}

testQueryDetail();
