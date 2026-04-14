const dbNayaxa = require('./src/config/dbNayaxa');

async function search() {
    try {
        const [rows] = await dbNayaxa.query("SELECT * FROM nayaxa_knowledge WHERE content LIKE '%Bapperida%' OR content LIKE '%pegawai%' ORDER BY created_at DESC LIMIT 20");
        console.log(JSON.stringify(rows, null, 2));
    } catch (err) {
        console.error(err);
    } finally {
        process.exit(0);
    }
}
search();
