const fs = require('fs');
const path = 'd:\\copy-dashboard\\Backend\\nayaxa_forensic.log';
const content = fs.readFileSync(path, 'utf8');
const lines = content.split('\n');
fs.writeFileSync('line-152.txt', lines[151]);
console.log('Line 152 saved to line-152.txt');
