const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

async function checkFiles() {
    const exportDir = 'd:\\nayaxa-engine\\Backend\\uploads\\exports';
    const files = fs.readdirSync(exportDir).filter(f => f.endsWith('.xlsx'));
    
    for (const file of files) {
        const filePath = path.join(exportDir, file);
        const stats = fs.statSync(filePath);
        console.log(`Checking ${file} (${stats.size} bytes)...`);
        
        try {
            const workbook = new ExcelJS.Workbook();
            await workbook.xlsx.readFile(filePath);
            console.log(`  [OK] ${file} is valid.`);
        } catch (err) {
            console.error(`  [CORRUPT] ${file} error: ${err.message}`);
        }
    }
}

checkFiles();
