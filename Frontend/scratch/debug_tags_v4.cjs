const fs = require('fs');
const content = fs.readFileSync('d:/nayaxa-engine/Frontend/src/features/chat/components/Chat.tsx', 'utf8');

const lines = content.split('\n');
let stack = [];

lines.forEach((line, i) => {
    const row = i + 1;
    // Match <tag, </tag, or <tag ... />
    const tagRegex = /<(div|motion\.[a-z]+)|<\/(div|motion\.[a-z]+)>|<(div|motion\.[a-z]+)[^>]*\/>/gi;
    let match;
    while ((match = tagRegex.exec(line)) !== null) {
        const fullTag = match[0];
        if (fullTag.endsWith('/>')) {
            // Self-closing, do nothing to stack
            // console.log(`[Line ${row}] Self-closing: ${fullTag}`);
        } else if (fullTag.startsWith('</')) {
            const type = match[2].toLowerCase();
            if (stack.length === 0) {
                console.log(`[Line ${row}] Extra closing: ${fullTag}`);
            } else {
                const last = stack.pop();
                if (last.type !== type) {
                    console.log(`[Line ${row}] Mismatch: ${fullTag} closes ${last.tag} from line ${last.row}`);
                }
            }
        } else {
            const type = match[1].toLowerCase();
            stack.push({ tag: fullTag, type, row });
        }
    }
});

stack.forEach(item => {
    console.log(`[Line ${item.row}] Unclosed: ${item.tag}`);
});
