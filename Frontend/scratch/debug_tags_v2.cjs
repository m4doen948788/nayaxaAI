const fs = require('fs');
const lines = fs.readFileSync('d:/nayaxa-engine/Frontend/src/features/chat/components/Chat.tsx', 'utf8').split('\n');

let stack = [];
lines.forEach((line, i) => {
    const row = i + 1;
    const openings = line.match(/<div/g) || [];
    const closings = line.match(/<\/div>/g) || [];
    
    openings.forEach(() => stack.push(row));
    closings.forEach(() => {
        if (stack.length > 0) {
            stack.pop();
        } else {
            console.log(`Extra closing </div> at line ${row}`);
        }
    });
});

stack.forEach(row => {
    console.log(`Unclosed <div> starting at line ${row}`);
});
