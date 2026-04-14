const dbDashboard = require('../src/config/dbDashboard');
const dbNayaxa = require('../src/config/dbNayaxa');

async function checkKLA() {
    try {
        console.log('--- Checking dokumen_upload (dbDashboard) ---');
        const [files] = await dbDashboard.query(
            "SELECT id, nama_file, path FROM dokumen_upload WHERE nama_file LIKE '%layak anak%' OR path LIKE '%layak anak%'"
        );
        console.log('Files found:', files);

        console.log('\n--- Checking nayaxa_knowledge (dbNayaxa) ---');
        const [knowledge] = await dbNayaxa.query(
            "SELECT id, category, source_file, content FROM nayaxa_knowledge WHERE content LIKE '%layak anak%' OR source_file LIKE '%layak anak%'"
        );
        console.log('Knowledge found:', knowledge.map(k => ({ id: k.id, category: k.category, source_file: k.source_file, content_preview: k.content.substring(0, 100) })));

    } catch (err) {
        console.error('Error:', err);
    } finally {
        process.exit(0);
    }
}

checkKLA();
