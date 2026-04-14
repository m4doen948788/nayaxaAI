const dbNayaxa = require('./src/config/dbNayaxa');
const dbDashboard = require('./src/config/dbDashboard');

async function check() {
    try {
        console.log('--- Checking nayaxa_knowledge (dbNayaxa) ---');
        const [k] = await dbNayaxa.query('SELECT category, source_file, COUNT(*) as chunks FROM nayaxa_knowledge GROUP BY category, source_file');
        console.log(JSON.stringify(k, null, 2));

        console.log('\n--- Checking dokumen_upload (dbDashboard) ---');
        const [d] = await dbDashboard.query('SELECT nama_file, path FROM dokumen_upload WHERE is_deleted = 0 ORDER BY uploaded_at DESC LIMIT 10');
        console.log(JSON.stringify(d, null, 2));

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

check();
