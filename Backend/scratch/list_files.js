const dbDashboard = require('../src/config/dbDashboard');
const dbNayaxa = require('../src/config/dbNayaxa');

async function listAll() {
    try {
        console.log('--- Listing last 50 dokumen_upload (dbDashboard) ---');
        const [files] = await dbDashboard.query(
            "SELECT id, nama_file FROM dokumen_upload ORDER BY id DESC LIMIT 50"
        );
        console.log('Files:', files.map(f => f.nama_file));

        console.log('\n--- Listing last 50 nayaxa_knowledge (dbNayaxa) ---');
        const [knowledge] = await dbNayaxa.query(
            "SELECT id, category, source_file FROM nayaxa_knowledge ORDER BY id DESC LIMIT 50"
        );
        console.log('Knowledge:', knowledge.map(k => ({ id: k.id, category: k.category, source_file: k.source_file })));

    } catch (err) {
        console.error('Error:', err);
    } finally {
        process.exit(0);
    }
}

listAll();
