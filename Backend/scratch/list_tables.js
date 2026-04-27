const poolDashboard = require('../Backend/src/config/db');
const poolNayaxa = require('./src/config/dbNayaxa');

async function listAllTables() {
    try {
        const [dashTables] = await poolDashboard.query('SHOW TABLES');
        const [nayaxaTables] = await poolNayaxa.query('SHOW TABLES');
        
        console.log('--- DASHBOARD TABLES ---');
        console.log(dashTables);
        console.log('\n--- NAYAXA TABLES ---');
        console.log(nayaxaTables);
        
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

listAllTables();
