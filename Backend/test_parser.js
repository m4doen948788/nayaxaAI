const fs = require('fs');
const cheerio = require('cheerio');

const html = fs.readFileSync('bing_test.html', 'utf8');
const $ = cheerio.load(html);
const classes = {};
$('*').each((i, el) => {
    const cls = $(el).attr('class');
    if (cls) {
        cls.split(/\s+/).forEach(c => {
            classes[c] = (classes[c] || 0) + 1;
        });
    }
});

const sortedClasses = Object.entries(classes).sort((a, b) => b[1] - a[1]);
console.log('Top Classes found:', sortedClasses.slice(0, 50));

console.log('--- SEARCHING FOR TITLES ---');
$('h2, h3').each((i, el) => {
    console.log(`[${el.tagName}] ${$(el).text().trim()}`);
});


