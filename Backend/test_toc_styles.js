const exportService = require('./src/services/exportService');
const path = require('path');
const fs = require('fs');

async function testTOCStyles() {
    const content = "# Pendahuluan\nIni bagian awal.\n# Analisis Data\n## Statistik Pegawai\nIsi statistik...\n## Tren Kegiatan\nIsi tren...\n# Kesimpulan\nLaporan selesai.";
    const filename = "test_toc.docx";
    const options = {
        font: "Arial",
        fontSize: 12,
        lineSpacing: 1.5,
        paperSize: "A4",
        includeTOC: true
    };

    try {
        const result = await exportService.generateWord(content, filename, options);
        console.log("SUCCESS:", result);
        const fullPath = path.join(__dirname, 'uploads/exports', filename);
        if (fs.existsSync(fullPath)) {
            console.log("File created at:", fullPath);
            const stats = fs.statSync(fullPath);
            console.log("File size:", stats.size, "bytes");
        } else {
            console.log("ERROR: File not found!");
        }
    } catch (e) {
        console.error("FAILED:", e);
    }
}

testTOCStyles();
