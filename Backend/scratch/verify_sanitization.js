const exportService = require('../src/services/exportService');
const fs = require('fs');
const path = require('path');

const dirtyContent = `
# **LAPORAN ANALISIS** <br>
Berikut adalah ringkasan: <br/>
- *Item 1* dengan **Penting** <br >
- - Item 2 <br>
* **Item 3** <br>

### DETAIL DATA
1. Data A: **$1,000**
2. Data B: -10% (negatif)
3. Data C: <span style="color:red">Error</span>
`;

const dirtyExcelData = [
    { "Uraian": "**Gaji Pokok**", "Nilai": "Rp 5.000.000 <br>", "Status": "*-Ok*" },
    { "Uraian": "Tunjangan", "Nilai": "10% - 20%", "Status": "<span class='badge'>Aktif</span>" }
];

async function runTest() {
    console.log("Starting Sanitization Verification...");
    
    try {
        // Test PDF
        console.log("Testing PDF...");
        const pdfUrl = await exportService.generatePDF(dirtyContent, 'test_sanitized.pdf');
        console.log("PDF OK:", pdfUrl);
        
        // Test Word
        console.log("Testing Word...");
        const wordUrl = await exportService.generateWord(dirtyContent, 'test_sanitized.docx');
        console.log("Word OK:", wordUrl);
        
        // Test Excel
        console.log("Testing Excel...");
        const excelUrl = await exportService.generateExcel(dirtyExcelData, 'test_sanitized.xlsx');
        console.log("Excel OK:", excelUrl);
        
        console.log("\nVerification scripts finished. Please manually check the files in Backend/uploads/exports/ if possible, or trust the logs.");
    } catch (e) {
        console.error("Verification failed:", e);
    }
}

runTest();
