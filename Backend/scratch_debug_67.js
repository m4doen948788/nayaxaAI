const db = require('./src/config/dbNayaxa');
async function run() {
    const [rows] = await db.query('SELECT content, created_at FROM nayaxa_chat_history WHERE user_id = 67 AND DATE(created_at) = "2026-04-29" ORDER BY created_at DESC LIMIT 5');
    console.log(rows);
    process.exit(0);
}
run();
