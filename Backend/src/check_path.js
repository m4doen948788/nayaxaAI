const path = require('path');
const fs = require('fs');

const __dirname_sim = 'd:\\nayaxa-engine\\Backend\\src';
const DASHBOARD_UPLOADS = path.join(__dirname_sim, '../../../copy-dashboard/Backend/uploads');
const testFile = '1776656402199-813308999.pdf';
const fullPath = path.join(DASHBOARD_UPLOADS, testFile);

console.log('__dirname:', __dirname_sim);
console.log('DASHBOARD_UPLOADS:', DASHBOARD_UPLOADS);
console.log('Test File Path:', fullPath);
console.log('Exists:', fs.existsSync(fullPath));
