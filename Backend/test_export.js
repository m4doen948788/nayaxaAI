const exportService = require('./src/services/exportService');
const fs = require('fs');
const path = require('path');

async function test() {
    console.log("Testing Export Service...");
    try {
        console.log("Testing PDF...");
        const pdf = await exportService.generatePDF("Test Content PDF", "test.pdf");
        console.log("PDF OK:", pdf);

        console.log("Testing Word...");
        const word = await exportService.generateWord("Test Content Word", "test.docx");
        console.log("Word OK:", word);

        console.log("Testing Excel...");
        const excel = await exportService.generateExcel([{ a: 1, b: 2 }], "test.xlsx");
        console.log("Excel OK:", excel);

        process.exit(0);
    } catch (err) {
        console.error("Export Test FAILED:", err);
        process.exit(1);
    }
}

test();
