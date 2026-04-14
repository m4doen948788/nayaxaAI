const nayaxaStandalone = require('./src/services/nayaxaStandalone');
const pool = require('./src/config/dbDashboard');

(async () => {
    try {
        console.log('--- SCHEMA ---');
        console.log(await nayaxaStandalone.getDatabaseSchema());
        
        console.log('--- PPM SEARCH ---');
        const [bidangs] = await pool.query("SELECT * FROM master_bidang_instansi WHERE nama_bidang LIKE '%PPM%' OR nama_bidang LIKE '%Pemerintahan%' OR singkatan LIKE '%PPM%'");
        console.log('Bidangs found:', JSON.stringify(bidangs, null, 2));

        if (bidangs.length > 0) {
            const ids = bidangs.map(b => b.id);
            const [pegawai] = await pool.query(`
                SELECT pp.nama_lengkap, mbi.nama_bidang, mj.jabatan 
                FROM profil_pegawai pp 
                LEFT JOIN master_bidang_instansi mbi ON pp.bidang_id = mbi.id 
                LEFT JOIN master_jabatan mj ON pp.jabatan_id = mj.id 
                WHERE pp.bidang_id IN (?)
            `, [ids]);
            console.log('Pegawai in these bidangs:', JSON.stringify(pegawai, null, 2));
        }

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
})();
