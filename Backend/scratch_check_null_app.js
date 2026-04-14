const db = require('./src/config/dbNayaxa');
async function run() {
    const [rows] = await db.query('SELECT COUNT(*) as cnt FROM nayaxa_chat_history WHERE app_id IS NULL');
    console.log(rows);
    process.exit(0);
}
run();
