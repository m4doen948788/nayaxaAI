const dbNayaxa = require('../Backend/src/config/dbNayaxa');

async function checkHistory() {
    try {
        const [rows] = await dbNayaxa.query('SELECT role, content FROM nayaxa_chat_history ORDER BY created_at DESC LIMIT 10');
        console.log(JSON.stringify(rows.reverse(), null, 2));
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

checkHistory();
