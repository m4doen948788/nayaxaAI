const dbNayaxa = require('../src/config/dbNayaxa');

async function listTables() {
    try {
        const [rows] = await dbNayaxa.query("SHOW TABLES");
        console.log("Tables in nayaxa_db:");
        console.table(rows);
    } catch (error) {
        console.error("Error:", error.message);
    }
    process.exit();
}

listTables();
