const poolDashboard = require('D:/copy-dashboard/Backend/src/config/db');
const poolNayaxa = require('D:/nayaxa-engine/Backend/src/config/dbNayaxa');

async function listAllTables() {
    try {
        const [dashTables] = await poolDashboard.query('SHOW TABLES');
        const [nayaxaTables] = await poolNayaxa.query('SHOW TABLES');
        
        console.log('--- DASHBOARD TABLES ---');
        console.log(JSON.stringify(dashTables, null, 2));
        console.log('\n--- NAYAXA TABLES ---');
        console.log(JSON.stringify(nayaxaTables, null, 2));
        
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

listAllTables();
