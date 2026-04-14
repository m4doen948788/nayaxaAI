const axios = require('axios');
const fs = require('fs');

const mobileHeaders = {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7'
};

const desktopHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7'
};

async function test(query) {
    try {
        console.log(`Testing Bing with Mobile Headers for: ${query}`);
        const resBing = await axios.get(`https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=id`, { headers: mobileHeaders, timeout: 15000 });
        fs.writeFileSync('bing-mobile-raw.html', resBing.data);
        console.log('Bing Mobile Raw saved.');

        console.log(`Testing Bing with Desktop Headers for: ${query}`);
        const resBingD = await axios.get(`https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=id`, { headers: desktopHeaders, timeout: 15000 });
        fs.writeFileSync('bing-desktop-raw.html', resBingD.data);
        console.log('Bing Desktop Raw saved.');

        console.log(`Testing Google with Mobile Headers for: ${query}`);
        const resG = await axios.get(`https://www.google.com/search?q=${encodeURIComponent(query)}&hl=id`, { headers: mobileHeaders, timeout: 15000 });
        fs.writeFileSync('google-mobile-raw.html', resG.data);
        console.log('Google Mobile Raw saved.');

    } catch (e) {
        console.error('Test Failed:', e.message);
    }
}

test('siapa bupati bogor 2025-2030');
