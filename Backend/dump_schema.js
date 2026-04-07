const dbDashboard = require('./src/config/dbDashboard');

async function dump() {
    try {
        const [rows] = await dbDashboard.query(`SELECT DISTINCT TABLE_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE()`);
        console.log('Tables in Dashboard DB:');
        rows.forEach(r => console.log(`- ${r.TABLE_NAME}`));
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

dump();
