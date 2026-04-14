const fs = require('fs');
const path = 'd:\\copy-dashboard\\Backend\\nayaxa_forensic.log';
const content = fs.readFileSync(path, 'utf8');
const lines = content.split('\n');
console.log(lines[151]); // Line 152 is index 151
