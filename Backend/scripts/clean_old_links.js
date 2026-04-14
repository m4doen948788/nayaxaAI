const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const dbNayaxa = require('../src/config/dbNayaxa');

async function cleanOldLinks() {
    try {
        console.log('🧹 === NAYAXA OLD CHAT LINKS SANITIZER ===');
        console.log('Mengoneksikan ke database Nayaxa...');

        // 1. Ganti bapperida-ppm.my.id:6001 dengan subdomain api-nayaxa.bapperida-ppm.my.id
        console.log('Merubah bapperida-ppm.my.id:6001 menjadi api-nayaxa.bapperida-ppm.my.id...');
        const [result1] = await dbNayaxa.query(`
            UPDATE nayaxa_chat_history 
            SET content = REPLACE(content, 'https://bapperida-ppm.my.id:6001', 'https://api-nayaxa.bapperida-ppm.my.id') 
            WHERE content LIKE '%https://bapperida-ppm.my.id:6001%'
        `);
        console.log(`✅ Sukses memperbarui tautan HTTPS: ${result1.affectedRows} baris terpengaruh.`);

        const [result2] = await dbNayaxa.query(`
            UPDATE nayaxa_chat_history 
            SET content = REPLACE(content, 'http://bapperida-ppm.my.id:6001', 'https://api-nayaxa.bapperida-ppm.my.id') 
            WHERE content LIKE '%http://bapperida-ppm.my.id:6001%'
        `);
        console.log(`✅ Sukses memperbarui tautan HTTP: ${result2.affectedRows} baris terpengaruh.`);

        // 2. Ganti localhost:6001 dan 127.0.0.1:6001 jika tidak sengaja tersimpan di database produksi
        const [result3] = await dbNayaxa.query(`
            UPDATE nayaxa_chat_history 
            SET content = REPLACE(content, 'http://localhost:6001', 'https://api-nayaxa.bapperida-ppm.my.id') 
            WHERE content LIKE '%http://localhost:6001%'
        `);
        const [result4] = await dbNayaxa.query(`
            UPDATE nayaxa_chat_history 
            SET content = REPLACE(content, 'http://127.0.0.1:6001', 'https://api-nayaxa.bapperida-ppm.my.id') 
            WHERE content LIKE '%http://127.0.0.1:6001%'
        `);
        console.log(`✅ Sukses membersihkan tautan lokal: ${result3.affectedRows + result4.affectedRows} baris terpengaruh.`);

        console.log('\n🎉 Selesai! Semua riwayat chat di database telah dibersihkan dari port 6001 mentah.');
    } catch (err) {
        console.error('❌ Gagal menjalankan sanitasi:', err.message);
    } finally {
        process.exit();
    }
}

cleanOldLinks();
