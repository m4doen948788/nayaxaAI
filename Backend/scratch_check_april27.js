const db = require('./src/config/dbNayaxa');
async function run() {
    const [rows] = await db.query('SELECT COUNT(*) as cnt, SUM(LENGTH(content)) as chars FROM nayaxa_chat_history WHERE DATE(created_at) = "2026-04-27"');
    console.log(rows);
    process.exit(0);
}
run();
