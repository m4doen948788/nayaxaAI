const fs = require('fs');
const content = fs.readFileSync('d:/nayaxa-engine/Frontend/src/features/chat/components/Chat.tsx', 'utf8');

let openDivs = 0;
let closeDivs = 0;
let openMotions = 0;
let closeMotions = 0;
let openParentheses = 0;
let closeParentheses = 0;
let openBraces = 0;
let closeBraces = 0;

// Simple regex (won't handle everything but might give a hint)
openDivs = (content.match(/<div/g) || []).length;
closeDivs = (content.match(/<\/div>/g) || []).length;
openMotions = (content.match(/<motion\./g) || []).length;
closeMotions = (content.match(/<\/motion\./g) || []).length;
openParentheses = (content.match(/\(/g) || []).length;
closeParentheses = (content.match(/\)/g) || []).length;
openBraces = (content.match(/\{/g) || []).length;
closeBraces = (content.match(/\}/g) || []).length;

console.log(`Divs: ${openDivs} / ${closeDivs}`);
console.log(`Motions: ${openMotions} / ${closeMotions}`);
console.log(`Parentheses: ${openParentheses} / ${closeParentheses}`);
console.log(`Braces: ${openBraces} / ${closeBraces}`);
