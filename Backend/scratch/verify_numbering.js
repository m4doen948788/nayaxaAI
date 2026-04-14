const exportService = require('../src/services/exportService');
const fs = require('fs');

const multiListContent = `
# LAPORAN PENOMORAN
Berikut adalah daftar pertama:
1. Apel
2. Jeruk
3. Mangga

Paragraf pemisah di sini untuk meriset penomoran.

## DAFTAR KEDUA
1. Kursi
2. Meja
3. Lemari

Satu lagi daftar setelah teks biasa:
1. Merah
2. Hijau
3. Biru
`;

async function runTest() {
    console.log("Starting Word Numbering Verification...");
    try {
        const wordUrl = await exportService.generateWord(multiListContent, 'test_numbering_restart.docx');
        console.log("Word OK:", wordUrl);
        console.log("Verification finished. Please check test_numbering_restart.docx in uploads/exports.");
    } catch (e) {
        console.error("Verification failed:", e);
    }
}

runTest();
