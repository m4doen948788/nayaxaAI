const db = require('./src/config/dbNayaxa');
async function run() {
    const [rows] = await db.query('SELECT content, created_at, app_id FROM nayaxa_chat_history WHERE user_id = 89 AND DATE(created_at) = "2026-04-29" ORDER BY created_at DESC');
    console.log(rows);
    process.exit(0);
}
run();
