const db = require('./src/config/dbNayaxa');
async function run() {
    const [rows] = await db.query('SELECT content, created_at FROM nayaxa_chat_history WHERE user_id = 82 ORDER BY created_at DESC LIMIT 1');
    console.log(rows);
    process.exit(0);
}
run();
