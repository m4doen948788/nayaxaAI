const fs = require('fs');
const content = fs.readFileSync('d:/nayaxa-engine/Frontend/src/features/chat/components/Chat.tsx', 'utf8');

const regex = /<(div|\/div)|<(motion\.[a-z]+|\/motion\.[a-z]+)/gi;
let match;
let stack = [];

const lines = content.split('\n');

lines.forEach((line, i) => {
    const row = i + 1;
    let lineMatch;
    const lineRegex = /<(div|\/div)|<(motion\.[a-z]+|\/motion\.[a-z]+)/gi;
    while ((lineMatch = lineRegex.exec(line)) !== null) {
        const tag = lineMatch[0].toLowerCase();
        if (tag.startsWith('</')) {
            const closingType = tag.substring(2);
            if (stack.length === 0) {
                console.log(`[Line ${row}] Extra closing tag: ${tag}`);
            } else {
                const last = stack.pop();
                if (last.type !== closingType) {
                    console.log(`[Line ${row}] Mismatch: ${tag} closes ${last.tag} from line ${last.row}`);
                }
            }
        } else {
            const openingType = tag.substring(1);
            stack.push({ tag, type: openingType, row });
        }
    }
});

stack.forEach(item => {
    console.log(`[Line ${item.row}] Unclosed tag: ${item.tag}`);
});
