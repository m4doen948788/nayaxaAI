const nayaxaBrowser = require('./src/services/nayaxaBrowserService');
const fs = require('fs');
async function run() {
    const url = `https://www.google.com/search?q=muflikha+mayazi&hl=id&gl=id`;
    const html = await nayaxaBrowser.executeSearch(url, () => document.documentElement.outerHTML);
    fs.writeFileSync('dump.html', html || 'no html');
    console.log('done writing dump.html');
    await nayaxaBrowser.closeBrowser();
}
run();
