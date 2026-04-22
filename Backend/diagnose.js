const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
const mysql = require('mysql2/promise');
const pdf = require('pdf-parse');
require('dotenv').config();

async function runDiagnosis() {
    console.log('=== NAYAXA SYSTEM DIAGNOSIS ===\n');

    // 1. Check Database
    console.log('1. Memeriksa Database...');
    try {
        const connection = await mysql.createConnection({
            host: process.env.NAYAXA_DB_HOST,
            user: process.env.NAYAXA_DB_USER,
            password: process.env.NAYAXA_DB_PASSWORD,
            database: process.env.NAYAXA_DB_NAME
        });
        console.log('   ✅ Database Terhubung: ' + process.env.NAYAXA_DB_NAME);
        await connection.end();
    } catch (err) {
        console.log('   ❌ Gagal Koneksi Database: ' + err.message);
    }

    // 2. Check DeepSeek (Utama)
    console.log('\n2. Memeriksa DeepSeek (Otak Utama)...');
    try {
        const res = await axios.post('https://api.deepseek.com/chat/completions', {
            model: 'deepseek-chat',
            messages: [{ role: 'user', content: 'test' }],
            max_tokens: 5
        }, {
            headers: { 'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}` },
            timeout: 5000
        });
        console.log('   ✅ DeepSeek Aktif & Merespon.');
    } catch (err) {
        console.log('   ❌ DeepSeek Error: ' + (err.response ? JSON.stringify(err.response.data) : err.message));
    }

    // 3. Check Gemini (Cadangan/Visual)
    console.log('\n3. Memeriksa Gemini (Otak Cadangan)...');
    try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        // Menggunakan model 2.5 Flash sesuai temuan kita tadi
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        const result = await model.generateContent('Hi');
        console.log('   ✅ Gemini 2.5 Aktif & Merespon.');
    } catch (err) {
        console.log('   ❌ Gemini Error: ' + err.message);
    }

    // 4. Check PDF Library
    console.log('\n4. Memeriksa Library PDF...');
    try {
        const dummyBuffer = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Title (Test) >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF');
        
        // Penyesuaian untuk pdf-parse v2.4.5
        const pdfParser = require('pdf-parse');
        const parseFunction = typeof pdfParser === 'function' ? pdfParser : pdfParser.default;
        
        if (typeof parseFunction !== 'function') {
            throw new Error('Library pdf-parse terinstall tapi tidak bisa dipanggil sebagai fungsi.');
        }

        await parseFunction(dummyBuffer);
        console.log('   ✅ Library PDF (pdf-parse) Berjalan Baik.');
    } catch (err) {
        console.log('   ❌ PDF Library Error: ' + err.message);
    }

    console.log('\n=== DIAGNOSA SELESAI ===');
}

runDiagnosis();
