const dbDashboard = require('../src/config/dbDashboard');

async function testFinalSearch(query) {
    try {
        console.log(`Testing search for: "${query}"`);
        
        // 1. Map query to tematik_id if possible
        const [tematikRows] = await dbDashboard.query(
            "SELECT id FROM master_tematik WHERE nama LIKE ? OR nama LIKE ?",
            [`%${query}%`, `%kla%`] // Simple heuristic for now
        );
        
        const tematikIds = tematikRows.map(r => r.id);
        console.log('Detected Tematik IDs:', tematikIds);

        // 2. Perform Search
        // We search in:
        // - dokumen_upload (by filename)
        // - dokumen_tematik (by link to tematik_id)
        
        let sql = `
            SELECT DISTINCT du.id, du.nama_file, du.path, du.ukuran, du.uploaded_at
            FROM dokumen_upload du
            LEFT JOIN dokumen_tematik dt ON du.id = dt.dokumen_id
            WHERE du.is_deleted = 0
            AND (
                du.nama_file LIKE ? 
                OR du.path LIKE ?
                ${tematikIds.length > 0 ? `OR dt.tematik_id IN (${tematikIds.join(',')})` : ''}
            )
            LIMIT 10
        `;
        
        const params = [`%${query}%`, `%${query}%`];
        const [rows] = await dbDashboard.query(sql, params);
        
        console.log('Search Results Found:', rows.length);
        rows.forEach(r => console.log(`- ${r.nama_file} (ID: ${r.id})`));

    } catch (err) {
        console.error('Search Test Failed:', err.message);
    } finally {
        process.exit(0);
    }
}

testFinalSearch('kla'); 
