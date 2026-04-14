const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const dbNayaxa = require('../src/config/dbNayaxa');

async function diagnose() {
    try {
        console.log('=== NAYAXA ENGINE DATABASE DIAGNOSIS ===');
        console.log('Environment Variables loaded from Backend/.env:');
        console.log(`- NAYAXA_DB_HOST: ${process.env.NAYAXA_DB_HOST}`);
        console.log(`- NAYAXA_DB_USER: ${process.env.NAYAXA_DB_USER}`);
        console.log(`- NAYAXA_DB_NAME: ${process.env.NAYAXA_DB_NAME}`);
        console.log(`- NAYAXA_DEEPSEEK_API_KEY: ${process.env.NAYAXA_DEEPSEEK_API_KEY ? 'DEFINED (Ends with ' + process.env.NAYAXA_DEEPSEEK_API_KEY.slice(-4) + ')' : 'UNDEFINED'}`);
        console.log(`- DEEPSEEK_API_KEY: ${process.env.DEEPSEEK_API_KEY ? 'DEFINED' : 'UNDEFINED'}`);

        // Try querying gemini_api_keys from dbNayaxa
        try {
            const [rows] = await dbNayaxa.query("SELECT id, label, jenis_ai, is_active, LEFT(api_key, 10) as key_prefix FROM gemini_api_keys");
            console.log(`\n✅ Query from dbNayaxa pool succeeded! Total keys found: ${rows.length}`);
            console.table(rows);
            
            // Check if there is an active DeepSeek Paid key
            const activeDeepSeekKeys = rows.filter(r => r.jenis_ai === 'DeepSeek Paid' && r.is_active === 1);
            console.log(`Active DeepSeek Paid keys: ${activeDeepSeekKeys.length}`);
            if (activeDeepSeekKeys.length > 0) {
                console.log('Active key found:', activeDeepSeekKeys[0]);
            } else {
                console.log('⚠️ No active DeepSeek Paid keys found in the database!');
            }
        } catch (err) {
            console.error('\n❌ Query from dbNayaxa pool FAILED:', err.message);
        }

    } catch (err) {
        console.error('Diagnosis failed:', err);
    } finally {
        process.exit();
    }
}

diagnose();
