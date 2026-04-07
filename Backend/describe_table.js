const dbDashboard = require('./src/config/dbDashboard');

async function dump() {
    try {
        const [rows] = await dbDashboard.query(`DESCRIBE dokumen_upload`);
        console.log('Columns in dokumen_upload:');
        rows.forEach(r => console.log(`- ${r.Field} (${r.Type})`));
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

dump();
