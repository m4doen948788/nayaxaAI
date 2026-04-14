const dbDashboard = require('../src/config/dbDashboard');
const dbNayaxa = require('../src/config/dbNayaxa');

async function countKLA() {
    try {
        console.log('--- Counting documents related to KLA ---');
        const [files] = await dbDashboard.query(
            "SELECT COUNT(*) as count FROM dokumen_upload WHERE (nama_file LIKE '%kla%' OR nama_file LIKE '%layak anak%' OR path LIKE '%kla%' OR path LIKE '%layak anak%') AND is_deleted = 0"
        );
        
        const [knowledge] = await dbNayaxa.query(
            "SELECT COUNT(*) as count FROM nayaxa_knowledge WHERE (category LIKE '%kla%' OR category LIKE '%layak anak%' OR content LIKE '%kla%' OR content LIKE '%layak anak%' OR source_file LIKE '%kla%' OR source_file LIKE '%layak anak%') AND is_active = 1"
        );

        console.log('Total Files in Uploads:', files[0].count);
        console.log('Total Knowledge Entries:', knowledge[0].count);
        console.log('Combined Total:', files[0].count + knowledge[0].count);

    } catch (err) {
        console.error('Error:', err);
    } finally {
        process.exit(0);
    }
}

countKLA();
