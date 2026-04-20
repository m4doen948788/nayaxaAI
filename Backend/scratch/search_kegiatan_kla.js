const db = require('../src/config/dbDashboard');

async function searchKLAInActivities() {
    try {
        const [rows] = await db.query(`
            SELECT id, nama_kegiatan, surat_undangan_masuk, bahan_desk, paparan 
            FROM kegiatan_manajemen 
            WHERE (nama_kegiatan LIKE '%kla%' OR nama_kegiatan LIKE '%layak anak%')
            AND is_deleted = 0
        `);
        
        console.log('--- KLA Activities & Documents ---');
        if (rows.length === 0) {
            console.log('No activities found with KLA keywords.');
        } else {
            rows.forEach(row => {
                console.log(`Activity [ID ${row.id}]: ${row.nama_kegiatan}`);
                if (row.surat_undangan_masuk) console.log(`- Undangan: ${row.surat_undangan_masuk}`);
                if (row.bahan_desk) console.log(`- Bahan Desk: ${row.bahan_desk}`);
                if (row.paparan) console.log(`- Paparan: ${row.paparan}`);
                console.log('---');
            });
        }
    } catch (err) {
        console.error('Error:', err);
    } finally {
        process.exit(0);
    }
}

searchKLAInActivities();
