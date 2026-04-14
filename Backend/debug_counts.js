const dbDashboard = require('./src/config/dbDashboard');
const dbNayaxa = require('./src/config/dbNayaxa');

async function check() {
    try {
        console.log('--- Bapperida (ID: 2) ---');
        const [total] = await dbDashboard.query('SELECT COUNT(*) as total FROM profil_pegawai WHERE instansi_id = 2 AND is_active = 1');
        console.log('Total Pegawai Active:', total[0].total);

        console.log('\n--- Knowledge Snippets ---');
        const [knowledge] = await dbNayaxa.query("SELECT category, content FROM nayaxa_knowledge WHERE content LIKE '%pegawai%' OR content LIKE '%76%' OR content LIKE '%84%' ORDER BY created_at DESC LIMIT 10");
        knowledge.forEach(k => {
            console.log(`[${k.category}] ${k.content.substring(0, 200)}...`);
        });

        console.log('\n--- Recent Activity Counts by Month ---');
        const months = [1, 2, 3, 4];
        for (const m of months) {
            const [active] = await dbDashboard.query('SELECT COUNT(DISTINCT profil_pegawai_id) as active FROM kegiatan_harian_pegawai k JOIN profil_pegawai p ON k.profil_pegawai_id = p.id WHERE p.instansi_id = 2 AND MONTH(k.tanggal) = ? AND YEAR(k.tanggal) = 2026', [m]);
            console.log(`Month ${m} 2026 Active:`, active[0].active);
        }

    } catch (err) {
        console.error(err);
    } finally {
        process.exit(0);
    }
}

check();
